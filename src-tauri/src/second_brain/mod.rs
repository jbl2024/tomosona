use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::{ensure_index_schema, now_ms, open_db, settings, AppError, Result};

pub mod config;
mod context;
pub mod draft;
mod draft_publish;
mod frontmatter_generation;
pub mod llm;
mod message_flow;
pub mod modes;
pub mod openai_codex;
mod paths;
mod prompt_builder;
mod pulse_flow;
pub mod session_store;
mod stream_control;

use config::{active_profile, validate_config, ConfigStatus, SecondBrainConfig};
use context::load_context_items;
use draft::{delete_draft, read_draft, write_draft};
use draft_publish::{
    append_message_to_draft, export_session_markdown, insert_assistant_into_target_note_impl,
    publish_draft_to_existing_note, publish_draft_to_new_note, save_draft,
    set_session_target_note_impl,
};
use frontmatter_generation::{
    generate_frontmatter_properties as generate_frontmatter_properties_impl,
    GenerateFrontmatterPropertiesPayload, GenerateFrontmatterPropertiesResult,
};
use message_flow::send_message;
use openai_codex::{discover_models, has_codex_tokens, CodexDiscoveredModel};
use pulse_flow::run_pulse;
use session_store::{
    create_session, delete_session, list_sessions, load_session, set_session_alter_id,
    upsert_context,
};
use stream_control::request_stream_cancel;

