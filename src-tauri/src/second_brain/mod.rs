use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::{
    active_workspace_root, normalize_workspace_relative_path, now_ms, open_db,
    reindex_markdown_file_now_sync, settings, AppError, Result,
};

pub mod config;
pub mod draft;
pub mod llm;
pub mod modes;
pub mod openai_codex;
pub mod session_store;

use config::{active_profile, validate_config, ConfigStatus, SecondBrainConfig};
use draft::{delete_draft, read_draft, write_draft};
use llm::{run_llm, run_llm_stream};
use modes::resolve_mode_prompt;
use openai_codex::{discover_models, has_codex_tokens, CodexDiscoveredModel};
use session_store::{
    create_session, delete_session, estimate_tokens, insert_message, list_sessions, load_session,
    set_target_note_path, update_session_title, upsert_context, ContextItem, MessageRow,
};

const SESSION_PREFIX: &str = "sb";
const SB_HISTORY_WINDOW: usize = 12;
const SB_PROMPT_BUDGET_TOKENS: usize = 10_000;
const SB_HISTORY_BUDGET_TOKENS: usize = 3_000;
const SB_CONTEXT_BUDGET_TOKENS: usize = 6_500;
const SB_MAX_FILE_TOKENS: usize = 1_200;
const SB_PROMPT_OVERHEAD_TOKENS: usize = 500;
const TRUNCATION_MARKER: &str = "\n[CONTENU TRONQUE]\n";

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
    #[serde(default)]
    pub attachments: Vec<AttachmentMeta>,
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

fn load_config() -> Result<SecondBrainConfig> {
    settings::load_llm_for_runtime().map_err(|err| {
        if matches!(err, AppError::InvalidOperation(_)) {
            err
        } else {
            AppError::InvalidOperation("Second Brain configuration is unavailable.".to_string())
        }
    })
}

#[derive(Debug, Clone, Deserialize)]
pub struct WriteGlobalConfigPayload {
    pub content_json: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WriteGlobalConfigResult {
    pub path: String,
}

fn normalize_markdown_path(path: &str) -> Result<String> {
    let root = active_workspace_root()?;
    let candidate = PathBuf::from(path);
    if !candidate.exists() || !candidate.is_file() {
        return Err(AppError::InvalidPath);
    }
    let canonical = fs::canonicalize(candidate)?;
    if !canonical.starts_with(&root) {
        return Err(AppError::InvalidPath);
    }
    let ext_ok = canonical
        .extension()
        .and_then(|item| item.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false);
    if !ext_ok {
        return Err(AppError::InvalidOperation(
            "Only markdown notes can be used in Second Brain context.".to_string(),
        ));
    }
    normalize_workspace_relative_path(&root, &canonical)
}

fn normalize_workspace_markdown_relative(path: &str) -> Result<String> {
    let root = active_workspace_root()?;
    let candidate = PathBuf::from(path);
    if !candidate.exists() || !candidate.is_file() {
        return Err(AppError::InvalidPath);
    }
    let canonical = fs::canonicalize(candidate)?;
    if !canonical.starts_with(&root) {
        return Err(AppError::InvalidPath);
    }
    let ext_ok = canonical
        .extension()
        .and_then(|item| item.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false);
    if !ext_ok {
        return Err(AppError::InvalidOperation(
            "Target note must be markdown.".to_string(),
        ));
    }
    normalize_workspace_relative_path(&root, &canonical)
}

fn next_id(prefix: &str) -> String {
    let seq = ID_SEQ.fetch_add(1, Ordering::SeqCst);
    format!("{prefix}-{}-{seq}", now_ms())
}

fn load_context_items(paths: &[String]) -> Result<Vec<ContextItem>> {
    let root = active_workspace_root()?;
    let mut out = Vec::new();
    for path in paths {
        let normalized = normalize_markdown_path(path)?;
        let content = fs::read_to_string(root.join(&normalized))?;
        out.push(ContextItem {
            path: normalized,
            token_estimate: estimate_tokens(&content),
        });
    }
    Ok(out)
}

#[derive(Debug, Clone)]
struct ContextPromptEntry {
    path: String,
    content: String,
}

#[derive(Debug, Clone)]
struct BuiltPrompt {
    user_prompt: String,
    included_context_paths: Vec<String>,
}

fn normalize_mention_candidate(raw: &str) -> Option<String> {
    let trimmed = raw.trim_matches(|ch: char| {
        matches!(
            ch,
            '(' | ')'
                | '['
                | ']'
                | '{'
                | '}'
                | '<'
                | '>'
                | '"'
                | '\''
                | '`'
                | ','
                | '.'
                | ';'
                | ':'
                | '!'
                | '?'
        )
    });
    if !trimmed.starts_with('@') {
        return None;
    }
    let path = trimmed[1..].trim();
    if path.is_empty() {
        return None;
    }
    let normalized = path.trim_start_matches("./").replace('\\', "/");
    let lower = normalized.to_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".markdown") {
        Some(normalized)
    } else {
        None
    }
}

