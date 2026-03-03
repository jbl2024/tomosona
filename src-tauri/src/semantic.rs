//! Local semantic indexing/runtime helpers.
//!
//! This module provides:
//! - lazy, process-wide embedding model initialization,
//! - sqlite-vec auto-extension registration,
//! - vector normalization/serialization helpers.
//!
//! Design constraints:
//! - semantic failures must not break lexical indexing/search paths,
//! - all errors are converted into safe user-facing strings.

use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use directories::BaseDirs;
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use genai::Client;
use rusqlite::{ffi::sqlite3_auto_extension, params, Connection};
use serde::Serialize;
use sqlite_vec::sqlite3_vec_init;

use crate::settings;

const EMBEDDING_MODEL_NAME: &str = "lightonai/modernbert-embed-large";
const EXTERNAL_PROVIDER_OPENAI: &str = "openai";
#[derive(Default)]
struct SemanticState {
    model: Option<TextEmbedding>,
    model_init_failed: bool,
    model_state: String,
    model_init_attempts: u32,
    model_last_started_at_ms: Option<u64>,
    model_last_finished_at_ms: Option<u64>,
    model_last_duration_ms: Option<u64>,
    model_last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SemanticRuntimeStatus {
    pub model_name: String,
    pub model_state: String,
    pub model_init_attempts: u32,
    pub model_last_started_at_ms: Option<u64>,
    pub model_last_finished_at_ms: Option<u64>,
    pub model_last_duration_ms: Option<u64>,
    pub model_last_error: Option<String>,
}

static STATE: OnceLock<Mutex<SemanticState>> = OnceLock::new();
static INDEX_LOGGER: OnceLock<fn(&str)> = OnceLock::new();

fn log_index(message: &str) {
    if let Some(logger) = INDEX_LOGGER.get() {
        logger(message);
    } else {
        eprintln!("[index] {message}");
    }
}

/// Registers an app-level index logger sink used by this module.
pub fn set_index_logger(logger: fn(&str)) {
    let _ = INDEX_LOGGER.set(logger);
}

fn semantic_state() -> &'static Mutex<SemanticState> {
    STATE.get_or_init(|| {
        let mut state = SemanticState::default();
        state.model_state = "not_initialized".to_string();
        Mutex::new(state)
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

/// Resolves the persistent local cache directory for embedding model files.
///
/// Preferred location is `~/.tomosona/models`. If the home directory is not
/// available or directory creation fails, it falls back to the OS temp folder.
fn model_cache_dir() -> std::path::PathBuf {
    let preferred = BaseDirs::new()
        .map(|dirs| dirs.home_dir().join(".tomosona").join("models"))
        .unwrap_or_else(|| std::env::temp_dir().join("tomosona-models"));
    if std::fs::create_dir_all(&preferred).is_ok() {
        return preferred;
    }
    std::env::temp_dir().join("tomosona-models")
}

fn configured_embedding_model_name() -> String {
    let settings = settings::load_embeddings_for_runtime();
    if let Ok(embeddings) = settings {
        if embeddings.mode.trim().eq_ignore_ascii_case("external") {
            if let Some(profile) = embeddings.external {
                let provider = profile.provider.trim().to_lowercase();
                let model = profile.model.trim().to_string();
                if model.contains("::") {
                    return model;
                }
                return format!("{provider}::{model}");
            }
        }
    }
    EMBEDDING_MODEL_NAME.to_string()
}

/// Returns the configured embedding model label persisted in the index.
pub fn embedding_model_name() -> String {
    configured_embedding_model_name()
}

/// Registers sqlite-vec as an SQLite auto-extension for future connections.
///
/// Returns `true` when registration succeeds. This is process-global and
/// idempotent from the caller perspective.
pub fn register_sqlite_vec_auto_extension() -> bool {
    static REGISTERED: OnceLock<bool> = OnceLock::new();
    *REGISTERED.get_or_init(|| unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute(sqlite3_vec_init as *const ()))) == 0
    })
}

