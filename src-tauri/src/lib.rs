//! Tauri command surface for local filesystem and lexical search.

mod app_meta;
mod db;
mod docx;
mod editor_sync;
mod favorites;
mod fs_ops;
mod index_schema;
mod markdown_index;
pub(crate) mod note_history;
mod search_index;
mod wikilink_graph;
mod workspace_paths;
mod workspace_runtime;
mod workspace_watch;
mod terminal;

// Tauri command surface for workspace I/O and index/search.
use std::{
    collections::{HashMap, VecDeque},
    io::Write,
    process::{Command, Stdio},
    sync::{
        atomic::AtomicBool,
        Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;

use docx::convert_markdown_to_docx;
use editor_sync::{read_note_snapshot, save_note_buffer};
use fs_ops::{
    clear_working_folder, copy_entry, create_entry, create_extracted_note, duplicate_entry,
    import_asset_files, list_children, list_markdown_files, move_entry, open_external_url, open_path_external,
    path_exists, read_file_metadata, read_image_data_url, read_pdf_data_url, read_text_file,
    is_text_file,
    rename_entry,
    render_pandoc_preview_html, render_spreadsheet_preview_html, reveal_in_file_manager,
    select_working_folder, set_working_folder, trash_entry,
    write_text_file,
};
use note_history::{
    list_note_history, move_note_history_entries, read_note_history_snapshot,
    restore_note_history_snapshot,
};
use index_schema::{
    ensure_index_schema, init_db as init_db_impl, list_markdown_files_via_find, min_max_normalize,
    read_index_logs as read_index_logs_impl,
    read_index_overview_stats as read_index_overview_stats_impl,
    rebuild_workspace_index_sync as rebuild_workspace_index_sync_impl,
    request_index_cancel as request_index_cancel_impl, IndexLogEntry, IndexOverviewStats,
    RebuildIndexResult,
};
use markdown_index::{
    reindex_markdown_file_lexical_sync, reindex_markdown_file_now_sync,
    remove_markdown_file_from_index_sync,
};
use search_index::{
    fts_search_sync as fts_search_sync_impl, read_property_keys as read_property_keys_impl,
    read_property_type_schema as read_property_type_schema_impl,
    read_property_value_suggestions as read_property_value_suggestions_impl,
    write_property_type_schema as write_property_type_schema_impl, Hit,
};
use wikilink_graph::{
    backlinks_for_path as backlinks_for_path_impl,
    update_wikilinks_for_path_moves as update_wikilinks_for_path_moves_impl,
    update_wikilinks_for_rename as update_wikilinks_for_rename_impl, Backlink, PathMoveInput,
    PathMoveRewriteResult, WikilinkRewriteResult,
};
pub(crate) use workspace_paths::{
    ensure_within_root, has_hidden_dir_component, normalize_key_text, normalize_note_key,
    normalize_workspace_path, normalize_workspace_relative_from_input, normalize_workspace_relative_path,
    note_link_target, rewrite_wikilinks_for_note,
    workspace_absolute_path,
};
pub(crate) use workspace_runtime::{
    active_workspace_root, clear_active_workspace, open_db, property_type_schema_path,
    set_active_workspace,
};

const INTERNAL_DIR_NAME: &str = ".tomosona";
const TRASH_DIR_NAME: &str = ".tomosona-trash";
const DB_FILE_NAME: &str = "tomosona.sqlite";
const PROPERTY_TYPE_SCHEMA_FILE: &str = "property-types.json";
const RESERVED_WORKSPACE_ERROR: &str =
    "Cannot use this folder as a workspace. Choose a dedicated project folder.";
const SEARCH_RESULT_LIMIT: usize = 25;
const INDEX_LOG_CAPACITY: usize = 400;
const INDEX_SCHEMA_VERSION: i64 = 4;
static INDEX_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

static INDEX_LOGS: OnceLock<Mutex<VecDeque<IndexLogEntry>>> = OnceLock::new();

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn index_log_buffer() -> &'static Mutex<VecDeque<IndexLogEntry>> {
    INDEX_LOGS.get_or_init(|| Mutex::new(VecDeque::with_capacity(INDEX_LOG_CAPACITY)))
}

fn log_index(message: &str) {
    if let Ok(mut logs) = index_log_buffer().lock() {
        if logs.len() >= INDEX_LOG_CAPACITY {
            logs.pop_front();
        }
        logs.push_back(IndexLogEntry {
            ts_ms: now_ms(),
            message: message.to_string(),
        });
    }
}

#[cfg(test)]
static WORKSPACE_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Error)]
enum AppError {
    #[error("File operation failed.")]
    Io(#[from] std::io::Error),
    #[error("Database operation failed.")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Invalid path.")]
    InvalidPath,
    #[error("Invalid name.")]
    InvalidName,
    #[error("File or folder already exists.")]
    AlreadyExists,
    #[error("Operation failed.")]
    OperationFailed,
    #[error("{0}")]
    InvalidOperation(String),
}

type Result<T> = std::result::Result<T, AppError>;

impl From<AppError> for tauri::ipc::InvokeError {
    fn from(err: AppError) -> Self {
        tauri::ipc::InvokeError::from(err.to_string())
    }
}

#[cfg(test)]
pub(crate) fn workspace_test_guard() -> std::sync::MutexGuard<'static, ()> {
    WORKSPACE_TEST_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("workspace test mutex poisoned")
}

#[tauri::command]
fn init_db() -> Result<()> {
    init_db_impl()
}

