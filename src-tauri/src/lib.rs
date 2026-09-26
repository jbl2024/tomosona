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
#[cfg(test)]
use markdown_index::{
    inject_relative_path_context, parse_note_targets, parse_yaml_frontmatter_properties,
    strip_yaml_frontmatter,
};
use markdown_index::{
    reindex_markdown_file_lexical_sync, reindex_markdown_file_now_sync,
    remove_markdown_file_from_index_sync,
};
#[cfg(test)]
use search_index::{
    build_prefix_fts_query, parse_search_query, SearchMode,
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

#[cfg(any())]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};
    use std::{
        fs,
        path::PathBuf,
    };

    use directories::UserDirs;
    use rusqlite::params;

    use super::*;

    fn workspace_test_guard() -> std::sync::MutexGuard<'static, ()> {
        crate::workspace_test_guard()
    }

    fn create_temp_workspace(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("{prefix}-{nonce}"));
        fs::create_dir_all(&dir).expect("create temp workspace");
        dir
    }

    #[test]
    fn rewrite_wikilinks_replaces_matching_target() {
        let input = "See [[notes/old]].";
        let (output, changed) = rewrite_wikilinks_for_note(input, "notes/old", "notes/new");
        assert!(changed);
        assert_eq!(output, "See [[notes/new]].");
    }

    #[test]
    fn rewrite_wikilinks_preserves_alias_and_heading() {
        let input = "[[notes/old|Alias]] and [[notes/old#section]].";
        let (output, changed) = rewrite_wikilinks_for_note(input, "notes/old", "notes/new");
        assert!(changed);
        assert_eq!(output, "[[notes/new|Alias]] and [[notes/new#section]].");
    }

    #[test]
    fn rewrite_wikilinks_keeps_non_matching_targets() {
        let input = "[[notes/old-stuff]] [[notes/other]].";
        let (output, changed) = rewrite_wikilinks_for_note(input, "notes/old", "notes/new");
        assert!(!changed);
        assert_eq!(output, input);
    }

    #[test]
    fn rewrite_wikilinks_matches_case_and_extensions() {
        let input = "[[Notes/Old.MD]] [[notes/old.markdown]].";
        let (output, changed) = rewrite_wikilinks_for_note(input, "notes/old", "notes/new");
        assert!(changed);
        assert_eq!(output, "[[notes/new]] [[notes/new]].");
    }

    #[test]
    fn strip_yaml_frontmatter_removes_header_block() {
        let markdown = "---\ntitle: Test\ntags: [one]\n---\n# Body\n[[note]]";
        let stripped = strip_yaml_frontmatter(markdown);
        assert_eq!(stripped, "# Body\n[[note]]");
    }

    #[test]
    fn parse_note_targets_ignores_frontmatter_links() {
        let markdown = "---\nassignee: \"[[Alice]]\"\n---\n[[BodyNote]]";
        let targets = parse_note_targets(markdown);
        assert_eq!(targets.len(), 1);
        assert!(targets.iter().any(|item| item == "bodynote"));
    }

    #[test]
    fn parse_note_targets_extracts_target_from_wikilink_with_alias() {
        let markdown = "See [[Folder/Note|Displayed Label]]";
        let targets = parse_note_targets(markdown);
        assert_eq!(targets.len(), 1);
        assert!(targets.iter().any(|item| item == "folder/note"));
    }

    #[test]
    fn parse_note_targets_normalizes_unicode_wikilink_target() {
        let markdown = "See [[syste\u{300}me/Tools.md|Tools]]";
        let targets = parse_note_targets(markdown);
        assert_eq!(targets.len(), 1);
        assert!(targets.iter().any(|item| item == "système/tools"));
    }

    #[test]
    fn parse_yaml_frontmatter_properties_indexes_scalars_and_lists() {
        let markdown =
            "---\npriority: 2\narchive: true\ndeadline: 2026-03-01\ntags: [dev, urgent]\n---\nbody";
        let indexed = parse_yaml_frontmatter_properties(markdown);
        assert!(indexed
            .iter()
            .any(|item| item.key == "priority" && item.kind == "number"));
        assert!(indexed
            .iter()
            .any(|item| item.key == "archive" && item.kind == "bool"));
        assert!(indexed
            .iter()
            .any(|item| item.key == "deadline" && item.kind == "date"));
        assert!(indexed.iter().any(|item| item.key == "tags"
            && item.kind == "list"
            && item.value_text.as_deref() == Some("dev")));
        assert!(indexed.iter().any(|item| item.key == "tags"
            && item.kind == "list"
            && item.value_text.as_deref() == Some("urgent")));
    }

    #[test]
    fn read_property_value_suggestions_returns_distinct_prefix_filtered_values() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-property-suggestions-test");
        let root = workspace.to_string_lossy().to_string();

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let note_a = workspace.join("a.md");
        let note_b = workspace.join("b.md");
        let note_c = workspace.join("c.md");
        fs::write(&note_a, "---\nstatus:\n  - draft\n---\nbody").expect("write note a");
        fs::write(&note_b, "---\nstatus:\n  - review\n---\nbody").expect("write note b");
        fs::write(&note_c, "---\nstatus:\n  - published\n---\nbody").expect("write note c");

        reindex_markdown_file_lexical_sync(note_a.to_string_lossy().to_string()).expect("index a");
        reindex_markdown_file_lexical_sync(note_b.to_string_lossy().to_string()).expect("index b");
        reindex_markdown_file_lexical_sync(note_c.to_string_lossy().to_string()).expect("index c");

        let all = read_property_value_suggestions_impl("status".to_string(), None, Some(20))
            .expect("read suggestions");
        assert_eq!(all, vec!["draft", "published", "review"]);

        let filtered = read_property_value_suggestions_impl(
            "status".to_string(),
            Some("pub".to_string()),
            Some(20),
        )
        .expect("read filtered suggestions");
        assert_eq!(filtered, vec!["published"]);

        let limited = read_property_value_suggestions_impl("status".to_string(), None, Some(2))
            .expect("read limited suggestions");
        assert_eq!(limited.len(), 2);

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn read_property_keys_returns_distinct_sorted_values() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-property-keys-test");
        let root = workspace.to_string_lossy().to_string();

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let note_a = workspace.join("a.md");
        let note_b = workspace.join("b.md");
        let note_c = workspace.join("c.md");
        fs::write(&note_a, "---\nStatus: draft\ncategory: work\n---\nbody").expect("write note a");
        fs::write(&note_b, "---\npriority: 1\ntags:\n  - alpha\n---\nbody").expect("write note b");
        fs::write(&note_c, "---\nupdated: 2026-01-01\n---\nbody").expect("write note c");

        reindex_markdown_file_lexical_sync(note_a.to_string_lossy().to_string()).expect("index a");
        reindex_markdown_file_lexical_sync(note_b.to_string_lossy().to_string()).expect("index b");
        reindex_markdown_file_lexical_sync(note_c.to_string_lossy().to_string()).expect("index c");

        let keys = read_property_keys_impl(Some(20)).expect("read keys");
        assert_eq!(
            keys,
            vec!["category", "priority", "status", "tags", "updated"]
        );

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn parse_search_query_extracts_property_filters() {
        let (mode, text, filters) =
            parse_search_query("roadmap tags:dev deadline>=2026-01-01 has:archive");
        assert_eq!(mode, SearchMode::Hybrid);
        assert_eq!(text, "roadmap");
        assert_eq!(filters.len(), 3);
    }

    #[test]
    fn parse_search_query_detects_search_mode_prefixes() {
        let (semantic_mode, semantic_text, semantic_filters) =
            parse_search_query("semantic: ai agents");
        assert_eq!(semantic_mode, SearchMode::Semantic);
        assert_eq!(semantic_text, "ai agents");
        assert!(semantic_filters.is_empty());

        let (lexical_mode, lexical_text, lexical_filters) =
            parse_search_query("Lexical: rust tauri");
        assert_eq!(lexical_mode, SearchMode::Lexical);
        assert_eq!(lexical_text, "rust tauri");
        assert!(lexical_filters.is_empty());

        let (hybrid_mode, hybrid_text, hybrid_filters) =
            parse_search_query("hybrid: graph has:tags");
        assert_eq!(hybrid_mode, SearchMode::Hybrid);
        assert_eq!(hybrid_text, "graph");
        assert_eq!(hybrid_filters.len(), 1);
    }

    #[test]
    fn parse_search_query_accepts_empty_text_after_prefix() {
        let (mode, text, filters) = parse_search_query("semantic:   ");
        assert_eq!(mode, SearchMode::Semantic);
        assert!(text.is_empty());
        assert!(filters.is_empty());
    }

    #[test]
    fn build_prefix_fts_query_converts_tokens_to_prefix_terms() {
        let query = build_prefix_fts_query("matter most");
        assert_eq!(query.as_deref(), Some("matter* AND most*"));
    }

    #[test]
    fn build_prefix_fts_query_ignores_punctuation_only_tokens() {
        let query = build_prefix_fts_query("  !!!  ");
        assert!(query.is_none());
    }

    #[test]
    fn semantic_snippet_preview_compacts_whitespace_and_truncates() {
        let preview = semantic_snippet_preview("line one\n\nline\t two");
        assert_eq!(preview, "line one line two");

        let long = "a".repeat(260);
        let truncated = semantic_snippet_preview(&long);
        assert!(truncated.ends_with("..."));
        assert!(truncated.len() <= 223);
    }

    #[test]
    fn list_markdown_files_via_find_skips_hidden_directories() {
        let workspace = create_temp_workspace("tomosona-hidden-scan-test");
        fs::create_dir_all(workspace.join(".hidden")).expect("create hidden dir");
        fs::create_dir_all(workspace.join("visible")).expect("create visible dir");
        fs::write(workspace.join(".hidden/secret.md"), "# secret").expect("write secret");
        fs::write(workspace.join("visible/public.md"), "# public").expect("write public");

        let files = list_markdown_files_via_find(&workspace).expect("list markdown files");
        let names = files
            .iter()
            .filter_map(|path| path.strip_prefix(&workspace).ok())
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .collect::<Vec<_>>();
        assert!(names.iter().any(|path| path == "visible/public.md"));
        assert!(!names.iter().any(|path| path.contains(".hidden/secret.md")));

        fs::remove_dir_all(workspace).expect("cleanup");
    }

    #[test]
    fn min_max_normalize_handles_flat_and_spread_inputs() {
        assert_eq!(min_max_normalize(&[2.0, 2.0, 2.0]), vec![1.0, 1.0, 1.0]);
        let normalized = min_max_normalize(&[1.0, 3.0, 5.0]);
        assert_eq!(normalized.len(), 3);
        assert!((normalized[0] - 0.0).abs() < 1e-6);
        assert!((normalized[1] - 0.5).abs() < 1e-6);
        assert!((normalized[2] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn set_active_workspace_rejects_home_directory() {
        let Some(user_dirs) = UserDirs::new() else {
            return;
        };

        let home = user_dirs.home_dir().to_string_lossy().to_string();
        let result = set_active_workspace(&home);
        assert!(result.is_err());
    }

    #[test]
    fn set_active_workspace_rejects_special_user_directories() {
        let Some(user_dirs) = UserDirs::new() else {
            return;
        };

        let special_dirs = [
            user_dirs.desktop_dir(),
            user_dirs.document_dir(),
            user_dirs.download_dir(),
            user_dirs.picture_dir(),
            user_dirs.audio_dir(),
            user_dirs.video_dir(),
            user_dirs.public_dir(),
        ];

        for dir in special_dirs.into_iter().flatten() {
            let result = set_active_workspace(&dir.to_string_lossy());
            assert!(
                result.is_err(),
                "expected special directory to be rejected: {dir:?}"
            );
        }
    }

    #[test]
    fn set_active_workspace_accepts_regular_folder() {
        let temp = std::env::temp_dir().join("tomosona-workspace-guard-test");
        fs::create_dir_all(&temp).expect("create temp dir");

        let set = set_active_workspace(&temp.to_string_lossy()).expect("set workspace");
        let active = active_workspace_root().expect("active workspace");
        assert_eq!(set, active);

        fs::remove_dir_all(&temp).expect("cleanup");
    }

    #[test]
    fn update_wikilinks_for_path_moves_rewrites_links_for_a_moved_note() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-path-move-note-test");
        let root = workspace.to_string_lossy().to_string();

        fs::create_dir_all(workspace.join("journal")).expect("create journal dir");
        fs::create_dir_all(workspace.join("archive")).expect("create archive dir");
        fs::write(workspace.join("journal/foo.md"), "# Foo").expect("write moved note");
        fs::write(workspace.join("index.md"), "[[journal/foo]]").expect("write inbound link");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        fs::rename(
            workspace.join("journal/foo.md"),
            workspace.join("archive/foo.md"),
        )
        .expect("move note");
        reindex_markdown_file_lexical_sync(
            workspace
                .join("archive/foo.md")
                .to_string_lossy()
                .to_string(),
        )
        .expect("reindex moved note");

        let result = update_wikilinks_for_path_moves_impl(vec![PathMoveInput {
            from_path: format!("{root}/journal/foo.md"),
            to_path: format!("{root}/archive/foo.md"),
        }])
        .expect("rewrite wikilinks");

        assert_eq!(result.updated_files, 1);
        assert_eq!(result.moved_markdown_files, 1);
        assert!(result.reindexed_files >= 2);
        assert_eq!(result.expanded_markdown_moves.len(), 1);
        assert!(result.expanded_markdown_moves[0]
            .from_path
            .ends_with("/journal/foo.md"));
        assert!(result.expanded_markdown_moves[0]
            .to_path
            .ends_with("/archive/foo.md"));
        let updated = fs::read_to_string(workspace.join("index.md")).expect("read updated note");
        assert!(updated.contains("[[archive/foo]]"));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn update_wikilinks_for_path_moves_expands_folder_moves_for_descendants() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-path-move-folder-test");
        let root = workspace.to_string_lossy().to_string();

        fs::create_dir_all(workspace.join("journal/sub")).expect("create journal dir");
        fs::create_dir_all(workspace.join("archive")).expect("create archive dir");
        fs::write(workspace.join("journal/a.md"), "# A").expect("write a");
        fs::write(workspace.join("journal/sub/b.md"), "# B").expect("write b");
        fs::write(
            workspace.join("index.md"),
            "[[journal/a]] and [[journal/sub/b]] and [[other/note]]",
        )
        .expect("write inbound links");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        fs::rename(workspace.join("journal"), workspace.join("archive/journal"))
            .expect("move folder");

        let result = update_wikilinks_for_path_moves_impl(vec![PathMoveInput {
            from_path: format!("{root}/journal"),
            to_path: format!("{root}/archive/journal"),
        }])
        .expect("rewrite folder move");

        assert_eq!(result.updated_files, 1);
        assert_eq!(result.moved_markdown_files, 2);
        let expanded_pairs = result
            .expanded_markdown_moves
            .iter()
            .map(|item| (item.from_path.clone(), item.to_path.clone()))
            .collect::<Vec<_>>();
        assert!(expanded_pairs.iter().any(|(from, to)| {
            from.ends_with("/journal/a.md") && to.ends_with("/archive/journal/a.md")
        }));
        assert!(expanded_pairs.iter().any(|(from, to)| {
            from.ends_with("/journal/sub/b.md") && to.ends_with("/archive/journal/sub/b.md")
        }));
        let updated = fs::read_to_string(workspace.join("index.md")).expect("read updated note");
        assert!(updated.contains("[[archive/journal/a]]"));
        assert!(updated.contains("[[archive/journal/sub/b]]"));
        assert!(updated.contains("[[other/note]]"));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn path_link_queries_use_indexed_relations() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-path-link-queries-test");
        let root = workspace.to_string_lossy().to_string();

        fs::write(workspace.join("a.md"), "# A").expect("write a");
        fs::write(workspace.join("b.md"), "# B").expect("write b");
        fs::write(workspace.join("c.md"), "# C").expect("write c");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let conn = open_db().expect("open db");
        conn.execute(
            "INSERT INTO note_links(source_path, target_key) VALUES (?1, ?2)",
            params!["a.md", "b"],
        )
        .expect("insert backlink source");
        conn.execute(
            "INSERT INTO semantic_edges(source_path, target_path, score, model, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["a.md", "b.md", 0.72f32, "test-model", now_ms() as i64],
        )
        .expect("insert incoming semantic edge");
        conn.execute(
            "INSERT INTO semantic_edges(source_path, target_path, score, model, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["b.md", "c.md", 0.91f32, "test-model", now_ms() as i64],
        )
        .expect("insert outgoing semantic edge");

        let backlinks = backlinks_for_path(workspace.join("b.md").to_string_lossy().to_string())
            .expect("load backlinks");
        assert_eq!(backlinks.len(), 1);
        assert!(backlinks[0].path.ends_with("/a.md"));

        let semantic_links =
            semantic_links_for_path(workspace.join("b.md").to_string_lossy().to_string())
                .expect("load semantic links");
        assert_eq!(semantic_links.len(), 2);
        assert!(semantic_links
            .iter()
            .any(|item| item.path.ends_with("/a.md") && item.direction == "incoming"));
        assert!(semantic_links
            .iter()
            .any(|item| item.path.ends_with("/c.md") && item.direction == "outgoing"));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn inject_relative_path_context_prefixes_first_chunk_only() {
        let chunks = vec![
            ("".to_string(), "first".to_string()),
            ("section".to_string(), "second".to_string()),
        ];
        let contextualized = inject_relative_path_context("journal/2026/02/2026-02-16.md", chunks);
        assert_eq!(contextualized.len(), 2);
        assert_eq!(contextualized[0].1, "journal/2026/02/2026-02-16.md\nfirst");
        assert_eq!(contextualized[1].1, "second");
    }

    #[test]
    fn init_db_uses_new_index_schema_columns() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-schema-test");
        let root = workspace.to_string_lossy().to_string();

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let conn = open_db().expect("open db");
        let chunk_columns: Vec<String> = {
            let mut stmt = conn
                .prepare("PRAGMA table_info(chunks)")
                .expect("prepare chunk pragma");
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .expect("query chunk pragma");
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .expect("collect chunk columns")
        };
        assert!(chunk_columns.iter().any(|name| name == "chunk_ord"));
        assert!(chunk_columns.iter().any(|name| name == "content_hash"));

        let embedding_columns: Vec<String> = {
            let mut stmt = conn
                .prepare("PRAGMA table_info(embeddings)")
                .expect("prepare embedding pragma");
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .expect("query embedding pragma");
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .expect("collect embedding columns")
        };
        assert!(embedding_columns.iter().any(|name| name == "content_hash"));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn lexical_reindex_updates_fts_data_without_embedding_rows() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-lexical-only-test");
        let root = workspace.to_string_lossy().to_string();
        let note_path = workspace.join("notes.md");
        fs::write(
            &note_path,
            "---\ntags: [dev]\npriority: 2\n---\n# Alpha\nhello world\n[[beta]]",
        )
        .expect("write note");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");
        reindex_markdown_file_lexical_sync(note_path.to_string_lossy().to_string())
            .expect("lexical reindex");

        let conn = open_db().expect("open db");
        let chunks_n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chunks WHERE path = 'notes.md'",
                [],
                |row| row.get(0),
            )
            .expect("query chunks");
        let links_n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM note_links WHERE source_path = 'notes.md'",
                [],
                |row| row.get(0),
            )
            .expect("query links");
        let props_n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM note_properties WHERE path = 'notes.md'",
                [],
                |row| row.get(0),
            )
            .expect("query properties");
        let embedding_n: i64 = conn
            .query_row("SELECT COUNT(*) FROM embeddings", [], |row| row.get(0))
            .expect("query embeddings");
        let note_embedding_n: i64 = conn
            .query_row("SELECT COUNT(*) FROM note_embeddings", [], |row| row.get(0))
            .expect("query note embeddings");

        assert!(chunks_n > 0);
        assert_eq!(links_n, 1);
        assert!(props_n >= 2);
        assert_eq!(embedding_n, 0);
        assert_eq!(note_embedding_n, 0);

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn lexical_reindex_stores_relative_path_in_first_chunk() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-lexical-context-test");
        let root = workspace.to_string_lossy().to_string();
        let note_path = workspace.join("nested").join("topic.md");
        fs::create_dir_all(note_path.parent().expect("parent")).expect("create nested");
        fs::write(&note_path, "# Heading\nline one\nline two").expect("write note");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");
        reindex_markdown_file_lexical_sync(note_path.to_string_lossy().to_string())
            .expect("lexical reindex");

        let conn = open_db().expect("open db");
        let first_chunk: String = conn
            .query_row(
                "SELECT text FROM chunks WHERE path = 'nested/topic.md' AND chunk_ord = 0",
                [],
                |row| row.get(0),
            )
            .expect("query first chunk");
        assert!(first_chunk.starts_with("nested/topic.md\n"));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn semantic_reindex_handles_notes_without_chunks() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-semantic-empty-note-test");
        let root = workspace.to_string_lossy().to_string();
        let note_path = workspace.join("empty.md");
        fs::write(&note_path, "   \n\n").expect("write empty note");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");
        reindex_markdown_file_lexical_sync(note_path.to_string_lossy().to_string())
            .expect("lexical reindex");
        reindex_markdown_file_semantic_sync(note_path.to_string_lossy().to_string())
            .expect("semantic reindex");

        let conn = open_db().expect("open db");
        let note_embedding_n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM note_embeddings WHERE path = 'empty.md'",
                [],
                |row| row.get(0),
            )
            .expect("query note embeddings");
        assert_eq!(note_embedding_n, 0);

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn semantic_reindex_reuses_stored_chunk_embeddings_for_multi_chunk_note() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-semantic-reuse-note-test");
        let root = workspace.to_string_lossy().to_string();
        let note_path = workspace.join("topic.md");
        fs::write(&note_path, "# One\nalpha\n# Two\nbeta\n# Three\ngamma\n").expect("write note");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");
        reindex_markdown_file_lexical_sync(note_path.to_string_lossy().to_string())
            .expect("lexical reindex");

        let conn = open_db().expect("open db");
        let mut stmt = conn
            .prepare("SELECT id, content_hash FROM chunks WHERE path = 'topic.md' ORDER BY chunk_ord ASC")
            .expect("prepare chunk query");
        let chunk_rows: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query chunk rows")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("collect chunk rows");
        assert_eq!(chunk_rows.len(), 3);

        for (index, (chunk_id, content_hash)) in chunk_rows.iter().enumerate() {
            let vector = vec![index as f32 + 1.0, 0.5];
            conn.execute(
                "INSERT INTO embeddings(chunk_id, model, dim, content_hash, vector) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    *chunk_id,
                    semantic::embedding_model_name(),
                    vector.len() as i64,
                    content_hash,
                    semantic::vector_to_blob(&vector)
                ],
            )
            .expect("insert chunk embedding");
        }
        drop(stmt);
        drop(conn);

        reindex_markdown_file_semantic_sync(note_path.to_string_lossy().to_string())
            .expect("semantic reindex");

        let conn = open_db().expect("reopen db");
        let embedding_n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE path = 'topic.md')",
                [],
                |row| row.get(0),
            )
            .expect("query chunk embeddings");
        let note_embedding_n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM note_embeddings WHERE path = 'topic.md'",
                [],
                |row| row.get(0),
            )
            .expect("query note embeddings");
        let note_embedding_dim: i64 = conn
            .query_row(
                "SELECT dim FROM note_embeddings WHERE path = 'topic.md'",
                [],
                |row| row.get(0),
            )
            .expect("query note embedding dim");
        assert_eq!(embedding_n, 3);
        assert_eq!(note_embedding_n, 1);
        assert_eq!(note_embedding_dim, 2);

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn read_index_overview_stats_reports_persisted_counts() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-index-overview-stats");
        let root = workspace.to_string_lossy().to_string();
        fs::write(workspace.join("a.md"), "# A").expect("write a");
        fs::write(workspace.join("b.md"), "# B").expect("write b");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let conn = open_db().expect("open db");
        conn.execute(
            "INSERT INTO note_embeddings(path, model, dim, vector, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["a.md", "test-model", 2_i64, vec![1_u8, 2, 3, 4], 1_i64],
        )
        .expect("insert note embedding a");
        conn.execute(
            "INSERT INTO note_embeddings(path, model, dim, vector, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["b.md", "test-model", 2_i64, vec![5_u8, 6, 7, 8], 1_i64],
        )
        .expect("insert note embedding b");
        conn.execute(
            "INSERT INTO note_processing(path, processed_at_ms) VALUES (?1, ?2)",
            params!["a.md", 1_i64],
        )
        .expect("insert processed note a");
        conn.execute(
            "INSERT INTO note_processing(path, processed_at_ms) VALUES (?1, ?2)",
            params!["b.md", 1_i64],
        )
        .expect("insert processed note b");
        conn.execute(
            "INSERT INTO semantic_edges(source_path, target_path, score, model, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["a.md", "b.md", 0.91_f32, "test-model", 1_i64],
        )
        .expect("insert semantic edge");
        index_schema::record_last_index_run(
            &conn,
            "Semantic links refreshed",
            1710836339000,
            Some(4321),
        )
        .expect("record last run");
        drop(conn);

        let stats = read_index_overview_stats_impl().expect("read overview stats");
        assert_eq!(stats.semantic_links_count, 1);
        assert_eq!(stats.processed_notes_count, 2);
        assert_eq!(stats.workspace_notes_count, 2);
        assert_eq!(stats.last_run_finished_at_ms, Some(1710836339000));
        assert_eq!(
            stats.last_run_title.as_deref(),
            Some("Semantic links refreshed")
        );
        assert_eq!(stats.last_run_duration_ms, Some(4321));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn read_index_overview_stats_reports_processed_notes_independently_of_embeddings() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-index-overview-processed");
        let root = workspace.to_string_lossy().to_string();
        fs::write(workspace.join("a.md"), "# A").expect("write a");
        fs::write(workspace.join("b.md"), "# B").expect("write b");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let conn = open_db().expect("open db");
        conn.execute(
            "INSERT INTO note_processing(path, processed_at_ms) VALUES (?1, ?2)",
            params!["a.md", 1_i64],
        )
        .expect("insert processed note a");
        conn.execute(
            "INSERT INTO note_processing(path, processed_at_ms) VALUES (?1, ?2)",
            params!["b.md", 1_i64],
        )
        .expect("insert processed note b");
        conn.execute(
            "INSERT INTO note_embeddings(path, model, dim, vector, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["a.md", "test-model", 2_i64, vec![1_u8, 2, 3, 4], 1_i64],
        )
        .expect("insert note embedding a");
        drop(conn);

        let stats = read_index_overview_stats_impl().expect("read overview stats");
        assert_eq!(stats.processed_notes_count, 2);
        assert_eq!(stats.workspace_notes_count, 2);

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn read_index_overview_stats_reports_workspace_total_notes() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-index-overview-total");
        let root = workspace.to_string_lossy().to_string();
        fs::create_dir_all(workspace.join("nested")).expect("create nested");
        fs::write(workspace.join("a.md"), "# A").expect("write a");
        fs::write(workspace.join("nested/b.md"), "# B").expect("write b");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let stats = read_index_overview_stats_impl().expect("read overview stats");
        assert_eq!(stats.workspace_notes_count, 2);

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn compute_echoes_pack_rejects_non_markdown_anchor() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-echoes-invalid-anchor");
        let root = workspace.to_string_lossy().to_string();
        let note_path = workspace.join("plain.txt");
        fs::write(&note_path, "text").expect("write non markdown");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let result = echoes::compute_echoes_pack(echoes::ComputeEchoesPackPayload {
            anchor_path: note_path.to_string_lossy().to_string(),
            limit: Some(5),
            include_recent_activity: Some(true),
        });
        assert!(result.is_err());

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn compute_echoes_pack_merges_multi_signal_candidates() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-echoes-merge");
        let root = workspace.to_string_lossy().to_string();
        fs::write(workspace.join("a.md"), "# Anchor\n[[b]]").expect("write a");
        fs::write(workspace.join("b.md"), "# Note B").expect("write b");
        fs::write(workspace.join("c.md"), "# Note C\n[[a]]").expect("write c");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let conn = open_db().expect("open db");
        conn.execute(
            "INSERT INTO note_links(source_path, target_key) VALUES (?1, ?2)",
            params!["a.md", "b"],
        )
        .expect("insert direct link");
        conn.execute(
            "INSERT INTO note_links(source_path, target_key) VALUES (?1, ?2)",
            params!["c.md", "a"],
        )
        .expect("insert backlink");
        conn.execute(
            "INSERT INTO semantic_edges(source_path, target_path, score, model, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["a.md", "b.md", 0.91_f32, "test-model", 1_i64],
        )
        .expect("insert semantic edge");

        let pack = echoes::compute_echoes_pack(echoes::ComputeEchoesPackPayload {
            anchor_path: workspace.join("a.md").to_string_lossy().to_string(),
            limit: Some(5),
            include_recent_activity: Some(false),
        })
        .expect("compute echoes");

        assert!(pack.items.iter().any(|item| {
            item.path.ends_with("/b.md")
                && item.title == "b"
                && item.reason_label == "Direct link"
                && item
                    .reason_labels
                    .iter()
                    .any(|label| label == "Semantically related")
        }));
        assert!(pack.items.iter().any(|item| item.path.ends_with("/c.md")
            && item.title == "c"
            && item.reason_label == "Backlink"));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn compute_echoes_pack_uses_recent_activity_without_semantic_data() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-echoes-recent");
        let root = workspace.to_string_lossy().to_string();
        fs::create_dir_all(workspace.join("notes")).expect("create notes dir");
        fs::write(workspace.join("notes/anchor.md"), "# Anchor").expect("write anchor");
        fs::write(workspace.join("notes/recent.md"), "# Recent").expect("write recent");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let pack = echoes::compute_echoes_pack(echoes::ComputeEchoesPackPayload {
            anchor_path: workspace
                .join("notes/anchor.md")
                .to_string_lossy()
                .to_string(),
            limit: Some(5),
            include_recent_activity: Some(true),
        })
        .expect("compute echoes");

        assert!(pack
            .items
            .iter()
            .any(|item| item.path.ends_with("/notes/recent.md")
                && item.title == "recent"
                && item.reason_label == "Recently active"));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn compute_echoes_pack_uses_filename_title_without_heading() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-echoes-filename-title");
        let root = workspace.to_string_lossy().to_string();
        fs::write(workspace.join("anchor.md"), "[[notes/plain target]]").expect("write anchor");
        fs::create_dir_all(workspace.join("notes")).expect("create notes dir");
        fs::write(
            workspace.join("notes/plain target.md"),
            "body without heading",
        )
        .expect("write target");

        set_active_workspace(&root).expect("set workspace");
        init_db().expect("init db");

        let conn = open_db().expect("open db");
        conn.execute(
            "INSERT INTO note_links(source_path, target_key) VALUES (?1, ?2)",
            params!["anchor.md", "notes/plain target"],
        )
        .expect("insert direct link");

        let pack = echoes::compute_echoes_pack(echoes::ComputeEchoesPackPayload {
            anchor_path: workspace.join("anchor.md").to_string_lossy().to_string(),
            limit: Some(5),
            include_recent_activity: Some(false),
        })
        .expect("compute echoes");

        assert!(pack
            .items
            .iter()
            .any(|item| item.path.ends_with("/notes/plain target.md")
                && item.title == "plain target"));

        clear_active_workspace().expect("clear workspace");
        fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }
}
