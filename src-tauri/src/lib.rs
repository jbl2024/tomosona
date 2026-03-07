//! Tauri command surface for local filesystem, lexical search, semantic search,
//! and Cosmos graph payload generation.

mod db;
mod echoes;
mod fs_ops;
mod second_brain;
mod semantic;
mod settings;
mod workspace_watch;

// Tauri command surface for workspace I/O, index/search, and graph data used by Cosmos view.
#[cfg(windows)]
use std::os::windows::fs::MetadataExt;
use std::{
    collections::{hash_map::DefaultHasher, HashMap, HashSet, VecDeque},
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use directories::UserDirs;
use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection};
use serde::Serialize;
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;

use fs_ops::{
    clear_working_folder, copy_entry, create_entry, duplicate_entry, list_children,
    list_markdown_files, move_entry, open_external_url, open_path_external, path_exists,
    read_file_metadata, read_text_file, rename_entry, reveal_in_file_manager,
    select_working_folder, set_working_folder, trash_entry, write_text_file,
};

const INTERNAL_DIR_NAME: &str = ".tomosona";
const TRASH_DIR_NAME: &str = ".tomosona-trash";
const DB_FILE_NAME: &str = "tomosona.sqlite";
const PROPERTY_TYPE_SCHEMA_FILE: &str = "property-types.json";
const RESERVED_WORKSPACE_ERROR: &str =
    "Cannot use this folder as a workspace. Choose a dedicated project folder.";
const HYBRID_LEXICAL_WEIGHT: f64 = 0.35;
const HYBRID_SEMANTIC_WEIGHT: f64 = 0.65;
const SEARCH_CANDIDATE_LIMIT: i64 = 200;
const SEARCH_RESULT_LIMIT: usize = 25;
const SEMANTIC_TOP_K_PER_NOTE: i64 = 3;
const SEMANTIC_THRESHOLD: f32 = 0.62;
const INDEX_LOG_CAPACITY: usize = 400;
const INDEX_SCHEMA_VERSION: i64 = 2;
static INDEX_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);
static SQLITE_VEC_PROBE_LOGGED: OnceLock<()> = OnceLock::new();
#[cfg(windows)]
const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;

#[derive(Clone, Serialize)]
struct IndexLogEntry {
    ts_ms: u64,
    message: String,
}

static INDEX_LOGS: OnceLock<Mutex<VecDeque<IndexLogEntry>>> = OnceLock::new();

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn index_log_buffer() -> &'static Mutex<VecDeque<IndexLogEntry>> {
    INDEX_LOGS.get_or_init(|| Mutex::new(VecDeque::with_capacity(INDEX_LOG_CAPACITY)))
}

fn log_index(message: &str) {
    eprintln!("[index] {message}");
    if let Ok(mut logs) = index_log_buffer().lock() {
        if logs.len() >= INDEX_LOG_CAPACITY {
            logs.pop_front();
        }
        logs.push_back(IndexLogEntry {
            ts_ms: now_ms(),
            message: message.to_string(),
        });
    }
}

static ACTIVE_WORKSPACE_ROOT: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

#[derive(Debug, Error)]
enum AppError {
    #[error("File operation failed.")]
    Io(#[from] std::io::Error),
    #[error("Database operation failed.")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Invalid path.")]
    InvalidPath,
    #[error("Invalid name.")]
    InvalidName,
    #[error("File or folder already exists.")]
    AlreadyExists,
    #[error("Operation failed.")]
    OperationFailed,
    #[error("{0}")]
    InvalidOperation(String),
}

type Result<T> = std::result::Result<T, AppError>;

impl From<AppError> for tauri::ipc::InvokeError {
    fn from(err: AppError) -> Self {
        tauri::ipc::InvokeError::from(err.to_string())
    }
}

fn normalize_existing_dir(path: &str) -> Result<PathBuf> {
    let pb = PathBuf::from(path);
    if pb.as_os_str().is_empty() || !pb.is_dir() {
        return Err(AppError::InvalidPath);
    }
    Ok(pb)
}

fn active_workspace_slot() -> &'static Mutex<Option<PathBuf>> {
    ACTIVE_WORKSPACE_ROOT.get_or_init(|| Mutex::new(None))
}

fn lock_workspace_slot() -> Result<std::sync::MutexGuard<'static, Option<PathBuf>>> {
    active_workspace_slot()
        .lock()
        .map_err(|_| AppError::OperationFailed)
}

fn is_reserved_workspace_root(path: &Path) -> bool {
    if path.parent().is_none() {
        return true;
    }

    let Some(user_dirs) = UserDirs::new() else {
        return false;
    };

    if path == user_dirs.home_dir() {
        return true;
    }

    let has_special_match = [
        user_dirs.desktop_dir(),
        user_dirs.document_dir(),
        user_dirs.download_dir(),
        user_dirs.picture_dir(),
        user_dirs.audio_dir(),
        user_dirs.video_dir(),
        user_dirs.public_dir(),
    ]
    .into_iter()
    .flatten()
    .any(|dir| path == dir);

    has_special_match
}

fn canonical_workspace_root(path: &str) -> Result<PathBuf> {
    let dir = normalize_existing_dir(path)?;
    let canonical = fs::canonicalize(dir)?;
    if is_reserved_workspace_root(&canonical) {
        return Err(AppError::InvalidOperation(
            RESERVED_WORKSPACE_ERROR.to_string(),
        ));
    }
    Ok(canonical)
}

pub(crate) fn set_active_workspace(path: &str) -> Result<PathBuf> {
    let canonical = canonical_workspace_root(path)?;
    let mut guard = lock_workspace_slot()?;
    *guard = Some(canonical.clone());
    Ok(canonical)
}

pub(crate) fn clear_active_workspace() -> Result<()> {
    let mut guard = lock_workspace_slot()?;
    *guard = None;
    Ok(())
}

pub(crate) fn active_workspace_root() -> Result<PathBuf> {
    let guard = lock_workspace_slot()?;
    guard
        .as_ref()
        .cloned()
        .ok_or_else(|| AppError::InvalidOperation("No workspace is selected.".to_string()))
}

fn open_db() -> Result<Connection> {
    if !db::init_sqlite_runtime() {
        log_index("sqlite_runtime:init_failed");
        return Err(AppError::OperationFailed);
    }
    let root = active_workspace_root()?;
    let db_dir = root.join(INTERNAL_DIR_NAME);
    fs::create_dir_all(&db_dir)?;

    let db_path = db_dir.join(DB_FILE_NAME);
    let conn = Connection::open(db_path)?;
    let _ = conn.busy_timeout(Duration::from_millis(3_000));
    if SQLITE_VEC_PROBE_LOGGED.set(()).is_ok() {
        match semantic::probe_vec_runtime(&conn) {
            Ok(version) => log_index(&format!("sqlite_vec:runtime_ready version={version}")),
            Err(err) => log_index(&format!("sqlite_vec:runtime_unavailable err={err}")),
        }
    }
    Ok(conn)
}

fn property_type_schema_path() -> Result<PathBuf> {
    let root = active_workspace_root()?;
    let schema_dir = root.join(INTERNAL_DIR_NAME);
    fs::create_dir_all(&schema_dir)?;
    Ok(schema_dir.join(PROPERTY_TYPE_SCHEMA_FILE))
}

fn normalize_existing_file(path: &str) -> Result<PathBuf> {
    let pb = PathBuf::from(path);
    if pb.as_os_str().is_empty() || !pb.is_file() {
        return Err(AppError::InvalidPath);
    }
    Ok(pb)
}

fn ensure_within_root(root: &Path, path: &Path) -> Result<()> {
    let root_canonical = fs::canonicalize(root)?;
    let path_canonical = fs::canonicalize(path)?;

    if !path_canonical.starts_with(&root_canonical) {
        return Err(AppError::InvalidPath);
    }

    Ok(())
}

fn heading_anchor(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut previous_dash = false;

    for ch in text.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            previous_dash = false;
            continue;
        }

        if !previous_dash {
            out.push('-');
            previous_dash = true;
        }
    }

    out.trim_matches('-').to_string()
}

fn chunk_markdown(markdown: &str) -> Vec<(String, String)> {
    let mut chunks: Vec<(String, String)> = Vec::new();
    let mut current_anchor = String::new();
    let mut current_lines: Vec<String> = Vec::new();

    for raw_line in markdown.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let line = raw_line.trim_end().to_string();

        let heading_data = {
            let level = line.chars().take_while(|ch| *ch == '#').count();
            if !(1..=6).contains(&level) {
                None
            } else {
                let title = line[level..].trim();
                if title.is_empty() {
                    None
                } else {
                    Some((heading_anchor(title), title.to_string()))
                }
            }
        };

        if let Some((anchor, title)) = heading_data {
            if !current_lines.is_empty() {
                let text = current_lines.join("\n").trim().to_string();
                if !text.is_empty() {
                    chunks.push((current_anchor.clone(), text));
                }
            }

            current_anchor = anchor;
            current_lines.clear();
            current_lines.push(title);
            continue;
        }

        current_lines.push(line);
    }

    if !current_lines.is_empty() {
        let text = current_lines.join("\n").trim().to_string();
        if !text.is_empty() {
            chunks.push((current_anchor, text));
        }
    }

    if chunks.is_empty() {
        let fallback = markdown.trim();
        if !fallback.is_empty() {
            chunks.push((String::new(), fallback.to_string()));
        }
    }

    chunks
}

/// Adds note identity context to the first chunk to improve semantic grounding.
///
/// The context uses workspace-relative path (including file name), for example:
/// `journal/2026-02-16.md`.
fn inject_relative_path_context(path_for_db: &str, mut chunks: Vec<(String, String)>) -> Vec<(String, String)> {
    if path_for_db.trim().is_empty() || chunks.is_empty() {
        return chunks;
    }
    if let Some((_, first_text)) = chunks.first_mut() {
        *first_text = format!("{path_for_db}\n{first_text}");
    }
    chunks
}

fn chunk_content_hash(anchor: &str, text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    anchor.hash(&mut hasher);
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn strip_markdown_extension(path: &Path) -> PathBuf {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown") {
        path.with_extension("")
    } else {
        path.to_path_buf()
    }
}

fn normalize_key_text(input: &str) -> String {
    input.to_lowercase().nfc().collect::<String>()
}

fn normalize_note_key(root: &Path, path: &Path) -> Result<String> {
    let relative = path.strip_prefix(root).map_err(|_| AppError::InvalidPath)?;
    let normalized = strip_markdown_extension(relative);
    let mut key = normalized
        .to_string_lossy()
        .replace('\\', "/")
        .trim()
        .to_string();
    while key.starts_with("./") {
        key = key[2..].to_string();
    }
    Ok(normalize_key_text(&key))
}

fn normalize_workspace_relative_path(root: &Path, path: &Path) -> Result<String> {
    let relative = path.strip_prefix(root).map_err(|_| AppError::InvalidPath)?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn workspace_absolute_path(root: &Path, stored_path: &str) -> String {
    root.join(stored_path).to_string_lossy().to_string()
}

fn is_hidden_dir_name(name: &str) -> bool {
    name.starts_with('.') && name != "." && name != ".."
}

#[cfg(windows)]
fn is_windows_hidden(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0)
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_windows_hidden(_path: &Path) -> bool {
    false
}

fn has_hidden_dir_component(root: &Path, path: &Path) -> bool {
    let relative = path.strip_prefix(root).unwrap_or(path);
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let std::path::Component::Normal(part) = component else {
            continue;
        };
        let name = part.to_string_lossy();
        current.push(part);
        if !current.is_dir() {
            continue;
        }
        if is_hidden_dir_name(&name) || is_windows_hidden(&current) {
            return true;
        }
    }
    false
}

/// Derives a display label from a workspace-relative markdown path.
///
/// The label keeps folder context (`graph/synapse`) to avoid basename collisions.
fn note_label_from_workspace_path(path: &str) -> String {
    let without_md = path
        .strip_suffix(".md")
        .or_else(|| path.strip_suffix(".markdown"))
        .unwrap_or(path);
    without_md.replace('\\', "/")
}

/// Normalizes a stored workspace path into the note key format used by `note_links.target_key`.
fn normalize_note_key_from_workspace_path(root: &Path, stored_path: &str) -> Option<String> {
    normalize_note_key(root, &root.join(stored_path)).ok()
}

/// Returns the final path segment of a normalized note key.
fn note_key_basename(key: &str) -> String {
    key.rsplit('/').next().unwrap_or(key).to_string()
}

