//! Read-only planning and revalidation for workspace file operations.
//!
//! These checks are advisory; the eventual filesystem mutation must revalidate
//! its own inputs because permissions and files may change after planning.
use crate::fs_ops::{
    ensure_within_root, normalize_existing_dir, validate_name, INTERNAL_DIR_NAME, TRASH_DIR_NAME,
};
use crate::{active_workspace_root, AppError, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

/// An advisory mutation check; the actual operation must revalidate its inputs.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MovePreflightIssue {
    InvalidSource,
    InvalidName,
    Unavailable,
    StaleSource,
    WorkspaceRoot,
    Symlink,
    ReadOnly,
    Descendant,
    SameLocation,
    Collision,
}

/// Metadata captured during preflight for later stale-state checks.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePreflightVersion {
    size: u64,
    modified_ms: Option<u64>,
    is_dir: bool,
}

/// A source and optional destination checked against the current filesystem snapshot.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePreflightEntry {
    source_path: String,
    destination_path: Option<String>,
    source_version: Option<MovePreflightVersion>,
    issue: Option<MovePreflightIssue>,
}

fn inspect_source(
    root: &Path,
    source_path: &str,
) -> std::result::Result<(PathBuf, fs::Metadata), MovePreflightIssue> {
    let raw = PathBuf::from(source_path);
    if !raw.is_absolute()
        || !raw.starts_with(root)
        || raw
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(MovePreflightIssue::InvalidSource);
    }
    let metadata = fs::symlink_metadata(&raw).map_err(|_| MovePreflightIssue::InvalidSource)?;
    if metadata.file_type().is_symlink() {
        return Err(MovePreflightIssue::Symlink);
    }
    let source = fs::canonicalize(&raw).map_err(|_| MovePreflightIssue::InvalidSource)?;
    if !source.starts_with(root)
        || source.starts_with(root.join(INTERNAL_DIR_NAME))
        || source.starts_with(root.join(TRASH_DIR_NAME))
    {
        return Err(MovePreflightIssue::InvalidSource);
    }
    if source == root {
        return Err(MovePreflightIssue::WorkspaceRoot);
    }
    let parent = source.parent().ok_or(MovePreflightIssue::InvalidSource)?;
    if fs::metadata(parent)
        .map_err(|_| MovePreflightIssue::InvalidSource)?
        .permissions()
        .readonly()
    {
        return Err(MovePreflightIssue::ReadOnly);
    }
    Ok((source, metadata))
}

fn destination_issue(path: &Path) -> Option<MovePreflightIssue> {
    match fs::symlink_metadata(path) {
        Ok(_) => Some(MovePreflightIssue::Collision),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => Some(MovePreflightIssue::Unavailable),
    }
}

fn source_version(metadata: &fs::Metadata) -> MovePreflightVersion {
    MovePreflightVersion {
        size: metadata.len(),
        modified_ms: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .and_then(|duration| u64::try_from(duration.as_millis()).ok()),
        is_dir: metadata.is_dir(),
    }
}

fn entry(source_path: String) -> MovePreflightEntry {
    MovePreflightEntry {
        source_path,
        destination_path: None,
        source_version: None,
        issue: None,
    }
}

/// Checks proposed moves without modifying files. Permissions are advisory:
/// filesystem ACLs and concurrent changes can still cause a later move to fail.
#[tauri::command]
pub fn preflight_move_entries(
    source_paths: Vec<String>,
    target_dir_path: String,
) -> Result<Vec<MovePreflightEntry>> {
    let root = fs::canonicalize(active_workspace_root()?)?;
    let target = normalize_existing_dir(&target_dir_path)?;
    ensure_within_root(&root, &target)?;
    let target_meta = fs::symlink_metadata(&target)?;
    if target_meta.file_type().is_symlink() {
        return Err(AppError::InvalidOperation(
            "Destination cannot be a symbolic link.".into(),
        ));
    }
    let target = fs::canonicalize(target)?;
    if target.starts_with(root.join(INTERNAL_DIR_NAME))
        || target.starts_with(root.join(TRASH_DIR_NAME))
    {
        return Err(AppError::InvalidOperation(
            "Destination is not available.".into(),
        ));
    }
    let target_read_only = fs::metadata(&target)?.permissions().readonly();
    let mut destinations = std::collections::HashSet::new();
    Ok(source_paths
        .into_iter()
        .map(|source_path| {
            let mut item = entry(source_path.clone());
            let check =
                || -> std::result::Result<(PathBuf, PathBuf, fs::Metadata), MovePreflightIssue> {
                    let (source, metadata) = inspect_source(&root, &source_path)?;
                    if target_read_only {
                        return Err(MovePreflightIssue::ReadOnly);
                    }
                    if metadata.is_dir() && target.starts_with(&source) {
                        return Err(MovePreflightIssue::Descendant);
                    }
                    let name = source
                        .file_name()
                        .ok_or(MovePreflightIssue::InvalidSource)?;
                    let destination = target.join(name);
                    if source == destination {
                        return Err(MovePreflightIssue::SameLocation);
                    }
                    Ok((source, destination, metadata))
                };
            match check() {
                Ok((source, destination, metadata)) => {
                    item.source_version = Some(source_version(&metadata));
                    item.source_path = source.to_string_lossy().into_owned();
                    item.destination_path = Some(destination.to_string_lossy().into_owned());
                    item.issue = if !destinations.insert(destination.clone()) {
                        Some(MovePreflightIssue::Collision)
                    } else {
                        destination_issue(&destination)
                    };
                }
                Err(issue) => item.issue = Some(issue),
            }
            item
        })
        .collect())
}

