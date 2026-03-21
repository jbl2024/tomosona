use std::{
    collections::HashMap,
    env,
    fs::File,
    fs,
    io::{Read, Write},
    path::Path,
    sync::{Mutex, OnceLock},
    time::Instant,
    time::{SystemTime, UNIX_EPOCH},
};

use atomicwrites::{AllowOverwrite, AtomicFile};
use serde::{Deserialize, Serialize};

use crate::{
    active_workspace_root,
    fs_ops::{ensure_parent_within_root, ensure_within_root, normalize_path},
    AppError, Result,
};

const INTERNAL_WRITE_TTL_MS: u64 = 5_000;

fn log_editor_sync(message: &str) {
    eprintln!("[editor-sync] {message}");
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InternalWriteSource {
    EditorSave,
    WorkspaceMutation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub mtime_ms: u64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadNoteSnapshotResult {
    pub path: String,
    pub content: String,
    pub version: FileVersion,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteBufferRequest {
    pub path: String,
    pub content: String,
    pub expected_base_version: Option<FileVersion>,
    pub request_id: String,
    pub force: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteSuccess {
    pub ok: bool,
    pub version: FileVersion,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteConflict {
    pub ok: bool,
    pub reason: &'static str,
    pub disk_version: FileVersion,
    pub disk_content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteError {
    pub ok: bool,
    pub reason: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum SaveNoteResult {
    Success(SaveNoteSuccess),
    Conflict(SaveNoteConflict),
    Error(SaveNoteError),
}

#[derive(Debug, Clone)]
pub(crate) struct InternalWriteRecord {
    pub path: String,
    pub request_id: String,
    pub timestamp_ms: u64,
    pub source: InternalWriteSource,
    pub resulting_version: FileVersion,
    pub content_hash: String,
}

fn normalize_slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn should_log_read_snapshot_perf(elapsed_ms: u128) -> bool {
    env::var("TOMOSONA_DEBUG_OPEN")
        .map(|value| value == "1")
        .unwrap_or(false)
        || elapsed_ms >= 75
}

fn log_read_snapshot_perf(command: &str, path: &Path, started_at: Instant, extra_fields: &[(&str, String)]) {
    let elapsed_ms = started_at.elapsed().as_millis();
    if !should_log_read_snapshot_perf(elapsed_ms) {
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
    eprintln!("[open-perf] {}", fields.join(" "));
}

fn version_from_metadata(metadata: &fs::Metadata) -> Option<FileVersion> {
    let modified = metadata.modified().ok()?;
    let mtime_ms = modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|value| value.as_millis() as u64)?;
    Some(FileVersion {
        mtime_ms,
        size: metadata.len(),
    })
}

pub(crate) fn version_from_path(path: &Path) -> Option<FileVersion> {
    fs::metadata(path).ok().and_then(|metadata| version_from_metadata(&metadata))
}

fn internal_write_slot() -> &'static Mutex<HashMap<String, InternalWriteRecord>> {
    static INTERNAL_WRITES: OnceLock<Mutex<HashMap<String, InternalWriteRecord>>> = OnceLock::new();
    INTERNAL_WRITES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn prune_expired_writes(writes: &mut HashMap<String, InternalWriteRecord>, now_ms: u64) {
    writes.retain(|_, record| now_ms.saturating_sub(record.timestamp_ms) <= INTERNAL_WRITE_TTL_MS);
}

pub(crate) fn record_internal_write_with_source(
    path: &Path,
    request_id: String,
    source: InternalWriteSource,
    version: FileVersion,
    content: &str,
) {
    let normalized = normalize_slashes(path);
    let log_message = format!(
        "record_internal_write source={source:?} path={normalized} request_id={request_id} version={} size={}",
        version.mtime_ms,
        version.size
    );
    let mut writes = match internal_write_slot().lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    let now = now_ms();
    prune_expired_writes(&mut writes, now);
    writes.insert(
        normalized.clone(),
        InternalWriteRecord {
            path: normalized,
            request_id,
            timestamp_ms: now,
            source,
            resulting_version: version,
            content_hash: blake3::hash(content.as_bytes()).to_hex().to_string(),
        },
    );
    log_editor_sync(&log_message);
}

pub(crate) fn record_internal_write(
    path: &Path,
    request_id: String,
    version: FileVersion,
    content: &str,
) {
    record_internal_write_with_source(
        path,
        request_id,
        InternalWriteSource::EditorSave,
        version,
        content,
    );
}

pub(crate) fn record_workspace_mutation_write(path: &Path, content: &str) {
    let Some(version) = version_from_path(path) else {
        return;
    };
    let request_id = format!("workspace-mutation:{}", now_ms());
    record_internal_write_with_source(
        path,
        request_id,
        InternalWriteSource::WorkspaceMutation,
        version,
        content,
    );
}

pub(crate) fn record_workspace_mutation_write_from_disk(path: &Path) {
    let Ok(bytes) = fs::read(path) else {
        return;
    };
    let Some(version) = version_from_path(path) else {
        return;
    };
    let request_id = format!("workspace-mutation:{}", now_ms());
    let normalized = normalize_slashes(path);
    let mut writes = match internal_write_slot().lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    let now = now_ms();
    prune_expired_writes(&mut writes, now);
    writes.insert(
        normalized.clone(),
        InternalWriteRecord {
            path: normalized,
            request_id,
            timestamp_ms: now,
            source: InternalWriteSource::WorkspaceMutation,
            resulting_version: version,
            content_hash: blake3::hash(&bytes).to_hex().to_string(),
        },
    );
}

pub(crate) fn recent_internal_write_for(path: &str) -> Option<InternalWriteRecord> {
    let mut writes = internal_write_slot().lock().ok()?;
    let now = now_ms();
    prune_expired_writes(&mut writes, now);
    writes.get(path).cloned()
}

pub(crate) fn same_version(left: Option<&FileVersion>, right: Option<&FileVersion>) -> bool {
    matches!((left, right), (Some(left), Some(right)) if left == right)
}

fn write_atomically(path: &Path, content: &str) -> Result<()> {
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

#[tauri::command]
pub fn read_note_snapshot(path: String) -> Result<ReadNoteSnapshotResult> {
    let started_at = Instant::now();
    let root = active_workspace_root()?;
    let root_ms = started_at.elapsed().as_millis();
    let pb = normalize_path(&path)?;
    let normalize_ms = started_at.elapsed().as_millis();
    ensure_within_root(&root, &pb)?;
    let within_root_ms = started_at.elapsed().as_millis();
    let open_started_at = Instant::now();
    let mut file = File::open(&pb)?;
    let open_ms = open_started_at.elapsed().as_millis();
    let content_started_at = Instant::now();
    let mut content = String::new();
    file.read_to_string(&mut content)?;
    let read_ms = content_started_at.elapsed().as_millis();
    let metadata_started_at = Instant::now();
    let metadata = fs::metadata(&pb)?;
    let metadata_ms = metadata_started_at.elapsed().as_millis();
    let version_started_at = Instant::now();
    let version = version_from_metadata(&metadata).ok_or(AppError::OperationFailed)?;
    let version_ms = version_started_at.elapsed().as_millis();

    log_read_snapshot_perf(
        "read_note_snapshot",
        &pb,
        started_at,
        &[
            ("root_ms", root_ms.to_string()),
            ("normalize_ms", normalize_ms.to_string()),
            ("within_root_ms", within_root_ms.to_string()),
            ("open_ms", open_ms.to_string()),
            ("read_ms", read_ms.to_string()),
            ("metadata_ms", metadata_ms.to_string()),
            ("version_ms", version_ms.to_string()),
            ("chars", content.len().to_string()),
        ],
    );
    Ok(ReadNoteSnapshotResult {
        path: normalize_slashes(&pb),
        content,
        version,
    })
}

#[tauri::command]
pub fn save_note_buffer(request: SaveNoteBufferRequest) -> Result<SaveNoteResult> {
    let root = active_workspace_root()?;
    let path = normalize_path(&request.path)?;
    ensure_parent_within_root(&root, &path)?;

    let force = request.force.unwrap_or(false);
    let exists = path.exists();
    let normalized_path = normalize_slashes(&path);

    log_editor_sync(&format!(
        "save_note_buffer:start path={normalized_path} request_id={} force={} expected_base_version={:?}",
        request.request_id, force, request.expected_base_version
    ));

    if exists {
        ensure_within_root(&root, &path)?;
    }

    let current_version = version_from_path(&path);

    if !force {
        match (&current_version, &request.expected_base_version) {
            (Some(current), Some(expected)) if current == expected => {}
            (None, None) => {}
            (None, Some(_)) => {
                log_editor_sync(&format!(
                    "save_note_buffer:not_found path={normalized_path} request_id={}",
                    request.request_id
                ));
                return Ok(SaveNoteResult::Error(SaveNoteError {
                    ok: false,
                    reason: "NOT_FOUND",
                    message: "File not found.".to_string(),
                }));
            }
            _ => {
                let disk_content = fs::read_to_string(&path).unwrap_or_default();
                let disk_version = current_version.clone().ok_or(AppError::OperationFailed)?;
                log_editor_sync(&format!(
                    "save_note_buffer:conflict path={normalized_path} request_id={} current_version={:?} expected_base_version={:?}",
                    request.request_id, current_version, request.expected_base_version
                ));
                return Ok(SaveNoteResult::Conflict(SaveNoteConflict {
                    ok: false,
                    reason: "CONFLICT",
                    disk_version,
                    disk_content,
                }));
            }
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    match write_atomically(&path, &request.content) {
        Ok(()) => {}
        Err(_) => {
            log_editor_sync(&format!(
                "save_note_buffer:io_error path={normalized_path} request_id={}",
                request.request_id
            ));
            return Ok(SaveNoteResult::Error(SaveNoteError {
                ok: false,
                reason: "IO_ERROR",
                message: "Could not save file.".to_string(),
            }));
        }
    }

    let version = version_from_path(&path).ok_or(AppError::OperationFailed)?;
    record_internal_write(&path, request.request_id, version.clone(), &request.content);
    log_editor_sync(&format!(
        "save_note_buffer:success path={normalized_path} version={:?}",
        version
    ));

    Ok(SaveNoteResult::Success(SaveNoteSuccess { ok: true, version }))
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf, time::{Duration, SystemTime, UNIX_EPOCH}};

    use super::*;
    use crate::{set_active_workspace, workspace_test_guard};

    fn unique_test_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("tomosona-editor-sync-{unique}"))
    }

    fn prepare_workspace() -> PathBuf {
        let root = unique_test_dir();
        fs::create_dir_all(&root).expect("create workspace");
        set_active_workspace(root.to_string_lossy().as_ref()).expect("set active workspace");
        root
    }

    #[test]
    fn read_snapshot_returns_content_and_version() {
        let _guard = workspace_test_guard();
        let root = prepare_workspace();
        let path = root.join("note.md");
        fs::write(&path, "hello").expect("write note");

        let snapshot = read_note_snapshot(path.to_string_lossy().to_string()).expect("read snapshot");

        assert_eq!(snapshot.content, "hello");
        assert_eq!(snapshot.path, normalize_slashes(&path));
        assert_eq!(snapshot.version.size, 5);
    }

    #[test]
    fn save_conflicts_when_base_version_is_stale() {
        let _guard = workspace_test_guard();
        let root = prepare_workspace();
        let path = root.join("note.md");
        fs::write(&path, "old").expect("write original");
        let version = version_from_path(&path).expect("version");
        std::thread::sleep(Duration::from_millis(5));
        fs::write(&path, "new").expect("write newer");

        let result = save_note_buffer(SaveNoteBufferRequest {
            path: path.to_string_lossy().to_string(),
            content: "mine".to_string(),
            expected_base_version: Some(version),
            request_id: "req-1".to_string(),
            force: Some(false),
        })
        .expect("save result");

        match result {
            SaveNoteResult::Conflict(conflict) => {
                assert_eq!(conflict.reason, "CONFLICT");
                assert_eq!(conflict.disk_content, "new");
            }
            _ => panic!("expected conflict"),
        }
    }

    #[test]
    fn first_save_can_create_virtual_note() {
        let _guard = workspace_test_guard();
        let root = prepare_workspace();
        let path = root.join("virtual.md");

        let result = save_note_buffer(SaveNoteBufferRequest {
            path: path.to_string_lossy().to_string(),
            content: "created".to_string(),
            expected_base_version: None,
            request_id: "req-2".to_string(),
            force: Some(false),
        })
        .expect("save result");

        match result {
            SaveNoteResult::Success(success) => {
                assert!(success.ok);
                assert_eq!(fs::read_to_string(path).expect("read file"), "created");
            }
            _ => panic!("expected success"),
        }
    }

    #[test]
    fn forced_save_overwrites_after_conflict() {
        let _guard = workspace_test_guard();
        let root = prepare_workspace();
        let path = root.join("note.md");
        fs::write(&path, "original").expect("write original");
        let version = version_from_path(&path).expect("version");
        std::thread::sleep(Duration::from_millis(5));
        fs::write(&path, "external").expect("write external");

        let result = save_note_buffer(SaveNoteBufferRequest {
            path: path.to_string_lossy().to_string(),
            content: "mine".to_string(),
            expected_base_version: Some(version),
            request_id: "req-3".to_string(),
            force: Some(true),
        })
        .expect("save result");

        match result {
            SaveNoteResult::Success(success) => {
                assert!(success.ok);
                assert_eq!(fs::read_to_string(path).expect("read file"), "mine");
            }
            _ => panic!("expected success"),
        }
    }

    #[test]
    fn save_returns_not_found_when_file_was_deleted() {
        let _guard = workspace_test_guard();
        let root = prepare_workspace();
        let path = root.join("note.md");
        fs::write(&path, "original").expect("write original");
        let version = version_from_path(&path).expect("version");
        fs::remove_file(&path).expect("remove file");

        let result = save_note_buffer(SaveNoteBufferRequest {
            path: path.to_string_lossy().to_string(),
            content: "mine".to_string(),
            expected_base_version: Some(version),
            request_id: "req-4".to_string(),
            force: Some(false),
        })
        .expect("save result");

        match result {
            SaveNoteResult::Error(error) => {
                assert_eq!(error.reason, "NOT_FOUND");
            }
            _ => panic!("expected error"),
        }
    }
}