fn note_link_target(root: &Path, path: &Path) -> Result<String> {
    let relative = path.strip_prefix(root).map_err(|_| AppError::InvalidPath)?;
    let normalized = strip_markdown_extension(relative);
    let mut target = normalized
        .to_string_lossy()
        .replace('\\', "/")
        .trim()
        .to_string();
    while target.starts_with("./") {
        target = target[2..].to_string();
    }
    if target.is_empty() {
        return Err(AppError::InvalidPath);
    }
    Ok(target)
}

fn normalize_workspace_path(root: &Path, raw: &str) -> Result<PathBuf> {
    let mut path = PathBuf::from(raw);
    if path.as_os_str().is_empty() {
        return Err(AppError::InvalidPath);
    }
    if !path.is_absolute() {
        path = root.join(path);
    }

    if path.exists() {
        let canonical = fs::canonicalize(path)?;
        ensure_within_root(root, &canonical)?;
        return Ok(canonical);
    }

    let parent = path.parent().ok_or(AppError::InvalidPath)?;
    let parent_canonical = fs::canonicalize(parent)?;
    let root_canonical = fs::canonicalize(root)?;
    if !parent_canonical.starts_with(root_canonical) {
        return Err(AppError::InvalidPath);
    }

    Ok(path)
}

fn normalize_workspace_relative_from_input(root: &Path, raw: &str) -> Result<String> {
    let mut path = PathBuf::from(raw);
    if path.as_os_str().is_empty() {
        return Err(AppError::InvalidPath);
    }
    if !path.is_absolute() {
        path = root.join(path);
    }

    if path.exists() {
        let canonical = fs::canonicalize(path)?;
        return normalize_workspace_relative_path(root, &canonical);
    }

    let parent = path.parent().ok_or(AppError::InvalidPath)?;
    let parent_canonical = fs::canonicalize(parent)?;
    ensure_within_root(root, &parent_canonical)?;
    normalize_workspace_relative_path(root, &path)
}

fn normalize_wikilink_target(raw: &str) -> Option<String> {
    let mut target = raw.trim().replace('\\', "/");
    if target.is_empty() {
        return None;
    }

    while target.starts_with('/') {
        target.remove(0);
    }

    while target.starts_with("./") {
        target = target[2..].to_string();
    }

    if target
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return None;
    }

    let target_lower = target.to_ascii_lowercase();
    if target_lower.ends_with(".markdown") {
        target.truncate(target.len().saturating_sub(".markdown".len()));
    } else if target_lower.ends_with(".md") {
        target.truncate(target.len().saturating_sub(".md".len()));
    }

    let key = normalize_key_text(target.trim_matches('/'));
    if key.is_empty() {
        return None;
    }
    Some(key)
}

fn parse_wikilink_targets(markdown: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut offset = 0usize;

    while let Some(start) = markdown[offset..].find("[[") {
        let content_start = offset + start + 2;
        let Some(end_rel) = markdown[content_start..].find("]]") else {
            break;
        };

        let content_end = content_start + end_rel;
        let content = &markdown[content_start..content_end];
        let target_with_optional_heading = content
            .split_once('|')
            .map(|(left, _)| left)
            .unwrap_or(content);
        let target = target_with_optional_heading
            .split_once('#')
            .map(|(left, _)| left)
            .unwrap_or(target_with_optional_heading)
            .trim();

        if !target.is_empty() {
            targets.push(target.to_string());
        }

        offset = content_end + 2;
    }

    targets
}

fn is_iso_date_token(input: &str) -> bool {
    if input.len() != 10 {
        return false;
    }
    let bytes = input.as_bytes();
    for (idx, value) in bytes.iter().enumerate() {
        if idx == 4 || idx == 7 {
            if *value != b'-' {
                return false;
            }
            continue;
        }
        if !value.is_ascii_digit() {
            return false;
        }
    }

    let year = input[0..4].parse::<u16>().ok().unwrap_or(0);
    let month = input[5..7].parse::<u8>().ok().unwrap_or(0);
    let day = input[8..10].parse::<u8>().ok().unwrap_or(0);
    if year == 0 || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return false;
    }
    true
}

fn parse_iso_date_targets(markdown: &str) -> Vec<String> {
    let mut out = Vec::new();
    for token in markdown.split(|ch: char| ch.is_whitespace() || ",.;:()[]{}<>!?\"'`".contains(ch))
    {
        if is_iso_date_token(token) {
            out.push(format!("journal/{token}"));
        }
    }
    out
}

fn parse_note_targets(markdown: &str) -> Vec<String> {
    let content = strip_yaml_frontmatter(markdown);
    let mut targets = HashSet::new();

    for target in parse_wikilink_targets(content) {
        if let Some(normalized) = normalize_wikilink_target(&target) {
            targets.insert(normalized);
        }
    }

    for target in parse_iso_date_targets(content) {
        targets.insert(normalize_key_text(&target));
    }

    targets.into_iter().collect()
}

fn strip_yaml_frontmatter(markdown: &str) -> &str {
    if !markdown.starts_with("---\n") {
        return markdown;
    }

    let rest = &markdown[4..];
    if let Some(end) = rest.find("\n---\n") {
        return &rest[(end + 5)..];
    }

    markdown
}

fn extract_yaml_frontmatter(markdown: &str) -> Option<&str> {
    if !markdown.starts_with("---\n") {
        return None;
    }
    let rest = &markdown[4..];
    let end = rest.find("\n---\n")?;
    Some(&rest[..end])
}

#[derive(Debug, Clone)]
struct IndexedProperty {
    key: String,
    kind: &'static str,
    value_text: Option<String>,
    value_num: Option<f64>,
    value_bool: Option<i64>,
    value_date: Option<String>,
}

fn unquote_yaml_scalar(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        let first = bytes[0] as char;
        let last = bytes[trimmed.len() - 1] as char;
        if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }
    trimmed.to_string()
}

fn is_iso_date_value(input: &str) -> bool {
    if input.len() != 10 {
        return false;
    }
    let bytes = input.as_bytes();
    for (idx, value) in bytes.iter().enumerate() {
        if idx == 4 || idx == 7 {
            if *value != b'-' {
                return false;
            }
            continue;
        }
        if !value.is_ascii_digit() {
            return false;
        }
    }
    true
}

fn parse_yaml_frontmatter_properties(markdown: &str) -> Vec<IndexedProperty> {
    let Some(raw_yaml) = extract_yaml_frontmatter(markdown) else {
        return Vec::new();
    };

    let lines: Vec<&str> = raw_yaml.lines().collect();
    let mut out = Vec::new();
    let mut idx = 0usize;

    while idx < lines.len() {
        let line = lines[idx];
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            idx += 1;
            continue;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            idx += 1;
            continue;
        }

        let Some((raw_key, raw_value_part)) = line.split_once(':') else {
            idx += 1;
            continue;
        };

        let key = raw_key.trim().to_lowercase();
        if key.is_empty() {
            idx += 1;
            continue;
        }

        let value_part = raw_value_part.trim_start();

        if value_part == "|" {
            idx += 1;
            let mut text_lines: Vec<String> = Vec::new();
            while idx < lines.len() {
                let next = lines[idx];
                if let Some(stripped) = next.strip_prefix("  ") {
                    text_lines.push(stripped.to_string());
                    idx += 1;
                    continue;
                }
                if next.trim().is_empty() {
                    text_lines.push(String::new());
                    idx += 1;
                    continue;
                }
                break;
            }
            let text = text_lines.join("\n");
            out.push(IndexedProperty {
                key,
                kind: "text",
                value_text: Some(text.to_lowercase()),
                value_num: None,
                value_bool: None,
                value_date: None,
            });
            continue;
        }

        if value_part.starts_with('[') && value_part.ends_with(']') {
            let inner = value_part[1..value_part.len() - 1].trim();
            if !inner.is_empty() {
                for item in inner.split(',') {
                    let value = unquote_yaml_scalar(item);
                    if value.is_empty() {
                        continue;
                    }
                    out.push(IndexedProperty {
                        key: key.clone(),
                        kind: "list",
                        value_text: Some(value.to_lowercase()),
                        value_num: None,
                        value_bool: None,
                        value_date: None,
                    });
                }
            }
            idx += 1;
            continue;
        }

        if value_part.is_empty() {
            idx += 1;
            let mut consumed = false;
            while idx < lines.len() {
                let next = lines[idx];
                let Some(item) = next.strip_prefix("  - ") else {
                    if next.trim().is_empty() {
                        idx += 1;
                        continue;
                    }
                    break;
                };
                consumed = true;
                let value = unquote_yaml_scalar(item);
                if !value.is_empty() {
                    out.push(IndexedProperty {
                        key: key.clone(),
                        kind: "list",
                        value_text: Some(value.to_lowercase()),
                        value_num: None,
                        value_bool: None,
                        value_date: None,
                    });
                }
                idx += 1;
            }
            if !consumed {
                out.push(IndexedProperty {
                    key,
                    kind: "text",
                    value_text: Some(String::new()),
                    value_num: None,
                    value_bool: None,
                    value_date: None,
                });
            }
            continue;
        }

        let scalar = unquote_yaml_scalar(value_part);
        if scalar.eq_ignore_ascii_case("true") || scalar.eq_ignore_ascii_case("false") {
            out.push(IndexedProperty {
                key,
                kind: "bool",
                value_text: Some(scalar.to_lowercase()),
                value_num: None,
                value_bool: Some(if scalar.eq_ignore_ascii_case("true") {
                    1
                } else {
                    0
                }),
                value_date: None,
            });
            idx += 1;
            continue;
        }

        if let Ok(num) = scalar.parse::<f64>() {
            if num.is_finite() {
                out.push(IndexedProperty {
                    key,
                    kind: "number",
                    value_text: Some(scalar.to_lowercase()),
                    value_num: Some(num),
                    value_bool: None,
                    value_date: None,
                });
                idx += 1;
                continue;
            }
        }

        if is_iso_date_value(&scalar) {
            out.push(IndexedProperty {
                key,
                kind: "date",
                value_text: Some(scalar.to_lowercase()),
                value_num: None,
                value_bool: None,
                value_date: Some(scalar),
            });
            idx += 1;
            continue;
        }

        out.push(IndexedProperty {
            key,
            kind: "text",
            value_text: Some(scalar.to_lowercase()),
            value_num: None,
            value_bool: None,
            value_date: None,
        });
        idx += 1;
    }

    out
}

fn split_wikilink_target_suffix(content: &str) -> (&str, &str) {
    let pipe_idx = content.find('|');
    let heading_idx = content.find('#');

    match (pipe_idx, heading_idx) {
        (Some(pipe), Some(heading)) => {
            let idx = pipe.min(heading);
            (&content[..idx], &content[idx..])
        }
        (Some(idx), None) | (None, Some(idx)) => (&content[..idx], &content[idx..]),
        (None, None) => (content, ""),
    }
}

fn rewrite_wikilinks_for_note(
    markdown: &str,
    old_target_key: &str,
    new_target: &str,
) -> (String, bool) {
    let mut output = String::with_capacity(markdown.len());
    let mut offset = 0usize;
    let mut changed = false;

    while let Some(start_rel) = markdown[offset..].find("[[") {
        let start = offset + start_rel;
        let content_start = start + 2;
        output.push_str(&markdown[offset..content_start]);

        let Some(end_rel) = markdown[content_start..].find("]]") else {
            output.push_str(&markdown[content_start..]);
            offset = markdown.len();
            break;
        };

        let content_end = content_start + end_rel;
        let content = &markdown[content_start..content_end];
        let (target_part, suffix) = split_wikilink_target_suffix(content);

        let should_replace =
            normalize_wikilink_target(target_part).is_some_and(|key| key == old_target_key);

        if should_replace {
            output.push_str(new_target);
            output.push_str(suffix);
            changed = true;
        } else {
            output.push_str(content);
        }

        output.push_str("]]");
        offset = content_end + 2;
    }

    if offset < markdown.len() {
        output.push_str(&markdown[offset..]);
    }

    if changed {
        (output, true)
    } else {
        (markdown.to_string(), false)
    }
}

