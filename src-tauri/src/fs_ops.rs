#[cfg(windows)]
use std::os::windows::fs::MetadataExt;
use std::{
    env, fs,
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};

use crate::editor_sync::record_workspace_mutation_write_from_disk;
use crate::{
    active_workspace_root, clear_active_workspace, set_active_workspace, workspace_watch, AppError,
    Result,
};

const TRASH_DIR_NAME: &str = ".tomosona-trash";
const INTERNAL_DIR_NAME: &str = ".tomosona";
const DB_FILE_NAME: &str = "tomosona.sqlite";
const GITIGNORE_FILE_NAME: &str = ".gitignore";
const TOMOSONA_IGNORE_FILE_NAME: &str = ".tomosonaignore";
#[cfg(windows)]
const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;

#[derive(Debug, Clone, Serialize)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_markdown: bool,
    pub has_children: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileMetadata {
    pub created_at_ms: Option<i64>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictStrategy {
    Fail,
    Rename,
    Overwrite,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    File,
    Folder,
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false)
}

fn should_skip_file(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };

    file_name == DB_FILE_NAME
        || file_name.starts_with("tomosona.sqlite-")
        || (file_name.starts_with('.') && file_name != "." && file_name != "..")
}

fn should_skip_dir_name(name: &str) -> bool {
    name == TRASH_DIR_NAME || name == INTERNAL_DIR_NAME
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

fn build_ignore_matcher(root: &Path) -> Option<Gitignore> {
    let mut builder = GitignoreBuilder::new(root);

    let gitignore = root.join(GITIGNORE_FILE_NAME);
    if gitignore.is_file() {
        builder.add(gitignore);
    }

    let tomosona_ignore = root.join(TOMOSONA_IGNORE_FILE_NAME);
    if tomosona_ignore.is_file() {
        builder.add(tomosona_ignore);
    }

    builder.build().ok()
}

fn skip_by_ignore_rules(
    root: &Path,
    matcher: Option<&Gitignore>,
    path: &Path,
    is_dir: bool,
) -> bool {
    let Some(matcher) = matcher else {
        return false;
    };

    let canonical_root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());

    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        canonical_root.join(path)
    };

    let canonical_candidate = fs::canonicalize(&candidate).unwrap_or(candidate);
    let Ok(relative) = canonical_candidate.strip_prefix(&canonical_root) else {
        return false;
    };

    matcher
        .matched_path_or_any_parents(relative, is_dir)
        .is_ignore()
}

fn should_skip_dir(root: &Path, matcher: Option<&Gitignore>, path: &Path) -> bool {
    if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
        if should_skip_dir_name(name) {
            return true;
        }
        if path.is_dir() && name.starts_with('.') && name != "." && name != ".." {
            return true;
        }
        if is_windows_hidden(path) {
            return true;
        }
    }

    skip_by_ignore_rules(root, matcher, path, true)
}

fn should_skip_non_dir_file(root: &Path, matcher: Option<&Gitignore>, path: &Path) -> bool {
    if should_skip_file(path) || is_windows_hidden(path) {
        return true;
    }

    skip_by_ignore_rules(root, matcher, path, false)
}

fn normalize_existing_dir(path: &str) -> Result<PathBuf> {
    let pb = PathBuf::from(path);
    if pb.as_os_str().is_empty() || !pb.is_dir() {
        return Err(AppError::InvalidPath);
    }
    Ok(pb)
}

pub(crate) fn normalize_path(path: &str) -> Result<PathBuf> {
    let pb = PathBuf::from(path);
    if pb.as_os_str().is_empty() {
        return Err(AppError::InvalidPath);
    }
    Ok(pb)
}

pub(crate) fn normalize_existing_path(path: &str) -> Result<PathBuf> {
    let pb = PathBuf::from(path);
    if pb.as_os_str().is_empty() || !pb.exists() {
        return Err(AppError::InvalidPath);
    }
    Ok(pb)
}

