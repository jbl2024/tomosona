use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::{
    active_workspace_root, normalize_workspace_path, normalize_workspace_relative_from_input,
    normalize_workspace_relative_path, now_ms, AppError, Result,
};

const INTERNAL_DIR_NAME: &str = ".tomosona";
const FAVORITES_FILE_NAME: &str = "favorites.json";
const FAVORITES_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize)]
pub struct FavoriteEntry {
    pub path: String,
    pub added_at_ms: u64,
    pub exists: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct FavoriteStoredItem {
    path: String,
    added_at_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct FavoritesFile {
    version: u8,
    items: Vec<FavoriteStoredItem>,
}

fn favorites_dir(root: &Path) -> Result<PathBuf> {
    let dir = root.join(INTERNAL_DIR_NAME);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn favorites_file_path(root: &Path) -> Result<PathBuf> {
    Ok(favorites_dir(root)?.join(FAVORITES_FILE_NAME))
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false)
}

fn normalize_relative_components(path: &str) -> Option<String> {
    let mut normalized = path.trim().replace('\\', "/");
    while normalized.starts_with("./") {
        normalized = normalized[2..].to_string();
    }
    normalized = normalized.trim_matches('/').to_string();
    if normalized.is_empty() {
        return None;
    }

    let candidate = Path::new(&normalized);
    let mut parts: Vec<String> = Vec::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

fn normalize_stored_path(root: &Path, raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let candidate = PathBuf::from(trimmed);
    if candidate.is_absolute() {
        return candidate
            .strip_prefix(root)
            .ok()
            .and_then(|relative| normalize_relative_components(&relative.to_string_lossy()));
    }

    normalize_relative_components(trimmed)
}

fn read_stored_items(root: &Path) -> Result<Vec<FavoriteStoredItem>> {
    let path = favorites_file_path(root)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(path)?;
    let parsed: FavoritesFile = serde_json::from_str(&raw)
        .map_err(|_| AppError::InvalidOperation("Favorites file is invalid.".to_string()))?;

    if parsed.version != FAVORITES_VERSION {
        return Err(AppError::InvalidOperation(
            "Favorites file version is not supported.".to_string(),
        ));
    }

    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for item in parsed.items {
        let Some(path) = normalize_stored_path(root, &item.path) else {
            continue;
        };
        let key = path.to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        items.push(FavoriteStoredItem {
            path,
            added_at_ms: item.added_at_ms,
        });
    }

    Ok(items)
}

fn write_stored_items(root: &Path, items: &[FavoriteStoredItem]) -> Result<()> {
    let path = favorites_file_path(root)?;
    let payload = FavoritesFile {
        version: FAVORITES_VERSION,
        items: items.to_vec(),
    };
    let content = serde_json::to_string_pretty(&payload).map_err(|_| AppError::OperationFailed)?;
    fs::write(path, format!("{content}\n"))?;
    Ok(())
}

fn favorite_exists(root: &Path, relative_path: &str) -> bool {
    let absolute = root.join(relative_path);
    absolute.is_file() && is_markdown_file(&absolute)
}

fn validate_existing_markdown(root: &Path, raw_path: &str) -> Result<String> {
    let absolute = normalize_workspace_path(root, raw_path)?;
    if !absolute.is_file() || !is_markdown_file(&absolute) {
        return Err(AppError::InvalidOperation(
            "Only existing markdown notes can be added to favorites.".to_string(),
        ));
    }
    normalize_workspace_relative_path(root, &absolute)
}

fn list_favorites_inner() -> Result<Vec<FavoriteEntry>> {
    let root = active_workspace_root()?;
    let mut items = read_stored_items(&root)?;
    items.sort_by(|left, right| left.path.to_lowercase().cmp(&right.path.to_lowercase()).then(left.path.cmp(&right.path)));

    Ok(items
        .into_iter()
        .map(|item| FavoriteEntry {
            exists: favorite_exists(&root, &item.path),
            path: item.path,
            added_at_ms: item.added_at_ms,
        })
        .collect())
}

#[tauri::command]
pub fn list_favorites() -> Result<Vec<FavoriteEntry>> {
    list_favorites_inner()
}

#[tauri::command]
pub fn add_favorite(path: String) -> Result<FavoriteEntry> {
    let root = active_workspace_root()?;
    let normalized_path = validate_existing_markdown(&root, &path)?;
    let mut items = read_stored_items(&root)?;

    if let Some(existing) = items
        .iter()
        .find(|item| item.path.eq_ignore_ascii_case(&normalized_path))
    {
        return Ok(FavoriteEntry {
            path: existing.path.clone(),
            added_at_ms: existing.added_at_ms,
            exists: true,
        });
    }

    let entry = FavoriteStoredItem {
        path: normalized_path.clone(),
        added_at_ms: now_ms(),
    };
    items.push(entry.clone());
    write_stored_items(&root, &items)?;

    Ok(FavoriteEntry {
        path: entry.path,
        added_at_ms: entry.added_at_ms,
        exists: true,
    })
}

#[tauri::command]
pub fn remove_favorite(path: String) -> Result<()> {
    let root = active_workspace_root()?;
    let normalized_path = normalize_workspace_relative_from_input(&root, &path)
        .or_else(|_| {
            normalize_stored_path(&root, &path)
                .ok_or_else(|| AppError::InvalidOperation("Invalid favorite path.".to_string()))
        })?;
    let mut items = read_stored_items(&root)?;
    items.retain(|item| !item.path.eq_ignore_ascii_case(&normalized_path));
    write_stored_items(&root, &items)
}

#[tauri::command]
pub fn rename_favorite(old_path: String, new_path: String) -> Result<()> {
    let root = active_workspace_root()?;
    let old_relative = normalize_workspace_relative_from_input(&root, &old_path)
        .or_else(|_| {
            normalize_stored_path(&root, &old_path)
                .ok_or_else(|| AppError::InvalidOperation("Invalid favorite path.".to_string()))
        })?;
    let new_relative = validate_existing_markdown(&root, &new_path)?;
    let mut items = read_stored_items(&root)?;

    let Some(index) = items
        .iter()
        .position(|item| item.path.eq_ignore_ascii_case(&old_relative))
    else {
        return Ok(());
    };

    if let Some(existing_index) = items
        .iter()
        .position(|item| item.path.eq_ignore_ascii_case(&new_relative))
    {
        if existing_index != index {
            items.remove(index);
            write_stored_items(&root, &items)?;
            return Ok(());
        }
    }

    items[index].path = new_relative;
    write_stored_items(&root, &items)
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;
    use crate::{clear_active_workspace, set_active_workspace, workspace_test_guard};

    fn create_temp_workspace(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("{prefix}-{nonce}"));
        fs::create_dir_all(&dir).expect("create temp workspace");
        dir
    }

    fn read_favorites_file(workspace: &Path) -> String {
        fs::read_to_string(workspace.join(".tomosona").join("favorites.json")).expect("read favorites")
    }

    #[test]
    fn list_favorites_returns_empty_when_file_absent() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-favorites-empty");
        set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");

        let items = list_favorites().expect("list favorites");
        assert!(items.is_empty());

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(workspace).expect("cleanup workspace");
    }

    #[test]
    fn add_and_remove_favorite_round_trip() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-favorites-roundtrip");
        let note = workspace.join("notes.md");
        fs::write(&note, "# Notes").expect("write note");
        set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");

        let added = add_favorite(note.to_string_lossy().to_string()).expect("add favorite");
        assert_eq!(added.path, "notes.md");
        assert!(added.exists);

        let listed = list_favorites().expect("list favorites");
        assert_eq!(listed.len(), 1);

        remove_favorite(note.to_string_lossy().to_string()).expect("remove favorite");
        assert!(list_favorites().expect("list after remove").is_empty());

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(workspace).expect("cleanup workspace");
    }