fn extract_mentioned_markdown_paths(message: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for token in message.split_whitespace() {
        if let Some(path) = normalize_mention_candidate(token) {
            let key = path.to_lowercase();
            if seen.insert(key) {
                out.push(path);
            }
        }
    }
    out
}

fn prioritize_context_items(
    context_items: &[ContextItem],
    mentions: &[String],
) -> Vec<ContextItem> {
    let mention_set: HashSet<String> = mentions.iter().map(|item| item.to_lowercase()).collect();
    let mut prioritized = Vec::with_capacity(context_items.len());
    for item in context_items {
        if mention_set.contains(&item.path.to_lowercase()) {
            prioritized.push(item.clone());
        }
    }
    for item in context_items {
        if !mention_set.contains(&item.path.to_lowercase()) {
            prioritized.push(item.clone());
        }
    }
    prioritized
}

fn truncate_text_for_tokens(text: &str, max_tokens: usize) -> String {
    if max_tokens == 0 {
        return String::new();
    }
    if estimate_tokens(text) <= max_tokens {
        return text.to_string();
    }

    let max_chars = max_tokens.saturating_mul(4);
    let marker_len = TRUNCATION_MARKER.chars().count();
    if max_chars <= marker_len + 32 {
        return TRUNCATION_MARKER.trim().to_string();
    }

    let keep_each = (max_chars - marker_len) / 2;
    let start: String = text.chars().take(keep_each).collect();
    let end_vec: Vec<char> = text.chars().rev().take(keep_each).collect();
    let end: String = end_vec.into_iter().rev().collect();
    format!("{start}{TRUNCATION_MARKER}{end}")
}

fn build_history_section(
    history_messages: &[MessageRow],
    history_budget_tokens: usize,
    max_messages: usize,
) -> String {
    let mut selected: Vec<String> = Vec::new();
    let mut consumed = 0usize;
    for item in history_messages.iter().rev() {
        if selected.len() >= max_messages {
            break;
        }
        let entry = format!("[{}]\n{}\n", item.role, item.content_md.trim());
        let entry_tokens = estimate_tokens(&entry);
        let remaining = history_budget_tokens.saturating_sub(consumed);
        if entry_tokens <= remaining {
            selected.push(entry);
            consumed = consumed.saturating_add(entry_tokens);
            continue;
        }
        if selected.is_empty() && remaining >= 32 {
            selected.push(truncate_text_for_tokens(&entry, remaining));
        }
        break;
    }
    selected.reverse();
    selected.join("\n")
}

fn build_context_section(
    session_id: &str,
    context_entries: &[ContextPromptEntry],
    context_budget_tokens: usize,
) -> (String, Vec<String>) {
    if context_entries.is_empty() || context_budget_tokens == 0 {
        return (String::new(), Vec::new());
    }

    let mut section = format!("Session: {session_id}\n\nContexte fourni:\n");
    let mut consumed = estimate_tokens(&section);
    let mut included_paths = Vec::new();
    for entry in context_entries {
        let remaining = context_budget_tokens.saturating_sub(consumed);
        if remaining < 64 {
            break;
        }
        let header = format!("\n--- SOURCE: {} ---\n", entry.path);
        let header_tokens = estimate_tokens(&header);
        if header_tokens >= remaining {
            break;
        }
        let content_budget = remaining
            .saturating_sub(header_tokens)
            .min(SB_MAX_FILE_TOKENS);
        if content_budget < 32 {
            break;
        }
        let content = truncate_text_for_tokens(&entry.content, content_budget);
        section.push_str(&header);
        section.push_str(&content);
        section.push('\n');
        consumed = consumed.saturating_add(estimate_tokens(&header) + estimate_tokens(&content));
        included_paths.push(entry.path.clone());
    }

    if included_paths.is_empty() {
        (String::new(), Vec::new())
    } else {
        (section, included_paths)
    }
}

