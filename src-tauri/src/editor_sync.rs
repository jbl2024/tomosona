use std::{
    collections::HashMap,
    fs,
    fs::File,
    io::{Read, Write},
    path::Path,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use atomicwrites::{AllowOverwrite, AtomicFile};
use serde::{Deserialize, Serialize};

use crate::{
    active_workspace_root,
    fs_ops::{ensure_parent_within_root, ensure_within_root, normalize_path},
    note_history::record_note_history_snapshot,
    AppError, Result,
};

const INTERNAL_WRITE_TTL_MS: u64 = 5_000;

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
    #[allow(dead_code)]
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
    pub timestamp_ms: u64,
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
    fs::metadata(path)
        .ok()
        .and_then(|metadata| version_from_metadata(&metadata))
}

fn internal_write_slot() -> &'static Mutex<HashMap<String, InternalWriteRecord>> {
    static INTERNAL_WRITES: OnceLock<Mutex<HashMap<String, InternalWriteRecord>>> = OnceLock::new();
    INTERNAL_WRITES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn prune_expired_writes(writes: &mut HashMap<String, InternalWriteRecord>, now_ms: u64) {
    writes.retain(|_, record| now_ms.saturating_sub(record.timestamp_ms) <= INTERNAL_WRITE_TTL_MS);
}

pub(crate) fn record_internal_write(path: &Path, version: FileVersion, content: &str) {
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
            timestamp_ms: now,
            resulting_version: version,
            content_hash: blake3::hash(content.as_bytes()).to_hex().to_string(),
        },
    );
}

pub(crate) fn record_workspace_mutation_write(path: &Path, content: &str) {
    let Some(version) = version_from_path(path) else {
        return;
    };
    record_internal_write(path, version, content);
}