fn should_log_fs_perf(elapsed_ms: u128) -> bool {
    env::var("TOMOSONA_DEBUG_OPEN")
        .map(|value| value == "1")
        .unwrap_or(false)
        || elapsed_ms >= 75
}

fn log_fs_perf(command: &str, path: &Path, started_at: Instant, extra_fields: &[(&str, String)]) {
    let elapsed_ms = started_at.elapsed().as_millis();
    if !should_log_fs_perf(elapsed_ms) {
        return;
    }

    let mut fields = vec![
        format!("cmd={command}"),
        format!("total_ms={elapsed_ms}"),
        format!("path={}", path.to_string_lossy()),
    ];
    for (key, value) in extra_fields {
        fields.push(format!("{key}={value}"));
    }
    eprintln!("[fs-perf] {}", fields.join(" "));
}

pub(crate) fn ensure_within_root(root: &Path, path: &Path) -> Result<()> {
    let root_canonical = fs::canonicalize(root)?;
    let path_canonical = fs::canonicalize(path)?;

    if !path_canonical.starts_with(&root_canonical) {
        return Err(AppError::InvalidPath);
    }
    Ok(())
}

pub(crate) fn ensure_parent_within_root(root: &Path, path: &Path) -> Result<()> {
    let Some(parent) = path.parent() else {
        return Err(AppError::InvalidPath);
    };

    let root_canonical = fs::canonicalize(root)?;
    let parent_canonical = fs::canonicalize(parent)?;

    if !parent_canonical.starts_with(&root_canonical) {
        return Err(AppError::InvalidPath);
    }
    Ok(())
}

fn validate_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(AppError::InvalidName);
    }

    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(AppError::InvalidName);
    }

    if trimmed
        .chars()
        .any(|ch| matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*') || ch.is_control())
    {
        return Err(AppError::InvalidName);
    }

    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err(AppError::InvalidName);
    }

    let lower = trimmed.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "con"
            | "prn"
            | "aux"
            | "nul"
            | "com1"
            | "com2"
            | "com3"
            | "com4"
            | "com5"
            | "com6"
            | "com7"
            | "com8"
            | "com9"
            | "lpt1"
            | "lpt2"
            | "lpt3"
            | "lpt4"
            | "lpt5"
            | "lpt6"
            | "lpt7"
            | "lpt8"
            | "lpt9"
    ) {
        return Err(AppError::InvalidName);
    }

    if trimmed.len() > 255 {
        return Err(AppError::InvalidName);
    }

    Ok(trimmed.to_string())
}

fn split_name_and_extension(file_name: &str, is_dir: bool) -> (String, String) {
    if is_dir {
        return (file_name.to_string(), String::new());
    }

    if let Some((stem, ext)) = file_name.rsplit_once('.') {
        if !stem.is_empty() {
            return (stem.to_string(), format!(".{ext}"));
        }
    }

    (file_name.to_string(), String::new())
}

fn next_available_path(path: &Path) -> Result<PathBuf> {
    let Some(parent) = path.parent() else {
        return Err(AppError::InvalidPath);
    };

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(AppError::InvalidPath)?;

    let is_dir = path.is_dir() || path.extension().is_none();
    let (stem, ext) = split_name_and_extension(file_name, is_dir);

    for idx in 1..10_000 {
        let candidate_name = format!("{stem} ({idx}){ext}");
        let candidate_path = parent.join(candidate_name);
        if !candidate_path.exists() {
            return Ok(candidate_path);
        }
    }

    Err(AppError::OperationFailed)
}

fn resolve_destination(path: PathBuf, strategy: ConflictStrategy, is_dir: bool) -> Result<PathBuf> {
    if !path.exists() {
        return Ok(path);
    }

    match strategy {
        ConflictStrategy::Fail => Err(AppError::AlreadyExists),
        ConflictStrategy::Rename => next_available_path(&path),
        ConflictStrategy::Overwrite => {
            if is_dir || path.is_dir() {
                Err(AppError::InvalidOperation(
                    "Cannot overwrite an existing folder.".to_string(),
                ))
            } else {
                Ok(path)
            }
        }
    }
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());

        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path)?;
        }
    }

    Ok(())
}