#[tauri::command]
async fn reindex_markdown_file_lexical(path: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || reindex_markdown_file_lexical_sync(path))
        .await
        .map_err(|_| AppError::OperationFailed)?
}


#[tauri::command]
async fn remove_markdown_file_from_index(path: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || remove_markdown_file_from_index_sync(path))
        .await
        .map_err(|_| AppError::OperationFailed)?
}

#[tauri::command]
async fn rebuild_workspace_index() -> Result<RebuildIndexResult> {
    tauri::async_runtime::spawn_blocking(rebuild_workspace_index_sync_impl)
        .await
        .map_err(|_| AppError::OperationFailed)?
}

#[tauri::command]
fn request_index_cancel() -> Result<()> {
    request_index_cancel_impl()
}

#[tauri::command]
fn read_index_logs(limit: Option<usize>) -> Result<Vec<IndexLogEntry>> {
    read_index_logs_impl(limit)
}

#[tauri::command]
fn read_property_value_suggestions(
    key: String,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<String>> {
    read_property_value_suggestions_impl(key, query, limit)
}

#[tauri::command]
fn read_property_keys(limit: Option<usize>) -> Result<Vec<String>> {
    read_property_keys_impl(limit)
}

#[tauri::command]
fn read_index_overview_stats() -> Result<IndexOverviewStats> {
    read_index_overview_stats_impl()
}

#[tauri::command]
fn read_property_type_schema() -> Result<HashMap<String, String>> {
    read_property_type_schema_impl()
}

#[tauri::command]
fn write_property_type_schema(schema: HashMap<String, String>) -> Result<()> {
    write_property_type_schema_impl(schema)
}

#[tauri::command]
fn write_clipboard_text(text: String) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        write_clipboard_via_command("pbcopy", &[], &text)?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        write_clipboard_via_command("cmd", &["/C", "clip"], &text)?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let commands: [(&str, &[&str]); 3] = [
            ("wl-copy", &[]),
            ("xclip", &["-selection", "clipboard"]),
            ("xsel", &["--clipboard", "--input"]),
        ];
        for (program, args) in commands {
            if write_clipboard_via_command(program, args, &text).is_ok() {
                return Ok(());
            }
        }
        return Err(AppError::InvalidOperation(
            "Clipboard access is not available on this Linux desktop.".to_string(),
        ));
    }

    #[allow(unreachable_code)]
    Err(AppError::InvalidOperation(
        "Clipboard access is not supported on this platform.".to_string(),
    ))
}

fn write_clipboard_via_command(program: &str, args: &[&str], text: &str) -> Result<()> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| AppError::OperationFailed)?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|_| AppError::OperationFailed)?;
    } else {
        return Err(AppError::OperationFailed);
    }

    let status = child.wait().map_err(|_| AppError::OperationFailed)?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::OperationFailed)
    }
}

#[tauri::command]
async fn fts_search(query: String) -> Result<Vec<Hit>> {
    tauri::async_runtime::spawn_blocking(move || fts_search_sync_impl(query))
        .await
        .map_err(|_| AppError::OperationFailed)?
}

#[tauri::command]
fn backlinks_for_path(path: String) -> Result<Vec<Backlink>> {
    backlinks_for_path_impl(path)
}


#[tauri::command]
fn update_wikilinks_for_rename(
    old_path: String,
    new_path: String,
) -> Result<WikilinkRewriteResult> {
    update_wikilinks_for_rename_impl(old_path, new_path)
}

#[tauri::command]
fn update_wikilinks_for_path_moves(moves: Vec<PathMoveInput>) -> Result<PathMoveRewriteResult> {
    update_wikilinks_for_path_moves_impl(moves)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if db::init_sqlite_runtime() {
        log_index("sqlite_runtime:init_ok");
    } else {
        log_index("sqlite_runtime:init_failed");
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            select_working_folder,
            import_asset_files,
            clear_working_folder,
            set_working_folder,
            list_children,
            list_markdown_files,
            path_exists,
            read_text_file,
            is_text_file,
            read_file_metadata,
            read_image_data_url,
            read_pdf_data_url,
            render_pandoc_preview_html,
            render_spreadsheet_preview_html,
            write_text_file,
            convert_markdown_to_docx,
            read_note_snapshot,
            save_note_buffer,
            list_note_history,
            read_note_history_snapshot,
            restore_note_history_snapshot,
            move_note_history_entries,
            create_entry,
            create_extracted_note,
            rename_entry,
            duplicate_entry,
            copy_entry,
            move_entry,
            trash_entry,
            open_path_external,
            open_external_url,
            reveal_in_file_manager,
            app_meta::read_about_metadata,
            app_meta::open_app_support_dir,
            init_db,
            reindex_markdown_file_lexical,
            remove_markdown_file_from_index,
            fts_search,
            rebuild_workspace_index,
            request_index_cancel,
            read_index_logs,
            read_property_value_suggestions,
            read_property_keys,
            read_index_overview_stats,
            backlinks_for_path,
            update_wikilinks_for_rename,
            update_wikilinks_for_path_moves,
            read_property_type_schema,
            write_property_type_schema,
            write_clipboard_text,
            terminal::start_terminal_session,
            terminal::write_terminal_session,
            terminal::resize_terminal_session,
            terminal::close_terminal_session,
            favorites::list_favorites,
            favorites::add_favorite,
            favorites::remove_favorite,
            favorites::rename_favorite,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