fn ensure_index_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS internal_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  "#,
    )?;

    let current_version = conn
        .query_row(
            "SELECT value FROM internal_meta WHERE key = 'index_schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);

    if current_version != INDEX_SCHEMA_VERSION {
        log_index(&format!(
            "schema:reset old_version={current_version} new_version={INDEX_SCHEMA_VERSION}"
        ));
        conn.execute_batch(
            r#"
      DROP TABLE IF EXISTS note_embeddings_vec;
      DROP TABLE IF EXISTS embeddings;
      DROP TABLE IF EXISTS chunks_fts;
      DROP TABLE IF EXISTS chunks;
      DROP TABLE IF EXISTS note_embeddings;
      DROP TABLE IF EXISTS note_links;
      DROP TABLE IF EXISTS note_properties;
      DROP TABLE IF EXISTS semantic_edges;
      DELETE FROM internal_meta WHERE key = 'index_schema_version';
    "#,
        )?;
    }

    conn.execute_batch(
        r#"
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      chunk_ord INTEGER NOT NULL DEFAULT 0,
      anchor TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      mtime INTEGER NOT NULL DEFAULT 0,
      UNIQUE(path, chunk_ord)
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      path,
      anchor,
      text,
      content='chunks',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, path, anchor, text) VALUES (new.id, new.path, new.anchor, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, path, anchor, text) VALUES('delete', old.id, old.path, old.anchor, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, path, anchor, text) VALUES('delete', old.id, old.path, old.anchor, old.text);
      INSERT INTO chunks_fts(rowid, path, anchor, text) VALUES (new.id, new.path, new.anchor, new.text);
    END;

    CREATE TABLE IF NOT EXISTS embeddings (
      chunk_id INTEGER PRIMARY KEY,
      model TEXT NOT NULL,
      dim INTEGER NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      vector BLOB NOT NULL,
      FOREIGN KEY(chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS note_embeddings (
      path TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      dim INTEGER NOT NULL,
      vector BLOB NOT NULL,
      updated_at_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS note_links (
      source_path TEXT NOT NULL,
      target_key TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_path);
    CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_key);

    CREATE TABLE IF NOT EXISTS note_properties (
      path TEXT NOT NULL,
      key TEXT NOT NULL,
      kind TEXT NOT NULL,
      value_text TEXT,
      value_num REAL,
      value_bool INTEGER,
      value_date TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_note_properties_path ON note_properties(path);
    CREATE INDEX IF NOT EXISTS idx_note_properties_key ON note_properties(key);
    CREATE INDEX IF NOT EXISTS idx_note_properties_key_text ON note_properties(key, value_text);
    CREATE INDEX IF NOT EXISTS idx_note_properties_key_num ON note_properties(key, value_num);
    CREATE INDEX IF NOT EXISTS idx_note_properties_key_bool ON note_properties(key, value_bool);
    CREATE INDEX IF NOT EXISTS idx_note_properties_key_date ON note_properties(key, value_date);

    CREATE TABLE IF NOT EXISTS semantic_edges (
      source_path TEXT NOT NULL,
      target_path TEXT NOT NULL,
      score REAL NOT NULL,
      model TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(source_path, target_path)
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_edges_source ON semantic_edges(source_path);
    CREATE INDEX IF NOT EXISTS idx_semantic_edges_target ON semantic_edges(target_path);

    CREATE TABLE IF NOT EXISTS second_brain_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      created_at_ms INTEGER NOT NULL DEFAULT 0,
      updated_at_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_second_brain_sessions_updated ON second_brain_sessions(updated_at_ms DESC);

    CREATE TABLE IF NOT EXISTS second_brain_context_items (
      session_id TEXT NOT NULL,
      path TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(session_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_second_brain_context_session_order
      ON second_brain_context_items(session_id, sort_order ASC);

    CREATE TABLE IF NOT EXISTS second_brain_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'freestyle',
      content_md TEXT NOT NULL DEFAULT '',
      citations_json TEXT NOT NULL DEFAULT '[]',
      attachments_json TEXT NOT NULL DEFAULT '[]',
      created_at_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_second_brain_messages_session_created
      ON second_brain_messages(session_id, created_at_ms ASC);

    CREATE TABLE IF NOT EXISTS second_brain_drafts (
      session_id TEXT PRIMARY KEY,
      content_md TEXT NOT NULL DEFAULT '',
      updated_at_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS second_brain_session_targets (
      session_id TEXT PRIMARY KEY,
      target_note_path TEXT NOT NULL DEFAULT '',
      updated_at_ms INTEGER NOT NULL DEFAULT 0
    );
  "#,
    )?;

    conn.execute(
        "INSERT OR REPLACE INTO internal_meta(key, value) VALUES ('index_schema_version', ?1)",
        params![INDEX_SCHEMA_VERSION.to_string()],
    )?;

    Ok(())
}

#[tauri::command]
fn init_db() -> Result<()> {
    let conn = open_db()?;
    ensure_index_schema(&conn)
}

fn reindex_markdown_file_lexical_sync(path: String) -> Result<()> {
    let started_at = Instant::now();
    let root = active_workspace_root()?;
    let file_path = normalize_existing_file(&path)?;
    ensure_within_root(&root, &file_path)?;

    let normalized_path = fs::canonicalize(&file_path)?;
    if has_hidden_dir_component(&root, &normalized_path) {
        log_index(&format!(
            "reindex:skip_hidden path={}",
            normalized_path.to_string_lossy()
        ));
        return Ok(());
    }
    let markdown = fs::read_to_string(&normalized_path)?;
    let content_for_indexing = strip_yaml_frontmatter(&markdown);
    let chunks = chunk_markdown(content_for_indexing);
    let targets = parse_note_targets(&markdown);
    let properties = parse_yaml_frontmatter_properties(&markdown);
    let chunk_count = chunks.len();
    let target_count = targets.len();
    let property_count = properties.len();
    let mtime = fs::metadata(&normalized_path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or(0)
        });

    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    let tx = conn.unchecked_transaction()?;
    let path_for_db = normalize_workspace_relative_path(&root, &normalized_path)?;
    let chunks = inject_relative_path_context(&path_for_db, chunks);
    log_index(&format!("reindex:start path={path_for_db}"));
    let source_key = normalize_note_key(&root, &normalized_path)?;

    tx.execute(
        "DELETE FROM note_links WHERE source_path = ?1",
        params![path_for_db.clone()],
    )?;
    tx.execute(
        "DELETE FROM note_properties WHERE path = ?1",
        params![path_for_db.clone()],
    )?;

    for (chunk_ord, (anchor, text)) in chunks.into_iter().enumerate() {
        let chunk_hash = chunk_content_hash(&anchor, &text);
        tx.execute(
            "INSERT INTO chunks(path, chunk_ord, anchor, text, content_hash, mtime)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(path, chunk_ord) DO UPDATE SET
               anchor = excluded.anchor,
               text = excluded.text,
               content_hash = excluded.content_hash,
               mtime = excluded.mtime",
            params![
                path_for_db,
                chunk_ord as i64,
                anchor,
                text,
                chunk_hash,
                mtime
            ],
        )?;
    }
    tx.execute(
        "DELETE FROM embeddings
         WHERE chunk_id IN (
           SELECT id FROM chunks WHERE path = ?1 AND chunk_ord >= ?2
         )",
        params![path_for_db.clone(), chunk_count as i64],
    )?;
    tx.execute(
        "DELETE FROM chunks WHERE path = ?1 AND chunk_ord >= ?2",
        params![path_for_db.clone(), chunk_count as i64],
    )?;

    for target in targets {
        if target == source_key {
            continue;
        }
        tx.execute(
            "INSERT INTO note_links(source_path, target_key) VALUES (?1, ?2)",
            params![path_for_db, target],
        )?;
    }

    for property in properties {
        tx.execute(
      "INSERT INTO note_properties(path, key, kind, value_text, value_num, value_bool, value_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      params![
        path_for_db,
        property.key,
        property.kind,
        property.value_text,
        property.value_num,
        property.value_bool,
        property.value_date
      ],
    )?;
    }

    tx.commit()?;
    let total_ms = started_at.elapsed().as_millis();
    log_index(&format!(
        "reindex:done path={path_for_db} chunks={chunk_count} targets={target_count} properties={property_count} embedding=deferred embedding_ms=0 total_ms={total_ms}"
    ));
    Ok(())
}

#[tauri::command]
async fn reindex_markdown_file_lexical(path: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || reindex_markdown_file_lexical_sync(path))
        .await
        .map_err(|_| AppError::OperationFailed)?
}

fn reindex_markdown_file_semantic_sync(path: String) -> Result<()> {
    let started_at = Instant::now();
    let root = active_workspace_root()?;
    let path_for_db = normalize_workspace_relative_from_input(&root, &path)?;
    log_index(&format!("semantic:reindex:start path={path_for_db}"));

    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    let tx = conn.unchecked_transaction()?;
    let mut stmt = tx.prepare(
        r#"
      SELECT c.id, c.text, c.content_hash, e.model, e.content_hash, e.dim, e.vector
      FROM chunks c
      LEFT JOIN embeddings e ON e.chunk_id = c.id
      WHERE c.path = ?1
      ORDER BY c.chunk_ord ASC
    "#,
    )?;
    let mut rows = stmt.query(params![path_for_db.clone()])?;

    let model_name = semantic::embedding_model_name();
    let mut chunk_ids: Vec<i64> = Vec::new();
    let mut chunk_hashes: Vec<String> = Vec::new();
    let mut chunk_vectors: Vec<Option<Vec<f32>>> = Vec::new();
    let mut embed_texts: Vec<String> = Vec::new();
    let mut embed_positions: Vec<usize> = Vec::new();
    let mut reused = 0usize;
    let mut reembedded = 0usize;

    while let Some(row) = rows.next()? {
        let chunk_id: i64 = row.get(0)?;
        let chunk_text: String = row.get(1)?;
        let chunk_hash: String = row.get(2)?;
        let embedding_model: Option<String> = row.get(3)?;
        let embedding_hash: Option<String> = row.get(4)?;
        let embedding_dim: Option<i64> = row.get(5)?;
        let embedding_blob: Option<Vec<u8>> = row.get(6)?;

        let mut reused_vector: Option<Vec<f32>> = None;
        if let (Some(model), Some(hash), Some(dim), Some(blob)) =
            (embedding_model, embedding_hash, embedding_dim, embedding_blob)
        {
            if model == model_name && hash == chunk_hash {
                reused_vector = semantic::blob_to_vector(&blob, dim as usize);
            }
        }

        if let Some(mut vector) = reused_vector {
            semantic::normalize_in_place(&mut vector);
            reused += 1;
            chunk_vectors.push(Some(vector));
        } else {
            embed_positions.push(chunk_vectors.len());
            embed_texts.push(chunk_text);
            chunk_vectors.push(None);
        }

        chunk_ids.push(chunk_id);
        chunk_hashes.push(chunk_hash);
    }

    drop(rows);
    drop(stmt);

    if !embed_texts.is_empty() {
        let mut new_vectors = semantic::embed_texts(&embed_texts)
            .map_err(|err| AppError::InvalidOperation(err.to_string()))?;
        if new_vectors.len() != embed_positions.len() {
            return Err(AppError::OperationFailed);
        }

        for (index, mut vector) in new_vectors.drain(..).enumerate() {
            semantic::normalize_in_place(&mut vector);
            let target_pos = embed_positions[index];
            let chunk_id = chunk_ids[target_pos];
            let content_hash = chunk_hashes[target_pos].clone();
            tx.execute(
                "INSERT INTO embeddings(chunk_id, model, dim, content_hash, vector) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(chunk_id) DO UPDATE SET
                   model=excluded.model,
                   dim=excluded.dim,
                   content_hash=excluded.content_hash,
                   vector=excluded.vector",
                params![
                    chunk_id,
                    model_name.clone(),
                    vector.len() as i64,
                    content_hash,
                    semantic::vector_to_blob(&vector)
                ],
            )?;
            chunk_vectors[target_pos] = Some(vector);
            reembedded += 1;
        }
    }

    let resolved_vectors: Vec<Vec<f32>> = chunk_vectors.into_iter().flatten().collect();
    if resolved_vectors.is_empty() {
        tx.execute(
            "DELETE FROM note_embeddings WHERE path = ?1",
            params![path_for_db.clone()],
        )?;
        semantic::try_delete_note_vector(&tx, &path_for_db);
    } else if let Some(note_vector) = semantic::centroid(&resolved_vectors) {
        let updated_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis() as i64)
            .unwrap_or(0);
        tx.execute(
            "INSERT INTO note_embeddings(path, model, dim, vector, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(path) DO UPDATE SET model=excluded.model, dim=excluded.dim, vector=excluded.vector, updated_at_ms=excluded.updated_at_ms",
            params![
                path_for_db.clone(),
                model_name,
                note_vector.len() as i64,
                semantic::vector_to_blob(&note_vector),
                updated_at_ms
            ],
        )?;
        if let Err(err) = semantic::try_ensure_vec_table(&tx, note_vector.len()) {
            log_index(&format!(
                "semantic:reindex:vec_table_unavailable path={path_for_db} dim={} err={err}",
                note_vector.len()
            ));
            return Err(AppError::OperationFailed);
        }
        if let Err(err) = semantic::try_upsert_note_vector(&tx, &path_for_db, &note_vector) {
            log_index(&format!(
                "semantic:reindex:vec_upsert_failed path={path_for_db} dim={} err={err}",
                note_vector.len()
            ));
            return Err(AppError::OperationFailed);
        }
    }

    tx.commit()?;
    let total_chunks = chunk_ids.len();
    log_index(&format!(
        "semantic:reindex:done path={path_for_db} chunks_total={total_chunks} chunks_reused={reused} chunks_reembedded={reembedded} total_ms={}",
        started_at.elapsed().as_millis()
    ));
    Ok(())
}

#[tauri::command]
async fn reindex_markdown_file_semantic(path: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || reindex_markdown_file_semantic_sync(path))
        .await
        .map_err(|_| AppError::OperationFailed)?
}

fn refresh_semantic_edges_cache_now_sync() -> Result<()> {
    let root = active_workspace_root()?;
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    refresh_semantic_edges_cache(&conn, &root)
}

#[tauri::command]
async fn refresh_semantic_edges_cache_now() -> Result<()> {
    tauri::async_runtime::spawn_blocking(refresh_semantic_edges_cache_now_sync)
        .await
        .map_err(|_| AppError::OperationFailed)?
}

pub(crate) fn reindex_markdown_file_now_sync(path: String) -> Result<()> {
    reindex_markdown_file_lexical_sync(path.clone())?;
    reindex_markdown_file_semantic_sync(path)?;
    refresh_semantic_edges_cache_now_sync()
}

fn remove_markdown_file_from_index_sync(path: String) -> Result<()> {
    let root = active_workspace_root()?;
    let path_for_db = normalize_workspace_relative_from_input(&root, &path)?;
    let source_key = normalize_note_key(&root, &root.join(&path_for_db))?;
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM chunks WHERE path = ?1",
        params![path_for_db.clone()],
    )?;
    tx.execute(
        "DELETE FROM note_links WHERE source_path = ?1 OR target_key = ?2",
        params![path_for_db.clone(), source_key],
    )?;
    tx.execute(
        "DELETE FROM note_properties WHERE path = ?1",
        params![path_for_db.clone()],
    )?;
    tx.execute(
        "DELETE FROM note_embeddings WHERE path = ?1",
        params![path_for_db.clone()],
    )?;
    semantic::try_delete_note_vector(&tx, &path_for_db);
    tx.execute(
        "DELETE FROM semantic_edges WHERE source_path = ?1 OR target_path = ?1",
        params![path_for_db.clone()],
    )?;
    tx.commit()?;

    if let Err(err) = refresh_semantic_edges_cache(&conn, &root) {
        log_index(&format!("semantic_edges:refresh_error err={err}"));
    }
    log_index(&format!("reindex:removed path={path_for_db}"));
    Ok(())
}