fn embed_texts_internal(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let (should_init, started_at, attempt) = {
        let mut state = semantic_state()
            .lock()
            .map_err(|_| "Semantic engine state is unavailable.".to_string())?;
        if state.model.is_none() {
            if state.model_init_failed {
                return Err("Semantic embedding model is unavailable.".to_string());
            }
            let started_at = now_ms();
            state.model_state = "initializing".to_string();
            state.model_init_attempts = state.model_init_attempts.saturating_add(1);
            state.model_last_started_at_ms = Some(started_at);
            state.model_last_error = None;
            (true, started_at, state.model_init_attempts)
        } else {
            (false, 0, 0)
        }
    };

    if should_init {
        log_index(&format!(
            "model:init:start model={EMBEDDING_MODEL_NAME} attempt={attempt} note=first init may download model files"
        ));
        let cache_dir = model_cache_dir();
        log_index(&format!(
            "model:cache_dir path={}",
            cache_dir.to_string_lossy()
        ));
        let options = InitOptions::new(EmbeddingModel::ModernBertEmbedLarge)
            .with_show_download_progress(false)
            .with_cache_dir(cache_dir);
        let init_result = TextEmbedding::try_new(options);

        let mut state = semantic_state()
            .lock()
            .map_err(|_| "Semantic engine state is unavailable.".to_string())?;
        match init_result {
            Ok(model) => {
                state.model = Some(model);
                state.model_state = "ready".to_string();
                let finished_at = now_ms();
                state.model_last_finished_at_ms = Some(finished_at);
                state.model_last_duration_ms = Some(finished_at.saturating_sub(started_at));
                log_index(&format!(
                    "model:init:done model={EMBEDDING_MODEL_NAME} elapsed_ms={}",
                    state.model_last_duration_ms.unwrap_or(0)
                ));
            }
            Err(_) => {
                state.model_init_failed = true;
                state.model_state = "failed".to_string();
                let finished_at = now_ms();
                state.model_last_finished_at_ms = Some(finished_at);
                state.model_last_duration_ms = Some(finished_at.saturating_sub(started_at));
                state.model_last_error =
                    Some("Semantic embedding model could not be initialized.".to_string());
                log_index(&format!("model:init:error model={EMBEDDING_MODEL_NAME}"));
                return Err("Semantic embedding model could not be initialized.".to_string());
            }
        }
    }

    let mut state = semantic_state()
        .lock()
        .map_err(|_| "Semantic engine state is unavailable.".to_string())?;
    let Some(model) = state.model.as_mut() else {
        if state.model_state.is_empty() {
            state.model_state = "not_initialized".to_string();
        }
        return Err("Semantic embedding model is unavailable.".to_string());
    };

    let text_refs: Vec<&str> = texts.iter().map(String::as_str).collect();
    model
        .embed(text_refs, None)
        .map_err(|_| "Semantic embedding inference failed.".to_string())
}

fn configure_external_embedding_environment(profile: &settings::EmbeddingProviderProfile) {
    let provider = profile.provider.trim().to_lowercase();
    if provider == EXTERNAL_PROVIDER_OPENAI {
        std::env::set_var("OPENAI_API_KEY", profile.api_key.trim());
        if let Some(base_url) = &profile.base_url {
            let trimmed = base_url.trim();
            if !trimmed.is_empty() {
                std::env::set_var("OPENAI_BASE_URL", trimmed);
            } else {
                std::env::remove_var("OPENAI_BASE_URL");
            }
        } else {
            std::env::remove_var("OPENAI_BASE_URL");
        }
    }
}

fn external_model_name(profile: &settings::EmbeddingProviderProfile) -> String {
    let model = profile.model.trim();
    if model.contains("::") {
        return model.to_string();
    }
    format!("{}::{model}", profile.provider.trim().to_lowercase())
}

fn embed_texts_external(
    texts: &[String],
    profile: &settings::EmbeddingProviderProfile,
) -> Result<Vec<Vec<f32>>, String> {
    configure_external_embedding_environment(profile);
    let model = external_model_name(profile);
    let payload = texts.to_vec();
    let response = tauri::async_runtime::block_on(async {
        let client = Client::default();
        client.embed_batch(&model, payload, None).await
    })
    .map_err(|_| "Semantic embedding inference failed.".to_string())?;

    let mut vectors = Vec::with_capacity(response.embeddings.len());
    for embedding in &response.embeddings {
        vectors.push(embedding.vector().to_vec());
    }
    Ok(vectors)
}