fn build_user_prompt(
    session_id: &str,
    message: &str,
    history_messages: &[MessageRow],
    context_entries: &[ContextPromptEntry],
) -> BuiltPrompt {
    let user_tokens = estimate_tokens(message);
    let available_budget = SB_PROMPT_BUDGET_TOKENS
        .saturating_sub(SB_PROMPT_OVERHEAD_TOKENS)
        .saturating_sub(user_tokens);
    let history_budget = available_budget.min(SB_HISTORY_BUDGET_TOKENS);
    let context_budget = available_budget
        .saturating_sub(history_budget)
        .min(SB_CONTEXT_BUDGET_TOKENS);

    let (context_section, included_context_paths) =
        build_context_section(session_id, context_entries, context_budget);
    let history_section =
        build_history_section(history_messages, history_budget, SB_HISTORY_WINDOW);

    let mut prompt = String::new();
    if !context_section.is_empty() {
        prompt.push_str(&context_section);
        prompt.push_str("\n\n");
    }
    if !history_section.is_empty() {
        prompt.push_str("Historique recent:\n");
        prompt.push_str(&history_section);
        prompt.push_str("\n\n");
    }
    prompt.push_str("Demande utilisateur:\n");
    prompt.push_str(message.trim());
    prompt.push_str("\n\nReponds en markdown.");

    BuiltPrompt {
        user_prompt: prompt,
        included_context_paths,
    }
}

fn read_session_context(conn: &rusqlite::Connection, session_id: &str) -> Result<Vec<ContextItem>> {
    let mut stmt = conn.prepare(
        "SELECT path, token_estimate FROM second_brain_context_items WHERE session_id = ?1 ORDER BY sort_order ASC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok(ContextItem {
            path: row.get::<_, String>(0)?,
            token_estimate: row.get::<_, i64>(1)? as usize,
        })
    })?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

fn read_session_messages(conn: &rusqlite::Connection, session_id: &str) -> Result<Vec<MessageRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, role, mode, content_md, citations_json, attachments_json, created_at_ms
         FROM second_brain_messages
         WHERE session_id = ?1
         ORDER BY created_at_ms ASC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok(MessageRow {
            id: row.get::<_, String>(0)?,
            role: row.get::<_, String>(1)?,
            mode: row.get::<_, String>(2)?,
            content_md: row.get::<_, String>(3)?,
            citations_json: row.get::<_, String>(4)?,
            attachments_json: row.get::<_, String>(5)?,
            created_at_ms: row.get::<_, i64>(6)? as u64,
        })
    })?;
    let mut messages = Vec::new();
    for row in rows {
        messages.push(row?);
    }
    Ok(messages)
}