#[tauri::command]
async fn remove_markdown_file_from_index(path: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || remove_markdown_file_from_index_sync(path))
        .await
        .map_err(|_| AppError::OperationFailed)?
}

#[derive(Serialize)]
struct RebuildIndexResult {
    indexed_files: usize,
    canceled: bool,
}

#[derive(Serialize)]
struct IndexRuntimeStatus {
    model_name: String,
    model_state: String,
    model_init_attempts: u32,
    model_last_started_at_ms: Option<u64>,
    model_last_finished_at_ms: Option<u64>,
    model_last_duration_ms: Option<u64>,
    model_last_error: Option<String>,
}

#[derive(Serialize)]
struct GraphNodeDto {
    id: String,
    path: String,
    label: String,
    degree: usize,
    tags: Vec<String>,
    cluster: Option<usize>,
}

#[derive(Serialize)]
struct GraphEdgeDto {
    source: String,
    target: String,
    #[serde(rename = "type")]
    edge_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    score: Option<f32>,
}

#[derive(Serialize)]
struct WikilinkGraphDto {
    nodes: Vec<GraphNodeDto>,
    edges: Vec<GraphEdgeDto>,
    generated_at_ms: u64,
}

#[derive(Debug)]
struct RankedSearchRow {
    chunk_id: i64,
    path: String,
    snippet: String,
    lexical_score: f64,
}

/// Applies min-max normalization to convert arbitrary score ranges into `[0, 1]`.
fn min_max_normalize(values: &[f64]) -> Vec<f64> {
    if values.is_empty() {
        return Vec::new();
    }
    let min = values
        .iter()
        .copied()
        .fold(f64::INFINITY, |acc, item| acc.min(item));
    let max = values
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, |acc, item| acc.max(item));
    if (max - min).abs() <= f64::EPSILON {
        return vec![1.0; values.len()];
    }
    values
        .iter()
        .map(|value| (value - min) / (max - min))
        .collect()
}

/// Rebuilds semantic edge cache from note-level embeddings and sqlite-vec KNN.
///
/// This is invoked at the end of index updates (full and partial) so graph reads
/// can stay fast and deterministic.
fn refresh_semantic_edges_cache(conn: &Connection, root_canonical: &Path) -> Result<()> {
    let started_at = Instant::now();
    let mut source_paths: Vec<String> = {
        let mut stmt = conn.prepare("SELECT path FROM note_embeddings_vec ORDER BY path")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        items
    };
    source_paths.sort_by_key(|item| item.to_lowercase());
    log_index(&format!(
        "semantic_edges:refresh_start sources={} top_k={} threshold={}",
        source_paths.len(),
        SEMANTIC_TOP_K_PER_NOTE,
        SEMANTIC_THRESHOLD
    ));

    conn.execute("DELETE FROM semantic_edges", []).map_err(|err| {
        log_index(&format!(
            "semantic_edges:refresh_error stage=clear_cache err={err}"
        ));
        AppError::Sqlite(err)
    })?;
    let updated_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0);

    let mut sources_with_vector = 0usize;
    let mut sources_query_ok = 0usize;
    let mut total_candidates = 0usize;
    let mut total_added = 0usize;
    let mut total_skipped_self = 0usize;
    let mut total_skipped_threshold = 0usize;
    let mut total_skipped_existing_link = 0usize;
    let mut total_skipped_missing_target_key = 0usize;
    let total_missing_vector = 0usize;

    for source_path in source_paths {
        let mut stmt = match conn.prepare(
            r#"
            SELECT path, distance
            FROM note_embeddings_vec
            WHERE embedding MATCH (SELECT embedding FROM note_embeddings_vec WHERE path = ?1)
            ORDER BY distance ASC
            LIMIT ?2
        "#,
        ) {
            Ok(value) => value,
            Err(err) => {
                log_index(&format!(
                    "semantic_edges:refresh_error stage=prepare source_path={source_path} err={err}"
                ));
                return Err(AppError::Sqlite(err));
            }
        };
        let mut rows = match stmt.query(params![source_path.clone(), SEMANTIC_TOP_K_PER_NOTE + 1]) {
            Ok(value) => value,
            Err(err) => {
                log_index(&format!(
                    "semantic_edges:refresh_error stage=query source_path={source_path} err={err}"
                ));
                return Err(AppError::Sqlite(err));
            }
        };
        sources_with_vector += 1;
        sources_query_ok += 1;

        let mut added_for_source = 0i64;
        while let Some(row) = rows.next().map_err(|err| {
            log_index(&format!(
                "semantic_edges:refresh_error stage=rows_next source_path={source_path} err={err}"
            ));
            AppError::Sqlite(err)
        })? {
            total_candidates += 1;
            let target_path: String = row.get(0).map_err(|err| {
                log_index(&format!(
                    "semantic_edges:refresh_error stage=row_target source_path={source_path} err={err}"
                ));
                AppError::Sqlite(err)
            })?;
            let distance: f32 = row.get(1).map_err(|err| {
                log_index(&format!(
                    "semantic_edges:refresh_error stage=row_distance source_path={source_path} target_path={target_path} err={err}"
                ));
                AppError::Sqlite(err)
            })?;
            if target_path == source_path {
                total_skipped_self += 1;
                continue;
            }
            let score = (1.0 - ((distance * distance) * 0.5)).clamp(0.0, 1.0);
            if score < SEMANTIC_THRESHOLD {
                total_skipped_threshold += 1;
                continue;
            }

            let Some(target_key) =
                normalize_note_key_from_workspace_path(root_canonical, &target_path)
            else {
                total_skipped_missing_target_key += 1;
                continue;
            };

            let exists = conn.query_row(
                "SELECT 1 FROM note_links WHERE source_path = ?1 AND target_key = ?2 LIMIT 1",
                params![source_path.clone(), target_key],
                |_row| Ok(()),
            );
            if exists.is_ok() {
                total_skipped_existing_link += 1;
                continue;
            }
            if let Err(err) = &exists {
                if !matches!(err, rusqlite::Error::QueryReturnedNoRows) {
                    log_index(&format!(
                        "semantic_edges:refresh_error stage=check_existing_link source_path={source_path} target_path={target_path} err={err}"
                    ));
                }
            }

            conn.execute(
                "INSERT INTO semantic_edges(source_path, target_path, score, model, updated_at_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    source_path.clone(),
                    target_path.clone(),
                    score,
                    semantic::embedding_model_name(),
                    updated_at_ms
                ],
            )
            .map_err(|err| {
                log_index(&format!(
                    "semantic_edges:refresh_error stage=insert source_path={source_path} target_path={target_path} score={score:.4} err={err}"
                ));
                AppError::Sqlite(err)
            })?;
            total_added += 1;
            added_for_source += 1;
            if added_for_source >= SEMANTIC_TOP_K_PER_NOTE {
                break;
            }
        }
    }

    log_index(&format!(
        "semantic_edges:refresh_done sources_with_vector={} sources_query_ok={} candidates={} added={} skip_self={} skip_threshold={} skip_existing_link={} skip_missing_target_key={} missing_vectors={} total_ms={}",
        sources_with_vector,
        sources_query_ok,
        total_candidates,
        total_added,
        total_skipped_self,
        total_skipped_threshold,
        total_skipped_existing_link,
        total_skipped_missing_target_key,
        total_missing_vector,
        started_at.elapsed().as_millis()
    ));
    Ok(())
}

/// Builds a graph payload from indexed wikilinks and current markdown files.
///
/// This function:
/// - treats markdown files in the workspace as the authoritative node set,
/// - resolves `note_links.target_key` via normalized note keys,
/// - excludes unresolved links,
/// - computes degree and tag metadata.
fn build_wikilink_graph_from_index(
    conn: &Connection,
    root_canonical: &Path,
    markdown_paths: &[String],
) -> Result<WikilinkGraphDto> {
    let mut nodes_set = HashSet::new();
    for path in markdown_paths {
        nodes_set.insert(path.clone());
    }

    let mut path_by_key: HashMap<String, String> = HashMap::new();
    let mut path_by_unique_basename: HashMap<String, Option<String>> = HashMap::new();
    for path in markdown_paths {
        if let Some(key) = normalize_note_key_from_workspace_path(root_canonical, path) {
            let basename = note_key_basename(&key);
            let existing = path_by_key.get(&key).cloned();
            if let Some(previous) = existing {
                if path.to_lowercase() < previous.to_lowercase() {
                    path_by_key.insert(key.clone(), path.clone());
                }
            } else {
                path_by_key.insert(key.clone(), path.clone());
            }

            match path_by_unique_basename.get(&basename) {
                Some(Some(previous)) if !previous.eq_ignore_ascii_case(path) => {
                    path_by_unique_basename.insert(basename, None);
                }
                Some(None) => {}
                _ => {
                    path_by_unique_basename.insert(basename, Some(path.clone()));
                }
            }
        }
    }

    let mut tags_by_path: HashMap<String, Vec<String>> = HashMap::new();
    let mut tag_stmt = conn.prepare(
        r#"
      SELECT path, value_text
      FROM note_properties
      WHERE key = 'tags' AND kind = 'list' AND value_text IS NOT NULL
      ORDER BY path, value_text
    "#,
    )?;
    let tag_rows = tag_stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    for row in tag_rows {
        let (path, value) = row?;
        if !nodes_set.contains(&path) {
            continue;
        }
        let entry = tags_by_path.entry(path).or_default();
        if !entry.iter().any(|item| item.eq_ignore_ascii_case(&value)) {
            entry.push(value);
        }
    }

    let mut degrees: HashMap<String, usize> = HashMap::new();
    let mut edges: Vec<GraphEdgeDto> = Vec::new();
    let mut seen_edges: HashSet<(String, String)> = HashSet::new();

    let mut edge_stmt = conn.prepare(
        r#"
      SELECT source_path, target_key
      FROM note_links
      ORDER BY source_path, target_key
    "#,
    )?;
    let edge_rows = edge_stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    for row in edge_rows {
        let (source_path, target_key) = row?;
        if !nodes_set.contains(&source_path) {
            continue;
        }
        let target_path = path_by_key.get(&target_key).cloned().or_else(|| {
            if target_key.contains('/') {
                return None;
            }
            path_by_unique_basename
                .get(&target_key)
                .and_then(|value| value.clone())
        });
        let Some(target_path) = target_path else {
            continue;
        };
        if source_path == target_path {
            continue;
        }
        if !seen_edges.insert((source_path.clone(), target_path.clone())) {
            continue;
        }

        *degrees.entry(source_path.clone()).or_insert(0) += 1;
        *degrees.entry(target_path.clone()).or_insert(0) += 1;

        edges.push(GraphEdgeDto {
            source: source_path,
            target: target_path,
            edge_type: "wikilink".to_string(),
            score: None,
        });
    }

    let mut semantic_stmt = conn.prepare(
        r#"
      SELECT source_path, target_path, score
      FROM semantic_edges
      ORDER BY source_path, target_path
    "#,
    )?;
    let semantic_rows = semantic_stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, f32>(2)?,
        ))
    })?;

    for row in semantic_rows {
        let (source_path, target_path, score) = row?;
        if !nodes_set.contains(&source_path) || !nodes_set.contains(&target_path) {
            continue;
        }
        if source_path == target_path {
            continue;
        }
        if !seen_edges.insert((source_path.clone(), target_path.clone())) {
            continue;
        }
        edges.push(GraphEdgeDto {
            source: source_path.clone(),
            target: target_path.clone(),
            edge_type: "semantic".to_string(),
            score: Some(score),
        });
        *degrees.entry(source_path).or_insert(0) += 1;
        *degrees.entry(target_path).or_insert(0) += 1;
    }

    let mut node_paths: Vec<String> = markdown_paths.to_vec();
    node_paths.sort_by_key(|item| item.to_lowercase());
    node_paths.dedup_by(|a, b| a.eq_ignore_ascii_case(b));

    let nodes = node_paths
        .into_iter()
        .map(|path| GraphNodeDto {
            id: path.clone(),
            label: note_label_from_workspace_path(&path),
            degree: *degrees.get(&path).unwrap_or(&0),
            tags: tags_by_path.remove(&path).unwrap_or_default(),
            cluster: None,
            path: workspace_absolute_path(root_canonical, &path),
        })
        .collect();

    let generated_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0);

    Ok(WikilinkGraphDto {
        nodes,
        edges,
        generated_at_ms,
    })
}