    #[test]
    fn add_favorite_rejects_non_markdown_files() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-favorites-non-markdown");
        let note = workspace.join("notes.txt");
        fs::write(&note, "text").expect("write note");
        set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");

        let result = add_favorite(note.to_string_lossy().to_string());
        assert!(result.is_err());

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(workspace).expect("cleanup workspace");
    }

    #[test]
    fn add_favorite_is_idempotent() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-favorites-idempotent");
        let note = workspace.join("notes.md");
        fs::write(&note, "# Notes").expect("write note");
        set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");

        let first = add_favorite(note.to_string_lossy().to_string()).expect("first add");
        let second = add_favorite(note.to_string_lossy().to_string()).expect("second add");
        assert_eq!(first.path, second.path);
        assert_eq!(first.added_at_ms, second.added_at_ms);
        assert_eq!(list_favorites().expect("list favorites").len(), 1);

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(workspace).expect("cleanup workspace");
    }

    #[test]
    fn list_favorites_marks_missing_entries() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-favorites-missing");
        fs::create_dir_all(workspace.join(".tomosona")).expect("create internal dir");
        fs::write(
            workspace.join(".tomosona").join("favorites.json"),
            r#"{"version":1,"items":[{"path":"ghost.md","added_at_ms":1}]}"#,
        )
        .expect("write favorites");
        set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");

        let items = list_favorites().expect("list favorites");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].path, "ghost.md");
        assert!(!items[0].exists);

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(workspace).expect("cleanup workspace");
    }

    #[test]
    fn remove_favorite_accepts_missing_entries() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-favorites-remove-missing");
        fs::create_dir_all(workspace.join(".tomosona")).expect("create internal dir");
        fs::write(
            workspace.join(".tomosona").join("favorites.json"),
            r#"{"version":1,"items":[{"path":"ghost.md","added_at_ms":1}]}"#,
        )
        .expect("write favorites");
        set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");

        remove_favorite("ghost.md".to_string()).expect("remove missing favorite");
        assert!(list_favorites().expect("list favorites").is_empty());

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(workspace).expect("cleanup workspace");
    }

    #[test]
    fn rename_favorite_preserves_added_at() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-favorites-rename");
        let old_note = workspace.join("old.md");
        let new_note = workspace.join("new.md");
        fs::write(&old_note, "# Old").expect("write old note");
        fs::write(&new_note, "# New").expect("write new note");
        set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");

        let added = add_favorite(old_note.to_string_lossy().to_string()).expect("add favorite");
        rename_favorite(
            old_note.to_string_lossy().to_string(),
            new_note.to_string_lossy().to_string(),
        )
        .expect("rename favorite");

        let items = list_favorites().expect("list favorites");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].path, "new.md");
        assert_eq!(items[0].added_at_ms, added.added_at_ms);

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(workspace).expect("cleanup workspace");
    }

    #[test]
    fn list_favorites_sorts_alphabetically_case_insensitive() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-favorites-sort");
        fs::create_dir_all(workspace.join(".tomosona")).expect("create internal dir");
        fs::write(
            workspace.join(".tomosona").join("favorites.json"),
            r#"{"version":1,"items":[{"path":"zeta.md","added_at_ms":2},{"path":"Alpha.md","added_at_ms":1}]}"#,
        )
        .expect("write favorites");
        fs::write(workspace.join("zeta.md"), "# Zeta").expect("write zeta");
        fs::write(workspace.join("Alpha.md"), "# Alpha").expect("write alpha");
        set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");

        let items = list_favorites().expect("list favorites");
        assert_eq!(items.iter().map(|item| item.path.as_str()).collect::<Vec<_>>(), vec!["Alpha.md", "zeta.md"]);

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(workspace).expect("cleanup workspace");
    }

    #[test]
    fn list_favorites_rejects_invalid_json() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-favorites-invalid");
        fs::create_dir_all(workspace.join(".tomosona")).expect("create internal dir");
        fs::write(workspace.join(".tomosona").join("favorites.json"), "{").expect("write favorites");
        set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");

        let result = list_favorites();
        assert!(result.is_err());

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(workspace).expect("cleanup workspace");
    }

    #[test]
    fn remove_favorite_rewrites_json_file() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-favorites-file");
        let note = workspace.join("notes.md");
        fs::write(&note, "# Notes").expect("write note");
        set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");

        add_favorite(note.to_string_lossy().to_string()).expect("add favorite");
        assert!(read_favorites_file(&workspace).contains("notes.md"));
        remove_favorite("notes.md".to_string()).expect("remove favorite");
        assert!(!read_favorites_file(&workspace).contains("notes.md"));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(workspace).expect("cleanup workspace");
    }
}