fn duplicate_file_name(path: &Path) -> Result<String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(AppError::InvalidPath)?;

    let is_dir = path.is_dir();
    let (stem, ext) = split_name_and_extension(file_name, is_dir);
    Ok(format!("{stem} copy{ext}"))
}

fn directory_has_visible_children(
    root: &Path,
    dir: &Path,
    matcher: Option<&Gitignore>,
) -> Result<bool> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if should_skip_dir(root, matcher, &path) {
            continue;
        }
        if path.is_dir() {
            return Ok(true);
        }
        if path.is_file() && !should_skip_non_dir_file(root, matcher, &path) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn collect_children(root: &Path, dir: &Path, matcher: Option<&Gitignore>) -> Result<Vec<TreeNode>> {
    let mut directories: Vec<TreeNode> = Vec::new();
    let mut files: Vec<TreeNode> = Vec::new();

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if should_skip_dir(root, matcher, &path) {
            continue;
        }

        if path.is_dir() {
            directories.push(TreeNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: true,
                is_markdown: false,
                has_children: directory_has_visible_children(root, &path, matcher)?,
            });
            continue;
        }

        if should_skip_non_dir_file(root, matcher, &path) {
            continue;
        }

        files.push(TreeNode {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir: false,
            is_markdown: is_markdown_file(&path),
            has_children: false,
        });
    }

    directories.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    directories.extend(files);
    Ok(directories)
}

fn collect_markdown_files_recursive(
    root: &Path,
    dir: &Path,
    out: &mut Vec<String>,
    matcher: Option<&Gitignore>,
) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_dir() {
            if should_skip_dir(root, matcher, &path) {
                continue;
            }
            collect_markdown_files_recursive(root, &path, out, matcher)?;
            continue;
        }

        if should_skip_non_dir_file(root, matcher, &path) || !is_markdown_file(&path) {
            continue;
        }

        let relative = path.strip_prefix(root).map_err(|_| AppError::InvalidPath)?;
        out.push(relative.to_string_lossy().replace('\\', "/"));
    }

    Ok(())
}