/// Embeds a text batch according to configured settings.
///
/// - `internal` mode uses local fastembed runtime.
/// - `external` mode uses provider APIs via `genai`.
pub fn embed_texts(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let embeddings = settings::load_embeddings_for_runtime()
        .map_err(|_| "Semantic embedding settings are invalid.".to_string())?;
    if embeddings.mode.trim().eq_ignore_ascii_case("external") {
        let profile = embeddings
            .external
            .ok_or_else(|| "Semantic embedding settings are invalid.".to_string())?;
        return embed_texts_external(texts, &profile);
    }
    embed_texts_internal(texts)
}

pub fn runtime_status() -> SemanticRuntimeStatus {
    let guard = semantic_state().try_lock();
    if let Ok(state) = guard {
        let model_state = if state.model.is_some() {
            "ready".to_string()
        } else if state.model_state.is_empty() {
            "not_initialized".to_string()
        } else {
            state.model_state.clone()
        };
        return SemanticRuntimeStatus {
            model_name: configured_embedding_model_name(),
            model_state,
            model_init_attempts: state.model_init_attempts,
            model_last_started_at_ms: state.model_last_started_at_ms,
            model_last_finished_at_ms: state.model_last_finished_at_ms,
            model_last_duration_ms: state.model_last_duration_ms,
            model_last_error: state.model_last_error.clone(),
        };
    }

    SemanticRuntimeStatus {
        model_name: configured_embedding_model_name(),
        model_state: "busy".to_string(),
        model_init_attempts: 0,
        model_last_started_at_ms: None,
        model_last_finished_at_ms: None,
        model_last_duration_ms: None,
        model_last_error: Some("Semantic engine state is unavailable.".to_string()),
    }
}

/// L2-normalizes a vector in-place.
pub fn normalize_in_place(vector: &mut [f32]) {
    for value in vector.iter_mut() {
        if !value.is_finite() {
            *value = 0.0;
        }
    }

    let norm_sq: f32 = vector.iter().map(|value| value * value).sum();
    if !norm_sq.is_finite() || norm_sq <= f32::EPSILON {
        return;
    }

    let norm = norm_sq.sqrt();
    if !norm.is_finite() || norm <= f32::EPSILON {
        return;
    }

    for value in vector.iter_mut() {
        *value /= norm;
    }
}

/// Computes cosine similarity for already normalized vectors.
pub fn cosine_similarity(left: &[f32], right: &[f32]) -> Option<f32> {
    if left.len() != right.len() || left.is_empty() {
        return None;
    }
    let dot = left
        .iter()
        .zip(right.iter())
        .map(|(a, b)| a * b)
        .sum::<f32>();
    Some(dot)
}

/// Serializes an f32 vector as little-endian BLOB storage.
pub fn vector_to_blob(vector: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

/// Deserializes a little-endian vector BLOB into f32 values.
pub fn blob_to_vector(blob: &[u8], dim: usize) -> Option<Vec<f32>> {
    if dim == 0 || blob.len() != dim * 4 {
        return None;
    }
    let mut out = Vec::with_capacity(dim);
    for chunk in blob.chunks_exact(4) {
        out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Some(out)
}

/// Computes a normalized centroid for chunk-level vectors.
pub fn centroid(vectors: &[Vec<f32>]) -> Option<Vec<f32>> {
    let first = vectors.first()?;
    if first.is_empty() {
        return None;
    }
    let dim = first.len();
    if vectors.iter().any(|item| item.len() != dim) {
        return None;
    }

    let mut out = vec![0.0f32; dim];
    for vector in vectors {
        for (index, value) in vector.iter().enumerate() {
            out[index] += *value;
        }
    }

    let denom = vectors.len() as f32;
    for value in &mut out {
        *value /= denom;
    }
    normalize_in_place(&mut out);
    Some(out)
}

/// Formats a vector as JSON array string for sqlite-vec `MATCH` queries.
pub fn vector_to_json(vector: &[f32]) -> String {
    let mut out = String::from("[");
    for (index, value) in vector.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        let safe_value = if value.is_finite() { *value } else { 0.0 };
        out.push_str(&format!("{safe_value:.7}"));
    }
    out.push(']');
    out
}

/// Ensures the note-level vec virtual table exists when sqlite-vec is available.
pub fn try_ensure_vec_table(conn: &Connection, dim: usize) -> bool {
    if let Ok(existing_sql) = conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='note_embeddings_vec'",
        [],
        |row| row.get::<_, String>(0),
    ) {
        let existing_dim = parse_vec_embedding_dim(&existing_sql);
        if existing_dim != Some(dim)
            && conn
                .execute("DROP TABLE IF EXISTS note_embeddings_vec", [])
                .is_err()
        {
            return false;
        }
        if existing_dim == Some(dim) {
            return true;
        }
    }

    conn.execute(
        &format!(
            "CREATE VIRTUAL TABLE IF NOT EXISTS note_embeddings_vec USING vec0(path TEXT PRIMARY KEY, embedding FLOAT[{dim}])"
        ),
        [],
    )
    .is_ok()
}

