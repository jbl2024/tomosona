//! Filesystem validation and normalization helpers for Second Brain workflows.
//!
//! This module owns all path-sensitive rules so message/pulse/draft flows can stay
//! focused on their business logic instead of repeating workspace boundary checks.

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use super::super::{active_workspace_root, normalize_workspace_relative_path, AppError, Result};

/// Normalizes an absolute markdown note path to a workspace-relative path accepted by Second Brain.
pub(super) fn normalize_markdown_path(path: &str) -> Result<String> {
    let root = active_workspace_root()?;
    let candidate = PathBuf::from(path);
    if !candidate.exists() || !candidate.is_file() {
        return Err(AppError::InvalidPath);
    }
    let canonical = fs::canonicalize(candidate)?;
    ensure_markdown_under_root(&root, &canonical, "Only markdown notes can be used in Second Brain context.")
}

/// Normalizes a workspace note target and rejects non-markdown destinations.
pub(super) fn normalize_workspace_markdown_relative(path: &str) -> Result<String> {
    let root = active_workspace_root()?;
    let candidate = PathBuf::from(path);
    if !candidate.exists() || !candidate.is_file() {
        return Err(AppError::InvalidPath);
    }
    let canonical = fs::canonicalize(candidate)?;
    ensure_markdown_under_root(&root, &canonical, "Target note must be markdown.")
}

/// Sanitizes user-facing filenames before writing a published draft to disk.
pub(super) fn sanitize_file_name(file_name: &str) -> String {
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

/// Ensures a canonicalized target remains inside the active workspace root.
pub(super) fn ensure_within(root: &Path, path: &Path) -> Result<()> {
    let canonical_root = fs::canonicalize(root)?;
    let canonical_path = fs::canonicalize(path)?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err(AppError::InvalidPath);
    }
    Ok(())
}

/// Returns a local-date-like string for frontmatter without adding a chrono dependency.
pub(super) fn chrono_like_today() -> String {
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

fn ensure_markdown_under_root(root: &Path, canonical: &Path, error_message: &str) -> Result<String> {
    if !canonical.starts_with(root) {
        return Err(AppError::InvalidPath);
    }
    let ext_ok = canonical
        .extension()
        .and_then(|item| item.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false);
    if !ext_ok {
        return Err(AppError::InvalidOperation(error_message.to_string()));
    }
    normalize_workspace_relative_path(root, canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_temp_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "tomosona-second-brain-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&path).expect("temp dir");
        path
    }

    #[test]
    fn sanitizes_filename_and_adds_md() {
        assert_eq!(sanitize_file_name("hello"), "hello.md");
        assert_eq!(sanitize_file_name("a:b"), "a-b.md");
    }

    #[test]
    fn ensure_within_rejects_path_outside_root() {
        let root = make_temp_dir("root");
        let outside = make_temp_dir("outside");
        assert!(ensure_within(&root, &outside).is_err());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn today_format_has_iso_shape() {
        let value = chrono_like_today();
        assert_eq!(value.len(), 10);
        assert_eq!(&value[4..5], "-");
        assert_eq!(&value[7..8], "-");
    }
}