pub(crate) fn record_workspace_mutation_write_from_disk(path: &Path) {
    let Ok(bytes) = fs::read(path) else {
        return;
    };
    let Some(version) = version_from_path(path) else {
        return;
    };
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
            timestamp_ms: now,
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

pub(crate) fn write_atomically(path: &Path, content: &str) -> Result<()> {
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
    let root = active_workspace_root()?;
    let pb = normalize_path(&path)?;
    ensure_within_root(&root, &pb)?;
    let mut file = File::open(&pb)?;
    let mut content = String::new();
    file.read_to_string(&mut content)?;
    if crate::page_protection::is_encrypted_page(&pb)? {
        let canonical = fs::canonicalize(&pb)?;
        content =
            crate::page_protection::decrypt_cached(&canonical, &content).map_err(|error| {
                if error == crate::page_protection::ProtectionError::Locked {
                    AppError::PageLocked(path.clone())
                } else {
                    crate::page_protection::protection_error(error)
                }
            })?;
    }
    let metadata = fs::metadata(&pb)?;
    let version = version_from_metadata(&metadata).ok_or(AppError::OperationFailed)?;
    Ok(ReadNoteSnapshotResult {
        path: normalize_slashes(&pb),
        content,
        version,
    })
}

#[tauri::command]
pub fn save_note_buffer(request: SaveNoteBufferRequest) -> Result<SaveNoteResult> {
    let _guard = crate::page_protection::page_io_guard()?;
    let root = active_workspace_root()?;
    let path = normalize_path(&request.path)?;
    ensure_parent_within_root(&root, &path)?;

    let force = request.force.unwrap_or(false);
    let exists = path.exists();

    if exists {
        ensure_within_root(&root, &path)?;
    }

    let protected = exists && crate::page_protection::is_encrypted_page(&path)?;
    let canonical = if protected {
        Some(fs::canonicalize(&path)?)
    } else {
        None
    };
    if let Some(ref canonical) = canonical {
        let envelope = fs::read_to_string(&path)?;
        crate::page_protection::decrypt_cached(canonical, &envelope).map_err(|error| {
            if error == crate::page_protection::ProtectionError::Locked {
                AppError::PageLocked(request.path.clone())
            } else {
                crate::page_protection::protection_error(error)
            }
        })?;
    }

    let current_version = version_from_path(&path);

    if !force {
        match (&current_version, &request.expected_base_version) {
            (Some(current), Some(expected)) if current == expected => {}
            (None, None) => {}
            (None, Some(_)) => {
                return Ok(SaveNoteResult::Error(SaveNoteError {
                    ok: false,
                    reason: "NOT_FOUND",
                    message: "File not found.".to_string(),
                }));
            }
            _ => {
                let mut disk_content = fs::read_to_string(&path).unwrap_or_default();
                if let Some(ref canonical) = canonical {
                    disk_content = crate::page_protection::decrypt_cached(canonical, &disk_content)
                        .map_err(crate::page_protection::protection_error)?;
                }
                let disk_version = current_version.clone().ok_or(AppError::OperationFailed)?;
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

    let persisted = if let Some(ref canonical) = canonical {
        crate::page_protection::encrypt_cached(canonical, &request.content)
            .map_err(crate::page_protection::protection_error)?
    } else {
        request.content.clone()
    };
    match write_atomically(&path, &persisted) {
        Ok(()) => {}
        Err(_) => {
            return Ok(SaveNoteResult::Error(SaveNoteError {
                ok: false,
                reason: "IO_ERROR",
                message: "Could not save file.".to_string(),
            }));
        }
    }

    let version = version_from_path(&path).ok_or(AppError::OperationFailed)?;
    record_internal_write(&path, version.clone(), &persisted);
    record_note_history_snapshot(&path, &persisted, "save");

    Ok(SaveNoteResult::Success(SaveNoteSuccess {
        ok: true,
        version,
    }))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

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
    fn protected_page_reads_and_saves_require_unlock_and_keep_history_encrypted() {
        let _guard = workspace_test_guard();
        let root = prepare_workspace();
        let path = root.join("protected.md");
        fs::write(&path, "original secret").unwrap();
        let name = path.to_string_lossy().to_string();
        crate::page_protection::protect_page(name.clone(), "password".into()).unwrap();
        crate::page_protection::lock_page(name.clone()).unwrap();
        assert!(matches!(
            read_note_snapshot(name.clone()),
            Err(AppError::PageLocked(_))
        ));
        assert!(matches!(
            crate::fs_ops::read_text_file(name.clone()),
            Err(AppError::PageLocked(_))
        ));
        let before = fs::read_to_string(&path).unwrap();
        let request = |force| SaveNoteBufferRequest {
            path: name.clone(),
            content: "updated secret".into(),
            expected_base_version: version_from_path(&path),
            request_id: "test".into(),
            force: Some(force),
        };
        assert!(matches!(
            save_note_buffer(request(true)),
            Err(AppError::PageLocked(_))
        ));
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
        tauri::async_runtime::block_on(crate::page_protection::unlock_page(
            name.clone(),
            "password".into(),
        ))
        .unwrap();
        assert_eq!(
            read_note_snapshot(name.clone()).unwrap().content,
            "original secret"
        );
        assert_eq!(
            crate::fs_ops::read_text_file(name.clone()).unwrap(),
            "original secret"
        );
        assert!(matches!(
            save_note_buffer(request(false)).unwrap(),
            SaveNoteResult::Success(_)
        ));
        let saved = fs::read_to_string(&path).unwrap();
        assert_ne!(saved, before);
        assert!(!saved.contains("updated secret"));
        assert_eq!(
            crate::page_protection::decrypt(&saved, "password").unwrap(),
            "updated secret"
        );
        let mut stale = request(false);
        stale.expected_base_version = Some(FileVersion {
            mtime_ms: 0,
            size: 0,
        });
        match save_note_buffer(stale).unwrap() {
            SaveNoteResult::Conflict(conflict) => {
                assert_eq!(conflict.disk_content, "updated secret")
            }
            _ => panic!("expected a conflict"),
        }
        let entries = crate::note_history::list_note_history(name.clone()).unwrap();
        assert_eq!(entries.len(), 1);
        let snapshot = crate::note_history::read_note_history_snapshot(
            name,
            entries[0].snapshot_id.clone(),
            Some("password".into()),
        )
        .unwrap();
        assert_eq!(snapshot.content, "updated secret");
    }

    #[test]
    fn read_snapshot_returns_content_and_version() {
        let _guard = workspace_test_guard();
        let root = prepare_workspace();
        let path = root.join("note.md");
        fs::write(&path, "hello").expect("write note");

        let snapshot =
            read_note_snapshot(path.to_string_lossy().to_string()).expect("read snapshot");

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
