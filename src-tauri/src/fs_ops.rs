#[cfg(windows)]
use std::os::windows::fs::MetadataExt;
use std::{
    env, fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use calamine::{open_workbook_auto, Data, DataType, Reader};

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};

use crate::editor_sync::record_workspace_mutation_write_from_disk;
use crate::{
    active_workspace_root, clear_active_workspace, note_link_target, set_active_workspace,
    workspace_watch, AppError, Result,
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

#[derive(Debug, Clone, Serialize)]
pub struct ExtractedNoteResult {
    pub path: String,
    pub link_target: String,
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

fn sanitize_extracted_note_stem(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|ch| {
            if matches!(
                ch,
                '/' | '\\' | ':' | '"' | '|' | '?' | '*' | '<' | '>' | '#' | '[' | ']' | '!'
            ) || ch.is_control()
            {
                ' '
            } else {
                ch
            }
        })
        .collect();
    let compact = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = compact.trim().trim_matches('.');
    if trimmed.is_empty() {
        "Extrait".to_string()
    } else {
        trimmed.to_string()
    }
}

fn strip_known_block_prefix(line: &str) -> &str {
    let trimmed = line.trim();
    if let Some(rest) = trimmed.strip_prefix('#') {
        let heading = rest.trim_start_matches('#').trim();
        if !heading.is_empty() {
            return heading;
        }
    }

    if let Some(rest) = trimmed.strip_prefix("> ") {
        let quote = rest.trim();
        if !quote.is_empty() {
            return quote;
        }
    }

    for prefix in ["- [ ] ", "- [x] ", "- [X] ", "- ", "* ", "+ "] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            let item = rest.trim();
            if !item.is_empty() {
                return item;
            }
        }
    }

    if let Some((leading, rest)) = trimmed.split_once(". ") {
        if !leading.is_empty() && leading.chars().all(|ch| ch.is_ascii_digit()) {
            let item = rest.trim();
            if !item.is_empty() {
                return item;
            }
        }
    }

    trimmed
}

fn derive_extracted_note_stem(content: &str) -> String {
    for line in content.replace("\r\n", "\n").lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let candidate = strip_known_block_prefix(trimmed);
        return sanitize_extracted_note_stem(candidate);
    }

    "Extrait".to_string()
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
pub fn import_asset_files() -> Result<Vec<String>> {
    let root = active_workspace_root()?;
    let Some(sources) = FileDialog::new().pick_files() else {
        return Ok(Vec::new());
    };

    let assets_dir = root.join("assets");
    fs::create_dir_all(&assets_dir)?;
    let mut imported = Vec::with_capacity(sources.len());

    for source in sources {
        if !source.is_file() {
            continue;
        }
        let file_name = source.file_name().ok_or(AppError::InvalidPath)?;
        let destination = resolve_destination(
            assets_dir.join(file_name),
            ConflictStrategy::Rename,
            false,
        )?;
        fs::copy(&source, &destination)?;
        imported.push(destination.to_string_lossy().to_string());
    }

    Ok(imported)
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
    let root = active_workspace_root()?;
    let dir = normalize_existing_dir(&dir_path)?;
    ensure_within_root(&root, &dir)?;
    let matcher = build_ignore_matcher(&root);
    collect_children(&root, &dir, matcher.as_ref())
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
    let root = active_workspace_root()?;
    let pb = normalize_existing_path(&path)?;
    ensure_within_root(&root, &pb)?;
    fs::read_to_string(&pb).map_err(Into::into)
}

#[tauri::command]
pub fn is_text_file(path: String) -> Result<bool> {
    let root = active_workspace_root()?;
    let pb = normalize_existing_path(&path)?;
    ensure_within_root(&root, &pb)?;
    if pb.is_dir() || binary_file_extension_for_path(&pb) {
        return Ok(false);
    }

    let mut file = fs::File::open(&pb)?;
    let mut buffer = Vec::with_capacity(8192);
    file.by_ref().take(8192).read_to_end(&mut buffer)?;
    Ok(looks_like_text(&buffer))
}

#[tauri::command]
pub fn read_pdf_data_url(path: String) -> Result<String> {
    let root = active_workspace_root()?;
    let pb = normalize_existing_path(&path)?;
    ensure_within_root(&root, &pb)?;
    let bytes = fs::read(&pb)?;
    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:application/pdf;base64,{encoded}"))
}

fn image_mime_type_for_path(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" | "svgz" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

fn binary_file_extension_for_path(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "bmp"
            | "ico"
            | "tif"
            | "tiff"
            | "avif"
            | "heic"
            | "heif"
            | "svgz"
            | "pdf"
            | "doc"
            | "docx"
            | "xls"
            | "xlsx"
            | "ppt"
            | "pptx"
            | "odt"
            | "ods"
            | "odp"
            | "epub"
            | "zip"
            | "tar"
            | "gz"
            | "bz2"
            | "xz"
            | "7z"
            | "rar"
            | "jar"
            | "apk"
            | "exe"
            | "dll"
            | "so"
            | "dylib"
            | "bin"
            | "iso"
            | "woff"
            | "woff2"
            | "ttf"
            | "otf"
            | "eot"
            | "mp3"
            | "wav"
            | "flac"
            | "aac"
            | "ogg"
            | "m4a"
            | "mp4"
            | "mkv"
            | "mov"
            | "avi"
            | "webm"
    )
}