/// Checks an inline rename without changing files or resolving conflicts.
#[tauri::command]
pub fn preflight_rename_entry(source_path: String, new_name: String) -> Result<MovePreflightEntry> {
    let root = fs::canonicalize(active_workspace_root()?)?;
    let mut item = entry(source_path.clone());
    let (source, metadata) = match inspect_source(&root, &source_path) {
        Ok(value) => value,
        Err(issue) => {
            item.issue = Some(issue);
            return Ok(item);
        }
    };
    let name = match validate_name(&new_name) {
        Ok(name) => name,
        Err(_) => {
            item.issue = Some(MovePreflightIssue::InvalidName);
            return Ok(item);
        }
    };
    let destination = source.parent().ok_or(AppError::InvalidPath)?.join(name);
    item.source_path = source.to_string_lossy().into_owned();
    item.source_version = Some(source_version(&metadata));
    item.destination_path = Some(destination.to_string_lossy().into_owned());
    item.issue = if source == destination {
        Some(MovePreflightIssue::SameLocation)
    } else {
        destination_issue(&destination)
    };
    Ok(item)
}

/// Checks trash eligibility without creating the trash or modifying entries.
#[tauri::command]
pub fn preflight_trash_entries(source_paths: Vec<String>) -> Result<Vec<MovePreflightEntry>> {
    let root = fs::canonicalize(active_workspace_root()?)?;
    let trash = root.join(TRASH_DIR_NAME);
    let parent = match fs::symlink_metadata(&trash) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(AppError::InvalidOperation("Trash is not available.".into()));
        }
        Ok(_) => {
            ensure_within_root(&root, &trash)?;
            trash
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => root.clone(),
        Err(_) => return Err(AppError::OperationFailed),
    };
    let read_only = fs::metadata(parent)?.permissions().readonly();
    Ok(source_paths
        .into_iter()
        .map(|source_path| {
            let mut item = entry(source_path.clone());
            match inspect_source(&root, &source_path) {
                Ok((source, metadata)) => {
                    item.source_path = source.to_string_lossy().into_owned();
                    item.source_version = Some(source_version(&metadata));
                    if read_only {
                        item.issue = Some(MovePreflightIssue::ReadOnly);
                    }
                }
                Err(issue) => item.issue = Some(issue),
            }
            item
        })
        .collect())
}

