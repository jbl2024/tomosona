//! Workspace path normalization and wikilink rewrite helpers.

#[cfg(windows)]
use std::os::windows::fs::MetadataExt;
use std::{
    fs,
    path::{Path, PathBuf},
};

use unicode_normalization::UnicodeNormalization;

use crate::{AppError, Result, DB_FILE_NAME, INTERNAL_DIR_NAME, TRASH_DIR_NAME};

#[cfg(windows)]
const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;

pub(crate) fn normalize_existing_file(path: &str) -> Result<PathBuf> {
    let pb = PathBuf::from(path);
    if pb.as_os_str().is_empty() || !pb.is_file() {
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

pub(crate) fn strip_markdown_extension(path: &Path) -> PathBuf {
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

pub(crate) fn normalize_key_text(input: &str) -> String {
    input.to_lowercase().nfc().collect::<String>()
}

pub(crate) fn normalize_note_key(root: &Path, path: &Path) -> Result<String> {
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

pub(crate) fn normalize_workspace_relative_path(root: &Path, path: &Path) -> Result<String> {
    let relative = path.strip_prefix(root).map_err(|_| AppError::InvalidPath)?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

pub(crate) fn workspace_absolute_path(root: &Path, stored_path: &str) -> String {
    root.join(stored_path).to_string_lossy().to_string()
}

pub(crate) fn is_hidden_dir_name(name: &str) -> bool {
    name.starts_with('.') && name != "." && name != ".."
}

#[cfg(windows)]
pub(crate) fn is_windows_hidden(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0)
        .unwrap_or(false)
}

#[cfg(not(windows))]
pub(crate) fn is_windows_hidden(_path: &Path) -> bool {
    false
}

pub(crate) fn has_hidden_dir_component(root: &Path, path: &Path) -> bool {
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

pub(crate) fn note_label_from_workspace_path(path: &str) -> String {
    let without_md = path
        .strip_suffix(".md")
        .or_else(|| path.strip_suffix(".markdown"))
        .unwrap_or(path);
    without_md.replace('\\', "/")
}

pub(crate) fn normalize_note_key_from_workspace_path(root: &Path, stored_path: &str) -> Option<String> {
    normalize_note_key(root, &root.join(stored_path)).ok()
}

pub(crate) fn note_key_basename(key: &str) -> String {
    key.rsplit('/').next().unwrap_or(key).to_string()
}

pub(crate) fn note_link_target(root: &Path, path: &Path) -> Result<String> {
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

pub(crate) fn normalize_workspace_path(root: &Path, raw: &str) -> Result<PathBuf> {
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

pub(crate) fn normalize_workspace_relative_from_input(root: &Path, raw: &str) -> Result<String> {
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

pub(crate) fn split_wikilink_target_suffix(content: &str) -> (&str, &str) {
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

pub(crate) fn rewrite_wikilinks_for_note(
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

        let should_replace = crate::markdown_index::normalize_wikilink_target(target_part)
            .is_some_and(|key| key == old_target_key);

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

pub(crate) fn should_skip_workspace_walk_file(path: &Path) -> bool {
    let name = path.file_name().and_then(|v| v.to_str()).unwrap_or_default();
    name == DB_FILE_NAME || name.starts_with("tomosona.sqlite-")
}

pub(crate) fn should_skip_workspace_walk_dir(name: &str, path: &Path) -> bool {
    name == INTERNAL_DIR_NAME
        || name == TRASH_DIR_NAME
        || is_hidden_dir_name(name)
        || is_windows_hidden(path)
}