fn rebuild_workspace_index_sync() -> Result<RebuildIndexResult> {
    let rebuild_started_at = Instant::now();
    let root_canonical = active_workspace_root()?;
    log_index(&format!(
        "rebuild:start workspace={}",
        root_canonical.to_string_lossy()
    ));
    let conn = open_db()?;
    ensure_index_schema(&conn)?;

    let clear_started_at = Instant::now();
    conn.execute_batch(
        r#"
    DELETE FROM embeddings;
    DELETE FROM note_embeddings;
    DELETE FROM chunks;
    DELETE FROM note_links;
    DELETE FROM note_properties;
    DELETE FROM semantic_edges;
  "#,
    )?;
    let _ = conn.execute("DELETE FROM note_embeddings_vec", []);
    log_index(&format!(
        "rebuild:cleared_tables elapsed_ms={}",
        clear_started_at.elapsed().as_millis()
    ));

    let markdown_files = list_markdown_files_via_find(&root_canonical)?;
    log_index(&format!(
        "rebuild:discovered_files count={}",
        markdown_files.len()
    ));
    let mut indexed_files = 0usize;
    let mut processed_files = 0usize;
    let mut semantic_indexed = 0usize;
    let mut canceled = false;
    INDEX_CANCEL_REQUESTED.store(false, Ordering::SeqCst);
    for candidate in markdown_files {
        if INDEX_CANCEL_REQUESTED.load(Ordering::SeqCst) {
            canceled = true;
            log_index("rebuild:canceled requested_by_user=true");
            break;
        }
        processed_files += 1;
        let canonical_candidate = match fs::canonicalize(&candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if ensure_within_root(&root_canonical, &canonical_candidate).is_err() {
            continue;
        }
        reindex_markdown_file_lexical_sync(canonical_candidate.to_string_lossy().to_string())?;
        indexed_files += 1;
        if indexed_files % 25 == 0 || processed_files % 50 == 0 {
            log_index(&format!(
                "rebuild:progress indexed={indexed_files} scanned={processed_files}"
            ));
        }
    }

    if !canceled {
        let markdown_files = list_markdown_files_via_find(&root_canonical)?;
        for candidate in markdown_files {
            if INDEX_CANCEL_REQUESTED.load(Ordering::SeqCst) {
                canceled = true;
                log_index("rebuild:canceled requested_by_user=true stage=semantic");
                break;
            }
            let canonical_candidate = match fs::canonicalize(&candidate) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if ensure_within_root(&root_canonical, &canonical_candidate).is_err() {
                continue;
            }
            if reindex_markdown_file_semantic_sync(canonical_candidate.to_string_lossy().to_string())
                .is_ok()
            {
                semantic_indexed += 1;
            }
        }
    }

    if !canceled {
        let semantic_edges_refresh_started_at = Instant::now();
        log_index("semantic_edges:refresh_start stage=rebuild");
        if let Err(err) = refresh_semantic_edges_cache_now_sync() {
            log_index(&format!(
                "semantic_edges:refresh_error stage=rebuild err={err}"
            ));
        } else {
            log_index(&format!(
                "semantic_edges:refresh_done stage=rebuild total_ms={}",
                semantic_edges_refresh_started_at.elapsed().as_millis()
            ));
        }
    }

    log_index(&format!(
        "rebuild:done indexed={indexed_files} semantic_indexed={semantic_indexed} scanned={processed_files} canceled={canceled} total_ms={}",
        rebuild_started_at.elapsed().as_millis()
    ));
    Ok(RebuildIndexResult {
        indexed_files,
        canceled,
    })
}

#[tauri::command]
async fn rebuild_workspace_index() -> Result<RebuildIndexResult> {
    tauri::async_runtime::spawn_blocking(rebuild_workspace_index_sync)
        .await
        .map_err(|_| AppError::OperationFailed)?
}

#[tauri::command]
fn request_index_cancel() -> Result<()> {
    INDEX_CANCEL_REQUESTED.store(true, Ordering::SeqCst);
    log_index("cancel:requested");
    Ok(())
}

#[tauri::command]
fn read_index_runtime_status() -> Result<IndexRuntimeStatus> {
    let status = semantic::runtime_status();
    Ok(IndexRuntimeStatus {
        model_name: status.model_name,
        model_state: status.model_state,
        model_init_attempts: status.model_init_attempts,
        model_last_started_at_ms: status.model_last_started_at_ms,
        model_last_finished_at_ms: status.model_last_finished_at_ms,
        model_last_duration_ms: status.model_last_duration_ms,
        model_last_error: status.model_last_error,
    })
}

#[tauri::command]
fn read_index_logs(limit: Option<usize>) -> Result<Vec<IndexLogEntry>> {
    let max_items = limit.unwrap_or(80).clamp(1, INDEX_LOG_CAPACITY);
    let guard = index_log_buffer()
        .lock()
        .map_err(|_| AppError::OperationFailed)?;
    let start = guard.len().saturating_sub(max_items);
    Ok(guard.iter().skip(start).cloned().collect())
}

/// Returns a workspace wikilink graph for the Cosmos view.
///
/// The graph is built from indexed wikilinks, while node existence is validated
/// against markdown files currently present in the workspace.
#[tauri::command]
fn get_wikilink_graph() -> Result<WikilinkGraphDto> {
    let root_canonical = active_workspace_root()?;
    let conn = open_db()?;
    let markdown_files = list_markdown_files_via_find(&root_canonical)?;
    let mut markdown_paths = Vec::new();

    for candidate in markdown_files {
        let canonical_candidate = match fs::canonicalize(&candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let relative =
            match normalize_workspace_relative_path(&root_canonical, &canonical_candidate) {
                Ok(value) => value,
                Err(_) => continue,
            };
        markdown_paths.push(relative);
    }

    build_wikilink_graph_from_index(&conn, &root_canonical, &markdown_paths)
}

#[tauri::command]
fn read_property_type_schema() -> Result<HashMap<String, String>> {
    let schema_path = property_type_schema_path()?;
    if !schema_path.exists() {
        return Ok(HashMap::new());
    }

    let raw = fs::read_to_string(schema_path)?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|_| AppError::InvalidOperation("Property type schema is invalid.".to_string()))?;

    let mut out: HashMap<String, String> = HashMap::new();
    if let Some(object) = parsed.as_object() {
        for (key, value) in object {
            let normalized_key = key.trim().to_lowercase();
            if normalized_key.is_empty() {
                continue;
            }
            let Some(raw_type) = value.as_str() else {
                continue;
            };
            if !matches!(
                raw_type,
                "text" | "list" | "number" | "checkbox" | "date" | "tags"
            ) {
                continue;
            }
            out.insert(normalized_key, raw_type.to_string());
        }
    }

    Ok(out)
}

#[tauri::command]
fn write_property_type_schema(schema: HashMap<String, String>) -> Result<()> {
    let schema_path = property_type_schema_path()?;
    let mut sanitized: HashMap<String, String> = HashMap::new();

    for (key, value) in schema {
        let normalized_key = key.trim().to_lowercase();
        if normalized_key.is_empty() {
            continue;
        }
        if !matches!(
            value.as_str(),
            "text" | "list" | "number" | "checkbox" | "date" | "tags"
        ) {
            continue;
        }
        sanitized.insert(normalized_key, value);
    }

    let serialized =
        serde_json::to_string_pretty(&sanitized).map_err(|_| AppError::OperationFailed)?;
    fs::write(schema_path, serialized)?;
    Ok(())
}

#[derive(Serialize)]
struct Hit {
    path: String,
    snippet: String,
    score: f64,
}

#[derive(Debug, Clone)]
enum PropertyFilter {
    Has { key: String },
    EqText { key: String, value: String },
    EqBool { key: String, value: i64 },
    EqNum { key: String, value: f64 },
    EqDate { key: String, value: String },
    GtNum { key: String, value: f64 },
    GteNum { key: String, value: f64 },
    LtNum { key: String, value: f64 },
    LteNum { key: String, value: f64 },
    GtDate { key: String, value: String },
    GteDate { key: String, value: String },
    LtDate { key: String, value: String },
    LteDate { key: String, value: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SearchMode {
    Hybrid,
    Semantic,
    Lexical,
}

fn is_property_key_token(input: &str) -> bool {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return false;
    }
    trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

fn parse_property_filter_token(token: &str) -> Option<PropertyFilter> {
    let token = token.trim();
    if token.is_empty() {
        return None;
    }

    if let Some(raw_key) = token.strip_prefix("has:") {
        let key = raw_key.trim().to_lowercase();
        if is_property_key_token(&key) {
            return Some(PropertyFilter::Has { key });
        }
        return None;
    }

    let operators = [
        (">=", 2usize),
        ("<=", 2usize),
        (">", 1usize),
        ("<", 1usize),
        (":", 1usize),
        ("=", 1usize),
    ];
    for (op, len) in operators {
        let Some(position) = token.find(op) else {
            continue;
        };
        if position == 0 {
            return None;
        }
        let key = token[..position].trim().to_lowercase();
        if !is_property_key_token(&key) {
            return None;
        }
        let raw_value = token[(position + len)..].trim();
        if raw_value.is_empty() {
            return None;
        }
        let value = unquote_yaml_scalar(raw_value);

        if op == ":" || op == "=" {
            if value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("false") {
                return Some(PropertyFilter::EqBool {
                    key,
                    value: if value.eq_ignore_ascii_case("true") {
                        1
                    } else {
                        0
                    },
                });
            }
            if let Ok(number) = value.parse::<f64>() {
                if number.is_finite() {
                    return Some(PropertyFilter::EqNum { key, value: number });
                }
            }
            if is_iso_date_value(&value) {
                return Some(PropertyFilter::EqDate { key, value });
            }
            return Some(PropertyFilter::EqText {
                key,
                value: value.to_lowercase(),
            });
        }

        if is_iso_date_value(&value) {
            return match op {
                ">" => Some(PropertyFilter::GtDate { key, value }),
                ">=" => Some(PropertyFilter::GteDate { key, value }),
                "<" => Some(PropertyFilter::LtDate { key, value }),
                "<=" => Some(PropertyFilter::LteDate { key, value }),
                _ => None,
            };
        }

        if let Ok(number) = value.parse::<f64>() {
            if number.is_finite() {
                return match op {
                    ">" => Some(PropertyFilter::GtNum { key, value: number }),
                    ">=" => Some(PropertyFilter::GteNum { key, value: number }),
                    "<" => Some(PropertyFilter::LtNum { key, value: number }),
                    "<=" => Some(PropertyFilter::LteNum { key, value: number }),
                    _ => None,
                };
            }
        }
        return None;
    }

    None
}

fn parse_search_query(raw: &str) -> (SearchMode, String, Vec<PropertyFilter>) {
    let trimmed = raw.trim();
    let lowered = trimmed.to_ascii_lowercase();
    let (mode, remainder) = if lowered.starts_with("semantic:") {
        (
            SearchMode::Semantic,
            trimmed["semantic:".len()..].trim_start(),
        )
    } else if lowered.starts_with("lexical:") {
        (
            SearchMode::Lexical,
            trimmed["lexical:".len()..].trim_start(),
        )
    } else if lowered.starts_with("hybrid:") {
        (SearchMode::Hybrid, trimmed["hybrid:".len()..].trim_start())
    } else {
        (SearchMode::Hybrid, trimmed)
    };

    let mut text_terms: Vec<String> = Vec::new();
    let mut filters: Vec<PropertyFilter> = Vec::new();

    for token in remainder.split_whitespace() {
        if let Some(filter) = parse_property_filter_token(token) {
            filters.push(filter);
        } else {
            text_terms.push(token.to_string());
        }
    }

    (mode, text_terms.join(" "), filters)
}

fn path_set_for_property_filter(
    conn: &Connection,
    filter: &PropertyFilter,
) -> Result<HashSet<String>> {
    let (sql, args): (&str, Vec<SqlValue>) = match filter {
        PropertyFilter::Has { key } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1",
            vec![SqlValue::Text(key.clone())],
        ),
        PropertyFilter::EqText { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_text = ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Text(value.clone())],
        ),
        PropertyFilter::EqBool { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_bool = ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Integer(*value)],
        ),
        PropertyFilter::EqNum { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_num = ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Real(*value)],
        ),
        PropertyFilter::EqDate { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_date = ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Text(value.clone())],
        ),
        PropertyFilter::GtNum { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_num > ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Real(*value)],
        ),
        PropertyFilter::GteNum { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_num >= ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Real(*value)],
        ),
        PropertyFilter::LtNum { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_num < ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Real(*value)],
        ),
        PropertyFilter::LteNum { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_num <= ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Real(*value)],
        ),
        PropertyFilter::GtDate { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_date > ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Text(value.clone())],
        ),
        PropertyFilter::GteDate { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_date >= ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Text(value.clone())],
        ),
        PropertyFilter::LtDate { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_date < ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Text(value.clone())],
        ),
        PropertyFilter::LteDate { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_date <= ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Text(value.clone())],
        ),
    };

    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query(params_from_iter(args.iter()))?;
    let mut out = HashSet::new();
    while let Some(row) = rows.next()? {
        let path: String = row.get(0)?;
        out.insert(path);
    }
    Ok(out)
}