/// Rechecks a proposed move and detects changes to its advisory source metadata.
/// The eventual mutation must still validate at the point of filesystem access.
#[tauri::command]
pub fn revalidate_move_entry(
    source_path: String,
    target_dir_path: String,
    expected_version: MovePreflightVersion,
) -> Result<MovePreflightEntry> {
    let mut item = preflight_move_entries(vec![source_path], target_dir_path)?
        .into_iter()
        .next()
        .ok_or(AppError::OperationFailed)?;
    if item
        .source_version
        .as_ref()
        .is_some_and(|current| *current != expected_version)
    {
        item.issue = Some(MovePreflightIssue::StaleSource);
    }
    Ok(item)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn make_temp_dir() -> PathBuf {
        static NEXT_ID: AtomicU64 = AtomicU64::new(0);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("tomosona-move-preflight-{timestamp}-{id}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn activate_workspace(root: &Path) -> std::sync::MutexGuard<'static, ()> {
        let guard = crate::workspace_test_guard();
        crate::set_active_workspace(&root.to_string_lossy()).unwrap();
        guard
    }

    #[test]
    fn rename_preflight_reports_invalid_names_collisions_and_stale_sources() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = fs::canonicalize(&dir).unwrap();
        let source = root.join("old.md");
        fs::write(&source, "old").unwrap();
        fs::write(root.join("taken.md"), "keep").unwrap();
        let path = source.to_string_lossy().into_owned();
        let ready = preflight_rename_entry(path.clone(), "new.md".into()).unwrap();
        assert_eq!(ready.issue, None);
        assert_eq!(
            ready.destination_path.as_deref(),
            root.join("new.md").to_str()
        );
        assert_eq!(ready.source_version.unwrap().size, 3);
        assert_eq!(
            preflight_rename_entry(path.clone(), "taken.md".into())
                .unwrap()
                .issue,
            Some(MovePreflightIssue::Collision)
        );
        assert_eq!(
            preflight_rename_entry(path.clone(), "../bad".into())
                .unwrap()
                .issue,
            Some(MovePreflightIssue::InvalidName)
        );
        assert_eq!(
            preflight_rename_entry(path.clone(), "old.md".into())
                .unwrap()
                .issue,
            Some(MovePreflightIssue::SameLocation)
        );
        fs::remove_file(&source).unwrap();
        assert_eq!(
            preflight_rename_entry(path, "new.md".into()).unwrap().issue,
            Some(MovePreflightIssue::InvalidSource)
        );
        assert_eq!(fs::read_to_string(root.join("taken.md")).unwrap(), "keep");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn trash_preflight_checks_entries_without_creating_trash() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = fs::canonicalize(&dir).unwrap();
        let source = root.join("note.md");
        fs::write(&source, "content").unwrap();
        let result = preflight_trash_entries(vec![
            source.to_string_lossy().into_owned(),
            root.to_string_lossy().into_owned(),
        ])
        .unwrap();
        assert_eq!(result[0].issue, None);
        assert_eq!(result[0].source_version.as_ref().unwrap().size, 7);
        assert!(result[0].destination_path.is_none());
        assert_eq!(result[1].issue, Some(MovePreflightIssue::WorkspaceRoot));
        assert!(!root.join(TRASH_DIR_NAME).exists());
        assert_eq!(fs::read_to_string(&source).unwrap(), "content");
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn trash_preflight_rejects_a_symlinked_trash_directory() {
        use std::os::unix::fs::symlink;
        let dir = make_temp_dir();
        let outside = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = fs::canonicalize(&dir).unwrap();
        symlink(&outside, root.join(TRASH_DIR_NAME)).unwrap();
        assert!(preflight_trash_entries(vec![]).is_err());
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn move_preflight_reports_conflicts_and_invalid_sources_without_modifying_files() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = fs::canonicalize(&dir).unwrap();
        let source_dir = root.join("source");
        let target = root.join("target");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&target).unwrap();
        let first = source_dir.join("first.md");
        let occupied = source_dir.join("occupied.md");
        fs::write(&first, "first").unwrap();
        fs::write(&occupied, "source").unwrap();
        fs::write(target.join("occupied.md"), "destination").unwrap();
        let outside = make_temp_dir();
        let external = outside.join("outside.md");
        fs::write(&external, "external").unwrap();
        let inputs = [
            &first,
            &occupied,
            &source_dir.join("missing.md"),
            &external,
            &root,
        ]
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
        let result = preflight_move_entries(inputs, target.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.len(), 5);
        assert_eq!(result[0].issue, None);
        assert_eq!(result[0].source_version.as_ref().unwrap().size, 5);
        assert!(!result[0].source_version.as_ref().unwrap().is_dir);
        let json = serde_json::to_value(&result[0]).unwrap();
        assert_eq!(json["sourceVersion"]["size"], 5);
        assert_eq!(json["sourceVersion"]["isDir"], false);
        assert!(json["destinationPath"].is_string());
        assert_eq!(
            serde_json::to_value(&result[1]).unwrap()["issue"],
            "collision"
        );
        assert_eq!(
            result[0].destination_path.as_deref(),
            Some(target.join("first.md").to_str().unwrap())
        );
        assert_eq!(result[1].issue, Some(MovePreflightIssue::Collision));
        assert_eq!(result[2].issue, Some(MovePreflightIssue::InvalidSource));
        assert_eq!(result[3].issue, Some(MovePreflightIssue::InvalidSource));
        assert_eq!(result[4].issue, Some(MovePreflightIssue::WorkspaceRoot));
        assert_eq!(fs::read_to_string(first).unwrap(), "first");
        assert_eq!(
            fs::read_to_string(target.join("occupied.md")).unwrap(),
            "destination"
        );
        assert!(preflight_move_entries(vec![], outside.to_string_lossy().into_owned()).is_err());
        let internal = root.join(".tomosona");
        fs::create_dir_all(&internal).unwrap();
        let hidden = internal.join("private.md");
        fs::write(&hidden, "private").unwrap();
        let hidden_result = preflight_move_entries(
            vec![hidden.to_string_lossy().into_owned()],
            target.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_eq!(
            hidden_result[0].issue,
            Some(MovePreflightIssue::InvalidSource)
        );
        assert!(preflight_move_entries(vec![], internal.to_string_lossy().into_owned()).is_err());
        fs::remove_dir_all(outside).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn move_preflight_detects_a_source_changed_after_planning() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = fs::canonicalize(&dir).unwrap();
        let source = root.join("note.md");
        let target = root.join("target");
        fs::create_dir_all(&target).unwrap();
        fs::write(&source, "original").unwrap();
        let source_path = source.to_string_lossy().into_owned();
        let target_path = target.to_string_lossy().into_owned();
        let plan = preflight_move_entries(vec![source_path.clone()], target_path.clone()).unwrap();
        let version = plan.into_iter().next().unwrap().source_version.unwrap();
        let unchanged =
            revalidate_move_entry(source_path.clone(), target_path.clone(), version.clone())
                .unwrap();
        assert_eq!(unchanged.issue, None);
        fs::write(&source, "changed content").unwrap();
        let result = revalidate_move_entry(source_path, target_path, version).unwrap();
        assert_eq!(result.issue, Some(MovePreflightIssue::StaleSource));
        assert_eq!(fs::read_to_string(source).unwrap(), "changed content");
        assert!(!target.join("note.md").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn move_preflight_rejects_descendants_same_location_and_group_collisions() {
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = fs::canonicalize(&dir).unwrap();
        let folder = root.join("folder");
        let target = root.join("target");
        let second = root.join("second");
        fs::create_dir_all(folder.join("child")).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(&second).unwrap();
        let descendant = preflight_move_entries(
            vec![folder.to_string_lossy().into_owned()],
            folder.join("child").to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_eq!(descendant[0].issue, Some(MovePreflightIssue::Descendant));
        let same = preflight_move_entries(
            vec![folder.to_string_lossy().into_owned()],
            root.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_eq!(same[0].issue, Some(MovePreflightIssue::SameLocation));
        fs::write(folder.join("same.md"), "a").unwrap();
        fs::write(second.join("same.md"), "b").unwrap();
        let result = preflight_move_entries(
            vec![
                folder.join("same.md").to_string_lossy().into_owned(),
                second.join("same.md").to_string_lossy().into_owned(),
            ],
            target.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_eq!(result[0].issue, None);
        assert_eq!(result[1].issue, Some(MovePreflightIssue::Collision));
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn move_preflight_rejects_symlinks_and_read_only_folders() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = make_temp_dir();
        let _guard = activate_workspace(&dir);
        let root = fs::canonicalize(&dir).unwrap();
        let target = root.join("target");
        fs::create_dir_all(&target).unwrap();
        let source = root.join("note.md");
        fs::write(&source, "data").unwrap();
        let link = root.join("link.md");
        symlink(&source, &link).unwrap();
        let result = preflight_move_entries(
            vec![link.to_string_lossy().into_owned()],
            target.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_eq!(result[0].issue, Some(MovePreflightIssue::Symlink));
        let target_link = root.join("target-link");
        symlink(&target, &target_link).unwrap();
        assert!(preflight_move_entries(
            vec![source.to_string_lossy().into_owned()],
            target_link.to_string_lossy().into_owned()
        )
        .is_err());
        fs::set_permissions(&target, fs::Permissions::from_mode(0o555)).unwrap();
        let result = preflight_move_entries(
            vec![source.to_string_lossy().into_owned()],
            target.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_eq!(result[0].issue, Some(MovePreflightIssue::ReadOnly));
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o555)).unwrap();
        assert_eq!(
            preflight_rename_entry(source.to_string_lossy().into_owned(), "renamed.md".into())
                .unwrap()
                .issue,
            Some(MovePreflightIssue::ReadOnly)
        );
        let trash_result =
            preflight_trash_entries(vec![source.to_string_lossy().into_owned()]).unwrap();
        assert_eq!(trash_result[0].issue, Some(MovePreflightIssue::ReadOnly));
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
}