fn session_exists(conn: &rusqlite::Connection, session_id: &str) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM second_brain_sessions WHERE id = ?1",
        params![session_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn normalize_title_from_first_message(raw: &str) -> String {
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let line = normalized
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Second Brain Session");
    let mut compact = line.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.len() > 80 {
        compact.truncate(80);
        compact.push_str("...");
    }
    compact
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
    let session_id = next_id(SESSION_PREFIX);
    let title = payload
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Second Brain Session")
        .to_string();

    let (created_at_ms, _updated_at_ms) =
        create_session(&conn, &session_id, &title, &active.provider, &active.model)?;

    let context_items = load_context_items(&payload.context_paths)?;
    let _ = upsert_context(&conn, &session_id, &context_items)?;
    write_draft(&session_id, "")?;

    Ok(CreateSessionResult {
        session_id,
        created_at_ms,
    })
}

#[tauri::command]
pub fn list_second_brain_sessions(
    limit: Option<usize>,
) -> Result<Vec<session_store::SessionSummary>> {
    let conn = open_db()?;
    list_sessions(&conn, limit.unwrap_or(80).clamp(1, 250))
}

#[tauri::command]
pub fn load_second_brain_session(session_id: String) -> Result<session_store::SessionPayload> {
    let conn = open_db()?;
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
pub async fn send_second_brain_message(
    app: AppHandle,
    payload: SendMessagePayload,
) -> Result<SendMessageResult> {
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

    if payload.message.trim().is_empty() {
        return Err(AppError::InvalidOperation(
            "Message must not be empty.".to_string(),
        ));
    }

    let conn = open_db()?;
    if !session_exists(&conn, &payload.session_id)? {
        return Err(AppError::InvalidOperation(
            "Second Brain session not found.".to_string(),
        ));
    }

    if (!payload.attachments.is_empty())
        && (!active.capabilities.image_input && !active.capabilities.audio_input)
    {
        return Err(AppError::InvalidOperation(
            "Attachments are not supported by the active profile.".to_string(),
        ));
    }

    let user_message_id = next_id("sbm-user");
    let assistant_message_id = next_id("sbm-assistant");
    let ts = now_ms();

    let user_message = MessageRow {
        id: user_message_id.clone(),
        role: "user".to_string(),
        mode: payload.mode.clone(),
        content_md: payload.message.clone(),
        citations_json: "[]".to_string(),
        attachments_json: serde_json::to_string(&payload.attachments)
            .unwrap_or_else(|_| "[]".to_string()),
        created_at_ms: ts,
    };
    insert_message(&conn, &user_message, &payload.session_id)?;

    let user_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM second_brain_messages WHERE session_id = ?1 AND role = 'user'",
        params![payload.session_id.clone()],
        |row| row.get(0),
    )?;
    if user_count <= 1 {
        let inferred_title = normalize_title_from_first_message(&payload.message);
        let _ = update_session_title(&conn, &payload.session_id, &inferred_title);
    }

    let context_items = read_session_context(&conn, &payload.session_id)?;
    let mentions = extract_mentioned_markdown_paths(&payload.message);
    let prioritized_context = prioritize_context_items(&context_items, &mentions);
    let root = active_workspace_root()?;
    let mut context_entries = Vec::new();
    for item in prioritized_context {
        let content = fs::read_to_string(root.join(&item.path))?;
        context_entries.push(ContextPromptEntry {
            path: item.path,
            content,
        });
    }
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
    );
    let user_prompt = built_prompt.user_prompt.clone();

    let _ = app.emit(
        "second-brain://assistant-start",
        StreamEvent {
            session_id: payload.session_id.clone(),
            message_id: assistant_message_id.clone(),
            chunk: String::new(),
            done: false,
            error: None,
        },
    );

    let stream_session_id = payload.session_id.clone();
    let stream_message_id = assistant_message_id.clone();
    let app_for_stream = app.clone();
    let llm_result = if active.capabilities.streaming {
        run_llm_stream(&active, &mode_prompt, &user_prompt, move |chunk| {
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
        })
        .await
    } else {
        run_llm(&active, &mode_prompt, &user_prompt).await
    };

    let answer = match llm_result {
        Ok(value) => value,
        Err(err) => {
            let _ = app.emit(
                "second-brain://assistant-error",
                StreamEvent {
                    session_id: payload.session_id.clone(),
                    message_id: assistant_message_id.clone(),
                    chunk: String::new(),
                    done: true,
                    error: Some(err.clone()),
                },
            );
            return Err(AppError::InvalidOperation(err));
        }
    };

    if !active.capabilities.streaming {
        let _ = app.emit(
            "second-brain://assistant-delta",
            StreamEvent {
                session_id: payload.session_id.clone(),
                message_id: assistant_message_id.clone(),
                chunk: answer.clone(),
                done: false,
                error: None,
            },
        );
    }

    let citations: Vec<String> = built_prompt
        .included_context_paths
        .into_iter()
        .take(12)
        .collect();

    let assistant_message = MessageRow {
        id: assistant_message_id.clone(),
        role: "assistant".to_string(),
        mode: payload.mode,
        content_md: answer.clone(),
        citations_json: serde_json::to_string(&citations).unwrap_or_else(|_| "[]".to_string()),
        attachments_json: "[]".to_string(),
        created_at_ms: now_ms(),
    };
    insert_message(&conn, &assistant_message, &payload.session_id)?;

    let _ = app.emit(
        "second-brain://assistant-complete",
        StreamEvent {
            session_id: payload.session_id,
            message_id: assistant_message_id.clone(),
            chunk: answer,
            done: true,
            error: None,
        },
    );

    Ok(SendMessageResult {
        user_message_id,
        assistant_message_id,
    })
}

