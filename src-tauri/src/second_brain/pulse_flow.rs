//! Pulse transformation workflow.
//!
//! This module validates the request, loads explicit context, builds the prompt,
//! streams deltas when supported, and emits the Pulse lifecycle events expected by
//! the frontend.

use tauri::{AppHandle, Emitter};

use super::{
    config::active_profile,
    context::load_context_entries_from_paths,
    llm::{run_llm, run_llm_stream},
    load_config, next_id,
    prompt_builder::{build_pulse_user_prompt, normalize_pulse_action_id, pulse_action_prompt},
    stream_control::consume_stream_cancel,
    AppError, PulseStreamEvent, Result, RunPulseTransformationPayload,
    RunPulseTransformationResult,
};

/// Runs the full Pulse workflow while preserving the existing IPC event contract.
pub(super) async fn run_pulse(
    app: AppHandle,
    payload: RunPulseTransformationPayload,
) -> Result<RunPulseTransformationResult> {
    let config = load_config()?;
    let active = active_profile(&config)
        .ok_or_else(|| {
            AppError::InvalidOperation("active profile is missing from config.".to_string())
        })?
        .clone();

    if !active.capabilities.text {
        return Err(AppError::InvalidOperation(
            "The active profile does not support text generation.".to_string(),
        ));
    }

    let action_id = normalize_pulse_action_id(&payload.action_id)?;
    validate_pulse_payload(&payload)?;

    let request_id = payload
        .request_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| next_id("pulse"));
    let output_id = next_id("pulse-output");
    if consume_stream_cancel(&request_id, &output_id) {
        return Err(AppError::InvalidOperation("Generation canceled.".to_string()));
    }

    let context_entries = load_context_entries_from_paths(&payload.context_paths)?;
    let built_prompt = build_pulse_user_prompt(&payload, &action_id, &context_entries);
    let provenance_paths = built_prompt.included_context_paths.clone();

    emit_pulse_start(&app, &request_id, &output_id, &provenance_paths);

    let answer = run_pulse_generation(
        &app,
        &active,
        &request_id,
        &output_id,
        &action_id,
        &built_prompt.user_prompt,
    )
    .await?;

    let title = pulse_completion_title(&action_id);
    let _ = app.emit(
        "pulse://complete",
        PulseStreamEvent {
            request_id: request_id.clone(),
            output_id: output_id.clone(),
            chunk: answer,
            done: true,
            error: None,
            title: Some(title),
            provenance_paths: built_prompt.included_context_paths,
        },
    );

    Ok(RunPulseTransformationResult {
        request_id,
        output_id,
    })
}

fn validate_pulse_payload(payload: &RunPulseTransformationPayload) -> Result<()> {
    let has_source_text = payload
        .source_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    if !has_source_text && payload.context_paths.is_empty() {
        return Err(AppError::InvalidOperation(
            "Pulse needs source text or note context.".to_string(),
        ));
    }
    Ok(())
}

async fn run_pulse_generation(
    app: &AppHandle,
    active: &super::config::ProviderProfile,
    request_id: &str,
    output_id: &str,
    action_id: &str,
    user_prompt: &str,
) -> Result<String> {
    let request_id_for_stream = request_id.to_string();
    let output_id_for_stream = output_id.to_string();
    let app_for_stream = app.clone();
    let llm_result = if active.capabilities.streaming {
        run_llm_stream(
            active,
            pulse_action_prompt(action_id),
            user_prompt,
            move |chunk| {
                if consume_stream_cancel(&request_id_for_stream, &output_id_for_stream) {
                    return Err("Generation canceled.".to_string());
                }
                let _ = app_for_stream.emit(
                    "pulse://delta",
                    PulseStreamEvent {
                        request_id: request_id_for_stream.clone(),
                        output_id: output_id_for_stream.clone(),
                        chunk: chunk.to_string(),
                        done: false,
                        error: None,
                        title: None,
                        provenance_paths: Vec::new(),
                    },
                );
                Ok(())
            },
        )
        .await
    } else {
        run_llm(active, pulse_action_prompt(action_id), user_prompt).await
    };

    let answer = match llm_result {
        Ok(value) => value,
        Err(err) => {
            emit_pulse_error(app, request_id, output_id, &err, Vec::new());
            return Err(AppError::InvalidOperation(err));
        }
    };

    if consume_stream_cancel(request_id, output_id) {
        emit_pulse_error(
            app,
            request_id,
            output_id,
            "Generation canceled.",
            Vec::new(),
        );
        return Err(AppError::InvalidOperation("Generation canceled.".to_string()));
    }

    if !active.capabilities.streaming {
        let _ = app.emit(
            "pulse://delta",
            PulseStreamEvent {
                request_id: request_id.to_string(),
                output_id: output_id.to_string(),
                chunk: answer.clone(),
                done: false,
                error: None,
                title: None,
                provenance_paths: Vec::new(),
            },
        );
    }

    Ok(answer)
}

fn pulse_completion_title(action_id: &str) -> String {
    format!("Pulse {}", action_id.replace('_', " "))
}

fn emit_pulse_start(
    app: &AppHandle,
    request_id: &str,
    output_id: &str,
    provenance_paths: &[String],
) {
    let _ = app.emit(
        "pulse://start",
        PulseStreamEvent {
            request_id: request_id.to_string(),
            output_id: output_id.to_string(),
            chunk: String::new(),
            done: false,
            error: None,
            title: None,
            provenance_paths: provenance_paths.to_vec(),
        },
    );
}

fn emit_pulse_error(
    app: &AppHandle,
    request_id: &str,
    output_id: &str,
    error: &str,
    provenance_paths: Vec<String>,
) {
    let _ = app.emit(
        "pulse://error",
        PulseStreamEvent {
            request_id: request_id.to_string(),
            output_id: output_id.to_string(),
            chunk: String::new(),
            done: true,
            error: Some(error.to_string()),
            title: None,
            provenance_paths,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload() -> RunPulseTransformationPayload {
        RunPulseTransformationPayload {
            request_id: Some("pulse-test".to_string()),
            source_kind: super::super::PulseSourceKind::EditorSelection,
            action_id: "rewrite".to_string(),
            instructions: None,
            context_paths: Vec::new(),
            source_text: Some("hello".to_string()),
            selection_label: None,
            session_id: None,
            cosmos_selected_node_id: None,
            cosmos_neighbor_paths: Vec::new(),
        }
    }

    #[test]
    fn rejects_pulse_without_source_or_context() {
        let mut payload = payload();
        payload.source_text = None;
        assert!(validate_pulse_payload(&payload).is_err());
    }

    #[test]
    fn completion_title_tracks_action_id() {
        assert_eq!(pulse_completion_title("identify_tensions"), "Pulse identify tensions");
    }

    #[test]
    fn request_id_is_preserved_by_command_contract() {
        assert_eq!(payload().request_id.as_deref(), Some("pulse-test"));
    }
}