fn paths_matching_property_filters(
    conn: &Connection,
    filters: &[PropertyFilter],
) -> Result<HashSet<String>> {
    let mut acc: Option<HashSet<String>> = None;
    for filter in filters {
        let next = path_set_for_property_filter(conn, filter)?;
        if let Some(existing) = acc.as_mut() {
            existing.retain(|item| next.contains(item));
        } else {
            acc = Some(next);
        }
    }
    Ok(acc.unwrap_or_default())
}

fn collect_lexical_ranked_rows(
    conn: &Connection,
    text_query: &str,
    property_paths: Option<&HashSet<String>>,
) -> Result<Vec<RankedSearchRow>> {
    let mut stmt = conn.prepare(
        r#"
    SELECT chunks.id,
           chunks.path,
           snippet(chunks_fts, 2, '<b>', '</b>', '...', 12) AS snip,
           bm25(chunks_fts) AS score
    FROM chunks_fts
    JOIN chunks ON chunks_fts.rowid = chunks.id
    WHERE chunks_fts MATCH ?1
    ORDER BY score
    LIMIT ?2;
  "#,
    )?;

    let mut rows = stmt.query(params![text_query, SEARCH_CANDIDATE_LIMIT])?;
    let mut ranked_rows: Vec<RankedSearchRow> = Vec::new();
    while let Some(row) = rows.next()? {
        let path = row.get::<_, String>(1)?;
        if let Some(paths) = property_paths {
            if !paths.contains(&path) {
                continue;
            }
        }
        ranked_rows.push(RankedSearchRow {
            chunk_id: row.get::<_, i64>(0)?,
            path,
            snippet: row.get::<_, String>(2)?,
            lexical_score: row.get::<_, f64>(3)?,
        });
    }

    Ok(ranked_rows)
}

/// Builds a conservative FTS prefix query (`term* AND other*`) used as
/// a hybrid fallback when strict lexical matching yields no candidates.
fn build_prefix_fts_query(text_query: &str) -> Option<String> {
    let terms: Vec<String> = text_query
        .split_whitespace()
        .filter_map(|token| {
            let cleaned: String = token
                .trim_matches(|ch: char| !ch.is_alphanumeric() && ch != '_' && ch != '-')
                .chars()
                .filter(|ch| ch.is_alphanumeric() || *ch == '_' || *ch == '-')
                .collect();
            if cleaned.is_empty() {
                None
            } else {
                Some(format!("{cleaned}*"))
            }
        })
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" AND "))
    }
}

fn fallback_lexical_hits(
    conn: &Connection,
    root_canonical: &Path,
    text_query: &str,
    property_paths: Option<&HashSet<String>>,
) -> Result<Vec<Hit>> {
    let ranked_rows = collect_lexical_ranked_rows(conn, text_query, property_paths)?;
    if ranked_rows.is_empty() {
        return Ok(vec![]);
    }
    let lexical_relevance: Vec<f64> = ranked_rows.iter().map(|item| -item.lexical_score).collect();
    let lexical_norm = min_max_normalize(&lexical_relevance);

    let mut scored: Vec<(usize, f64)> = ranked_rows
        .iter()
        .enumerate()
        .map(|(index, _)| (index, lexical_norm[index]))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut out = Vec::new();
    for (index, score) in scored.into_iter().take(SEARCH_RESULT_LIMIT) {
        let row = &ranked_rows[index];
        out.push(Hit {
            path: workspace_absolute_path(root_canonical, &row.path),
            snippet: row.snippet.clone(),
            score,
        });
    }
    Ok(out)
}

fn semantic_snippet_preview(text: &str) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return "semantic match".to_string();
    }
    let mut preview = compact.chars().take(220).collect::<String>();
    if compact.chars().count() > 220 {
        preview.push_str("...");
    }
    preview
}

fn load_semantic_snippet(conn: &Connection, path: &str) -> Result<String> {
    let row = conn.query_row(
        "SELECT text FROM chunks WHERE path = ?1 ORDER BY id ASC LIMIT 1",
        params![path],
        |row| row.get::<_, String>(0),
    );
    match row {
        Ok(text) => Ok(semantic_snippet_preview(&text)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok("semantic match".to_string()),
        Err(err) => Err(AppError::Sqlite(err)),
    }
}

fn semantic_only_hits(
    conn: &Connection,
    root_canonical: &Path,
    text_query: &str,
    property_paths: Option<&HashSet<String>>,
) -> Result<Option<Vec<Hit>>> {
    let query_vec = semantic::embed_texts(&[text_query.to_string()])
        .ok()
        .and_then(|mut items| items.pop());
    let Some(mut query_vector) = query_vec else {
        log_index("search:semantic:fallback reason=embed_query_failed");
        return Ok(None);
    };
    semantic::normalize_in_place(&mut query_vector);
    let payload = semantic::vector_to_json(&query_vector);

    let mut stmt = match conn.prepare(
        r#"
        SELECT path, distance
        FROM note_embeddings_vec
        WHERE embedding MATCH ?1
        ORDER BY distance ASC
        LIMIT ?2
      "#,
    ) {
        Ok(value) => value,
        Err(err) => {
            log_index(&format!(
                "search:semantic:fallback reason=prepare_failed err={err}"
            ));
            return Ok(None);
        }
    };

    let mut rows = match stmt.query(params![payload, SEARCH_CANDIDATE_LIMIT]) {
        Ok(value) => value,
        Err(err) => {
            log_index(&format!(
                "search:semantic:fallback reason=query_failed err={err}"
            ));
            return Ok(None);
        }
    };

    let mut scored: Vec<(String, f64)> = Vec::new();
    while let Some(row) = rows.next()? {
        let path: String = row.get(0)?;
        if let Some(paths) = property_paths {
            if !paths.contains(&path) {
                continue;
            }
        }
        let distance: f32 = row.get(1)?;
        let score = (1.0 - ((distance * distance) as f64 * 0.5)).clamp(0.0, 1.0);
        if score < f64::from(SEMANTIC_THRESHOLD) {
            continue;
        }
        scored.push((path, score));
    }

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let mut out = Vec::new();
    for (path, score) in scored.into_iter().take(SEARCH_RESULT_LIMIT) {
        let snippet = load_semantic_snippet(conn, &path)?;
        out.push(Hit {
            path: workspace_absolute_path(root_canonical, &path),
            snippet,
            score,
        });
    }
    Ok(Some(out))
}

fn fts_search_sync(query: String) -> Result<Vec<Hit>> {
    let conn = open_db()?;
    let root_canonical = active_workspace_root()?;
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }

    let (mode, text_query, property_filters) = parse_search_query(q);
    let property_paths = if property_filters.is_empty() {
        None
    } else {
        Some(paths_matching_property_filters(&conn, &property_filters)?)
    };

    if text_query.is_empty() {
        let Some(paths) = property_paths else {
            return Ok(vec![]);
        };

        let mut out: Vec<Hit> = paths
            .into_iter()
            .map(|path| Hit {
                path: workspace_absolute_path(&root_canonical, &path),
                snippet: "property match".to_string(),
                score: 0.0,
            })
            .collect();
        out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
        out.truncate(SEARCH_RESULT_LIMIT);
        return Ok(out);
    }

    if mode == SearchMode::Semantic {
        if let Some(hits) =
            semantic_only_hits(&conn, &root_canonical, &text_query, property_paths.as_ref())?
        {
            return Ok(hits);
        }
        return fallback_lexical_hits(&conn, &root_canonical, &text_query, property_paths.as_ref());
    }

    let mut ranked_rows = collect_lexical_ranked_rows(&conn, &text_query, property_paths.as_ref())?;
    if ranked_rows.is_empty() && mode == SearchMode::Hybrid {
        if let Some(prefix_query) = build_prefix_fts_query(&text_query) {
            if prefix_query != text_query {
                ranked_rows =
                    collect_lexical_ranked_rows(&conn, &prefix_query, property_paths.as_ref())?;
            }
        }
    }
    if ranked_rows.is_empty() {
        return Ok(vec![]);
    }

    let lexical_relevance: Vec<f64> = ranked_rows.iter().map(|item| -item.lexical_score).collect();
    let lexical_norm = min_max_normalize(&lexical_relevance);

    let mut scored: Vec<(usize, f64)> = if mode == SearchMode::Lexical {
        ranked_rows
            .iter()
            .enumerate()
            .map(|(index, _)| (index, lexical_norm[index]))
            .collect()
    } else {
        let mut semantic_norm = vec![0.0f64; ranked_rows.len()];
        let query_vec = semantic::embed_texts(&[text_query.clone()])
            .ok()
            .and_then(|mut items| {
                let first = items.pop()?;
                Some(first)
            });

        if let Some(mut query_vector) = query_vec {
            semantic::normalize_in_place(&mut query_vector);
            let mut semantic_scores = vec![0.0f64; ranked_rows.len()];
            for (index, row) in ranked_rows.iter().enumerate() {
                let embedding = conn.query_row(
                    "SELECT vector, dim FROM embeddings WHERE chunk_id = ?1",
                    params![row.chunk_id],
                    |db_row| Ok((db_row.get::<_, Vec<u8>>(0)?, db_row.get::<_, i64>(1)?)),
                );
                let Ok((blob, dim)) = embedding else {
                    continue;
                };
                let Some(vector) = semantic::blob_to_vector(&blob, dim as usize) else {
                    continue;
                };
                let Some(score) = semantic::cosine_similarity(&query_vector, &vector) else {
                    continue;
                };
                semantic_scores[index] = score as f64;
            }
            semantic_norm = min_max_normalize(&semantic_scores);
        }

        ranked_rows
            .iter()
            .enumerate()
            .map(|(index, _)| {
                let hybrid = lexical_norm[index] * HYBRID_LEXICAL_WEIGHT
                    + semantic_norm[index] * HYBRID_SEMANTIC_WEIGHT;
                (index, hybrid)
            })
            .collect()
    };

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut out = Vec::new();
    for (index, score) in scored.into_iter().take(SEARCH_RESULT_LIMIT) {
        let row = &ranked_rows[index];
        out.push(Hit {
            path: workspace_absolute_path(&root_canonical, &row.path),
            snippet: row.snippet.clone(),
            score,
        });
    }
    Ok(out)
}