#[tauri::command]
pub fn set_second_brain_session_target_note(
    payload: SetSessionTargetNotePayload,
) -> Result<SetSessionTargetNoteResult> {
    let conn = open_db()?;
    if !session_exists(&conn, &payload.session_id)? {
        return Err(AppError::InvalidOperation(
            "Second Brain session not found.".to_string(),
        ));
    }
    let target_relative = normalize_workspace_markdown_relative(&payload.target_path)?;
    set_target_note_path(&conn, &payload.session_id, &target_relative)?;
    Ok(SetSessionTargetNoteResult {
        target_note_path: target_relative,
    })
}

#[tauri::command]
pub fn insert_second_brain_assistant_into_target_note(
    payload: InsertAssistantIntoTargetPayload,
) -> Result<InsertAssistantIntoTargetResult> {
    let conn = open_db()?;
    if !session_exists(&conn, &payload.session_id)? {
        return Err(AppError::InvalidOperation(
            "Second Brain session not found.".to_string(),
        ));
    }

    let target_relative: String = conn
        .query_row(
            "SELECT target_note_path FROM second_brain_session_targets WHERE session_id = ?1",
            params![payload.session_id.clone()],
            |row| row.get(0),
        )
        .map_err(|_| {
            AppError::InvalidOperation("No target note is linked to this session.".to_string())
        })?;

    if target_relative.trim().is_empty() {
        return Err(AppError::InvalidOperation(
            "No target note is linked to this session.".to_string(),
        ));
    }

    let assistant_text: String = conn
        .query_row(
            "SELECT content_md FROM second_brain_messages WHERE id = ?1 AND session_id = ?2 AND role = 'assistant'",
            params![payload.message_id, payload.session_id.clone()],
            |row| row.get(0),
        )
        .map_err(|_| AppError::InvalidOperation("Assistant message not found.".to_string()))?;

    let root = active_workspace_root()?;
    let target_path = root.join(&target_relative);
    let existing = fs::read_to_string(&target_path).unwrap_or_default();
    let next = if existing.trim().is_empty() {
        assistant_text.clone()
    } else {
        format!("{existing}\n\n---\n\n{assistant_text}")
    };
    fs::write(&target_path, next)?;
    reindex_markdown_file_now_sync(target_path.to_string_lossy().to_string())?;

    Ok(InsertAssistantIntoTargetResult {
        target_note_path: target_relative,
    })
}

