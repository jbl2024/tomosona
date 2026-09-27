//! Local note-history storage for saved Markdown snapshots.
//!
//! This module keeps the storage model intentionally small:
//! - snapshots are recorded after successful saves;
//! - history is keyed by workspace note path;
//! - restore and move operations are explicit and local.

use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use atomicwrites::{AllowOverwrite, AtomicFile};
use serde::{Deserialize, Serialize};

use crate::{
    active_workspace_root,
    editor_sync::{record_internal_write, version_from_path, SaveNoteResult, SaveNoteSuccess},
    fs_ops::normalize_path,
    now_ms, AppError, Result,
};

const INTERNAL_DIR_NAME: &str = ".tomosona";
const HISTORY_DIR_NAME: &str = "note-history";
const HISTORY_MANIFEST_FILE_NAME: &str = "manifest.json";
const HISTORY_SNAPSHOTS_DIR_NAME: &str = "snapshots";
const HISTORY_MANIFEST_VERSION: u8 = 1;
const HISTORY_KEEP_LAST: usize = 20;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteHistoryEntry {
    pub snapshot_id: String,
    pub note_path: String,
    pub created_at_ms: u64,
    pub reason: String,
    pub content_size: u64,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteHistorySnapshot {
    pub entry: NoteHistoryEntry,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteHistoryStoredEntry {
    snapshot_id: String,
    created_at_ms: u64,
    reason: String,
    content_size: u64,
    content_hash: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteHistoryManifest {
    version: u8,
    note_path: String,
    snapshots: Vec<NoteHistoryStoredEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveHistoryPathInput {
    pub from: String,
    pub to: String,
}

fn log_history(message: &str) {
    eprintln!("[note-history] {message}");
}

fn history_root(root: &Path) -> PathBuf {
    root.join(INTERNAL_DIR_NAME).join(HISTORY_DIR_NAME)
}

fn normalize_snapshot_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn history_key_for_path(path: &Path) -> String {
    let normalized = normalize_snapshot_path(path);
    blake3::hash(normalized.as_bytes()).to_hex().to_string()
}

fn note_history_dir(root: &Path, path: &Path) -> PathBuf {
    history_root(root).join(history_key_for_path(path))
}

fn manifest_path(root: &Path, path: &Path) -> PathBuf {
    note_history_dir(root, path).join(HISTORY_MANIFEST_FILE_NAME)
}

fn snapshots_dir(root: &Path, path: &Path) -> PathBuf {
    note_history_dir(root, path).join(HISTORY_SNAPSHOTS_DIR_NAME)
}

fn snapshot_path(root: &Path, path: &Path, snapshot_id: &str) -> PathBuf {
    snapshots_dir(root, path).join(format!("{snapshot_id}.md"))
}

fn note_path_from_input(path: &str) -> Result<PathBuf> {
    normalize_path(path)
}

fn normalize_path_for_containment(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        return Ok(fs::canonicalize(path)?);
    }

    let mut suffix = Vec::new();
    let mut current = path;
    while !current.exists() {
        let Some(name) = current.file_name() else {
            return Err(AppError::InvalidPath);
        };
        suffix.push(name.to_os_string());
        current = current.parent().ok_or(AppError::InvalidPath)?;
    }

    let mut normalized = fs::canonicalize(current)?;
    for component in suffix.into_iter().rev() {
        normalized.push(component);
    }
    Ok(normalized)
}

fn ensure_history_path_within_root(root: &Path, path: &Path) -> Result<()> {
    let root_canonical = fs::canonicalize(root)?;
    let path_canonical = normalize_path_for_containment(path)?;

    if !path_canonical.starts_with(&root_canonical) {
        return Err(AppError::InvalidPath);
    }
    Ok(())
}

fn current_note_path_label(path: &Path) -> String {
    normalize_snapshot_path(path)
}

fn to_entry(note_path: &Path, entry: &NoteHistoryStoredEntry) -> NoteHistoryEntry {
    NoteHistoryEntry {
        snapshot_id: entry.snapshot_id.clone(),
        note_path: current_note_path_label(note_path),
        created_at_ms: entry.created_at_ms,
        reason: entry.reason.clone(),
        content_size: entry.content_size,
        content_hash: entry.content_hash.clone(),
    }
}

fn read_manifest_strict(root: &Path, path: &Path) -> Result<NoteHistoryManifest> {
    let manifest = manifest_path(root, path);
    if !manifest.exists() {
        return Ok(NoteHistoryManifest {
            version: HISTORY_MANIFEST_VERSION,
            note_path: current_note_path_label(path),
            snapshots: Vec::new(),
        });
    }

    let raw = fs::read_to_string(&manifest)?;
    let parsed: NoteHistoryManifest = serde_json::from_str(&raw)
        .map_err(|_| AppError::InvalidOperation("Note history manifest is invalid.".to_string()))?;
    if parsed.version != HISTORY_MANIFEST_VERSION {
        return Err(AppError::InvalidOperation(
            "Note history manifest version is not supported.".to_string(),
        ));
    }
    Ok(parsed)
}

fn read_manifest_best_effort(root: &Path, path: &Path) -> NoteHistoryManifest {
    match read_manifest_strict(root, path) {
        Ok(manifest) => manifest,
        Err(err) => {
            log_history(&format!(
                "manifest_recovery path={} error={}",
                current_note_path_label(path),
                err
            ));
            NoteHistoryManifest {
                version: HISTORY_MANIFEST_VERSION,
                note_path: current_note_path_label(path),
                snapshots: Vec::new(),
            }
        }
    }
}

fn write_manifest(root: &Path, path: &Path, manifest: &NoteHistoryManifest) -> Result<()> {
    let manifest_path = manifest_path(root, path);
    if let Some(parent) = manifest_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let payload = serde_json::to_string_pretty(manifest).map_err(|_| AppError::OperationFailed)?;
    let atomic = AtomicFile::new(&manifest_path, AllowOverwrite);
    atomic
        .write(|file| {
            file.write_all(payload.as_bytes())?;
            file.write_all(b"\n")?;
            file.flush()?;
            file.sync_all()?;
            Ok(())
        })
        .map_err(|err| match err {
            atomicwrites::Error::Internal(error) | atomicwrites::Error::User(error) => {
                AppError::Io(error)
            }
        })
}

fn write_snapshot(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let atomic = AtomicFile::new(path, AllowOverwrite);
    atomic
        .write(|file| {
            file.write_all(content.as_bytes())?;
            file.flush()?;
            file.sync_all()?;
            Ok(())
        })
        .map_err(|err| match err {
            atomicwrites::Error::Internal(error) | atomicwrites::Error::User(error) => {
                AppError::Io(error)
            }
        })
}

fn trim_retention(root: &Path, path: &Path, manifest: &mut NoteHistoryManifest) -> Result<()> {
    if manifest.snapshots.len() <= HISTORY_KEEP_LAST {
        return Ok(());
    }

    let mut removed = Vec::new();
    while manifest.snapshots.len() > HISTORY_KEEP_LAST {
        if let Some(entry) = manifest.snapshots.first().cloned() {
            removed.push(entry);
        }
        manifest.snapshots.remove(0);
    }

    write_manifest(root, path, manifest)?;

    for entry in removed {
        let file = snapshot_path(root, path, &entry.snapshot_id);
        let _ = fs::remove_file(file);
    }

    Ok(())
}

fn append_snapshot(
    root: &Path,
    path: &Path,
    content: &str,
    reason: &str,
    strict: bool,
) -> Result<Option<NoteHistoryEntry>> {
    let mut manifest = if strict {
        read_manifest_strict(root, path)?
    } else {
        read_manifest_best_effort(root, path)
    };

    let content_hash = blake3::hash(content.as_bytes()).to_hex().to_string();
    if manifest
        .snapshots
        .last()
        .map(|entry| entry.content_hash == content_hash)
        .unwrap_or(false)
    {
        return Ok(None);
    }

    let created_at_ms = now_ms();
    let snapshot_id = format!("{:016x}-{}", created_at_ms, &content_hash[..12]);
    let stored = NoteHistoryStoredEntry {
        snapshot_id: snapshot_id.clone(),
        created_at_ms,
        reason: reason.to_string(),
        content_size: content.len() as u64,
        content_hash,
    };
    let snapshot = snapshot_path(root, path, &snapshot_id);
    write_snapshot(&snapshot, content)?;
    manifest.note_path = current_note_path_label(path);
    manifest.snapshots.push(stored);
    write_manifest(root, path, &manifest)?;
    trim_retention(root, path, &mut manifest)?;
    Ok(Some(to_entry(
        path,
        manifest.snapshots.last().expect("snapshot just pushed"),
    )))
}

fn read_snapshot_content(
    root: &Path,
    path: &Path,
    snapshot_id: &str,
) -> Result<NoteHistorySnapshot> {
    let manifest = read_manifest_strict(root, path)?;
    let Some(entry) = manifest
        .snapshots
        .iter()
        .find(|candidate| candidate.snapshot_id == snapshot_id)
    else {
        return Err(AppError::InvalidOperation(
            "Note history snapshot not found.".to_string(),
        ));
    };

    let snapshot_file = snapshot_path(root, path, snapshot_id);
    let content = fs::read_to_string(&snapshot_file)?;
    Ok(NoteHistorySnapshot {
        entry: to_entry(path, entry),
        content,
    })
}

fn merge_history_dirs(root: &Path, from: &Path, to: &Path) -> Result<()> {
    let from_dir = note_history_dir(root, from);
    if !from_dir.exists() {
        return Ok(());
    }

    let from_manifest = read_manifest_strict(root, from)?;
    let mut to_manifest = read_manifest_strict(root, to)?;
    let mut seen: HashSet<String> = to_manifest
        .snapshots
        .iter()
        .map(|entry| entry.snapshot_id.clone())
        .collect();

    if let Some(parent) = snapshots_dir(root, to).parent() {
        fs::create_dir_all(parent).map_err(|err| {
            AppError::InvalidOperation(format!(
                "Could not prepare note history target directory {}: {}",
                parent.to_string_lossy(),
                err
            ))
        })?;
    }
    fs::create_dir_all(snapshots_dir(root, to)).map_err(|err| {
        AppError::InvalidOperation(format!(
            "Could not create note history snapshots directory {}: {}",
            snapshots_dir(root, to).to_string_lossy(),
            err
        ))
    })?;

    for entry in from_manifest.snapshots {
        let source = snapshot_path(root, from, &entry.snapshot_id);
        let destination = snapshot_path(root, to, &entry.snapshot_id);
        if seen.insert(entry.snapshot_id.clone()) {
            if !destination.exists() && source.exists() {
                fs::rename(&source, &destination)
                    .or_else(|_| fs::copy(&source, &destination).map(|_| ()))
                    .map_err(|err| {
                        AppError::InvalidOperation(format!(
                            "Could not move note history snapshot from {} to {}: {}",
                            source.to_string_lossy(),
                            destination.to_string_lossy(),
                            err
                        ))
                    })?;
            }
            to_manifest.snapshots.push(entry);
        }
    }

    to_manifest
        .snapshots
        .sort_by_key(|entry| entry.created_at_ms);
    to_manifest.note_path = current_note_path_label(to);
    write_manifest(root, to, &to_manifest).map_err(|err| {
        AppError::InvalidOperation(format!(
            "Could not write merged note history manifest at {}: {}",
            manifest_path(root, to).to_string_lossy(),
            err
        ))
    })?;

    fs::remove_dir_all(&from_dir).map_err(|err| {
        AppError::InvalidOperation(format!(
            "Could not remove old note history directory {}: {}",
            from_dir.to_string_lossy(),
            err
        ))
    })?;
    Ok(())
}

pub(crate) fn record_note_history_snapshot(path: &Path, content: &str, reason: &str) {
    let Ok(root) = active_workspace_root() else {
        return;
    };
    let note_path = path.to_path_buf();
    if ensure_history_path_within_root(&root, &note_path).is_err() {
        return;
    }

    if let Err(err) = append_snapshot(&root, &note_path, content, reason, false) {
        log_history(&format!(
            "record_failed path={} error={}",
            note_path.to_string_lossy(),
            err
        ));
    }
}

#[tauri::command]
pub fn list_note_history(path: String) -> Result<Vec<NoteHistoryEntry>> {
    let root = active_workspace_root()?;
    let note_path = note_path_from_input(&path)?;
    ensure_history_path_within_root(&root, &note_path)?;
    let manifest = read_manifest_strict(&root, &note_path)?;
    Ok(manifest
        .snapshots
        .iter()
        .rev()
        .map(|entry| to_entry(&note_path, entry))
        .collect())
}

#[tauri::command]
pub fn read_note_history_snapshot(
    path: String,
    snapshot_id: String,
) -> Result<NoteHistorySnapshot> {
    let root = active_workspace_root()?;
    let note_path = note_path_from_input(&path)?;
    ensure_history_path_within_root(&root, &note_path)?;
    read_snapshot_content(&root, &note_path, &snapshot_id)
}

#[tauri::command]
pub fn restore_note_history_snapshot(path: String, snapshot_id: String) -> Result<SaveNoteResult> {
    let root = active_workspace_root()?;
    let note_path = note_path_from_input(&path)?;
    ensure_history_path_within_root(&root, &note_path)?;
    let snapshot = read_snapshot_content(&root, &note_path, &snapshot_id)?;

    if let Some(parent) = note_path.parent() {
        fs::create_dir_all(parent)?;
    }
    write_snapshot(&note_path, &snapshot.content)?;
    let version = version_from_path(&note_path).ok_or(AppError::OperationFailed)?;
    record_internal_write(&note_path, version.clone(), &snapshot.content);
    record_note_history_snapshot(&note_path, &snapshot.content, "restore");

    Ok(SaveNoteResult::Success(SaveNoteSuccess {
        ok: true,
        version,
    }))
}

#[tauri::command]
pub fn move_note_history_entries(moves: Vec<MoveHistoryPathInput>) -> Result<()> {
    let root = active_workspace_root()?;
    for move_path in moves {
        let from = note_path_from_input(&move_path.from)?;
        let to = note_path_from_input(&move_path.to)?;
        if from == to {
            continue;
        }
        ensure_history_path_within_root(&root, &from)?;
        ensure_history_path_within_root(&root, &to)?;
        merge_history_dirs(&root, &from, &to)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;
    use crate::{set_active_workspace, workspace_test_guard};

    fn create_workspace() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("tomosona-note-history-{nonce}"));
        fs::create_dir_all(&dir).expect("create workspace");
        dir
    }

    fn setup_note_workspace() -> (PathBuf, PathBuf) {
        let workspace = create_workspace();
        let note = workspace.join("notes.md");
        fs::write(&note, "# Notes\n").expect("write note");
        set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        (workspace, note)
    }

    fn history_manifest_raw(workspace: &Path, note: &Path) -> String {
        fs::read_to_string(manifest_path(workspace, note)).expect("read manifest")
    }

    #[test]
    fn list_history_returns_empty_when_absent() {
        let _guard = workspace_test_guard();
        let workspace = create_workspace();
        let note = workspace.join("notes.md");
        fs::write(&note, "# Notes\n").expect("write note");
        set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");

        let entries = list_note_history(note.to_string_lossy().to_string()).expect("list history");
        assert!(entries.is_empty());
        fs::remove_dir_all(workspace).expect("cleanup");
    }

    #[test]
    fn recording_snapshot_skips_duplicate_content() {
        let _guard = workspace_test_guard();
        let (workspace, note) = setup_note_workspace();
        record_note_history_snapshot(&note, "# Notes\n", "save");
        record_note_history_snapshot(&note, "# Notes\n", "save");

        let entries = list_note_history(note.to_string_lossy().to_string()).expect("list history");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].reason, "save");
        fs::remove_dir_all(workspace).expect("cleanup");
    }

    #[test]
    fn recording_snapshot_caps_retention() {
        let _guard = workspace_test_guard();
        let (workspace, note) = setup_note_workspace();

        for index in 0..25 {
            record_note_history_snapshot(&note, &format!("note-{index}\n"), "save");
        }

        let entries = list_note_history(note.to_string_lossy().to_string()).expect("list history");
        assert_eq!(entries.len(), HISTORY_KEEP_LAST);
        assert_eq!(entries[0].content_size, "note-24\n".len() as u64);
        fs::remove_dir_all(workspace).expect("cleanup");
    }

    #[test]
    fn read_note_history_snapshot_returns_content() {
        let _guard = workspace_test_guard();
        let (workspace, note) = setup_note_workspace();
        record_note_history_snapshot(&note, "alpha\nbeta\n", "save");
        let entry_id = list_note_history(note.to_string_lossy().to_string())
            .expect("list history")
            .first()
            .expect("entry")
            .snapshot_id
            .clone();

        let snapshot = read_note_history_snapshot(note.to_string_lossy().to_string(), entry_id)
            .expect("read snapshot");
        assert_eq!(snapshot.content, "alpha\nbeta\n");
        assert_eq!(snapshot.entry.reason, "save");
        fs::remove_dir_all(workspace).expect("cleanup");
    }

    #[test]
    fn read_note_history_snapshot_rejects_missing_entry() {
        let _guard = workspace_test_guard();
        let (workspace, note) = setup_note_workspace();

        let result =
            read_note_history_snapshot(note.to_string_lossy().to_string(), "missing".to_string());
        assert!(result.is_err());
        fs::remove_dir_all(workspace).expect("cleanup");
    }

    #[test]
    fn list_history_returns_newest_first() {
        let _guard = workspace_test_guard();
        let (workspace, note) = setup_note_workspace();
        record_note_history_snapshot(&note, "one\n", "save");
        record_note_history_snapshot(&note, "two\n", "restore");

        let entries = list_note_history(note.to_string_lossy().to_string()).expect("list history");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].reason, "restore");
        assert_eq!(entries[1].reason, "save");
        fs::remove_dir_all(workspace).expect("cleanup");
    }

    #[test]
    fn restore_writes_selected_snapshot_and_preserves_previous_state() {
        let _guard = workspace_test_guard();
        let (workspace, note) = setup_note_workspace();
        record_note_history_snapshot(&note, "old\n", "save");
        record_note_history_snapshot(&note, "new\n", "save");
        let entries = list_note_history(note.to_string_lossy().to_string()).expect("list history");
        let target = entries.last().expect("target entry").snapshot_id.clone();

        let result = restore_note_history_snapshot(note.to_string_lossy().to_string(), target)
            .expect("restore");
        match result {
            SaveNoteResult::Success(success) => {
                assert!(success.ok);
                assert_eq!(fs::read_to_string(&note).expect("read note"), "old\n");
            }
            _ => panic!("expected success"),
        }

        let entries_after =
            list_note_history(note.to_string_lossy().to_string()).expect("list history");
        assert!(entries_after.len() >= 2);
        assert_eq!(entries_after[0].reason, "restore");
        fs::remove_dir_all(workspace).expect("cleanup");
    }

    #[test]
    fn move_note_history_entries_moves_snapshot_directory() {
        let _guard = workspace_test_guard();
        let (workspace, note) = setup_note_workspace();
        record_note_history_snapshot(&note, "one\n", "save");

        let moved = workspace.join("archive").join("notes.md");
        fs::create_dir_all(moved.parent().expect("parent")).expect("create dest parent");
        fs::rename(&note, &moved).expect("move note");

        let result = move_note_history_entries(vec![MoveHistoryPathInput {
            from: note.to_string_lossy().to_string(),
            to: moved.to_string_lossy().to_string(),
        }]);
        result.expect("move history");

        assert_eq!(
            list_note_history(moved.to_string_lossy().to_string())
                .expect("list moved history")
                .len(),
            1
        );
        assert!(list_note_history(note.to_string_lossy().to_string())
            .expect("list old history")
            .is_empty());
        fs::remove_dir_all(workspace).expect("cleanup");
    }

    #[test]
    fn manifest_file_is_written_pretty() {
        let _guard = workspace_test_guard();
        let (workspace, note) = setup_note_workspace();
        record_note_history_snapshot(&note, "body\n", "save");

        let raw = history_manifest_raw(&workspace, &note);
        assert!(raw.contains("\"version\": 1"));
        assert!(raw.contains("\"snapshots\""));
        fs::remove_dir_all(workspace).expect("cleanup");
    }
}