#[tauri::command]
async fn fts_search(query: String) -> Result<Vec<Hit>> {
    tauri::async_runtime::spawn_blocking(move || fts_search_sync(query))
        .await
        .map_err(|_| AppError::OperationFailed)?
}

#[derive(Serialize)]
struct Backlink {
    path: String,
}

#[derive(Serialize)]
struct WikilinkRewriteResult {
    updated_files: usize,
}

fn list_markdown_files_via_find(root: &Path) -> Result<Vec<PathBuf>> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if path.is_dir() {
                if name == INTERNAL_DIR_NAME
                    || name == TRASH_DIR_NAME
                    || is_hidden_dir_name(&name)
                    || is_windows_hidden(&path)
                {
                    continue;
                }
                walk(root, &path, out)?;
                continue;
            }

            if !path.is_file() {
                continue;
            }

            if name == DB_FILE_NAME || name.starts_with("tomosona.sqlite-") {
                continue;
            }

            let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
                continue;
            };

            if (ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
                && !has_hidden_dir_component(root, &path)
            {
                out.push(path);
            }
        }
        Ok(())
    }

    let mut files = Vec::new();
    walk(root, root, &mut files)?;
    Ok(files)
}

#[tauri::command]
fn backlinks_for_path(path: String) -> Result<Vec<Backlink>> {
    let root_canonical = active_workspace_root()?;
    let mut path_buf = PathBuf::from(path);
    if path_buf.as_os_str().is_empty() {
        return Err(AppError::InvalidPath);
    }
    if !path_buf.is_absolute() {
        path_buf = root_canonical.join(path_buf);
    }
    if path_buf.exists() {
        path_buf = fs::canonicalize(path_buf)?;
    }

    let target_key = normalize_note_key(&root_canonical, &path_buf)?;
    if target_key.is_empty() {
        return Ok(vec![]);
    }

    let markdown_files = list_markdown_files_via_find(&root_canonical)?;
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for candidate in markdown_files {
        let canonical_candidate = match fs::canonicalize(&candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let source_key = match normalize_note_key(&root_canonical, &canonical_candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if source_key == target_key {
            continue;
        }

        let markdown = match fs::read_to_string(&canonical_candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let targets = parse_note_targets(&markdown);
        if !targets.iter().any(|item| item == &target_key) {
            continue;
        }

        let source_path = canonical_candidate.to_string_lossy().to_string();
        if seen.insert(source_path.clone()) {
            out.push(Backlink { path: source_path });
        }
    }

    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(out)
}

#[tauri::command]
fn update_wikilinks_for_rename(
    old_path: String,
    new_path: String,
) -> Result<WikilinkRewriteResult> {
    let root_canonical = active_workspace_root()?;
    let old_note_path = normalize_workspace_path(&root_canonical, &old_path)?;
    let new_note_path = normalize_workspace_path(&root_canonical, &new_path)?;

    let old_target_key = normalize_note_key(&root_canonical, &old_note_path)?;
    let new_target = note_link_target(&root_canonical, &new_note_path)?;
    if old_target_key.is_empty()
        || old_target_key == normalize_note_key(&root_canonical, &new_note_path)?
    {
        return Ok(WikilinkRewriteResult { updated_files: 0 });
    }

    let markdown_files = list_markdown_files_via_find(&root_canonical)?;
    let mut changed_files = 0usize;

    for candidate in markdown_files {
        let canonical_candidate = match fs::canonicalize(&candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let markdown = match fs::read_to_string(&canonical_candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let (updated_markdown, changed) =
            rewrite_wikilinks_for_note(&markdown, &old_target_key, &new_target);
        if !changed {
            continue;
        }

        fs::write(&canonical_candidate, updated_markdown)?;
        reindex_markdown_file_now_sync(canonical_candidate.to_string_lossy().to_string())?;
        changed_files += 1;
    }

    Ok(WikilinkRewriteResult {
        updated_files: changed_files,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if db::init_sqlite_runtime() {
        log_index("sqlite_runtime:init_ok");
    } else {
        log_index("sqlite_runtime:init_failed");
    }
    semantic::set_index_logger(log_index);
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            select_working_folder,
            clear_working_folder,
            set_working_folder,
            list_children,
            list_markdown_files,
            path_exists,
            read_text_file,
            read_file_metadata,
            write_text_file,
            create_entry,
            rename_entry,
            duplicate_entry,
            copy_entry,
            move_entry,
            trash_entry,
            open_path_external,
            open_external_url,
            reveal_in_file_manager,
            init_db,
            reindex_markdown_file_lexical,
            reindex_markdown_file_semantic,
            refresh_semantic_edges_cache_now,
            remove_markdown_file_from_index,
            fts_search,
            rebuild_workspace_index,
            request_index_cancel,
            read_index_runtime_status,
            read_index_logs,
            backlinks_for_path,
            update_wikilinks_for_rename,
            get_wikilink_graph,
            read_property_type_schema,
            write_property_type_schema,
            echoes::compute_echoes_pack,
            settings::read_app_settings,
            settings::write_app_settings,
            second_brain::read_second_brain_config_status,
            second_brain::discover_codex_models,
            second_brain::write_second_brain_global_config,
            second_brain::list_second_brain_sessions,
            second_brain::create_second_brain_session,
            second_brain::load_second_brain_session,
            second_brain::delete_second_brain_session,
            second_brain::update_second_brain_context,
            second_brain::cancel_second_brain_stream,
            second_brain::cancel_pulse_stream,
            second_brain::run_pulse_transformation,
            second_brain::send_second_brain_message,
            second_brain::set_second_brain_session_target_note,
            second_brain::insert_second_brain_assistant_into_target_note,
            second_brain::export_second_brain_session_markdown,
            second_brain::save_second_brain_draft,
            second_brain::append_message_to_second_brain_draft,
            second_brain::publish_second_brain_draft_to_new_note,
            second_brain::publish_second_brain_draft_to_existing_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    use directories::UserDirs;

    use super::*;

    static WORKSPACE_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn workspace_test_guard() -> std::sync::MutexGuard<'static, ()> {
        WORKSPACE_TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("workspace test mutex poisoned")
    }

    fn create_temp_workspace(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("{prefix}-{nonce}"));
        fs::create_dir_all(&dir).expect("create temp workspace");
        dir
    }

    #[test]
    fn rewrite_wikilinks_replaces_matching_target() {
        let input = "See [[notes/old]].";
        let (output, changed) = rewrite_wikilinks_for_note(input, "notes/old", "notes/new");
        assert!(changed);
        assert_eq!(output, "See [[notes/new]].");
    }

    #[test]
    fn rewrite_wikilinks_preserves_alias_and_heading() {
        let input = "[[notes/old|Alias]] and [[notes/old#section]].";
        let (output, changed) = rewrite_wikilinks_for_note(input, "notes/old", "notes/new");
        assert!(changed);
        assert_eq!(output, "[[notes/new|Alias]] and [[notes/new#section]].");
    }

    #[test]
    fn rewrite_wikilinks_keeps_non_matching_targets() {
        let input = "[[notes/old-stuff]] [[notes/other]].";
        let (output, changed) = rewrite_wikilinks_for_note(input, "notes/old", "notes/new");
        assert!(!changed);
        assert_eq!(output, input);
    }

    #[test]
    fn rewrite_wikilinks_matches_case_and_extensions() {
        let input = "[[Notes/Old.MD]] [[notes/old.markdown]].";
        let (output, changed) = rewrite_wikilinks_for_note(input, "notes/old", "notes/new");
        assert!(changed);
        assert_eq!(output, "[[notes/new]] [[notes/new]].");
    }

    #[test]
    fn strip_yaml_frontmatter_removes_header_block() {
        let markdown = "---\ntitle: Test\ntags: [one]\n---\n# Body\n[[note]]";
        let stripped = strip_yaml_frontmatter(markdown);
        assert_eq!(stripped, "# Body\n[[note]]");
    }

    #[test]
    fn parse_note_targets_ignores_frontmatter_links() {
        let markdown = "---\nassignee: \"[[Alice]]\"\n---\n[[BodyNote]]";
        let targets = parse_note_targets(markdown);
        assert_eq!(targets.len(), 1);
        assert!(targets.iter().any(|item| item == "bodynote"));
    }

    #[test]
    fn parse_note_targets_extracts_target_from_wikilink_with_alias() {
        let markdown = "See [[Folder/Note|Displayed Label]]";
        let targets = parse_note_targets(markdown);
        assert_eq!(targets.len(), 1);
        assert!(targets.iter().any(|item| item == "folder/note"));
    }

    #[test]
    fn parse_note_targets_normalizes_unicode_wikilink_target() {
        let markdown = "See [[syste\u{300}me/Tools.md|Tools]]";
        let targets = parse_note_targets(markdown);
        assert_eq!(targets.len(), 1);
        assert!(targets.iter().any(|item| item == "système/tools"));
    }

    #[test]
    fn parse_yaml_frontmatter_properties_indexes_scalars_and_lists() {
        let markdown =
            "---\npriority: 2\narchive: true\ndeadline: 2026-03-01\ntags: [dev, urgent]\n---\nbody";
        let indexed = parse_yaml_frontmatter_properties(markdown);
        assert!(indexed
            .iter()
            .any(|item| item.key == "priority" && item.kind == "number"));
        assert!(indexed
            .iter()
            .any(|item| item.key == "archive" && item.kind == "bool"));
        assert!(indexed
            .iter()
            .any(|item| item.key == "deadline" && item.kind == "date"));
        assert!(indexed.iter().any(|item| item.key == "tags"
            && item.kind == "list"
            && item.value_text.as_deref() == Some("dev")));
        assert!(indexed.iter().any(|item| item.key == "tags"
            && item.kind == "list"
            && item.value_text.as_deref() == Some("urgent")));
    }

    #[test]
    fn parse_search_query_extracts_property_filters() {
        let (mode, text, filters) =
            parse_search_query("roadmap tags:dev deadline>=2026-01-01 has:archive");
        assert_eq!(mode, SearchMode::Hybrid);
        assert_eq!(text, "roadmap");
        assert_eq!(filters.len(), 3);
    }

    #[test]
    fn parse_search_query_detects_search_mode_prefixes() {
        let (semantic_mode, semantic_text, semantic_filters) =
            parse_search_query("semantic: ai agents");
        assert_eq!(semantic_mode, SearchMode::Semantic);
        assert_eq!(semantic_text, "ai agents");
        assert!(semantic_filters.is_empty());

        let (lexical_mode, lexical_text, lexical_filters) =
            parse_search_query("Lexical: rust tauri");
        assert_eq!(lexical_mode, SearchMode::Lexical);
        assert_eq!(lexical_text, "rust tauri");
        assert!(lexical_filters.is_empty());

        let (hybrid_mode, hybrid_text, hybrid_filters) =
            parse_search_query("hybrid: graph has:tags");
        assert_eq!(hybrid_mode, SearchMode::Hybrid);
        assert_eq!(hybrid_text, "graph");
        assert_eq!(hybrid_filters.len(), 1);
    }

    #[test]
    fn parse_search_query_accepts_empty_text_after_prefix() {
        let (mode, text, filters) = parse_search_query("semantic:   ");
        assert_eq!(mode, SearchMode::Semantic);
        assert!(text.is_empty());
        assert!(filters.is_empty());
    }

    #[test]
    fn build_prefix_fts_query_converts_tokens_to_prefix_terms() {
        let query = build_prefix_fts_query("matter most");
        assert_eq!(query.as_deref(), Some("matter* AND most*"));
    }

    #[test]
    fn build_prefix_fts_query_ignores_punctuation_only_tokens() {
        let query = build_prefix_fts_query("  !!!  ");
        assert!(query.is_none());
    }

    #[test]
    fn semantic_snippet_preview_compacts_whitespace_and_truncates() {
        let preview = semantic_snippet_preview("line one\n\nline\t two");
        assert_eq!(preview, "line one line two");

        let long = "a".repeat(260);
        let truncated = semantic_snippet_preview(&long);
        assert!(truncated.ends_with("..."));
        assert!(truncated.len() <= 223);
    }

    #[test]
    fn list_markdown_files_via_find_skips_hidden_directories() {
        let workspace = create_temp_workspace("tomosona-hidden-scan-test");
        fs::create_dir_all(workspace.join(".hidden")).expect("create hidden dir");
        fs::create_dir_all(workspace.join("visible")).expect("create visible dir");
        fs::write(workspace.join(".hidden/secret.md"), "# secret").expect("write secret");
        fs::write(workspace.join("visible/public.md"), "# public").expect("write public");

        let files = list_markdown_files_via_find(&workspace).expect("list markdown files");
        let names = files
            .iter()
            .filter_map(|path| path.strip_prefix(&workspace).ok())
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .collect::<Vec<_>>();
        assert!(names.iter().any(|path| path == "visible/public.md"));
        assert!(!names.iter().any(|path| path.contains(".hidden/secret.md")));

        fs::remove_dir_all(workspace).expect("cleanup");
    }

    #[test]
    fn min_max_normalize_handles_flat_and_spread_inputs() {
        assert_eq!(min_max_normalize(&[2.0, 2.0, 2.0]), vec![1.0, 1.0, 1.0]);
        let normalized = min_max_normalize(&[1.0, 3.0, 5.0]);
        assert_eq!(normalized.len(), 3);
        assert!((normalized[0] - 0.0).abs() < 1e-6);
        assert!((normalized[1] - 0.5).abs() < 1e-6);
        assert!((normalized[2] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn set_active_workspace_rejects_home_directory() {
        let Some(user_dirs) = UserDirs::new() else {
            return;
        };

        let home = user_dirs.home_dir().to_string_lossy().to_string();
        let result = set_active_workspace(&home);
        assert!(result.is_err());
    }

    #[test]
    fn set_active_workspace_rejects_special_user_directories() {
        let Some(user_dirs) = UserDirs::new() else {
            return;
        };

        let special_dirs = [
            user_dirs.desktop_dir(),
            user_dirs.document_dir(),
            user_dirs.download_dir(),
            user_dirs.picture_dir(),
            user_dirs.audio_dir(),
            user_dirs.video_dir(),
            user_dirs.public_dir(),
        ];

        for dir in special_dirs.into_iter().flatten() {
            let result = set_active_workspace(&dir.to_string_lossy());
            assert!(
                result.is_err(),
                "expected special directory to be rejected: {dir:?}"
            );
        }
    }

    #[test]
    fn set_active_workspace_accepts_regular_folder() {
        let temp = std::env::temp_dir().join("tomosona-workspace-guard-test");
        fs::create_dir_all(&temp).expect("create temp dir");

        let set = set_active_workspace(&temp.to_string_lossy()).expect("set workspace");
        let active = active_workspace_root().expect("active workspace");
        assert_eq!(set, active);

        fs::remove_dir_all(&temp).expect("cleanup");
    }

    #[test]
    fn get_wikilink_graph_builds_expected_nodes_edges_and_tags() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-graph-test");
        let root = workspace.to_string_lossy().to_string();

        fs::write(workspace.join("a.md"), "# A\n[[b]]").expect("write a");
        fs::write(workspace.join("b.md"), "# B\n[[a]]").expect("write b");
        fs::write(workspace.join("c.md"), "# C").expect("write c");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let conn = open_db().expect("open db");
        conn.execute(
            "INSERT INTO note_links(source_path, target_key) VALUES (?1, ?2)",
            params!["a.md", "b"],
        )
        .expect("insert edge a->b");
        conn.execute(
            "INSERT INTO note_links(source_path, target_key) VALUES (?1, ?2)",
            params!["b.md", "a"],
        )
        .expect("insert edge b->a");
        conn.execute(
            "INSERT INTO note_links(source_path, target_key) VALUES (?1, ?2)",
            params!["a.md", "missing/note"],
        )
        .expect("insert unresolved edge");
        conn.execute(
            "INSERT INTO note_properties(path, key, kind, value_text) VALUES (?1, 'tags', 'list', ?2)",
            params!["a.md", "dev"],
        )
        .expect("insert tags");

        let graph = get_wikilink_graph().expect("build graph");
        let node_by_name = graph
            .nodes
            .iter()
            .map(|node| {
                (
                    Path::new(&node.path)
                        .file_name()
                        .and_then(|v| v.to_str())
                        .unwrap_or("")
                        .to_string(),
                    node,
                )
            })
            .collect::<HashMap<_, _>>();

        assert_eq!(graph.nodes.len(), 3);
        assert_eq!(graph.edges.len(), 2);
        assert!(graph.edges.iter().all(|edge| edge.edge_type.eq("wikilink")));
        assert!(graph.generated_at_ms > 0);

        let a = node_by_name.get("a.md").expect("node a");
        assert!(a.path.ends_with("/a.md"));
        assert_eq!(a.degree, 2);
        assert_eq!(a.tags, vec!["dev".to_string()]);

        let b = node_by_name.get("b.md").expect("node b");
        assert!(b.path.ends_with("/b.md"));
        assert_eq!(b.degree, 2);

        let c = node_by_name.get("c.md").expect("node c");
        assert!(c.path.ends_with("/c.md"));
        assert_eq!(c.degree, 0);

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn get_wikilink_graph_resolves_unique_basename_targets() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-graph-basename-test");
        let root = workspace.to_string_lossy().to_string();

        fs::create_dir_all(workspace.join("notes")).expect("create notes dir");
        fs::write(workspace.join("a.md"), "# A\n[[nested]]").expect("write a");
        fs::write(workspace.join("notes/nested.md"), "# Nested").expect("write nested");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let conn = open_db().expect("open db");
        conn.execute(
            "INSERT INTO note_links(source_path, target_key) VALUES (?1, ?2)",
            params!["a.md", "nested"],
        )
        .expect("insert edge a->nested");

        let graph = get_wikilink_graph().expect("build graph");
        assert!(graph
            .edges
            .iter()
            .any(|edge| edge.source == "a.md" && edge.target == "notes/nested.md"));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn inject_relative_path_context_prefixes_first_chunk_only() {
        let chunks = vec![
            ("".to_string(), "first".to_string()),
            ("section".to_string(), "second".to_string()),
        ];
        let contextualized = inject_relative_path_context("journal/2026-02-16.md", chunks);
        assert_eq!(contextualized.len(), 2);
        assert_eq!(contextualized[0].1, "journal/2026-02-16.md\nfirst");
        assert_eq!(contextualized[1].1, "second");
    }

    #[test]
    fn init_db_uses_new_index_schema_columns() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-schema-test");
        let root = workspace.to_string_lossy().to_string();

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let conn = open_db().expect("open db");
        let chunk_columns: Vec<String> = {
            let mut stmt = conn
                .prepare("PRAGMA table_info(chunks)")
                .expect("prepare chunk pragma");
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .expect("query chunk pragma");
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .expect("collect chunk columns")
        };
        assert!(chunk_columns.iter().any(|name| name == "chunk_ord"));
        assert!(chunk_columns.iter().any(|name| name == "content_hash"));

        let embedding_columns: Vec<String> = {
            let mut stmt = conn
                .prepare("PRAGMA table_info(embeddings)")
                .expect("prepare embedding pragma");
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .expect("query embedding pragma");
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .expect("collect embedding columns")
        };
        assert!(embedding_columns.iter().any(|name| name == "content_hash"));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn lexical_reindex_updates_fts_data_without_embedding_rows() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-lexical-only-test");
        let root = workspace.to_string_lossy().to_string();
        let note_path = workspace.join("notes.md");
        fs::write(
            &note_path,
            "---\ntags: [dev]\npriority: 2\n---\n# Alpha\nhello world\n[[beta]]",
        )
        .expect("write note");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");
        reindex_markdown_file_lexical_sync(note_path.to_string_lossy().to_string())
            .expect("lexical reindex");

        let conn = open_db().expect("open db");
        let chunks_n: i64 = conn
            .query_row("SELECT COUNT(*) FROM chunks WHERE path = 'notes.md'", [], |row| {
                row.get(0)
            })
            .expect("query chunks");
        let links_n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM note_links WHERE source_path = 'notes.md'",
                [],
                |row| row.get(0),
            )
            .expect("query links");
        let props_n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM note_properties WHERE path = 'notes.md'",
                [],
                |row| row.get(0),
            )
            .expect("query properties");
        let embedding_n: i64 = conn
            .query_row("SELECT COUNT(*) FROM embeddings", [], |row| row.get(0))
            .expect("query embeddings");
        let note_embedding_n: i64 = conn
            .query_row("SELECT COUNT(*) FROM note_embeddings", [], |row| row.get(0))
            .expect("query note embeddings");

        assert!(chunks_n > 0);
        assert_eq!(links_n, 1);
        assert!(props_n >= 2);
        assert_eq!(embedding_n, 0);
        assert_eq!(note_embedding_n, 0);

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn lexical_reindex_stores_relative_path_in_first_chunk() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-lexical-context-test");
        let root = workspace.to_string_lossy().to_string();
        let note_path = workspace.join("nested").join("topic.md");
        fs::create_dir_all(note_path.parent().expect("parent")).expect("create nested");
        fs::write(&note_path, "# Heading\nline one\nline two").expect("write note");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");
        reindex_markdown_file_lexical_sync(note_path.to_string_lossy().to_string())
            .expect("lexical reindex");

        let conn = open_db().expect("open db");
        let first_chunk: String = conn
            .query_row(
                "SELECT text FROM chunks WHERE path = 'nested/topic.md' AND chunk_ord = 0",
                [],
                |row| row.get(0),
            )
            .expect("query first chunk");
        assert!(first_chunk.starts_with("nested/topic.md\n"));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn semantic_reindex_handles_notes_without_chunks() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-semantic-empty-note-test");
        let root = workspace.to_string_lossy().to_string();
        let note_path = workspace.join("empty.md");
        fs::write(&note_path, "   \n\n").expect("write empty note");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");
        reindex_markdown_file_lexical_sync(note_path.to_string_lossy().to_string())
            .expect("lexical reindex");
        reindex_markdown_file_semantic_sync(note_path.to_string_lossy().to_string())
            .expect("semantic reindex");

        let conn = open_db().expect("open db");
        let note_embedding_n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM note_embeddings WHERE path = 'empty.md'",
                [],
                |row| row.get(0),
            )
            .expect("query note embeddings");
        assert_eq!(note_embedding_n, 0);

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn compute_echoes_pack_rejects_non_markdown_anchor() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-echoes-invalid-anchor");
        let root = workspace.to_string_lossy().to_string();
        let note_path = workspace.join("plain.txt");
        fs::write(&note_path, "text").expect("write non markdown");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let result = echoes::compute_echoes_pack(echoes::ComputeEchoesPackPayload {
            anchor_path: note_path.to_string_lossy().to_string(),
            limit: Some(5),
            include_recent_activity: Some(true),
        });
        assert!(result.is_err());

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn compute_echoes_pack_merges_multi_signal_candidates() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-echoes-merge");
        let root = workspace.to_string_lossy().to_string();
        fs::write(workspace.join("a.md"), "# Anchor\n[[b]]").expect("write a");
        fs::write(workspace.join("b.md"), "# Note B").expect("write b");
        fs::write(workspace.join("c.md"), "# Note C\n[[a]]").expect("write c");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let conn = open_db().expect("open db");
        conn.execute(
            "INSERT INTO note_links(source_path, target_key) VALUES (?1, ?2)",
            params!["a.md", "b"],
        )
        .expect("insert direct link");
        conn.execute(
            "INSERT INTO note_links(source_path, target_key) VALUES (?1, ?2)",
            params!["c.md", "a"],
        )
        .expect("insert backlink");
        conn.execute(
            "INSERT INTO semantic_edges(source_path, target_path, score, model, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["a.md", "b.md", 0.91_f32, "test-model", 1_i64],
        )
        .expect("insert semantic edge");

        let pack = echoes::compute_echoes_pack(echoes::ComputeEchoesPackPayload {
            anchor_path: workspace.join("a.md").to_string_lossy().to_string(),
            limit: Some(5),
            include_recent_activity: Some(false),
        })
        .expect("compute echoes");

        assert!(pack.items.iter().any(|item| {
            item.path.ends_with("/b.md")
                && item.reason_label == "Direct link"
                && item
                    .reason_labels
                    .iter()
                    .any(|label| label == "Semantically related")
        }));
        assert!(pack.items.iter().any(|item| item.path.ends_with("/c.md") && item.reason_label == "Backlink"));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn compute_echoes_pack_uses_recent_activity_without_semantic_data() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-echoes-recent");
        let root = workspace.to_string_lossy().to_string();
        fs::create_dir_all(workspace.join("notes")).expect("create notes dir");
        fs::write(workspace.join("notes/anchor.md"), "# Anchor").expect("write anchor");
        fs::write(workspace.join("notes/recent.md"), "# Recent").expect("write recent");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let pack = echoes::compute_echoes_pack(echoes::ComputeEchoesPackPayload {
            anchor_path: workspace.join("notes/anchor.md").to_string_lossy().to_string(),
            limit: Some(5),
            include_recent_activity: Some(true),
        })
        .expect("compute echoes");

        assert!(pack
            .items
            .iter()
            .any(|item| item.path.ends_with("/notes/recent.md") && item.reason_label == "Recently active"));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }
}
