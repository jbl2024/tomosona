//! Native pseudo-terminal sessions scoped to the active workspace.
//!
//! This module owns process lifetime and streams raw terminal bytes to the
//! frontend. The renderer remains responsible for terminal emulation.

use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    thread,
};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{active_workspace_root, normalize_workspace_path, AppError, Result};

const OUTPUT_EVENT: &str = "terminal://output";
const CLOSED_EVENT: &str = "terminal://closed";
static SESSION_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static SESSIONS: OnceLock<Mutex<HashMap<String, TerminalSession>>> = OnceLock::new();

struct TerminalSession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

#[derive(Clone, Serialize)]
struct TerminalOutput {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct TerminalClosed {
    session_id: String,
}

fn sessions() -> &'static Mutex<HashMap<String, TerminalSession>> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn default_shell() -> String {
    if cfg!(target_os = "windows") {
        "cmd.exe".to_string()
    } else {
        std::env::var("SHELL")
            .ok()
            .filter(|shell| !shell.is_empty())
            .unwrap_or_else(|| "/bin/sh".to_string())
    }
}

#[tauri::command]
pub fn start_terminal_session(app: AppHandle, cwd: Option<String>) -> Result<String> {
    let root = active_workspace_root()?;
    let cwd = terminal_start_directory(&root, cwd)?;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|_| AppError::OperationFailed)?;
    let mut command = CommandBuilder::new(default_shell());
    command.cwd(cwd);
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|_| AppError::OperationFailed)?;
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|_| AppError::OperationFailed)?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|_| AppError::OperationFailed)?;
    let session_id = format!(
        "terminal-{}",
        SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let output_session_id = session_id.clone();
    sessions()
        .lock()
        .map_err(|_| AppError::OperationFailed)?
        .insert(
            session_id.clone(),
            TerminalSession {
                writer,
                master: pair.master,
                child,
            },
        );
    thread::spawn(move || forward_output(app, output_session_id, reader));
    Ok(session_id)
}

/// Resolves the requested initial terminal location without permitting escape
/// from the active workspace. File paths start in their containing directory.
fn terminal_start_directory(root: &Path, cwd: Option<String>) -> Result<PathBuf> {
    let Some(cwd) = cwd.filter(|value| !value.trim().is_empty()) else {
        return Ok(root.to_path_buf());
    };
    let path = normalize_workspace_path(root, &cwd)?;
    if path.is_dir() {
        Ok(path)
    } else {
        path.parent()
            .map(Path::to_path_buf)
            .ok_or(AppError::InvalidPath)
    }
}

fn forward_output(app: AppHandle, session_id: String, mut reader: Box<dyn Read + Send>) {
    let mut buffer = [0_u8; 8192];
    loop {
        let Ok(count) = reader.read(&mut buffer) else {
            break;
        };
        if count == 0 {
            break;
        }
        let _ = app.emit(
            OUTPUT_EVENT,
            TerminalOutput {
                session_id: session_id.clone(),
                data: String::from_utf8_lossy(&buffer[..count]).into_owned(),
            },
        );
    }
    let _ = app.emit(
        CLOSED_EVENT,
        TerminalClosed {
            session_id: session_id.clone(),
        },
    );
    let _ = sessions()
        .lock()
        .map(|mut active| active.remove(&session_id));
}

#[tauri::command]
pub fn write_terminal_session(session_id: String, data: String) -> Result<()> {
    let mut guard = sessions().lock().map_err(|_| AppError::OperationFailed)?;
    let session = guard
        .get_mut(&session_id)
        .ok_or(AppError::InvalidOperation(
            "Terminal session not found.".to_string(),
        ))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|_| AppError::OperationFailed)?;
    session
        .writer
        .flush()
        .map_err(|_| AppError::OperationFailed)
}

#[tauri::command]
pub fn resize_terminal_session(session_id: String, cols: u16, rows: u16) -> Result<()> {
    let guard = sessions().lock().map_err(|_| AppError::OperationFailed)?;
    let session = guard.get(&session_id).ok_or(AppError::InvalidOperation(
        "Terminal session not found.".to_string(),
    ))?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|_| AppError::OperationFailed)
}

#[tauri::command]
pub fn close_terminal_session(session_id: String) -> Result<()> {
    let Some(mut session) = sessions()
        .lock()
        .map_err(|_| AppError::OperationFailed)?
        .remove(&session_id)
    else {
        return Ok(());
    };
    session.child.kill().map_err(|_| AppError::OperationFailed)
}
