use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::{
    event::{EventKind, ModifyKind, RenameMode},
    RecommendedWatcher, RecursiveMode,
};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{
    editor_sync::{
        recent_internal_write_for, same_version, version_from_path, FileVersion,
    },
    AppError, Result,
};

const INTERNAL_DIR_NAME: &str = ".tomosona";
const TRASH_DIR_NAME: &str = ".tomosona-trash";
const DB_FILE_NAME: &str = "tomosona.sqlite";
const GITIGNORE_FILE_NAME: &str = ".gitignore";
const TOMOSONA_IGNORE_FILE_NAME: &str = ".tomosonaignore";
const FS_EVENT_NAME: &str = "workspace://fs-changed";

fn log_editor_sync_watch(message: &str) {
    eprintln!("[editor-sync/watch] {message}");
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkspaceFsChangeKind {
    Created,
    Removed,
    Renamed,
    Modified,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct WorkspaceFsChange {
    pub kind: WorkspaceFsChangeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_dir: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<FileVersion>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct WorkspaceFsChangedPayload {
    pub session_id: u64,
    pub root: String,
    pub changes: Vec<WorkspaceFsChange>,
    pub ts_ms: u64,
}

#[derive(Debug)]
struct WorkspaceWatcherState {
    session_id: u64,
    root: Option<PathBuf>,
    watcher: Option<Debouncer<RecommendedWatcher, RecommendedCache>>,
    started_at_ms: u64,
}

impl Default for WorkspaceWatcherState {
    fn default() -> Self {
        Self {
            session_id: 0,
            root: None,
            watcher: None,
            started_at_ms: 0,
        }
    }
}

fn watcher_state() -> &'static Mutex<WorkspaceWatcherState> {
    static WATCHER_STATE: OnceLock<Mutex<WorkspaceWatcherState>> = OnceLock::new();
    WATCHER_STATE.get_or_init(|| Mutex::new(WorkspaceWatcherState::default()))
}

fn normalize_slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn root_contains_path(root: &str, path: &str) -> bool {
    path == root || path.starts_with(&format!("{root}/"))
}

fn path_parent(path: &str) -> Option<String> {
    path.rsplit_once('/').map(|(parent, _)| parent.to_string())
}

fn skip_file_name(file_name: &str) -> bool {
    file_name == DB_FILE_NAME
        || file_name.starts_with("tomosona.sqlite-")
        || (file_name.starts_with('.') && file_name != "." && file_name != "..")
}

fn should_skip_path(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };

    if skip_file_name(file_name) {
        return true;
    }

    path.components().any(|component| {
        let part = component.as_os_str().to_string_lossy();
        part == INTERNAL_DIR_NAME || part == TRASH_DIR_NAME
    })
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

fn is_ignored_by_matcher(
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

fn should_skip_event_path(
    root: &Path,
    matcher: Option<&Gitignore>,
    path: &Path,
    is_dir: bool,
) -> bool {
    should_skip_path(path) || is_ignored_by_matcher(root, matcher, path, is_dir)
}

fn normalize_event_path(raw: &Path, root_path: &Path, root_normalized: &str) -> Option<String> {
    let candidate = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        root_path.join(raw)
    };

    let normalized = normalize_slashes(&candidate);
    if !root_contains_path(root_normalized, &normalized) {
        return None;
    }
    Some(normalized)
}

fn maybe_is_dir(path: &Path) -> Option<bool> {
    if let Ok(meta) = fs::metadata(path) {
        return Some(meta.is_dir());
    }

    if path.extension().is_none() {
        Some(true)
    } else {
        None
    }
}

fn file_modified_at_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

fn should_skip_initial_modify_event(path: &Path, watcher_started_at_ms: Option<u64>) -> bool {
    let Some(started_at_ms) = watcher_started_at_ms else {
        return false;
    };
    let Some(modified_at_ms) = file_modified_at_ms(path) else {
        return false;
    };
    modified_at_ms.saturating_add(250) < started_at_ms
}

fn build_payload(
    session_id: u64,
    root_normalized: &str,
    changes: Vec<WorkspaceFsChange>,
) -> WorkspaceFsChangedPayload {
    let ts_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0);

    WorkspaceFsChangedPayload {
        session_id,
        root: root_normalized.to_string(),
        changes,
        ts_ms,
    }
}

fn emit_changes(
    app_handle: &AppHandle,
    session_id: u64,
    root_normalized: &str,
    changes: Vec<WorkspaceFsChange>,
) {
    if changes.is_empty() {
        return;
    }

    let payload = build_payload(session_id, root_normalized, changes);
    let _ = app_handle.emit(FS_EVENT_NAME, payload);
}

fn content_hash(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    Some(blake3::hash(&bytes).to_hex().to_string())
}

fn should_filter_internal_write(path: &Path, normalized: &str, version: Option<&FileVersion>) -> bool {
    let Some(record) = recent_internal_write_for(normalized) else {
        return false;
    };

    if same_version(version, Some(&record.resulting_version)) {
        log_editor_sync_watch(&format!(
            "suppress version_match path={} source={:?} request_id={} version={:?}",
            record.path, record.source, record.request_id, version
        ));
        return true;
    }

    let Some(current_hash) = content_hash(path) else {
        return false;
    };

    if current_hash == record.content_hash {
        log_editor_sync_watch(&format!(
            "suppress hash_match path={} source={:?} request_id={}",
            record.path, record.source, record.request_id
        ));
        return true;
    }

    log_editor_sync_watch(&format!(
        "keep path={} source={:?} request_id={} version={:?}",
        record.path, record.source, record.request_id, version
    ));
    false
}

fn should_filter_internal_remove(normalized: &str) -> bool {
    let Some(record) = recent_internal_write_for(normalized) else {
        return false;
    };

    let path = PathBuf::from(normalized);
    if path.exists() {
        log_editor_sync_watch(&format!(
            "suppress remove_existing_path path={} source={:?} request_id={}",
            record.path, record.source, record.request_id
        ));
        return true;
    }

    false
}

fn enrich_change_versions_and_filter_internal_writes(changes: Vec<WorkspaceFsChange>) -> Vec<WorkspaceFsChange> {
    let mut filtered = Vec::with_capacity(changes.len());

    for mut change in changes {
        let Some(path) = change.path.as_deref() else {
            filtered.push(change);
            continue;
        };

        let Some(is_dir) = change.is_dir else {
            filtered.push(change);
            continue;
        };

        if is_dir {
            filtered.push(change);
            continue;
        }

        let path_buf = PathBuf::from(path);
        if matches!(change.kind, WorkspaceFsChangeKind::Removed) {
            if should_filter_internal_remove(path) {
                continue;
            }
            filtered.push(change);
            continue;
        }

        if !path_buf.exists() {
            filtered.push(change);
            continue;
        }

        if matches!(change.kind, WorkspaceFsChangeKind::Created | WorkspaceFsChangeKind::Modified) {
            let version = version_from_path(&path_buf);
            if should_filter_internal_write(&path_buf, path, version.as_ref()) {
                continue;
            }
            change.version = version;
        }

        filtered.push(change);
    }

    filtered
}

fn handle_notify_event(
    app_handle: &AppHandle,
    session_id: u64,
    root_path: &Path,
    root_normalized: &str,
    matcher: Option<&Gitignore>,
    watcher_started_at_ms: Option<u64>,
    event: notify::Event,
) {
    let changes = map_notify_event_to_changes_with_options(
        root_path,
        root_normalized,
        matcher,
        watcher_started_at_ms,
        event,
    );
    if !changes.is_empty() {
        log_editor_sync_watch(&format!(
            "mapped session_id={session_id} changes={:?}",
            changes
        ));
    }
    let changes = enrich_change_versions_and_filter_internal_writes(changes);
    if !changes.is_empty() {
        log_editor_sync_watch(&format!(
            "emit session_id={session_id} changes={:?}",
            changes
        ));
    }
    emit_changes(app_handle, session_id, root_normalized, changes);
}

#[cfg(test)]
fn map_notify_event_to_changes(
    root_path: &Path,
    root_normalized: &str,
    matcher: Option<&Gitignore>,
    event: notify::Event,
) -> Vec<WorkspaceFsChange> {
    map_notify_event_to_changes_with_options(root_path, root_normalized, matcher, None, event)
}

fn map_notify_event_to_changes_with_options(
    root_path: &Path,
    root_normalized: &str,
    matcher: Option<&Gitignore>,
    watcher_started_at_ms: Option<u64>,
    event: notify::Event,
) -> Vec<WorkspaceFsChange> {
    let mut changes: Vec<WorkspaceFsChange> = Vec::new();

    match event.kind {
        EventKind::Create(_) => {
            for path in event.paths {
                if should_skip_event_path(
                    root_path,
                    matcher,
                    &path,
                    maybe_is_dir(&path).unwrap_or(false),
                ) {
                    continue;
                }
                let Some(normalized) = normalize_event_path(&path, root_path, root_normalized)
                else {
                    continue;
                };
                changes.push(WorkspaceFsChange {
                    kind: WorkspaceFsChangeKind::Created,
                    parent: path_parent(&normalized),
                    path: Some(normalized),
                    old_path: None,
                    new_path: None,
                    old_parent: None,
                    new_parent: None,
                    is_dir: maybe_is_dir(&path),
                    version: None,
                });
            }
        }
        EventKind::Remove(_) => {
            for path in event.paths {
                if should_skip_event_path(
                    root_path,
                    matcher,
                    &path,
                    maybe_is_dir(&path).unwrap_or(false),
                ) {
                    continue;
                }
                let Some(normalized) = normalize_event_path(&path, root_path, root_normalized)
                else {
                    continue;
                };
                changes.push(WorkspaceFsChange {
                    kind: WorkspaceFsChangeKind::Removed,
                    parent: path_parent(&normalized),
                    path: Some(normalized),
                    old_path: None,
                    new_path: None,
                    old_parent: None,
                    new_parent: None,
                    is_dir: maybe_is_dir(&path),
                    version: None,
                });
            }
        }
        EventKind::Modify(ModifyKind::Name(rename_mode)) => match rename_mode {
            RenameMode::Both if event.paths.len() >= 2 => {
                let old_raw = &event.paths[0];
                let new_raw = &event.paths[1];
                if should_skip_event_path(
                    root_path,
                    matcher,
                    old_raw,
                    maybe_is_dir(old_raw).unwrap_or(false),
                ) || should_skip_event_path(
                    root_path,
                    matcher,
                    new_raw,
                    maybe_is_dir(new_raw).unwrap_or(false),
                ) {
                    return Vec::new();
                }

                let Some(old_path) = normalize_event_path(old_raw, root_path, root_normalized)
                else {
                    return Vec::new();
                };
                let Some(new_path) = normalize_event_path(new_raw, root_path, root_normalized)
                else {
                    return Vec::new();
                };

                changes.push(WorkspaceFsChange {
                    kind: WorkspaceFsChangeKind::Renamed,
                    old_parent: path_parent(&old_path),
                    new_parent: path_parent(&new_path),
                    old_path: Some(old_path),
                    new_path: Some(new_path),
                    path: None,
                    parent: None,
                    is_dir: maybe_is_dir(new_raw).or_else(|| maybe_is_dir(old_raw)),
                    version: None,
                });
            }
            RenameMode::From => {
                for path in event.paths {
                    if should_skip_event_path(
                        root_path,
                        matcher,
                        &path,
                        maybe_is_dir(&path).unwrap_or(false),
                    ) {
                        continue;
                    }
                    let Some(normalized) = normalize_event_path(&path, root_path, root_normalized)
                    else {
                        continue;
                    };
                    changes.push(WorkspaceFsChange {
                        kind: WorkspaceFsChangeKind::Removed,
                        parent: path_parent(&normalized),
                        path: Some(normalized),
                        old_path: None,
                        new_path: None,
                        old_parent: None,
                        new_parent: None,
                        is_dir: maybe_is_dir(&path),
                        version: None,
                    });
                }
            }
            RenameMode::To => {
                for path in event.paths {
                    if should_skip_event_path(
                        root_path,
                        matcher,
                        &path,
                        maybe_is_dir(&path).unwrap_or(false),
                    ) {
                        continue;
                    }
                    let Some(normalized) = normalize_event_path(&path, root_path, root_normalized)
                    else {
                        continue;
                    };
                    changes.push(WorkspaceFsChange {
                        kind: WorkspaceFsChangeKind::Created,
                        parent: path_parent(&normalized),
                        path: Some(normalized),
                        old_path: None,
                        new_path: None,
                        old_parent: None,
                        new_parent: None,
                        is_dir: maybe_is_dir(&path),
                        version: None,
                    });
                }
            }
            _ => {}
        },
        EventKind::Modify(_) => {
            for path in event.paths {
                if should_skip_event_path(
                    root_path,
                    matcher,
                    &path,
                    maybe_is_dir(&path).unwrap_or(false),
                ) {
                    continue;
                }
                if should_skip_initial_modify_event(&path, watcher_started_at_ms) {
                    continue;
                }
                let Some(normalized) = normalize_event_path(&path, root_path, root_normalized)
                else {
                    continue;
                };
                changes.push(WorkspaceFsChange {
                    kind: WorkspaceFsChangeKind::Modified,
                    parent: path_parent(&normalized),
                    path: Some(normalized),
                    old_path: None,
                    new_path: None,
                    old_parent: None,
                    new_parent: None,
                    is_dir: maybe_is_dir(&path),
                    version: None,
                });
            }
        }
        _ => {}
    }

    changes
}

pub(crate) fn start_workspace_watcher(app_handle: AppHandle, root_path: PathBuf) -> Result<()> {
    let root_canonical = fs::canonicalize(&root_path)?;
    let root_normalized = normalize_slashes(&root_canonical);
    let started_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0);

    let mut state = watcher_state()
        .lock()
        .map_err(|_| AppError::OperationFailed)?;

    state.watcher = None;
    state.session_id = state.session_id.saturating_add(1);
    state.root = Some(root_canonical.clone());
    state.started_at_ms = started_at_ms;
    let session_id = state.session_id;

    let callback_app_handle = app_handle.clone();
    let callback_root = root_canonical.clone();
    let callback_root_normalized = root_normalized.clone();
    let callback_ignore_matcher = build_ignore_matcher(&root_canonical).map(Arc::new);

    let mut watcher = new_debouncer(
        Duration::from_millis(250),
        None,
        move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return;
            };

            let mut seen = HashSet::new();
            for debounced in events {
                let event = debounced.event;
                let signature = format!("{:?}-{:?}", event.kind, event.paths);
                if !seen.insert(signature) {
                    continue;
                }

                handle_notify_event(
                    &callback_app_handle,
                    session_id,
                    &callback_root,
                    &callback_root_normalized,
                    callback_ignore_matcher.as_deref(),
                    Some(started_at_ms),
                    event,
                );
            }
        },
    )
    .map_err(|err| AppError::InvalidOperation(format!("Could not start workspace watcher: {err}")))?;

    watcher
        .watch(&root_canonical, RecursiveMode::Recursive)
        .map_err(|err| AppError::InvalidOperation(format!("Could not watch workspace: {err}")))?;

    state.watcher = Some(watcher);
    Ok(())
}