fn looks_like_text(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }
    if bytes.contains(&0) {
        return false;
    }
    std::str::from_utf8(bytes).is_ok()
}

#[tauri::command]
pub fn read_image_data_url(path: String) -> Result<String> {
    let root = active_workspace_root()?;
    let pb = normalize_existing_path(&path)?;
    ensure_within_root(&root, &pb)?;
    let mime = image_mime_type_for_path(&pb).ok_or(AppError::InvalidOperation(
        "Unsupported image format.".to_string(),
    ))?;
    let bytes = fs::read(&pb)?;
    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

fn spreadsheet_input_format_for_path(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "xlsx" => Some("xlsx"),
        "ods" => Some("ods"),
        _ => None,
    }
}

fn escape_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

fn spreadsheet_column_label(mut column_index: usize) -> String {
    let mut label = String::new();
    loop {
        let remainder = column_index % 26;
        label.push((b'A' + remainder as u8) as char);
        if column_index < 26 {
            break;
        }
        column_index = (column_index / 26) - 1;
    }
    label.chars().rev().collect()
}

fn spreadsheet_cell_text(cell: Option<&Data>) -> String {
    cell.and_then(|value| value.as_string()).unwrap_or_default()
}

fn render_spreadsheet_sheet_html(
    sheet_index: usize,
    sheet_name: &str,
    range: &calamine::Range<Data>,
) -> String {
    let (row_start, col_start) = range.start().unwrap_or((0, 0));
    let (row_count, col_count) = range.get_size();
    let used_cells = range.used_cells().count();
    let sheet_id = format!("sheet-{sheet_index}");
    let sheet_title = escape_html(sheet_name);
    let mut html = String::new();

    html.push_str(&format!(
        "<section class=\"spreadsheet-sheet\" data-spreadsheet-sheet data-sheet-id=\"{sheet_id}\" data-active=\"{}\"{}>",
        if sheet_index == 0 { "true" } else { "false" },
        if sheet_index == 0 { "" } else { " hidden" }
    ));
    html.push_str(&format!(
        "<header class=\"spreadsheet-sheet-head\"><div><h2>{sheet_title}</h2><p>{row_count} rows · {col_count} columns · {used_cells} filled cells</p></div><span class=\"spreadsheet-sheet-range\">R{}C{}</span></header>",
        row_start + 1,
        col_start + 1
    ));

    if row_count == 0 || col_count == 0 {
        html.push_str("<div class=\"spreadsheet-empty\">This sheet is empty.</div></section>");
        return html;
    }

    html.push_str("<div class=\"spreadsheet-table-shell\"><table class=\"spreadsheet-table\">");
    html.push_str("<thead><tr><th class=\"spreadsheet-corner\"></th>");
    for col_offset in 0..col_count {
        let label = spreadsheet_column_label((col_start as usize) + col_offset);
        html.push_str(&format!("<th scope=\"col\">{}</th>", escape_html(&label)));
    }
    html.push_str("</tr></thead><tbody>");

    for row_offset in 0..row_count {
        let row_number = row_start as usize + row_offset + 1;
        html.push_str("<tr>");
        html.push_str(&format!(
            "<th scope=\"row\" class=\"spreadsheet-row-header\">{row_number}</th>"
        ));

        for col_offset in 0..col_count {
            let value = spreadsheet_cell_text(range.get_value((
                row_start + row_offset as u32,
                col_start + col_offset as u32,
            )));
            html.push_str(&format!("<td>{}</td>", escape_html(&value)));
        }

        html.push_str("</tr>");
    }

    html.push_str("</tbody></table></div></section>");
    html
}