const SESSION_PREFIX: &str = "sb";
static ID_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentMeta {
    pub id: String,
    pub kind: String,
    pub mime: String,
    pub name: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateSessionPayload {
    pub title: Option<String>,
    pub context_paths: Vec<String>,
    pub alter_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CreateSessionResult {
    pub session_id: String,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateContextPayload {
    pub session_id: String,
    pub context_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateContextResult {
    pub token_estimate: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SendMessagePayload {
    pub session_id: String,
    pub mode: String,
    pub message: String,
    pub alter_id: Option<String>,
    #[serde(default)]
    pub attachments: Vec<AttachmentMeta>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetSessionAlterPayload {
    pub session_id: String,
    pub alter_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetSessionAlterResult {
    pub alter_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SendMessageResult {
    pub user_message_id: String,
    pub assistant_message_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StreamEvent {
    pub session_id: String,
    pub message_id: String,
    pub chunk: String,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PulseSourceKind {
    EditorSelection,
    EditorNote,
    SecondBrainContext,
    CosmosFocus,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RunPulseTransformationPayload {
    pub request_id: Option<String>,
    pub source_kind: PulseSourceKind,
    pub action_id: String,
    pub instructions: Option<String>,
    #[serde(default)]
    pub context_paths: Vec<String>,
    pub source_text: Option<String>,
    pub selection_label: Option<String>,
    pub session_id: Option<String>,
    pub cosmos_selected_node_id: Option<String>,
    #[serde(default)]
    pub cosmos_neighbor_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunPulseTransformationResult {
    pub request_id: String,
    pub output_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PulseStreamEvent {
    pub request_id: String,
    pub output_id: String,
    pub chunk: String,
    pub done: bool,
    pub error: Option<String>,
    pub title: Option<String>,
    pub provenance_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CancelStreamPayload {
    pub session_id: String,
    pub message_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveDraftPayload {
    pub session_id: String,
    pub content_md: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AppendMessageToDraftPayload {
    pub session_id: String,
    pub message_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PublishDraftToNewNotePayload {
    pub session_id: String,
    pub target_dir: String,
    pub file_name: String,
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublishDraftToNewNoteResult {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PublishDraftToExistingNotePayload {
    pub session_id: String,
    pub target_path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetSessionTargetNotePayload {
    pub session_id: String,
    pub target_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetSessionTargetNoteResult {
    pub target_note_path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InsertAssistantIntoTargetPayload {
    pub session_id: String,
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct InsertAssistantIntoTargetResult {
    pub target_note_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportSessionMarkdownResult {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CancelPulseStreamPayload {
    pub request_id: String,
    pub output_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WriteGlobalConfigPayload {
    pub content_json: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WriteGlobalConfigResult {
    pub path: String,
}

/// Loads the user-facing Second Brain config and normalizes backend failures to safe IPC errors.
pub(super) fn load_config() -> Result<SecondBrainConfig> {
    settings::load_llm_for_runtime().map_err(|err| {
        if matches!(err, AppError::InvalidOperation(_)) {
            err
        } else {
            AppError::InvalidOperation("Second Brain configuration is unavailable.".to_string())
        }
    })
}

pub(super) fn next_id(prefix: &str) -> String {
    let seq = ID_SEQ.fetch_add(1, Ordering::SeqCst);
    format!("{prefix}-{}-{seq}", now_ms())
}

pub(super) fn session_exists(conn: &rusqlite::Connection, session_id: &str) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM second_brain_sessions WHERE id = ?1",
        params![session_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

#[tauri::command]
pub fn read_second_brain_config_status() -> Result<ConfigStatus> {
    match load_config() {
        Ok(config) => {
            let active = active_profile(&config).ok_or_else(|| {
                AppError::InvalidOperation("active profile is missing from config.".to_string())
            })?;
            if active.provider.trim().eq_ignore_ascii_case("openai-codex") && !has_codex_tokens() {
                return Ok(ConfigStatus {
                    configured: false,
                    provider: Some(active.provider.clone()),
                    model: Some(active.model.clone()),
                    profile_id: Some(active.id.clone()),
                    supports_streaming: false,
                    supports_image_input: false,
                    supports_audio_input: false,
                    error: Some(
                        "OpenAI Codex is not authenticated. Run `codex auth login`.".to_string(),
                    ),
                });
            }
            Ok(ConfigStatus {
                configured: true,
                provider: Some(active.provider.clone()),
                model: Some(active.model.clone()),
                profile_id: Some(active.id.clone()),
                supports_streaming: active.capabilities.streaming,
                supports_image_input: active.capabilities.image_input,
                supports_audio_input: active.capabilities.audio_input,
                error: None,
            })
        }
        Err(err) => Ok(ConfigStatus {
            configured: false,
            provider: None,
            model: None,
            profile_id: None,
            supports_streaming: false,
            supports_image_input: false,
            supports_audio_input: false,
            error: Some(err.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn generate_frontmatter_properties(
    payload: GenerateFrontmatterPropertiesPayload,
) -> Result<GenerateFrontmatterPropertiesResult> {
    generate_frontmatter_properties_impl(payload).await
}

#[tauri::command]
pub async fn discover_codex_models() -> Result<Vec<CodexDiscoveredModel>> {
    discover_models().await.map_err(AppError::InvalidOperation)
}

#[tauri::command]
pub fn write_second_brain_global_config(
    payload: WriteGlobalConfigPayload,
) -> Result<WriteGlobalConfigResult> {
    let parsed: SecondBrainConfig =
        serde_json::from_str(payload.content_json.trim()).map_err(|_| {
            AppError::InvalidOperation("Second Brain configuration is invalid JSON.".to_string())
        })?;
    validate_config(&parsed).map_err(|message| {
        AppError::InvalidOperation(format!("Second Brain configuration error: {message}"))
    })?;

    let path = settings::write_llm_only(parsed)?;
    Ok(WriteGlobalConfigResult {
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn create_second_brain_session(payload: CreateSessionPayload) -> Result<CreateSessionResult> {
    let config = load_config()?;
    let active = active_profile(&config).ok_or_else(|| {
        AppError::InvalidOperation("active profile is missing from config.".to_string())
    })?;

    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    let session_id = next_id(SESSION_PREFIX);
    let title = payload
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Second Brain Session")
        .to_string();

    let (created_at_ms, _updated_at_ms) = create_session(
        &conn,
        &session_id,
        &title,
        &active.provider,
        &active.model,
        payload.alter_id.as_deref().unwrap_or("").trim(),
    )?;

    let context_items = load_context_items(&payload.context_paths)?;
    let _ = upsert_context(&conn, &session_id, &context_items)?;
    write_draft(&session_id, "")?;

    Ok(CreateSessionResult {
        session_id,
        created_at_ms,
    })
}

#[tauri::command]
pub fn set_second_brain_session_alter(
    payload: SetSessionAlterPayload,
) -> Result<SetSessionAlterResult> {
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    if !session_exists(&conn, &payload.session_id)? {
        return Err(AppError::InvalidOperation(
            "Second Brain session not found.".to_string(),
        ));
    }
    let alter_id = payload.alter_id.unwrap_or_default().trim().to_string();
    if !alter_id.is_empty() {
        let _ = crate::alters::resolve_invocation_prompt(&conn, Some(&alter_id))?;
    }
    set_session_alter_id(&conn, &payload.session_id, &alter_id)?;
    Ok(SetSessionAlterResult { alter_id })
}

#[tauri::command]
pub fn list_second_brain_sessions(
    limit: Option<usize>,
) -> Result<Vec<session_store::SessionSummary>> {
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    list_sessions(&conn, limit.unwrap_or(80).clamp(1, 250))
}

#[tauri::command]
pub fn load_second_brain_session(session_id: String) -> Result<session_store::SessionPayload> {
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    let draft_content = read_draft(&session_id)?;
    load_session(&conn, &session_id, draft_content)
}

#[tauri::command]
pub fn delete_second_brain_session(session_id: String) -> Result<()> {
    let conn = open_db()?;
    if !session_exists(&conn, &session_id)? {
        return Err(AppError::InvalidOperation(
            "Second Brain session not found.".to_string(),
        ));
    }
    delete_session(&conn, &session_id)?;
    delete_draft(&session_id)?;
    Ok(())
}

#[tauri::command]
pub fn update_second_brain_context(payload: UpdateContextPayload) -> Result<UpdateContextResult> {
    let conn = open_db()?;
    if !session_exists(&conn, &payload.session_id)? {
        return Err(AppError::InvalidOperation(
            "Second Brain session not found.".to_string(),
        ));
    }
    let context_items = load_context_items(&payload.context_paths)?;
    let token_estimate = upsert_context(&conn, &payload.session_id, &context_items)?;
    Ok(UpdateContextResult { token_estimate })
}

#[tauri::command]
pub fn cancel_second_brain_stream(payload: CancelStreamPayload) -> Result<()> {
    if payload.session_id.trim().is_empty() {
        return Err(AppError::InvalidOperation(
            "Second Brain session not found.".to_string(),
        ));
    }
    request_stream_cancel(&payload.session_id, payload.message_id.as_deref());
    Ok(())
}

#[tauri::command]
pub fn cancel_pulse_stream(payload: CancelPulseStreamPayload) -> Result<()> {
    if payload.request_id.trim().is_empty() {
        return Err(AppError::InvalidOperation(
            "Pulse request not found.".to_string(),
        ));
    }
    request_stream_cancel(&payload.request_id, payload.output_id.as_deref());
    Ok(())
}

#[tauri::command]
pub async fn run_pulse_transformation(
    app: AppHandle,
    payload: RunPulseTransformationPayload,
) -> Result<RunPulseTransformationResult> {
    run_pulse(app, payload).await
}

#[tauri::command]
pub async fn send_second_brain_message(
    app: AppHandle,
    payload: SendMessagePayload,
) -> Result<SendMessageResult> {
    send_message(app, payload).await
}

#[tauri::command]
pub fn set_second_brain_session_target_note(
    payload: SetSessionTargetNotePayload,
) -> Result<SetSessionTargetNoteResult> {
    set_session_target_note_impl(payload)
}

#[tauri::command]
pub fn insert_second_brain_assistant_into_target_note(
    payload: InsertAssistantIntoTargetPayload,
) -> Result<InsertAssistantIntoTargetResult> {
    insert_assistant_into_target_note_impl(payload)
}

#[tauri::command]
pub fn export_second_brain_session_markdown(
    session_id: String,
) -> Result<ExportSessionMarkdownResult> {
    export_session_markdown(session_id)
}

#[tauri::command]
pub fn save_second_brain_draft(payload: SaveDraftPayload) -> Result<()> {
    save_draft(payload)
}

#[tauri::command]
pub fn append_message_to_second_brain_draft(
    payload: AppendMessageToDraftPayload,
) -> Result<String> {
    append_message_to_draft(payload)
}

#[tauri::command]
pub fn publish_second_brain_draft_to_new_note(
    payload: PublishDraftToNewNotePayload,
) -> Result<PublishDraftToNewNoteResult> {
    publish_draft_to_new_note(payload)
}

#[tauri::command]
pub fn publish_second_brain_draft_to_existing_note(
    payload: PublishDraftToExistingNotePayload,
) -> Result<()> {
    publish_draft_to_existing_note(payload)
}
