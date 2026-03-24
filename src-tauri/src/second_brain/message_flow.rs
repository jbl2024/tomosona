//! Assistant message workflow for Second Brain sessions.
//!
//! The command wrapper stays in `mod.rs`, while this module owns the concrete flow:
//! validate payload, persist the user message, build the prompt, run the LLM, persist
//! the assistant response, and emit streaming lifecycle events.

use rusqlite::params;
use tauri::{AppHandle, Emitter};

use super::{
    config::active_profile,
    context::{load_prioritized_session_entries, read_session_messages},
    llm::{run_llm, run_llm_stream},
    load_config,
    modes::resolve_mode_prompt,
    next_id,
    prompt_builder::{build_user_prompt, normalize_title_from_first_message},
    session_exists,
    session_store::{insert_message, update_session_title, MessageRow},
    stream_control::consume_stream_cancel,
    AppError, Result, SendMessagePayload, SendMessageResult, StreamEvent,
};
use crate::alters::{
    effective_generation_temperature, resolve_invocation_prompt, resolve_invocation_temperature,
};
use crate::ensure_index_schema;

/// Runs the complete assistant message flow while preserving the existing IPC events.
pub(super) async fn send_message(
    app: AppHandle,
    payload: SendMessagePayload,
) -> Result<SendMessageResult> {
    let config = load_config()?;
    let active = active_profile(&config)
        .ok_or_else(|| {
            AppError::InvalidOperation("active profile is missing from config.".to_string())
        })?
        .clone();

    validate_send_message(&payload, &active.capabilities)?;

    let conn = super::super::open_db()?;
    ensure_index_schema(&conn)?;
    if !session_exists(&conn, &payload.session_id)? {
        return Err(AppError::InvalidOperation(
            "Second Brain session not found.".to_string(),
        ));
    }

    let session_alter_id: String = conn
        .query_row(
            "SELECT COALESCE(alter_id, '') FROM second_brain_sessions WHERE id = ?1",
            params![payload.session_id.clone()],
            |row| row.get(0),
        )
        .unwrap_or_default();
    let effective_alter_id = payload
        .alter_id
        .as_deref()
        .unwrap_or(&session_alter_id)
        .trim()
        .to_string();
    let effective_temperature = effective_generation_temperature(resolve_invocation_temperature(
        Some(&effective_alter_id),
    )?);

    let user_message_id = next_id("sbm-user");
    let assistant_message_id = next_id("sbm-assistant");
    if consume_stream_cancel(&payload.session_id, &assistant_message_id) {
        return Err(AppError::InvalidOperation(
            "Generation canceled.".to_string(),
        ));
    }

    persist_user_message(&conn, &payload, &user_message_id)?;
    maybe_update_title_from_first_user_message(&conn, &payload.session_id, &payload.message)?;

    let context_entries = load_prioritized_session_entries(&payload.session_id, &payload.message)?;
    let history_messages = read_session_messages(&conn, &payload.session_id)?
        .into_iter()
        .filter(|item| item.id != user_message_id)
        .collect::<Vec<_>>();
    let mode_prompt = resolve_mode_prompt(&payload.mode);
    let built_prompt = build_user_prompt(
        &payload.session_id,
        &payload.message,
        &history_messages,
        &context_entries,
        resolve_invocation_prompt(&conn, Some(&effective_alter_id))?.as_deref(),
    );

    emit_assistant_start(&app, &payload.session_id, &assistant_message_id);

    let answer = run_assistant_generation(
        &app,
        &active,
        &payload.session_id,
        &assistant_message_id,
        &mode_prompt,
        &built_prompt.user_prompt,
        effective_temperature,
    )
    .await?;

    let citations = build_citations(&built_prompt.included_context_paths);
    persist_assistant_message(&conn, &payload, &assistant_message_id, &answer, &citations)?;
    emit_assistant_complete(&app, &payload.session_id, &assistant_message_id, &answer);

    Ok(SendMessageResult {
        user_message_id,
        assistant_message_id,
    })
}

fn validate_send_message(
    payload: &SendMessagePayload,
    capabilities: &super::config::ProfileCapabilities,
) -> Result<()> {
    if !capabilities.text {
        return Err(AppError::InvalidOperation(
            "The active profile does not support text generation.".to_string(),
        ));
    }
    if payload.message.trim().is_empty() {
        return Err(AppError::InvalidOperation(
            "Message must not be empty.".to_string(),
        ));
    }
    if !payload.attachments.is_empty() && !capabilities.image_input && !capabilities.audio_input {
        return Err(AppError::InvalidOperation(
            "Attachments are not supported by the active profile.".to_string(),
        ));
    }
    Ok(())
}

fn persist_user_message(
    conn: &rusqlite::Connection,
    payload: &SendMessagePayload,
    user_message_id: &str,
) -> Result<()> {
    let user_message = MessageRow {
        id: user_message_id.to_string(),
        role: "user".to_string(),
        mode: payload.mode.clone(),
        content_md: payload.message.clone(),
        citations_json: "[]".to_string(),
        attachments_json: serde_json::to_string(&payload.attachments)
            .unwrap_or_else(|_| "[]".to_string()),
        created_at_ms: super::super::now_ms(),
    };
    insert_message(conn, &user_message, &payload.session_id)
}

