//! Workspace runtime helpers shared by indexing, search and filesystem commands.
//!
//! This module owns the active workspace slot, canonical workspace validation and
//! opening the workspace-local SQLite database.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};

use directories::UserDirs;
use rusqlite::Connection;

use crate::{
    db, log_index, semantic, AppError, Result, DB_FILE_NAME, INTERNAL_DIR_NAME,
    RESERVED_WORKSPACE_ERROR, SQLITE_VEC_PROBE_LOGGED,
};

static ACTIVE_WORKSPACE_ROOT: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

fn normalize_existing_dir(path: &str) -> Result<PathBuf> {
    let pb = PathBuf::from(path);
    if pb.as_os_str().is_empty() || !pb.is_dir() {
        return Err(AppError::InvalidPath);
    }
    Ok(pb)
}

fn active_workspace_slot() -> &'static Mutex<Option<PathBuf>> {
    ACTIVE_WORKSPACE_ROOT.get_or_init(|| Mutex::new(None))
}

fn lock_workspace_slot() -> Result<std::sync::MutexGuard<'static, Option<PathBuf>>> {
    active_workspace_slot()
        .lock()
        .map_err(|_| AppError::OperationFailed)
}

fn is_reserved_workspace_root(path: &Path) -> bool {
    if path.parent().is_none() {
        return true;
    }

    let Some(user_dirs) = UserDirs::new() else {
        return false;
    };

    if path == user_dirs.home_dir() {
        return true;
    }

    let special_dirs = [
        user_dirs.desktop_dir(),
        user_dirs.document_dir(),
        user_dirs.download_dir(),
        user_dirs.picture_dir(),
        user_dirs.audio_dir(),
        user_dirs.video_dir(),
        user_dirs.public_dir(),
    ];

    let is_special = special_dirs.into_iter().flatten().any(|dir| path == dir);
    is_special
}

fn canonical_workspace_root(path: &str) -> Result<PathBuf> {
    let dir = normalize_existing_dir(path)?;
    let canonical = fs::canonicalize(dir)?;
    if is_reserved_workspace_root(&canonical) {
        return Err(AppError::InvalidOperation(
            RESERVED_WORKSPACE_ERROR.to_string(),
        ));
    }
    Ok(canonical)
}

pub(crate) fn set_active_workspace(path: &str) -> Result<PathBuf> {
    let canonical = canonical_workspace_root(path)?;
    let mut guard = lock_workspace_slot()?;
    *guard = Some(canonical.clone());
    Ok(canonical)
}

pub(crate) fn clear_active_workspace() -> Result<()> {
    let mut guard = lock_workspace_slot()?;
    *guard = None;
    Ok(())
}

pub(crate) fn active_workspace_root() -> Result<PathBuf> {
    let guard = lock_workspace_slot()?;
    guard
        .as_ref()
        .cloned()
        .ok_or_else(|| AppError::InvalidOperation("No workspace is selected.".to_string()))
}

pub(crate) fn open_db() -> Result<Connection> {
    if !db::init_sqlite_runtime() {
        log_index("sqlite_runtime:init_failed");
        return Err(AppError::OperationFailed);
    }
    let root = active_workspace_root()?;
    let db_dir = root.join(INTERNAL_DIR_NAME);
    fs::create_dir_all(&db_dir)?;

    let db_path = db_dir.join(DB_FILE_NAME);
    let conn = Connection::open(db_path)?;
    let _ = conn.busy_timeout(Duration::from_millis(3_000));
    if SQLITE_VEC_PROBE_LOGGED.set(()).is_ok() {
        match semantic::probe_vec_runtime(&conn) {
            Ok(version) => log_index(&format!("sqlite_vec:runtime_ready version={version}")),
            Err(err) => log_index(&format!("sqlite_vec:runtime_unavailable err={err}")),
        }
    }
    Ok(conn)
}

pub(crate) fn property_type_schema_path() -> Result<PathBuf> {
    let root = active_workspace_root()?;
    let schema_dir = root.join(INTERNAL_DIR_NAME);
    fs::create_dir_all(&schema_dir)?;
    Ok(schema_dir.join(crate::PROPERTY_TYPE_SCHEMA_FILE))
}