fn parse_vec_embedding_dim(create_sql: &str) -> Option<usize> {
    let normalized = create_sql.to_ascii_lowercase();
    let marker = "float[";
    let start = normalized.find(marker)? + marker.len();
    let end = start + normalized[start..].find(']')?;
    normalized[start..end].trim().parse::<usize>().ok()
}

/// Upserts one note-level vector into vec table.
pub fn try_upsert_note_vector(conn: &Connection, path: &str, vector: &[f32]) -> Result<(), String> {
    let payload = vector_to_json(vector);
    match conn.execute(
        "INSERT OR REPLACE INTO note_embeddings_vec(path, embedding) VALUES (?1, ?2)",
        params![path, payload],
    ) {
        Ok(_) => return Ok(()),
        Err(replace_err) => {
            conn.execute(
                "DELETE FROM note_embeddings_vec WHERE path = ?1",
                params![path],
            )
            .map_err(|delete_err| {
                format!(
                    "replace_err={replace_err}; fallback_delete_err={delete_err}"
                )
            })?;

            conn.execute(
                "INSERT INTO note_embeddings_vec(path, embedding) VALUES (?1, ?2)",
                params![path, payload],
            )
            .map(|_| ())
            .map_err(|insert_err| {
                format!(
                    "replace_err={replace_err}; fallback_insert_err={insert_err}"
                )
            })
        }
    }
}

/// Deletes one note-level vector from vec table.
pub fn try_delete_note_vector(conn: &Connection, path: &str) {
    let _ = conn.execute(
        "DELETE FROM note_embeddings_vec WHERE path = ?1",
        params![path],
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn vector_roundtrip_serialization() {
        let input = vec![0.1f32, -0.2, 0.3];
        let blob = vector_to_blob(&input);
        let output = blob_to_vector(&blob, 3).expect("deserialize");
        assert_eq!(output.len(), input.len());
        assert!((output[0] - input[0]).abs() < 1e-6);
        assert!((output[1] - input[1]).abs() < 1e-6);
        assert!((output[2] - input[2]).abs() < 1e-6);
    }

    #[test]
    fn centroid_normalizes_output() {
        let vectors = vec![vec![1.0f32, 0.0], vec![0.0, 1.0]];
        let out = centroid(&vectors).expect("centroid");
        assert_eq!(out.len(), 2);
        let norm = (out[0] * out[0] + out[1] * out[1]).sqrt();
        assert!((norm - 1.0).abs() < 1e-5);
    }

    #[test]
    fn cosine_similarity_handles_dimension_mismatch() {
        assert!(cosine_similarity(&[1.0, 0.0], &[1.0]).is_none());
    }

    #[test]
    fn normalize_in_place_sanitizes_non_finite_values() {
        let mut vector = vec![3.0f32, f32::NAN, f32::INFINITY, -4.0];
        normalize_in_place(&mut vector);

        assert!(vector.iter().all(|value| value.is_finite()));
        let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5);
        assert!(vector[1].abs() < 1e-7);
        assert!(vector[2].abs() < 1e-7);
    }

    #[test]
    fn normalize_in_place_handles_all_non_finite_vector() {
        let mut vector = vec![f32::NAN, f32::INFINITY, f32::NEG_INFINITY];
        normalize_in_place(&mut vector);

        assert!(vector.iter().all(|value| value.is_finite()));
        assert!(vector.iter().all(|value| value.abs() < 1e-7));
    }

    #[test]
    fn vector_to_json_replaces_non_finite_values() {
        let payload = vector_to_json(&[0.25, f32::NAN, f32::INFINITY, f32::NEG_INFINITY]);
        assert_eq!(payload, "[0.2500000,0.0000000,0.0000000,0.0000000]");
        assert!(!payload.contains("NaN"));
        assert!(!payload.contains("inf"));

        let parsed: Value = serde_json::from_str(&payload).expect("valid json");
        let array = parsed.as_array().expect("array");
        assert_eq!(array.len(), 4);
    }
}