fn maybe_update_title_from_first_user_message(
    conn: &rusqlite::Connection,
    session_id: &str,
    message: &str,
) -> Result<()> {
    let user_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM second_brain_messages WHERE session_id = ?1 AND role = 'user'",
        params![session_id],
        |row| row.get(0),
    )?;
    if user_count <= 1 {
        let inferred_title = normalize_title_from_first_message(message);
        let _ = update_session_title(conn, session_id, &inferred_title);
    }
    Ok(())
}

async fn run_assistant_generation(
    app: &AppHandle,
    active: &super::config::ProviderProfile,
    session_id: &str,
    assistant_message_id: &str,
    system_prompt: &str,
    user_prompt: &str,
    temperature: f64,
) -> Result<String> {
    let stream_session_id = session_id.to_string();
    let stream_message_id = assistant_message_id.to_string();
    let app_for_stream = app.clone();
    let llm_result = if active.capabilities.streaming {
        run_llm_stream(
            active,
            system_prompt,
            user_prompt,
            Some(temperature),
            move |chunk| {
                if consume_stream_cancel(&stream_session_id, &stream_message_id) {
                    return Err("Generation canceled.".to_string());
                }
                let _ = app_for_stream.emit(
                    "second-brain://assistant-delta",
                    StreamEvent {
                        session_id: stream_session_id.clone(),
                        message_id: stream_message_id.clone(),
                        chunk: chunk.to_string(),
                        done: false,
                        error: None,
                    },
                );
                Ok(())
            },
        )
        .await
    } else {
        run_llm(active, system_prompt, user_prompt, Some(temperature)).await
    };

    let answer = match llm_result {
        Ok(value) => value,
        Err(err) => {
            emit_assistant_error(app, session_id, assistant_message_id, &err);
            return Err(AppError::InvalidOperation(err));
        }
    };

    if consume_stream_cancel(session_id, assistant_message_id) {
        emit_assistant_error(
            app,
            session_id,
            assistant_message_id,
            "Generation canceled.",
        );
        return Err(AppError::InvalidOperation(
            "Generation canceled.".to_string(),
        ));
    }

    if !active.capabilities.streaming {
        let _ = app.emit(
            "second-brain://assistant-delta",
            StreamEvent {
                session_id: session_id.to_string(),
                message_id: assistant_message_id.to_string(),
                chunk: answer.clone(),
                done: false,
                error: None,
            },
        );
    }

    Ok(answer)
}

fn persist_assistant_message(
    conn: &rusqlite::Connection,
    payload: &SendMessagePayload,
    assistant_message_id: &str,
    answer: &str,
    citations: &[String],
) -> Result<()> {
    let assistant_message = MessageRow {
        id: assistant_message_id.to_string(),
        role: "assistant".to_string(),
        mode: payload.mode.clone(),
        content_md: answer.to_string(),
        citations_json: serde_json::to_string(citations).unwrap_or_else(|_| "[]".to_string()),
        attachments_json: "[]".to_string(),
        created_at_ms: super::super::now_ms(),
    };
    insert_message(conn, &assistant_message, &payload.session_id)
}

fn build_citations(paths: &[String]) -> Vec<String> {
    paths.iter().take(12).cloned().collect()
}

fn emit_assistant_start(app: &AppHandle, session_id: &str, message_id: &str) {
    let _ = app.emit(
        "second-brain://assistant-start",
        StreamEvent {
            session_id: session_id.to_string(),
            message_id: message_id.to_string(),
            chunk: String::new(),
            done: false,
            error: None,
        },
    );
}

fn emit_assistant_error(app: &AppHandle, session_id: &str, message_id: &str, error: &str) {
    let _ = app.emit(
        "second-brain://assistant-error",
        StreamEvent {
            session_id: session_id.to_string(),
            message_id: message_id.to_string(),
            chunk: String::new(),
            done: true,
            error: Some(error.to_string()),
        },
    );
}

fn emit_assistant_complete(app: &AppHandle, session_id: &str, message_id: &str, answer: &str) {
    let _ = app.emit(
        "second-brain://assistant-complete",
        StreamEvent {
            session_id: session_id.to_string(),
            message_id: message_id.to_string(),
            chunk: answer.to_string(),
            done: true,
            error: None,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::second_brain::config::ProfileCapabilities;

    #[test]
    fn rejects_empty_message() {
        let payload = SendMessagePayload {
            session_id: "s1".to_string(),
            mode: "freestyle".to_string(),
            message: "   ".to_string(),
            alter_id: None,
            attachments: Vec::new(),
        };
        let capabilities = ProfileCapabilities {
            text: true,
            ..Default::default()
        };
        assert!(validate_send_message(&payload, &capabilities).is_err());
    }

    #[test]
    fn rejects_attachments_when_profile_cannot_handle_them() {
        let payload = SendMessagePayload {
            session_id: "s1".to_string(),
            mode: "freestyle".to_string(),
            message: "hello".to_string(),
            alter_id: None,
            attachments: vec![super::super::AttachmentMeta {
                id: "a1".to_string(),
                kind: "image".to_string(),
                mime: "image/png".to_string(),
                name: "shot.png".to_string(),
                size_bytes: 1,
            }],
        };
        let capabilities = ProfileCapabilities {
            text: true,
            ..Default::default()
        };
        assert!(validate_send_message(&payload, &capabilities).is_err());
    }

    #[test]
    fn citations_are_limited_to_twelve_paths() {
        let citations = build_citations(
            &(0..20)
                .map(|idx| format!("notes/{idx}.md"))
                .collect::<Vec<_>>(),
        );
        assert_eq!(citations.len(), 12);
    }
}