fn decorate_spreadsheet_preview_html(html: String, title: &str) -> String {
    let injection = format!(
        r#"{}<style>
html {{
  background: var(--app-bg, var(--surface-bg, #f4f7fb));
}}
body {{
  margin: 0;
  background: var(--app-bg, var(--surface-bg, #f4f7fb));
  color: var(--text-main, #1a1a18);
  font-family: var(--font-editor, var(--font-sans, ui-sans-serif, system-ui, sans-serif));
  line-height: 1.45;
  -webkit-font-variant-ligatures: none;
  font-variant-ligatures: none;
  font-feature-settings: "liga" 0;
}}
.spreadsheet-preview-shell {{
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}}
.spreadsheet-preview {{
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.9rem 0.9rem 1.1rem;
  box-sizing: border-box;
}}
.spreadsheet-tab-input {{
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
  clip-path: inset(50%);
}}
.spreadsheet-preview-head {{
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.5rem;
}}
.spreadsheet-preview-head h1 {{
  margin: 0;
  font-size: 0.98rem;
  font-weight: 650;
  letter-spacing: -0.01em;
}}
.spreadsheet-preview-head p {{
  margin: 0.18rem 0 0;
  font-size: 0.8rem;
  color: var(--text-soft, #5c5c56);
}}
.spreadsheet-preview-tabs {{
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  padding: 0.2rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-subtle, #edf2f8) 72%, transparent);
  border: 1px solid var(--border-subtle, #d5dde8);
  position: sticky;
  top: 0;
  z-index: 2;
  backdrop-filter: blur(8px);
}}
.spreadsheet-tab-btn {{
  display: inline-flex;
  align-items: center;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-soft, #5c5c56);
  border-radius: 999px;
  padding: 0.3rem 0.62rem;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.1;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
}}
.spreadsheet-tab-btn:hover {{
  background: color-mix(in srgb, var(--surface-bg, #ffffff) 72%, transparent);
  color: var(--text-main, #1a1a18);
}}
.spreadsheet-tab-btn[data-active="true"] {{
  background: var(--surface-bg, #ffffff);
  color: var(--text-main, #1a1a18);
  border-color: var(--border-subtle, #d5dde8);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--border-subtle, #d5dde8) 45%, transparent);
}}
.spreadsheet-tab-btn:focus-visible {{
  outline: 2px solid var(--accent, #1f5f9b);
  outline-offset: 2px;
}}
.spreadsheet-sheet {{
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 0.55rem;
  scroll-margin-top: 5rem;
}}
.spreadsheet-sheet[hidden] {{
  display: none;
}}
.spreadsheet-sheet[data-active="true"] {{
  display: flex;
}}
.spreadsheet-sheet-head {{
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}}
.spreadsheet-sheet-head h2 {{
  margin: 0;
  font-size: 0.92rem;
  font-weight: 650;
}}
.spreadsheet-sheet-head p,
.spreadsheet-sheet-range {{
  margin: 0;
  font-size: 0.76rem;
  color: var(--text-soft, #5c5c56);
}}
.spreadsheet-table-shell {{
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border-subtle, #d5dde8);
  border-radius: 0.8rem;
  background: var(--surface-bg, #ffffff);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--border-subtle, #d5dde8) 38%, transparent);
}}
.spreadsheet-table {{
  width: max(100%, max-content);
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  font-size: 0.76rem;
}}
.spreadsheet-table thead th,
.spreadsheet-table tbody th,
.spreadsheet-table td {{
  border-right: 1px solid var(--border-subtle, #d5dde8);
  border-bottom: 1px solid var(--border-subtle, #d5dde8);
  padding: 0.28rem 0.4rem;
  min-width: 4.5rem;
  max-width: 18rem;
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
}}
.spreadsheet-table thead th {{
  position: sticky;
  top: 0;
  z-index: 1;
  background: color-mix(in srgb, var(--surface-muted, #edf2f8) 78%, var(--surface-bg, #ffffff));
  font-weight: 650;
  text-align: center;
  color: var(--text-main, #1a1a18);
}}
.spreadsheet-table tbody th {{
  position: sticky;
  left: 0;
  z-index: 1;
  background: color-mix(in srgb, var(--surface-muted, #edf2f8) 78%, var(--surface-bg, #ffffff));
  font-weight: 650;
  text-align: right;
  color: var(--text-main, #1a1a18);
  min-width: 2.85rem;
  width: 2.85rem;
}}
.spreadsheet-table .spreadsheet-corner {{
  left: 0;
  z-index: 2;
  min-width: 2.85rem;
  width: 2.85rem;
}}
.spreadsheet-table td {{
  background: var(--surface-bg, #ffffff);
}}
.spreadsheet-table tr:last-child > th,
.spreadsheet-table tr:last-child > td {{
  border-bottom: none;
}}
.spreadsheet-table tr > th:last-child,
.spreadsheet-table tr > td:last-child {{
  border-right: none;
}}
.spreadsheet-empty {{
  padding: 1rem 1.1rem;
  border: 1px dashed var(--border-subtle, #d5dde8);
  border-radius: 0.75rem;
  color: var(--text-soft, #5c5c56);
  background: color-mix(in srgb, var(--surface-subtle, #edf2f8) 40%, transparent);
}}
@media (max-width: 840px) {{
  .spreadsheet-preview {{
    padding: 0.75rem;
  }}

  .spreadsheet-sheet-head {{
    flex-direction: column;
    align-items: flex-start;
  }}
}}
</style>
<title>{}</title>"#,
        preview_srcdoc_csp_meta(),
        title
    );

    if let Some(head_end) = html.find("</head>") {
        let mut decorated = String::with_capacity(html.len() + injection.len());
        decorated.push_str(&html[..head_end]);
        decorated.push_str(&injection);
        decorated.push_str(&html[head_end..]);
        return decorated;
    }

    format!("{injection}{html}")
}

fn build_spreadsheet_preview_script(sheet_count: usize) -> String {
    let mut script = String::from(
        r#"<script>
(function () {
  function setActive(root, sheetId) {
    var tabs = Array.from(root.querySelectorAll('[data-spreadsheet-tab]'));
    var sheets = Array.from(root.querySelectorAll('[data-spreadsheet-sheet]'));

    tabs.forEach(function (tab) {
      var isActive = tab.dataset.sheetId === sheetId;
      tab.dataset.active = isActive ? 'true' : 'false';
      tab.setAttribute('aria-current', isActive ? 'true' : 'false');
    });

    sheets.forEach(function (sheet) {
      var isActive = sheet.dataset.sheetId === sheetId;
      sheet.dataset.active = isActive ? 'true' : 'false';
      sheet.hidden = !isActive;
    });
  }

  var root = document.querySelector('[data-spreadsheet-preview]');
  if (!root) return;

  root.addEventListener('click', function (event) {
    var tab = event.target.closest('[data-spreadsheet-tab]');
    if (!tab || !root.contains(tab)) return;
    event.preventDefault();
    setActive(root, tab.dataset.sheetId);
  });

  var initial = root.querySelector('[data-spreadsheet-tab][data-active="true"]') || root.querySelector('[data-spreadsheet-tab]');
  if (initial) {
    setActive(root, initial.dataset.sheetId);
  }
})();
</script>"#,
    );
    if sheet_count == 0 {
        script.clear();
    }
    script
}

fn render_spreadsheet_preview_html_sync(path: String) -> Result<String> {
    let root = active_workspace_root()?;
    let pb = normalize_existing_path(&path)?;
    ensure_within_root(&root, &pb)?;
    spreadsheet_input_format_for_path(&pb)
        .ok_or_else(|| AppError::InvalidOperation("Preview unavailable for this file format.".to_string()))?;

    let mut workbook =
        open_workbook_auto(&pb).map_err(|err| AppError::InvalidOperation(format!("Spreadsheet preview failed: {err}")))?;

    let sheet_names = workbook.sheet_names().to_owned();
    if sheet_names.is_empty() {
        return Err(AppError::InvalidOperation(
            "Spreadsheet preview failed: no sheets were found.".to_string(),
        ));
    }

    let mut html = String::new();
    html.push_str("<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>");
    html.push_str(
        "<div class=\"spreadsheet-preview-shell\"><main class=\"spreadsheet-preview\" data-spreadsheet-preview>",
    );
    html.push_str(&format!(
        "<header class=\"spreadsheet-preview-head\"><div><h1>{}</h1><p>{} sheet{}</p></div></header>",
        escape_html(
            pb.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Spreadsheet preview")
        ),
        sheet_names.len(),
        if sheet_names.len() == 1 { "" } else { "s" }
    ));
    html.push_str("<nav class=\"spreadsheet-preview-tabs\" aria-label=\"Spreadsheet sheets\">");

    let mut rendered_sheets = Vec::new();
    for (index, sheet_name) in sheet_names.iter().enumerate() {
        let sheet_label = escape_html(sheet_name);
        html.push_str(&format!(
            "<button type=\"button\" class=\"spreadsheet-tab-btn\" data-spreadsheet-tab data-sheet-id=\"sheet-{index}\"{}>{sheet_label}</button>",
            if index == 0 { " data-active=\"true\" aria-current=\"true\"" } else { "" }
        ));

        match workbook.worksheet_range(sheet_name) {
            Ok(range) => rendered_sheets.push(render_spreadsheet_sheet_html(index, sheet_name, &range)),
            Err(err) => rendered_sheets.push(format!(
                "<section class=\"spreadsheet-sheet\" data-spreadsheet-sheet data-sheet-id=\"sheet-{index}\" data-active=\"{}\"{}><div class=\"spreadsheet-empty\">Could not load this sheet: {}</div></section>",
                if index == 0 { "true" } else { "false" },
                if index == 0 { "" } else { " hidden" },
                escape_html(&err.to_string())
            )),
        }
    }

    html.push_str("</nav>");
    html.push_str("<div class=\"spreadsheet-sheets\">");
    for sheet_html in rendered_sheets {
        html.push_str(&sheet_html);
    }
    html.push_str("</div></main></div>");
    html.push_str(&build_spreadsheet_preview_script(sheet_names.len()));
    html.push_str("</body></html>");
    let decorated = decorate_spreadsheet_preview_html(html, "Spreadsheet preview");
    Ok(decorated)
}

#[tauri::command]
pub async fn render_spreadsheet_preview_html(path: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || render_spreadsheet_preview_html_sync(path))
        .await
        .map_err(|_| AppError::OperationFailed)?
}

fn pandoc_input_format_for_path(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "docx" => Some("docx"),
        "odt" => Some("odt"),
        "csv" => Some("csv"),
        "tsv" => Some("tsv"),
        "html" | "htm" => Some("html"),
        "rst" => Some("rst"),
        "tex" | "latex" => Some("latex"),
        "epub" => Some("epub"),
        "org" => Some("org"),
        "asciidoc" | "adoc" => Some("asciidoc"),
        _ => None,
    }
}

fn unwrap_pandoc_list_blockquotes(html: String) -> String {
    html.replace("<li><blockquote><p>", "<li><p>")
        .replace("</p></blockquote></li>", "</p></li>")
}

fn preview_srcdoc_csp_meta() -> &'static str {
    r#"<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src 'self' data:; media-src data:">"#
}

fn find_ascii_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    let haystack = haystack.as_bytes();
    let needle = needle.as_bytes();
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }

    haystack
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle))
}

fn find_tag_open_end(html: &str, tag_start: usize) -> Option<usize> {
    let bytes = html.as_bytes();
    let mut index = tag_start;
    let mut quote: Option<u8> = None;

    while index < bytes.len() {
        let current = bytes[index];
        match quote {
            Some(active_quote) if current == active_quote => quote = None,
            Some(_) => {}
            None if current == b'"' || current == b'\'' => quote = Some(current),
            None if current == b'>' => return Some(index + 1),
            None => {}
        }
        index += 1;
    }

    None
}

fn find_open_tag_bounds(html: &str, tag: &str) -> Option<(usize, usize)> {
    let open_tag = format!("<{tag}");
    let start = find_ascii_case_insensitive(html, &open_tag)?;
    let boundary = html.as_bytes().get(start + 1 + tag.len()).copied();
    if !matches!(boundary, Some(b'>') | Some(b'/') | Some(b' ') | Some(b'\t') | Some(b'\n') | Some(b'\r')) {
        return None;
    }

    let end = find_tag_open_end(html, start)?;
    Some((start, end))
}

fn find_closing_tag_start(html: &str, tag: &str) -> Option<usize> {
    let close_tag = format!("</{tag}>");
    find_ascii_case_insensitive(html, &close_tag)
}

fn inject_into_head(html: &str, injection: &str) -> Option<String> {
    let (_, head_end) = find_open_tag_bounds(html, "head")?;
    let mut decorated = String::with_capacity(html.len() + injection.len());
    decorated.push_str(&html[..head_end]);
    decorated.push_str(injection);
    decorated.push_str(&html[head_end..]);
    Some(decorated)
}

fn wrap_body_contents(html: &str) -> Option<String> {
    let (_, body_end) = find_open_tag_bounds(html, "body")?;
    let body_close = find_closing_tag_start(html, "body")?;

    if body_close <= body_end {
        return None;
    }

    let mut wrapped = String::with_capacity(html.len() + 72);
    wrapped.push_str(&html[..body_end]);
    wrapped.push_str("<div class=\"pandoc-preview-shell\"><article class=\"pandoc-preview\">");
    wrapped.push_str(&html[body_end..body_close]);
    wrapped.push_str("</article></div>");
    wrapped.push_str(&html[body_close..]);

    Some(wrapped)
}

fn decorate_pandoc_html(html: String, title: &str) -> String {
    let injection = format!(
        r#"{}<style>
html {{
  background: #f4f7fb;
}}
body {{
  margin: 0;
  padding: 0;
  background: #f4f7fb;
  color: #1a1a18;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.5;
  -webkit-font-variant-ligatures: none;
  font-variant-ligatures: none;
  font-feature-settings: "liga" 0;
}}
.pandoc-preview-shell {{
  margin: 0;
  padding: 0 0 2rem;
}}
.pandoc-preview {{
  width: 800px;
  margin: 0 auto;
  box-sizing: border-box;
  padding-left: 5rem;
  padding-right: 2rem;
  min-height: 100vh;
  --pandoc-scale: 0.88;
  outline: none;
  word-wrap: break-word;
  white-space: pre-wrap;
  white-space: break-spaces;
  font-size: calc(1rem * var(--pandoc-scale, 1));
  color: #1a1a18;
  line-height: 1.5;
}}
.pandoc-preview > * {{
  position: relative;
}}
.pandoc-preview p {{
  font-size: calc(1rem * var(--pandoc-scale, 1));
  margin: 0.42rem 0;
}}
.pandoc-preview strong,
.pandoc-preview b {{
  font-weight: 600;
}}
.pandoc-preview h1 {{
  font-size: calc(1.9rem * var(--pandoc-scale, 1));
  font-weight: 580;
  line-height: 1.35;
  margin: 0.68rem 0 0.45rem;
  color: #1a1a18;
}}
.pandoc-preview h2 {{
  font-size: calc(1.6rem * var(--pandoc-scale, 1));
  line-height: 1.35;
  margin: 0.95rem 0 0.8rem;
  color: #1a1a18;
}}
.pandoc-preview h3 {{
  font-size: calc(1.35rem * var(--pandoc-scale, 1));
  line-height: 1.35;
  margin: 0.75rem 0 0.45rem;
  color: #1a1a18;
}}
.pandoc-preview h4 {{
  font-size: calc(1.18rem * var(--pandoc-scale, 1));
  font-weight: 560;
  line-height: 1.35;
  margin: 0.62rem 0 0.35rem;
  color: #1a1a18;
}}
.pandoc-preview h5 {{
  font-size: calc(1.04rem * var(--pandoc-scale, 1));
  font-weight: 540;
  line-height: 1.35;
  margin: 0.5rem 0 0.28rem;
  color: #44576b;
}}
.pandoc-preview h6 {{
  font-size: calc(0.94rem * var(--pandoc-scale, 1));
  font-weight: 520;
  line-height: 1.35;
  margin: 0.45rem 0 0.22rem;
  color: #66788b;
}}
.pandoc-preview :not(pre) > code {{
  border-radius: 0.34rem;
  padding: 0.06rem 0.38rem;
  font-size: 0.92em;
  font-family: "SFMono-Regular", ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace;
  background: #edf2f8;
}}
.pandoc-preview ul,
.pandoc-preview ol {{
  margin: 0.32rem 0 0.45rem 1.35rem;
  padding: 0;
}}
.pandoc-preview li {{
  margin: 0.2rem 0;
}}
.pandoc-preview table {{
  width: 100%;
  max-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  margin: 0.36rem 0;
  border: 1px solid #d5dde8;
  border-radius: 0.52rem;
  overflow: hidden;
  background: #ffffff;
  font-size: calc(0.82rem * var(--pandoc-scale, 1));
  line-height: 1.3;
  table-layout: fixed;
}}
.pandoc-preview th,
.pandoc-preview td {{
  border-right: 1px solid #d5dde8;
  border-bottom: 1px solid #d5dde8;
  padding: 0.24rem 0.34rem;
  vertical-align: top;
  text-align: left;
  min-width: 2.6rem;
}}
.pandoc-preview tr:last-child > th,
.pandoc-preview tr:last-child > td {{
  border-bottom: none;
}}
.pandoc-preview tr > th:last-child,
.pandoc-preview tr > td:last-child {{
  border-right: none;
}}
.pandoc-preview th {{
  font-weight: 640;
  background: #edf2f8;
  color: #16202d;
}}
.pandoc-preview pre {{
  border: 1px solid #d5dde8;
  border-radius: 0.6rem;
  padding: 0.8rem;
  overflow: auto;
  background: #ffffff;
}}
.pandoc-preview blockquote {{
  margin-inline: 0;
  padding-inline-start: 0;
  border-inline-start: 0;
}}
.pandoc-preview img,
.pandoc-preview video,
.pandoc-preview svg,
.pandoc-preview canvas {{
  max-width: 100%;
}}
.pandoc-preview a {{
  color: #1f5f9b;
}}
@media (max-width: 840px) {{
.pandoc-preview-shell {{
  padding: 0 1rem 1rem;
}}
.pandoc-preview {{
  width: 100%;
  padding-left: 1rem;
  padding-right: 1rem;
}}
}}
@media (max-width: 840px) {{
body {{
  padding-top: 0.5rem;
}}
}}
@media (prefers-color-scheme: dark) {{
html {{
  background: #1b1f28;
}}
body {{
  background: #1b1f28;
  color: #dbe3ec;
}}
.pandoc-preview {{
  color: #dbe3ec;
}}
.pandoc-preview h1,
.pandoc-preview h2,
.pandoc-preview h3,
.pandoc-preview h4 {{
  color: #f5f8fc;
}}
.pandoc-preview h5 {{
  color: #cbd5e1;
}}
.pandoc-preview h6 {{
  color: #94a3b8;
}}
.pandoc-preview :not(pre) > code {{
  background: #20252d;
}}
.pandoc-preview table,
.pandoc-preview pre {{
  background: #20252d;
  border-color: #39424d;
}}
.pandoc-preview th,
.pandoc-preview td {{
  border-color: #39424d;
}}
.pandoc-preview th {{
  background: #2a303a;
}}
.pandoc-preview blockquote {{
  border-inline-start-color: transparent;
}}
.pandoc-preview a {{
  color: #8bc3ff;
}}
}}
</style>
<meta name="color-scheme" content="light dark">
<title>{}</title>"#,
        preview_srcdoc_csp_meta(),
        title
    );

    let decorated = if let Some(decorated) = inject_into_head(&html, &injection) {
        decorated
    } else {
        format!("{injection}{html}")
    };

    wrap_body_contents(&decorated).unwrap_or(decorated)
}

fn decorate_pandoc_preview_html(html: String, title: &str) -> String {
    decorate_pandoc_html(html, title)
}

fn pandoc_binary_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/pandoc"),
        PathBuf::from("/usr/local/bin/pandoc"),
        PathBuf::from("/usr/bin/pandoc"),
    ];

    if let Some(path) = env::var_os("PATH") {
        for dir in env::split_paths(&path) {
            candidates.push(dir.join("pandoc"));
        }
    }

    candidates
}

fn resolve_pandoc_binary() -> Option<PathBuf> {
    pandoc_binary_candidates().into_iter().find(|candidate| candidate.is_file())
}

fn render_pandoc_preview_html_sync(path: String) -> Result<String> {
    let root = active_workspace_root()?;
    let pb = normalize_existing_path(&path)?;
    ensure_within_root(&root, &pb)?;
    let input_format = pandoc_input_format_for_path(&pb)
        .ok_or_else(|| AppError::InvalidOperation("Preview unavailable for this file format.".to_string()))?;

    let pandoc_binary = resolve_pandoc_binary().unwrap_or_else(|| PathBuf::from("pandoc"));
    let output = Command::new(pandoc_binary)
        .arg("--from")
        .arg(input_format)
        .arg("--to")
        .arg("html5")
        .arg("--standalone")
        .arg("--self-contained")
        .arg("--wrap")
        .arg("none")
        .arg(&pb)
        .output()
        .map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                AppError::InvalidOperation(
                    "Pandoc is not available. Install it to preview this file type.".to_string(),
                )
            } else {
                AppError::OperationFailed
            }
        })?;

    if !output.status.success() {
        return Err(AppError::InvalidOperation(
            String::from_utf8(output.stderr)
                .ok()
                .and_then(|stderr| stderr.lines().next().map(str::to_owned))
                .filter(|line| !line.trim().is_empty())
                .unwrap_or_else(|| "Pandoc preview conversion failed.".to_string()),
        ));
    }

    let html = String::from_utf8(output.stdout).map_err(|_| AppError::OperationFailed)?;
    let html = unwrap_pandoc_list_blockquotes(html);
    let decorated = decorate_pandoc_preview_html(html, "Preview");
    Ok(decorated)
}

#[tauri::command]
pub async fn render_pandoc_preview_html(path: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || render_pandoc_preview_html_sync(path))
        .await
        .map_err(|_| AppError::OperationFailed)?
}

fn system_time_to_unix_ms(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

#[tauri::command]
pub fn read_file_metadata(path: String) -> Result<FileMetadata> {
    let root = active_workspace_root()?;
    let pb = normalize_existing_path(&path)?;
    ensure_within_root(&root, &pb)?;
    let metadata = fs::metadata(&pb)?;

    let result = FileMetadata {
        created_at_ms: metadata.created().ok().and_then(system_time_to_unix_ms),
        updated_at_ms: metadata.modified().ok().and_then(system_time_to_unix_ms),
    };

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
pub fn create_extracted_note(source_path: String, content: String) -> Result<ExtractedNoteResult> {
    let root = active_workspace_root()?;
    let source = normalize_existing_path(&source_path)?;
    ensure_within_root(&root, &source)?;

    if !is_markdown_file(&source) {
        return Err(AppError::InvalidOperation(
            "Only markdown notes can be extracted into a linked note.".to_string(),
        ));
    }

    let note_content = content.replace("\r\n", "\n");
    if note_content.trim().is_empty() {
        return Err(AppError::InvalidOperation(
            "Selection is empty.".to_string(),
        ));
    }

    let Some(parent) = source.parent() else {
        return Err(AppError::InvalidPath);
    };

    let base_name = format!("{}.md", derive_extracted_note_stem(&note_content));
    let created_path = create_entry(
        parent.to_string_lossy().to_string(),
        base_name,
        EntryKind::File,
        ConflictStrategy::Rename,
    )?;
    let created = PathBuf::from(&created_path);

    if let Err(error) = fs::write(&created, &note_content) {
        let _ = fs::remove_file(&created);
        return Err(AppError::Io(error));
    }

    let created = fs::canonicalize(&created)?;
    record_workspace_mutation_write_from_disk(&created);
    let link_target = note_link_target(&root, &created)?;
    Ok(ExtractedNoteResult {
        path: created.to_string_lossy().to_string(),
        link_target,
    })
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

    use calamine::Data;
    use crate::editor_sync::recent_internal_write_for;

    use super::{
        copy_entry, create_entry, create_extracted_note, duplicate_entry, list_children,
        is_text_file, list_markdown_files, move_entry, open_external_url, open_path_external,
        pandoc_input_format_for_path, read_pdf_data_url, read_text_file, rename_entry,
        preview_srcdoc_csp_meta, render_spreadsheet_sheet_html, reveal_in_file_manager,
        sanitize_external_url, spreadsheet_column_label, trash_entry, ConflictStrategy, EntryKind,
        decorate_pandoc_html, decorate_spreadsheet_preview_html, unwrap_pandoc_list_blockquotes,
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
    fn pandoc_input_format_maps_supported_extensions() {
        assert_eq!(
            pandoc_input_format_for_path(Path::new("report.docx")),
            Some("docx")
        );
        assert_eq!(
            pandoc_input_format_for_path(Path::new("sheet.xlsx")),
            None
        );
        assert_eq!(
            pandoc_input_format_for_path(Path::new("notes.odt")),
            Some("odt")
        );
        assert_eq!(pandoc_input_format_for_path(Path::new("image.png")), None);
    }

    #[test]
    fn spreadsheet_column_labels_follow_excel_conventions() {
        assert_eq!(spreadsheet_column_label(0), "A");
        assert_eq!(spreadsheet_column_label(25), "Z");
        assert_eq!(spreadsheet_column_label(26), "AA");
    }

    #[test]
    fn spreadsheet_sheet_preview_renders_tabs_and_absolute_coordinates() {
        let mut range = calamine::Range::new((1, 1), (2, 2));
        range.set_value((1, 1), Data::String("Alpha & Beta".to_string()));
        range.set_value((2, 2), Data::String("Gamma".to_string()));

        let html = render_spreadsheet_sheet_html(0, "Summary & More", &range);

        assert!(html.contains("data-spreadsheet-sheet"));
        assert!(html.contains("data-sheet-id=\"sheet-0\""));
        assert!(html.contains("Summary &amp; More"));
        assert!(html.contains("<th scope=\"col\">B</th>"));
        assert!(html.contains("<th scope=\"col\">C</th>"));
        assert!(!html.contains("This sheet is empty."));
        assert!(html.contains("Alpha &amp; Beta"));
        assert!(html.contains("Gamma"));
        assert!(html.contains("R2C2"));
        assert!(html.contains("<th scope=\"row\" class=\"spreadsheet-row-header\">2</th>"));
        assert!(html.contains("<th scope=\"row\" class=\"spreadsheet-row-header\">3</th>"));
    }

    #[test]
    fn preview_srcdoc_csp_meta_allows_inline_preview_assets() {
        let csp = preview_srcdoc_csp_meta();

        assert!(csp.contains("style-src 'unsafe-inline'"));
        assert!(csp.contains("script-src 'unsafe-inline'"));
        assert!(csp.contains("img-src 'self' data:"));
        assert!(csp.contains("media-src data:"));
    }

    #[test]
    fn decorate_pandoc_html_injects_preview_csp_meta() {
        let html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body><main>Preview</main></body></html>".to_string();

        let decorated = decorate_pandoc_html(html, "Preview");

        assert!(decorated.contains("http-equiv=\"Content-Security-Policy\""));
        assert!(decorated.contains("style-src 'unsafe-inline'"));
        assert!(decorated.contains("script-src 'unsafe-inline'"));
        assert!(decorated.contains("<meta name=\"color-scheme\" content=\"light dark\">"));
        assert!(decorated.contains("<title>Preview</title>"));
    }

    #[test]
    fn decorate_pandoc_html_handles_body_attributes() {
        let html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body class=\"doc\" data-kind=\"pandoc\"><main>Preview</main></body></html>".to_string();

        let decorated = decorate_pandoc_html(html, "Preview");

        assert!(decorated.contains("<body class=\"doc\" data-kind=\"pandoc\"><div class=\"pandoc-preview-shell\"><article class=\"pandoc-preview\">"));
        assert!(decorated.contains("<main>Preview</main>"));
        assert!(decorated.contains("</article></div></body>"));
    }

    #[test]
    fn decorate_spreadsheet_preview_html_injects_preview_csp_meta() {
        let html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body><main data-spreadsheet-preview>Preview</main></body></html>".to_string();

        let decorated = decorate_spreadsheet_preview_html(html, "Spreadsheet preview");

        assert!(decorated.contains("http-equiv=\"Content-Security-Policy\""));
        assert!(decorated.contains("style-src 'unsafe-inline'"));
        assert!(decorated.contains("script-src 'unsafe-inline'"));
        assert!(decorated.contains("<title>Spreadsheet preview</title>"));
    }

    #[test]
    fn unwrap_pandoc_list_blockquotes_removes_list_quote_wrappers() {
        let html = "<ul><li><blockquote><p>Mode: challenge</p></blockquote></li><li><blockquote><p><strong>Rounds</strong>: 2</p></blockquote></li></ul>";

        let normalized = unwrap_pandoc_list_blockquotes(html.to_string());

        assert_eq!(
            normalized,
            "<ul><li><p>Mode: challenge</p></li><li><p><strong>Rounds</strong>: 2</p></li></ul>"
        );
        assert!(!normalized.contains("<blockquote>"));
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
    fn is_text_file_detects_text_and_binary_samples() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let text_path = dir.join("script.ts");
        let binary_path = dir.join("image.png");
        fs::write(&text_path, "const value = 1;\n").expect("write text");
        fs::write(&binary_path, [0, 159, 146, 150]).expect("write binary");

        assert!(is_text_file(text_path.to_string_lossy().to_string()).expect("text"));
        assert!(!is_text_file(binary_path.to_string_lossy().to_string()).expect("binary"));
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
    fn create_extracted_note_writes_content_next_to_source() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let source = dir.join("source.md");
        fs::write(&source, "source").expect("write source");

        let created = create_extracted_note(
            source.to_string_lossy().to_string(),
            "## Heading\n\nAlpha".to_string(),
        )
        .expect("create extracted note");

        assert_eq!(created.link_target, "Heading");
        let created_path = PathBuf::from(created.path);
        let created_path_string = created_path.to_string_lossy().to_string();
        let canonical_dir = fs::canonicalize(&dir).expect("canonicalize dir");
        assert_eq!(created_path.parent(), Some(canonical_dir.as_path()));
        assert_eq!(
            read_text_file(created_path_string.clone()).expect("read created"),
            "## Heading\n\nAlpha"
        );
        assert!(recent_internal_write_for(&created_path_string).is_some());
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn create_extracted_note_renames_on_conflict() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let source = dir.join("source.md");
        fs::write(&source, "source").expect("write source");
        fs::write(dir.join("Alpha.md"), "existing").expect("write existing");

        let created = create_extracted_note(source.to_string_lossy().to_string(), "Alpha".to_string())
            .expect("create extracted note");

        assert!(created.path.ends_with("Alpha (1).md"));
        assert_eq!(created.link_target, "Alpha (1)");
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn create_extracted_note_rejects_non_markdown_sources() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let source = dir.join("source.txt");
        fs::write(&source, "source").expect("write source");

        let result = create_extracted_note(source.to_string_lossy().to_string(), "Alpha".to_string());

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
    fn read_pdf_data_url_returns_a_browser_safe_data_uri() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let source = dir.join("report.pdf");
        fs::write(&source, b"%PDF-1.4 test").expect("write pdf");

        let data_url = read_pdf_data_url(source.to_string_lossy().to_string()).expect("read pdf data url");

        assert!(data_url.starts_with("data:application/pdf;base64,"));
        assert!(data_url.contains("JVBERi0xLjQgdGVzdA"));
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn read_pdf_data_url_rejects_path_outside_workspace() {
        let workspace = make_temp_dir();
        let _guard = activate_workspace(&workspace);

        let outside_dir = make_temp_dir();
        let outside = outside_dir.join("outside.pdf");
        fs::write(&outside, b"%PDF-1.4 test").expect("write outside");

        let result = read_pdf_data_url(outside.to_string_lossy().to_string());
        assert!(result.is_err());

        fs::remove_file(outside).expect("cleanup outside file");
        fs::remove_dir_all(outside_dir).expect("cleanup outside dir");
        fs::remove_dir_all(workspace).expect("cleanup workspace");
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