pub(crate) fn stop_workspace_watcher() -> Result<()> {
    let mut state = watcher_state()
        .lock()
        .map_err(|_| AppError::OperationFailed)?;
    state.watcher = None;
    state.root = None;
    state.started_at_ms = 0;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};
    use notify::Event;

    use super::*;
    use crate::editor_sync::record_workspace_mutation_write;

    fn unique_test_dir() -> PathBuf {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("tomosona-watch-tests-{now}"))
    }

    fn mk_root() -> (PathBuf, String) {
        let root = unique_test_dir();
        fs::create_dir_all(&root).expect("create test root");
        let root_normalized = normalize_slashes(&root);
        (root, root_normalized)
    }

    fn test_event(kind: EventKind, paths: Vec<PathBuf>) -> Event {
        Event {
            kind,
            paths,
            attrs: Default::default(),
        }
    }

    #[test]
    fn root_contains_path_checks_boundary() {
        assert!(root_contains_path("/ws", "/ws"));
        assert!(root_contains_path("/ws", "/ws/a.md"));
        assert!(!root_contains_path("/ws", "/wsx/a.md"));
    }

    #[test]
    fn should_skip_path_skips_internal_dirs_and_db_files() {
        assert!(should_skip_path(Path::new("/ws/.tomosona/state.json")));
        assert!(should_skip_path(Path::new("/ws/.tomosona-trash/item.md")));
        assert!(should_skip_path(Path::new("/ws/tomosona.sqlite")));
        assert!(should_skip_path(Path::new("/ws/tomosona.sqlite-wal")));
        assert!(!should_skip_path(Path::new("/ws/notes/file.md")));
    }

    #[test]
    fn gitignore_rules_filter_watcher_events() {
        let (root, root_norm) = mk_root();
        fs::write(root.join(".gitignore"), "ignored.md\n").expect("write gitignore");
        let matcher = build_ignore_matcher(&root);
        let ignored = root.join("ignored.md");
        fs::write(&ignored, "x").expect("write ignored file");

        let changes = map_notify_event_to_changes(
            &root,
            &root_norm,
            matcher.as_ref(),
            test_event(EventKind::Create(CreateKind::Any), vec![ignored]),
        );

        assert!(changes.is_empty());
    }

    #[test]
    fn tomosonaignore_rules_filter_watcher_events() {
        let (root, root_norm) = mk_root();
        fs::write(root.join(".tomosonaignore"), "private/**\n").expect("write tomosonaignore");
        fs::create_dir_all(root.join("private")).expect("create private dir");
        let matcher = build_ignore_matcher(&root);
        let ignored = root.join("private/secret.md");
        fs::write(&ignored, "x").expect("write ignored file");

        let changes = map_notify_event_to_changes(
            &root,
            &root_norm,
            matcher.as_ref(),
            test_event(EventKind::Create(CreateKind::Any), vec![ignored]),
        );

        assert!(changes.is_empty());
    }

    #[test]
    fn hidden_files_filter_watcher_events() {
        let (root, root_norm) = mk_root();
        let hidden = root.join(".DS_Store");
        fs::write(&hidden, "x").expect("write hidden file");

        let changes = map_notify_event_to_changes_with_options(
            &root,
            &root_norm,
            None,
            None,
            test_event(EventKind::Modify(ModifyKind::Any), vec![hidden]),
        );

        assert!(changes.is_empty());
    }

    #[test]
    fn maps_create_event_for_absolute_path() {
        let (root, root_norm) = mk_root();
        let file = root.join("notes/new.md");
        fs::create_dir_all(file.parent().expect("parent")).expect("create parent");
        fs::write(&file, "hello").expect("create file");

        let changes = map_notify_event_to_changes(
            &root,
            &root_norm,
            None,
            test_event(EventKind::Create(CreateKind::Any), vec![file.clone()]),
        );

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, WorkspaceFsChangeKind::Created);
        assert_eq!(changes[0].path, Some(normalize_slashes(&file)));
        assert_eq!(
            changes[0].parent,
            Some(normalize_slashes(file.parent().expect("parent")))
        );
    }

    #[test]
    fn maps_create_event_for_relative_path() {
        let (root, root_norm) = mk_root();
        let relative = PathBuf::from("nested/file.md");
        let absolute = root.join(&relative);
        fs::create_dir_all(absolute.parent().expect("parent")).expect("create parent");
        fs::write(&absolute, "ok").expect("create file");

        let changes = map_notify_event_to_changes(
            &root,
            &root_norm,
            None,
            test_event(EventKind::Create(CreateKind::Any), vec![relative]),
        );

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, Some(normalize_slashes(&absolute)));
    }

    #[test]
    fn ignores_paths_outside_workspace_root() {
        let (root, root_norm) = mk_root();
        let external = PathBuf::from("/tmp/somewhere-else.md");
        let changes = map_notify_event_to_changes(
            &root,
            &root_norm,
            None,
            test_event(EventKind::Create(CreateKind::Any), vec![external]),
        );
        assert!(changes.is_empty());
    }

    #[test]
    fn maps_remove_event() {
        let (root, root_norm) = mk_root();
        let removed = root.join("gone.md");
        let changes = map_notify_event_to_changes(
            &root,
            &root_norm,
            None,
            test_event(EventKind::Remove(RemoveKind::Any), vec![removed.clone()]),
        );

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, WorkspaceFsChangeKind::Removed);
        assert_eq!(changes[0].path, Some(normalize_slashes(&removed)));
    }

    #[test]
    fn maps_rename_both_event() {
        let (root, root_norm) = mk_root();
        let old_path = root.join("old.md");
        let new_path = root.join("new.md");
        fs::write(&new_path, "renamed").expect("create renamed file");

        let changes = map_notify_event_to_changes(
            &root,
            &root_norm,
            None,
            test_event(
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                vec![old_path.clone(), new_path.clone()],
            ),
        );

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, WorkspaceFsChangeKind::Renamed);
        assert_eq!(changes[0].old_path, Some(normalize_slashes(&old_path)));
        assert_eq!(changes[0].new_path, Some(normalize_slashes(&new_path)));
        assert_eq!(changes[0].old_parent, Some(root_norm.clone()));
        assert_eq!(changes[0].new_parent, Some(root_norm));
    }

    #[test]
    fn maps_rename_from_event_as_removed() {
        let (root, root_norm) = mk_root();
        let old_path = root.join("old.md");
        let changes = map_notify_event_to_changes(
            &root,
            &root_norm,
            None,
            test_event(
                EventKind::Modify(ModifyKind::Name(RenameMode::From)),
                vec![old_path.clone()],
            ),
        );

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, WorkspaceFsChangeKind::Removed);
        assert_eq!(changes[0].path, Some(normalize_slashes(&old_path)));
    }

    #[test]
    fn maps_rename_to_event_as_created() {
        let (root, root_norm) = mk_root();
        let new_path = root.join("new.md");
        fs::write(&new_path, "created").expect("create file");
        let changes = map_notify_event_to_changes(
            &root,
            &root_norm,
            None,
            test_event(
                EventKind::Modify(ModifyKind::Name(RenameMode::To)),
                vec![new_path.clone()],
            ),
        );

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, WorkspaceFsChangeKind::Created);
        assert_eq!(changes[0].path, Some(normalize_slashes(&new_path)));
    }

    #[test]
    fn rename_both_returns_empty_when_path_is_skipped() {
        let (root, root_norm) = mk_root();
        let old_path = root.join(".tomosona/old.md");
        let new_path = root.join("new.md");
        let changes = map_notify_event_to_changes(
            &root,
            &root_norm,
            None,
            test_event(
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                vec![old_path, new_path],
            ),
        );
        assert!(changes.is_empty());
    }

    #[test]
    fn maps_non_name_modify_event() {
        let (root, root_norm) = mk_root();
        let file = root.join("notes/changed.md");
        fs::create_dir_all(file.parent().expect("parent")).expect("create parent");
        fs::write(&file, "updated").expect("create file");

        let changes = map_notify_event_to_changes(
            &root,
            &root_norm,
            None,
            test_event(EventKind::Modify(ModifyKind::Any), vec![file.clone()]),
        );

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, WorkspaceFsChangeKind::Modified);
        assert_eq!(changes[0].path, Some(normalize_slashes(&file)));
    }

    #[test]
    fn skips_startup_modify_event_for_older_file() {
        let (root, root_norm) = mk_root();
        let file = root.join("notes/stale.md");
        fs::create_dir_all(file.parent().expect("parent")).expect("create parent");
        fs::write(&file, "updated").expect("create file");
        let started_at_ms = file_modified_at_ms(&file).expect("modified time") + 5_000;

        let changes = map_notify_event_to_changes_with_options(
            &root,
            &root_norm,
            None,
            Some(started_at_ms),
            test_event(EventKind::Modify(ModifyKind::Any), vec![file]),
        );

        assert!(changes.is_empty());
    }

    #[test]
    fn filters_recent_workspace_mutation_modify_event() {
        let (root, root_norm) = mk_root();
        let file = root.join("notes/rewritten.md");
        fs::create_dir_all(file.parent().expect("parent")).expect("create parent");
        fs::write(&file, "rewritten").expect("write file");

        record_workspace_mutation_write(&file, "rewritten");

        let mapped = map_notify_event_to_changes(
            &root,
            &root_norm,
            None,
            test_event(EventKind::Modify(ModifyKind::Any), vec![file.clone()]),
        );
        let filtered = enrich_change_versions_and_filter_internal_writes(mapped);

        assert!(filtered.is_empty());
    }

    #[test]
    fn filters_repeated_modify_events_for_the_same_internal_write() {
        let (root, root_norm) = mk_root();
        let file = root.join("notes/repeated.md");
        fs::create_dir_all(file.parent().expect("parent")).expect("create parent");
        fs::write(&file, "saved").expect("write file");

        record_workspace_mutation_write(&file, "saved");

        let mapped_first = map_notify_event_to_changes(
            &root,
            &root_norm,
            None,
            test_event(EventKind::Modify(ModifyKind::Any), vec![file.clone()]),
        );
        let filtered_first = enrich_change_versions_and_filter_internal_writes(mapped_first);
        assert!(filtered_first.is_empty());

        let mapped_second = map_notify_event_to_changes(
            &root,
            &root_norm,
            None,
            test_event(EventKind::Modify(ModifyKind::Any), vec![file.clone()]),
        );
        let filtered_second = enrich_change_versions_and_filter_internal_writes(mapped_second);
        assert!(filtered_second.is_empty());
    }

    #[test]
    fn filters_remove_event_when_atomic_replace_has_already_recreated_the_file() {
        let (root, root_norm) = mk_root();
        let file = root.join("notes/atomic.md");
        fs::create_dir_all(file.parent().expect("parent")).expect("create parent");
        fs::write(&file, "saved").expect("write file");

        record_workspace_mutation_write(&file, "saved");

        let mapped = map_notify_event_to_changes(
            &root,
            &root_norm,
            None,
            test_event(EventKind::Remove(RemoveKind::Any), vec![file.clone()]),
        );
        let filtered = enrich_change_versions_and_filter_internal_writes(mapped);

        assert!(filtered.is_empty());
    }

    #[test]
    fn keeps_external_modify_event_when_not_recorded_as_internal() {
        let (root, root_norm) = mk_root();
        let file = root.join("notes/external.md");
        fs::create_dir_all(file.parent().expect("parent")).expect("create parent");
        fs::write(&file, "external").expect("write file");

        let mapped = map_notify_event_to_changes(
            &root,
            &root_norm,
            None,
            test_event(EventKind::Modify(ModifyKind::Any), vec![file.clone()]),
        );
        let filtered = enrich_change_versions_and_filter_internal_writes(mapped);

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].kind, WorkspaceFsChangeKind::Modified);
        assert_eq!(filtered[0].path, Some(normalize_slashes(&file)));
        assert_eq!(filtered[0].version, version_from_path(&file));
    }
}