#[tauri::command]
pub fn export_second_brain_session_markdown(
    session_id: String,
) -> Result<ExportSessionMarkdownResult> {
    let conn = open_db()?;
    if !session_exists(&conn, &session_id)? {
        return Err(AppError::InvalidOperation(
            "Second Brain session not found.".to_string(),
        ));
    }

    let payload = load_session(&conn, &session_id, read_draft(&session_id)?)?;
    let root = active_workspace_root()?;
    let session_dir = root.join(".tomosona").join("second-brain").join("sessions");
    fs::create_dir_all(&session_dir)?;
    let out_path = session_dir.join(format!("{session_id}.md"));

    let context_list = payload
        .context_items
        .iter()
        .map(|item| format!("- {}", item.path))
        .collect::<Vec<_>>()
        .join("\n");

    let mut thread = String::new();
    for msg in &payload.messages {
        thread.push_str(&format!(
            "\n### {} ({})\n\n{}\n",
            if msg.role == "assistant" {
                "Assistant"
            } else {
                "User"
            },
            msg.mode,
            msg.content_md
        ));
    }

    let markdown = format!(
        "---\nsession_id: {}\ntitle: {}\ncreated_at_ms: {}\nupdated_at_ms: {}\ntarget_note_path: {}\n---\n\n## Context\n{}\n\n## Thread{}\n",
        payload.session_id,
        payload.title,
        payload.created_at_ms,
        payload.updated_at_ms,
        payload.target_note_path,
        context_list,
        thread
    );

    fs::write(&out_path, markdown)?;
    Ok(ExportSessionMarkdownResult {
        path: out_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn save_second_brain_draft(payload: SaveDraftPayload) -> Result<()> {
    let conn = open_db()?;
    if !session_exists(&conn, &payload.session_id)? {
        return Err(AppError::InvalidOperation(
            "Second Brain session not found.".to_string(),
        ));
    }

    write_draft(&payload.session_id, &payload.content_md)?;
    conn.execute(
        "INSERT INTO second_brain_drafts (session_id, content_md, updated_at_ms)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET content_md = excluded.content_md, updated_at_ms = excluded.updated_at_ms",
        params![payload.session_id, payload.content_md, now_ms() as i64],
    )?;
    Ok(())
}

#[tauri::command]
pub fn append_message_to_second_brain_draft(
    payload: AppendMessageToDraftPayload,
) -> Result<String> {
    let conn = open_db()?;
    if !session_exists(&conn, &payload.session_id)? {
        return Err(AppError::InvalidOperation(
            "Second Brain session not found.".to_string(),
        ));
    }

    let message_content = conn
        .query_row(
            "SELECT content_md FROM second_brain_messages WHERE id = ?1 AND session_id = ?2",
            params![payload.message_id, payload.session_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| AppError::InvalidOperation("Message not found in session.".to_string()))?;

    let mut draft_content = read_draft(&payload.session_id)?;
    if !draft_content.trim().is_empty() {
        draft_content.push_str("\n\n---\n\n");
    }
    draft_content.push_str(&message_content);
    write_draft(&payload.session_id, &draft_content)?;

    conn.execute(
        "INSERT INTO second_brain_drafts (session_id, content_md, updated_at_ms)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET content_md = excluded.content_md, updated_at_ms = excluded.updated_at_ms",
        params![payload.session_id, draft_content, now_ms() as i64],
    )?;

    Ok(read_draft(&payload.session_id)?)
}

fn sanitize_file_name(file_name: &str) -> String {
    let mut out = file_name
        .trim()
        .replace(
            |ch: char| matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'),
            "-",
        )
        .trim()
        .to_string();
    if out.is_empty() {
        out = "second-brain-note".to_string();
    }
    if !out.to_lowercase().ends_with(".md") {
        out.push_str(".md");
    }
    out
}

fn ensure_within(root: &Path, path: &Path) -> Result<()> {
    let canonical_root = fs::canonicalize(root)?;
    let canonical_path = fs::canonicalize(path)?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err(AppError::InvalidPath);
    }
    Ok(())
}

#[tauri::command]
pub fn publish_second_brain_draft_to_new_note(
    payload: PublishDraftToNewNotePayload,
) -> Result<PublishDraftToNewNoteResult> {
    let conn = open_db()?;
    if !session_exists(&conn, &payload.session_id)? {
        return Err(AppError::InvalidOperation(
            "Second Brain session not found.".to_string(),
        ));
    }

    let root = active_workspace_root()?;
    let target_dir = PathBuf::from(&payload.target_dir);
    if !target_dir.exists() || !target_dir.is_dir() {
        return Err(AppError::InvalidPath);
    }
    let target_dir_canonical = fs::canonicalize(target_dir)?;
    if !target_dir_canonical.starts_with(&root) {
        return Err(AppError::InvalidPath);
    }

    let file_name = sanitize_file_name(&payload.file_name);
    let target_path = target_dir_canonical.join(file_name);
    if target_path.exists() {
        return Err(AppError::AlreadyExists);
    }

    let draft_content = read_draft(&payload.session_id)?;
    let created = chrono_like_today();
    let mut frontmatter = String::new();
    frontmatter.push_str("---\n");
    frontmatter.push_str(&format!("created: {created}\n"));
    frontmatter.push_str("origin: ai\n");
    frontmatter.push_str("sources:\n");
    for source in &payload.sources {
        frontmatter.push_str(&format!("  - [[{}]]\n", source.trim()));
    }
    frontmatter.push_str(&format!("session_id: {}\n", payload.session_id));
    frontmatter.push_str("---\n\n");

    fs::write(&target_path, format!("{frontmatter}{draft_content}\n"))?;
    ensure_within(&root, &target_path)?;
    reindex_markdown_file_now_sync(target_path.to_string_lossy().to_string())?;

    Ok(PublishDraftToNewNoteResult {
        path: target_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn publish_second_brain_draft_to_existing_note(
    payload: PublishDraftToExistingNotePayload,
) -> Result<()> {
    let conn = open_db()?;
    if !session_exists(&conn, &payload.session_id)? {
        return Err(AppError::InvalidOperation(
            "Second Brain session not found.".to_string(),
        ));
    }

    let root = active_workspace_root()?;
    let target_path = PathBuf::from(&payload.target_path);
    if !target_path.exists() || !target_path.is_file() {
        return Err(AppError::InvalidPath);
    }
    let canonical = fs::canonicalize(&target_path)?;
    if !canonical.starts_with(&root) {
        return Err(AppError::InvalidPath);
    }

    let existing = fs::read_to_string(&canonical)?;
    let draft_content = read_draft(&payload.session_id)?;
    let merged = if existing.trim().is_empty() {
        draft_content
    } else {
        format!("{existing}\n\n---\n\n{draft_content}")
    };
    fs::write(&canonical, merged)?;
    reindex_markdown_file_now_sync(canonical.to_string_lossy().to_string())?;

    Ok(())
}

fn chrono_like_today() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let days = epoch / 86_400;
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    format!("{:04}-{:02}-{:02}", year, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(id: &str, role: &str, content: &str) -> MessageRow {
        MessageRow {
            id: id.to_string(),
            role: role.to_string(),
            mode: "freestyle".to_string(),
            content_md: content.to_string(),
            citations_json: "[]".to_string(),
            attachments_json: "[]".to_string(),
            created_at_ms: 0,
        }
    }

    #[test]
    fn sanitizes_filename_and_adds_md() {
        assert_eq!(sanitize_file_name("hello"), "hello.md");
        assert_eq!(sanitize_file_name("a:b"), "a-b.md");
    }

    #[test]
    fn today_format_has_iso_shape() {
        let v = chrono_like_today();
        assert_eq!(v.len(), 10);
        assert_eq!(&v[4..5], "-");
        assert_eq!(&v[7..8], "-");
    }

    #[test]
    fn extracts_markdown_mentions_and_deduplicates() {
        let mentions = extract_mentioned_markdown_paths(
            "Use @foo/bar.md and @foo/bar.md plus (@journal/2026-03-03.markdown).",
        );
        assert_eq!(
            mentions,
            vec![
                "foo/bar.md".to_string(),
                "journal/2026-03-03.markdown".to_string()
            ]
        );
    }

    #[test]
    fn prioritizes_mentioned_context_items_first() {
        let items = vec![
            ContextItem {
                path: "notes/a.md".to_string(),
                token_estimate: 10,
            },
            ContextItem {
                path: "notes/b.md".to_string(),
                token_estimate: 10,
            },
            ContextItem {
                path: "notes/c.md".to_string(),
                token_estimate: 10,
            },
        ];
        let mentions = vec!["notes/c.md".to_string()];
        let ordered = prioritize_context_items(&items, &mentions);
        assert_eq!(ordered[0].path, "notes/c.md");
        assert_eq!(ordered[1].path, "notes/a.md");
        assert_eq!(ordered[2].path, "notes/b.md");
    }

    #[test]
    fn truncates_text_with_marker_when_budget_is_small() {
        let long_text = "x".repeat(20_000);
        let truncated = truncate_text_for_tokens(&long_text, 50);
        assert!(truncated.contains("[CONTENU TRONQUE]"));
        assert!(estimate_tokens(&truncated) <= 70);
    }

    #[test]
    fn history_section_keeps_recent_window() {
        let history = (0..20)
            .map(|idx| message(&format!("m{idx}"), "user", &format!("msg-{idx}")))
            .collect::<Vec<_>>();
        let section = build_history_section(&history, 10_000, 12);
        assert!(!section.contains("msg-0"));
        assert!(section.contains("msg-19"));
        assert!(section.contains("msg-8"));
    }

    #[test]
    fn user_prompt_without_context_is_valid() {
        let history = vec![message("m1", "assistant", "old answer")];
        let built = build_user_prompt("s1", "nouvelle demande", &history, &[]);
        assert!(built.user_prompt.contains("Historique recent"));
        assert!(built.user_prompt.contains("Demande utilisateur"));
        assert!(built.user_prompt.contains("Reponds en markdown."));
        assert!(built.included_context_paths.is_empty());
    }

    #[test]
    fn user_prompt_includes_only_context_that_fits_budget() {
        let history = vec![message("m1", "assistant", "ok")];
        let contexts = vec![
            ContextPromptEntry {
                path: "a.md".to_string(),
                content: "a".repeat(8_000),
            },
            ContextPromptEntry {
                path: "b.md".to_string(),
                content: "b".repeat(8_000),
            },
        ];
        let built = build_user_prompt("s1", "question", &history, &contexts);
        assert!(built.user_prompt.contains("--- SOURCE: a.md ---"));
        assert!(built.user_prompt.contains("[CONTENU TRONQUE]"));
        assert!(!built.included_context_paths.is_empty());
    }
}