#[tauri::command]
pub fn select_working_folder(app_handle: tauri::AppHandle) -> Result<Option<String>> {
    let Some(path) = FileDialog::new().pick_folder() else {
        return Ok(None);
    };
    let canonical = set_active_workspace(&path.to_string_lossy())?;
    workspace_watch::start_workspace_watcher(app_handle, canonical.clone())?;
    Ok(Some(canonical.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn clear_working_folder() -> Result<()> {
    workspace_watch::stop_workspace_watcher()?;
    clear_active_workspace()
}

#[tauri::command]
pub fn set_working_folder(path: String, app_handle: tauri::AppHandle) -> Result<String> {
    let canonical = set_active_workspace(&path)?;
    workspace_watch::start_workspace_watcher(app_handle, canonical.clone())?;
    Ok(canonical.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_children(dir_path: String) -> Result<Vec<TreeNode>> {
    let started_at = Instant::now();
    let root = active_workspace_root()?;
    let dir = normalize_existing_dir(&dir_path)?;
    ensure_within_root(&root, &dir)?;
    let matcher = build_ignore_matcher(&root);
    let children = collect_children(&root, &dir, matcher.as_ref())?;
    log_fs_perf(
        "list_children",
        &dir,
        started_at,
        &[("entries", children.len().to_string())],
    );
    Ok(children)
}

#[tauri::command]
pub fn list_markdown_files() -> Result<Vec<String>> {
    let root_canonical = active_workspace_root()?;
    let mut out = Vec::new();
    let matcher = build_ignore_matcher(&root_canonical);
    collect_markdown_files_recursive(&root_canonical, &root_canonical, &mut out, matcher.as_ref())?;
    out.sort_by_key(|path| path.to_ascii_lowercase());
    Ok(out)
}

#[tauri::command]
pub fn path_exists(path: String) -> Result<bool> {
    let root = active_workspace_root()?;
    let pb = normalize_path(&path)?;
    ensure_parent_within_root(&root, &pb)?;
    Ok(pb.exists())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String> {
    let started_at = Instant::now();
    let root = active_workspace_root()?;
    let pb = normalize_existing_path(&path)?;
    ensure_within_root(&root, &pb)?;
    let content = fs::read_to_string(&pb)?;
    log_fs_perf(
        "read_text_file",
        &pb,
        started_at,
        &[
            ("chars", content.chars().count().to_string()),
            ("bytes", content.len().to_string()),
        ],
    );
    Ok(content)
}

fn system_time_to_unix_ms(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

#[tauri::command]
pub fn read_file_metadata(path: String) -> Result<FileMetadata> {
    let started_at = Instant::now();
    let root = active_workspace_root()?;
    let pb = normalize_existing_path(&path)?;
    ensure_within_root(&root, &pb)?;
    let metadata = fs::metadata(&pb)?;

    let result = FileMetadata {
        created_at_ms: metadata.created().ok().and_then(system_time_to_unix_ms),
        updated_at_ms: metadata.modified().ok().and_then(system_time_to_unix_ms),
    };
    log_fs_perf("read_file_metadata", &pb, started_at, &[]);

    Ok(result)
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<()> {
    let root = active_workspace_root()?;
    let pb = normalize_path(&path)?;
    ensure_parent_within_root(&root, &pb)?;
    fs::write(pb, content)?;
    Ok(())
}

#[tauri::command]
pub fn create_entry(
    parent_path: String,
    name: String,
    kind: EntryKind,
    conflict_strategy: ConflictStrategy,
) -> Result<String> {
    let root = active_workspace_root()?;
    let parent = normalize_existing_dir(&parent_path)?;
    ensure_within_root(&root, &parent)?;

    let safe_name = validate_name(&name)?;
    let base_path = parent.join(safe_name);
    ensure_parent_within_root(&root, &base_path)?;

    let is_dir = matches!(kind, EntryKind::Folder);
    let destination = resolve_destination(base_path, conflict_strategy, is_dir)?;

    if is_dir {
        fs::create_dir_all(&destination)?;
    } else if destination.exists() {
        fs::write(&destination, "")?;
    } else {
        fs::File::create(&destination)?;
    }

    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
pub fn rename_entry(
    path: String,
    new_name: String,
    conflict_strategy: ConflictStrategy,
) -> Result<String> {
    let root = active_workspace_root()?;
    let source = normalize_existing_path(&path)?;
    ensure_within_root(&root, &source)?;

    let Some(parent) = source.parent() else {
        return Err(AppError::InvalidPath);
    };

    let safe_name = validate_name(&new_name)?;
    let base_destination = parent.join(safe_name);

    if source == base_destination {
        return Ok(source.to_string_lossy().to_string());
    }

    let destination = resolve_destination(base_destination, conflict_strategy, source.is_dir())?;

    if destination.exists() && source.is_file() {
        fs::remove_file(&destination)?;
    }

    fs::rename(&source, &destination)?;
    if destination.is_file() {
        record_workspace_mutation_write_from_disk(&destination);
    }
    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
pub fn duplicate_entry(path: String, conflict_strategy: ConflictStrategy) -> Result<String> {
    let root = active_workspace_root()?;
    let source = normalize_existing_path(&path)?;
    ensure_within_root(&root, &source)?;

    let Some(parent) = source.parent() else {
        return Err(AppError::InvalidPath);
    };

    let duplicate_name = duplicate_file_name(&source)?;
    let base_destination = parent.join(duplicate_name);
    let destination = resolve_destination(base_destination, conflict_strategy, source.is_dir())?;

    if source.is_dir() {
        copy_dir_recursive(&source, &destination)?;
    } else {
        if destination.exists() {
            fs::remove_file(&destination)?;
        }
        fs::copy(&source, &destination)?;
    }

    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
pub fn move_entry(
    source_path: String,
    target_dir_path: String,
    conflict_strategy: ConflictStrategy,
) -> Result<String> {
    let root = active_workspace_root()?;
    let source = normalize_existing_path(&source_path)?;
    let target_dir = normalize_existing_dir(&target_dir_path)?;

    ensure_within_root(&root, &source)?;
    ensure_within_root(&root, &target_dir)?;

    if source.is_dir() {
        let source_canonical = fs::canonicalize(&source)?;
        let target_canonical = fs::canonicalize(&target_dir)?;

        if target_canonical.starts_with(&source_canonical) {
            return Err(AppError::InvalidOperation(
                "Cannot move a folder into itself.".to_string(),
            ));
        }
    }

    let Some(file_name) = source.file_name() else {
        return Err(AppError::InvalidPath);
    };

    let base_destination = target_dir.join(file_name);

    if source == base_destination {
        return Ok(source.to_string_lossy().to_string());
    }

    let destination = resolve_destination(base_destination, conflict_strategy, source.is_dir())?;

    if destination.exists() && source.is_file() {
        fs::remove_file(&destination)?;
    }

    fs::rename(&source, &destination)?;
    if destination.is_file() {
        record_workspace_mutation_write_from_disk(&destination);
    }
    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
pub fn copy_entry(
    source_path: String,
    target_dir_path: String,
    conflict_strategy: ConflictStrategy,
) -> Result<String> {
    let root = active_workspace_root()?;
    let source = normalize_existing_path(&source_path)?;
    let target_dir = normalize_existing_dir(&target_dir_path)?;

    ensure_within_root(&root, &source)?;
    ensure_within_root(&root, &target_dir)?;

    if source.is_dir() {
        let source_canonical = fs::canonicalize(&source)?;
        let target_canonical = fs::canonicalize(&target_dir)?;
        if target_canonical.starts_with(&source_canonical) {
            return Err(AppError::InvalidOperation(
                "Cannot copy a folder into itself.".to_string(),
            ));
        }
    }

    let Some(file_name) = source.file_name() else {
        return Err(AppError::InvalidPath);
    };
    let base_destination = target_dir.join(file_name);
    let destination = resolve_destination(base_destination, conflict_strategy, source.is_dir())?;

    if source.is_dir() {
        copy_dir_recursive(&source, &destination)?;
    } else {
        if destination.exists() {
            fs::remove_file(&destination)?;
        }
        fs::copy(&source, &destination)?;
    }

    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
pub fn trash_entry(path: String) -> Result<String> {
    let root = active_workspace_root()?;
    let source = normalize_existing_path(&path)?;
    ensure_within_root(&root, &source)?;

    let root_canonical = fs::canonicalize(&root)?;
    let source_canonical = fs::canonicalize(&source)?;
    if source_canonical == root_canonical {
        return Err(AppError::InvalidOperation(
            "Cannot move the working folder to trash.".to_string(),
        ));
    }

    let trash_dir = root.join(TRASH_DIR_NAME);
    fs::create_dir_all(&trash_dir)?;

    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(AppError::InvalidPath)?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AppError::OperationFailed)?
        .as_secs();

    let destination = trash_dir.join(format!("{timestamp}_{file_name}"));
    let final_destination = if destination.exists() {
        next_available_path(&destination)?
    } else {
        destination
    };

    fs::rename(&source, &final_destination)?;
    Ok(final_destination.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_path_external(path: String) -> Result<()> {
    let root = active_workspace_root()?;
    let pb = normalize_existing_path(&path)?;
    ensure_within_root(&root, &pb)?;
    open::that_detached(pb).map_err(|_| AppError::OperationFailed)?;
    Ok(())
}

fn sanitize_external_url(raw: &str) -> Result<String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err(AppError::InvalidPath);
    }

    if value.chars().any(|ch| ch.is_control()) {
        return Err(AppError::InvalidPath);
    }

    let lower = value.to_ascii_lowercase();
    let is_http = lower.starts_with("http://");
    let is_https = lower.starts_with("https://");
    let is_mailto = lower.starts_with("mailto:");

    if !is_http && !is_https && !is_mailto {
        return Err(AppError::InvalidPath);
    }

    if is_http || is_https {
        let scheme_len = if is_https {
            "https://".len()
        } else {
            "http://".len()
        };
        let host = value[scheme_len..]
            .split(['/', '?', '#'])
            .next()
            .unwrap_or("");
        if host.trim().is_empty() {
            return Err(AppError::InvalidPath);
        }
    } else if value["mailto:".len()..].trim().is_empty() {
        return Err(AppError::InvalidPath);
    }

    Ok(value.to_string())
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<()> {
    let safe_url = sanitize_external_url(&url)?;
    open::that_detached(safe_url).map_err(|_| AppError::OperationFailed)?;
    Ok(())
}

#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<()> {
    let root = active_workspace_root()?;
    let pb = normalize_existing_path(&path)?;
    ensure_within_root(&root, &pb)?;
    let target = if pb.is_dir() {
        pb
    } else {
        pb.parent().ok_or(AppError::InvalidPath)?.to_path_buf()
    };
    open::that_detached(target).map_err(|_| AppError::OperationFailed)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::editor_sync::recent_internal_write_for;

    use super::{
        copy_entry, create_entry, duplicate_entry, list_children, list_markdown_files, move_entry,
        open_external_url, open_path_external, read_text_file, rename_entry,
        reveal_in_file_manager, sanitize_external_url, trash_entry, ConflictStrategy, EntryKind,
    };

    fn make_temp_dir() -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tomosona-fsops-test-{timestamp}"));
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    fn activate_workspace(root: &Path) -> std::sync::MutexGuard<'static, ()> {
        let guard = crate::workspace_test_guard();
        crate::set_active_workspace(&root.to_string_lossy()).expect("set active workspace");
        guard
    }

    #[test]
    fn create_entry_renames_on_conflict() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = dir.to_string_lossy().to_string();

        let first = create_entry(
            root.clone(),
            "note.md".to_string(),
            EntryKind::File,
            ConflictStrategy::Rename,
        )
        .expect("create first");

        let second = create_entry(
            root.clone(),
            "note.md".to_string(),
            EntryKind::File,
            ConflictStrategy::Rename,
        )
        .expect("create second");

        assert!(first.ends_with("note.md"));
        assert!(second.ends_with("note (1).md"));
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn duplicate_file_creates_copy() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let source = dir.join("doc.md");
        fs::write(&source, "hello").expect("write source");

        let duplicated = duplicate_entry(
            source.to_string_lossy().to_string(),
            ConflictStrategy::Rename,
        )
        .expect("duplicate");

        let copied_content = read_text_file(duplicated).expect("read duplicated");
        assert_eq!(copied_content, "hello");
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn move_entry_renames_on_conflict() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let source = dir.join("a.md");
        let destination_dir = dir.join("dest");

        fs::create_dir_all(&destination_dir).expect("create dest");
        fs::write(&source, "a").expect("write source");
        fs::write(destination_dir.join("a.md"), "existing").expect("write existing");

        let moved = move_entry(
            source.to_string_lossy().to_string(),
            destination_dir.to_string_lossy().to_string(),
            ConflictStrategy::Rename,
        )
        .expect("move");

        assert!(moved.ends_with("a (1).md"));
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn trash_entry_moves_file_to_trash_folder() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let source = dir.join("to-delete.md");
        fs::write(&source, "delete me").expect("write source");

        let trashed = trash_entry(source.to_string_lossy().to_string()).expect("trash");

        assert!(trashed.contains(".tomosona-trash"));
        assert!(PathBuf::from(trashed).exists());
        assert!(!source.exists());
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn list_tree_excludes_internal_files() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = dir.as_path();
        fs::write(root.join("doc.md"), "x").expect("write md");
        fs::write(root.join("tomosona.sqlite"), "legacy db").expect("write legacy db");
        fs::create_dir_all(root.join(".tomosona")).expect("internal dir");
        fs::write(root.join(".tomosona").join("tomosona.sqlite"), "db").expect("write db");
        fs::create_dir_all(root.join(".tomosona-trash")).expect("trash dir");

        let tree = list_children(root.to_string_lossy().to_string()).expect("list tree");
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].name, "doc.md");
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn list_tree_excludes_hidden_directories() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = dir.as_path();
        fs::create_dir_all(root.join(".git")).expect("git dir");
        fs::create_dir_all(root.join(".obsidian")).expect("hidden dir");
        fs::create_dir_all(root.join("notes")).expect("visible dir");

        let tree = list_children(root.to_string_lossy().to_string()).expect("list tree");
        let names: Vec<String> = tree.into_iter().map(|node| node.name).collect();
        assert_eq!(names, vec!["notes".to_string()]);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn list_tree_respects_gitignore_and_tomosonaignore() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = dir.as_path();
        fs::write(root.join(".gitignore"), "ignored.md\n").expect("write gitignore");
        fs::write(root.join(".tomosonaignore"), "secret/\n").expect("write tomosonaignore");
        fs::create_dir_all(root.join("secret")).expect("create secret dir");
        fs::write(root.join("visible.md"), "x").expect("write visible");
        fs::write(root.join("ignored.md"), "x").expect("write ignored");
        fs::write(root.join("secret").join("hidden.md"), "x").expect("write hidden");

        let tree = list_children(root.to_string_lossy().to_string()).expect("list tree");
        let names: Vec<String> = tree.into_iter().map(|node| node.name).collect();
        assert_eq!(names, vec!["visible.md".to_string()]);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn list_tree_excludes_hidden_files() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = dir.as_path();
        fs::write(root.join(".DS_Store"), "x").expect("write hidden file");
        fs::write(root.join("visible.md"), "x").expect("write visible");

        let tree = list_children(root.to_string_lossy().to_string()).expect("list tree");
        let names: Vec<String> = tree.into_iter().map(|node| node.name).collect();
        assert_eq!(names, vec!["visible.md".to_string()]);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn list_markdown_files_is_recursive() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = dir.as_path();
        let nested = root.join("docs");
        fs::create_dir_all(&nested).expect("mkdir");
        fs::write(root.join("a.md"), "x").expect("write a");
        fs::write(nested.join("b.markdown"), "x").expect("write b");
        fs::write(nested.join("c.txt"), "x").expect("write c");
        fs::create_dir_all(root.join(".tomosona")).expect("internal dir");
        fs::write(root.join(".tomosona").join("hidden.md"), "x").expect("write hidden");

        let files = list_markdown_files().expect("list markdown");
        assert_eq!(
            files,
            vec!["a.md".to_string(), "docs/b.markdown".to_string()]
        );
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn list_markdown_files_respects_ignore_rules() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = dir.as_path();
        let nested = root.join("docs");
        fs::create_dir_all(&nested).expect("mkdir");
        fs::create_dir_all(root.join("private")).expect("mkdir private");
        fs::write(root.join(".gitignore"), "docs/skip.md\n").expect("write gitignore");
        fs::write(root.join(".tomosonaignore"), "private/**\n").expect("write tomosonaignore");
        fs::write(root.join("a.md"), "x").expect("write a");
        fs::write(nested.join("ok.md"), "x").expect("write ok");
        fs::write(nested.join("skip.md"), "x").expect("write skip");
        fs::write(root.join("private").join("secret.md"), "x").expect("write secret");

        let files = list_markdown_files().expect("list markdown");
        assert_eq!(files, vec!["a.md".to_string(), "docs/ok.md".to_string()]);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn rename_entry_changes_name() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let source = dir.join("old.md");
        fs::write(&source, "content").expect("write source");

        let renamed = rename_entry(
            source.to_string_lossy().to_string(),
            "new.md".to_string(),
            ConflictStrategy::Rename,
        )
        .expect("rename");

        assert!(renamed.ends_with("new.md"));
        assert!(!source.exists());
        assert!(recent_internal_write_for(&renamed).is_some());
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn rename_entry_rejects_invalid_name_characters() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let source = dir.join("old.md");
        fs::write(&source, "content").expect("write source");

        let result = rename_entry(
            source.to_string_lossy().to_string(),
            "bad:name.md".to_string(),
            ConflictStrategy::Rename,
        );

        assert!(result.is_err());
        assert!(source.exists());
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn create_entry_rejects_reserved_windows_names() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = dir.to_string_lossy().to_string();

        let result = create_entry(
            root,
            "CON".to_string(),
            EntryKind::File,
            ConflictStrategy::Fail,
        );

        assert!(result.is_err());
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn copy_entry_works_for_files() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let source = dir.join("a.md");
        let target_dir = dir.join("sub");
        fs::create_dir_all(&target_dir).expect("create sub");
        fs::write(&source, "content").expect("write source");

        let copied = copy_entry(
            source.to_string_lossy().to_string(),
            target_dir.to_string_lossy().to_string(),
            ConflictStrategy::Fail,
        )
        .expect("copy");

        let text = read_text_file(copied).expect("read copied");
        assert_eq!(text, "content");
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn open_path_external_rejects_path_outside_workspace() {
        let workspace = make_temp_dir();
        let _guard = activate_workspace(&workspace);

        let outside_dir = make_temp_dir();
        let outside = outside_dir.join("outside.md");
        fs::write(&outside, "x").expect("write outside");

        let result = open_path_external(outside.to_string_lossy().to_string());
        assert!(result.is_err());

        fs::remove_file(outside).expect("cleanup outside file");
        fs::remove_dir_all(outside_dir).expect("cleanup outside dir");
        fs::remove_dir_all(workspace).expect("cleanup workspace");
    }

    #[test]
    fn reveal_in_file_manager_rejects_path_outside_workspace() {
        let workspace = make_temp_dir();
        let _guard = activate_workspace(&workspace);

        let outside_dir = make_temp_dir();
        let outside = outside_dir.join("outside.md");
        fs::write(&outside, "x").expect("write outside");

        let result = reveal_in_file_manager(outside.to_string_lossy().to_string());
        assert!(result.is_err());

        fs::remove_file(outside).expect("cleanup outside file");
        fs::remove_dir_all(outside_dir).expect("cleanup outside dir");
        fs::remove_dir_all(workspace).expect("cleanup workspace");
    }

    #[test]
    fn sanitize_external_url_allows_expected_schemes() {
        assert_eq!(
            sanitize_external_url("https://example.com/path").expect("https url"),
            "https://example.com/path"
        );
        assert_eq!(
            sanitize_external_url("http://example.com").expect("http url"),
            "http://example.com"
        );
        assert_eq!(
            sanitize_external_url("mailto:test@example.com").expect("mailto url"),
            "mailto:test@example.com"
        );
    }

    #[test]
    fn sanitize_external_url_rejects_invalid_schemes() {
        assert!(sanitize_external_url("javascript:alert(1)").is_err());
        assert!(sanitize_external_url("file:///tmp/foo").is_err());
        assert!(sanitize_external_url("www.example.com").is_err());
    }

    #[test]
    fn sanitize_external_url_rejects_missing_host_and_payload() {
        assert!(sanitize_external_url("https://").is_err());
        assert!(sanitize_external_url("http:///path").is_err());
        assert!(sanitize_external_url("mailto:").is_err());
    }

    #[test]
    fn open_external_url_rejects_invalid_scheme() {
        let result = open_external_url("javascript:alert(1)".to_string());
        assert!(result.is_err());
    }
}
