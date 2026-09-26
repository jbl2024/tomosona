//! Index schema and full-workspace rebuild helpers.

use std::{
    collections::VecDeque,
    fs,
    path::{Path, PathBuf},
    sync::atomic::Ordering,
    time::Instant,
};

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::{
    active_workspace_root, ensure_within_root, has_hidden_dir_component, index_log_buffer,
    log_index, open_db, reindex_markdown_file_lexical_sync, AppError, Result, INDEX_CANCEL_REQUESTED,
    INDEX_LOG_CAPACITY, INDEX_SCHEMA_VERSION,
};

#[derive(Clone, Serialize)]
pub(crate) struct IndexLogEntry {
    pub ts_ms: u64,
    pub message: String,
}

#[derive(Serialize)]
pub(crate) struct RebuildIndexResult {
    pub indexed_files: usize,
    pub canceled: bool,
}

#[derive(Serialize)]
pub(crate) struct IndexOverviewStats {
    pub processed_notes_count: u64,
    pub workspace_notes_count: u64,
    pub last_run_finished_at_ms: Option<u64>,
    pub last_run_title: Option<String>,
    pub last_run_duration_ms: Option<u64>,
}

const INTERNAL_META_LAST_RUN_FINISHED_AT_MS_KEY: &str = "last_index_run_finished_at_ms";
const INTERNAL_META_LAST_RUN_TITLE_KEY: &str = "last_index_run_title";
const INTERNAL_META_LAST_RUN_DURATION_MS_KEY: &str = "last_index_run_duration_ms";

pub(crate) fn ensure_index_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS internal_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  "#,
    )?;

    let current_version = conn
        .query_row(
            "SELECT value FROM internal_meta WHERE key = 'index_schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    // Version 3 databases can include a `vec0` virtual table.  Its extension is
    // intentionally no longer loaded, so attempting to drop that table makes
    // SQLite reject the migration.  The lexical tables remain compatible and
    // are retained while the schema version advances below.
    let _legacy_schema_version = current_version;

    conn.execute_batch(
        r#"
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      chunk_ord INTEGER NOT NULL DEFAULT 0,
      anchor TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      mtime INTEGER NOT NULL DEFAULT 0,
      UNIQUE(path, chunk_ord)
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      path,
      anchor,
      text,
      content='chunks',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, path, anchor, text) VALUES (new.id, new.path, new.anchor, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, path, anchor, text) VALUES('delete', old.id, old.path, old.anchor, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, path, anchor, text) VALUES('delete', old.id, old.path, old.anchor, old.text);
      INSERT INTO chunks_fts(rowid, path, anchor, text) VALUES (new.id, new.path, new.anchor, new.text);
    END;

    CREATE TABLE IF NOT EXISTS note_processing (
      path TEXT PRIMARY KEY,
      processed_at_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS note_links (
      source_path TEXT NOT NULL,
      target_key TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_path);
    CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_key);

    CREATE TABLE IF NOT EXISTS note_properties (
      path TEXT NOT NULL,
      key TEXT NOT NULL,
      kind TEXT NOT NULL,
      value_text TEXT,
      value_num REAL,
      value_bool INTEGER,
      value_date TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_note_properties_path ON note_properties(path);
    CREATE INDEX IF NOT EXISTS idx_note_properties_key ON note_properties(key);
    CREATE INDEX IF NOT EXISTS idx_note_properties_key_text ON note_properties(key, value_text);
    CREATE INDEX IF NOT EXISTS idx_note_properties_key_num ON note_properties(key, value_num);
    CREATE INDEX IF NOT EXISTS idx_note_properties_key_bool ON note_properties(key, value_bool);
    CREATE INDEX IF NOT EXISTS idx_note_properties_key_date ON note_properties(key, value_date);

  "#,
    )?;

    conn.execute(
        "INSERT OR REPLACE INTO internal_meta(key, value) VALUES ('index_schema_version', ?1)",
        params![INDEX_SCHEMA_VERSION.to_string()],
    )?;

    Ok(())
}

pub(crate) fn init_db() -> Result<()> {
    let conn = open_db()?;
    ensure_index_schema(&conn)
}

pub(crate) fn min_max_normalize(values: &[f64]) -> Vec<f64> {
    if values.is_empty() {
        return Vec::new();
    }
    let min = values
        .iter()
        .copied()
        .fold(f64::INFINITY, |acc, item| acc.min(item));
    let max = values
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, |acc, item| acc.max(item));
    if (max - min).abs() <= f64::EPSILON {
        return vec![1.0; values.len()];
    }
    values
        .iter()
        .map(|value| (value - min) / (max - min))
        .collect()
}

pub(crate) fn rebuild_workspace_index_sync() -> Result<RebuildIndexResult> {
    let rebuild_started_at = Instant::now();
    let root_canonical = active_workspace_root()?;
    log_index(&format!(
        "rebuild:start workspace={}",
        root_canonical.to_string_lossy()
    ));
    let conn = open_db()?;
    ensure_index_schema(&conn)?;

    conn.execute_batch(
        r#"
    DELETE FROM note_processing;
    DELETE FROM chunks;
    DELETE FROM note_links;
    DELETE FROM note_properties;
  "#,
    )?;

    let markdown_files = list_markdown_files_via_find(&root_canonical)?;
    let mut indexed_files = 0usize;
    let mut processed_files = 0usize;
    let mut canceled = false;
    INDEX_CANCEL_REQUESTED.store(false, Ordering::SeqCst);
    for candidate in markdown_files {
        if INDEX_CANCEL_REQUESTED.load(Ordering::SeqCst) {
            canceled = true;
            break;
        }
        processed_files += 1;
        let canonical_candidate = match fs::canonicalize(&candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if ensure_within_root(&root_canonical, &canonical_candidate).is_err() {
            continue;
        }
        reindex_markdown_file_lexical_sync(canonical_candidate.to_string_lossy().to_string())?;
        indexed_files += 1;
    }

    log_index(&format!(
        "rebuild:done indexed={indexed_files} scanned={processed_files} canceled={canceled} total_ms={}",
        rebuild_started_at.elapsed().as_millis()
    ));
    if !canceled {
        let finished_at_ms = crate::now_ms();
        let _ = record_last_index_run(
            &conn,
            "Workspace rebuild done",
            finished_at_ms,
            Some(rebuild_started_at.elapsed().as_millis() as u64),
        );
    }
    Ok(RebuildIndexResult {
        indexed_files,
        canceled,
    })
}

pub(crate) fn request_index_cancel() -> Result<()> {
    INDEX_CANCEL_REQUESTED.store(true, Ordering::SeqCst);
    log_index("cancel:requested");
    Ok(())
}

pub(crate) fn read_index_overview_stats() -> Result<IndexOverviewStats> {
    let conn = open_db()?;
    let root = active_workspace_root()?;
    let processed_notes_count = conn.query_row(
        r#"
        SELECT CASE
          WHEN EXISTS(SELECT 1 FROM note_processing)
            THEN (SELECT COUNT(*) FROM note_processing)
          ELSE (SELECT COUNT(DISTINCT path) FROM chunks)
        END
        "#,
        [],
        |row| row.get::<_, i64>(0),
    )? as u64;
    let workspace_notes_count = list_markdown_files_via_find(&root)?.len() as u64;
    let last_run_finished_at_ms = conn
        .query_row(
            "SELECT value FROM internal_meta WHERE key = ?1",
            [INTERNAL_META_LAST_RUN_FINISHED_AT_MS_KEY],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|value| value.parse::<u64>().ok());
    let last_run_title = conn
        .query_row(
            "SELECT value FROM internal_meta WHERE key = ?1",
            [INTERNAL_META_LAST_RUN_TITLE_KEY],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let last_run_duration_ms = conn
        .query_row(
            "SELECT value FROM internal_meta WHERE key = ?1",
            [INTERNAL_META_LAST_RUN_DURATION_MS_KEY],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|value| value.parse::<u64>().ok());
    Ok(IndexOverviewStats {
        processed_notes_count,
        workspace_notes_count,
        last_run_finished_at_ms,
        last_run_title,
        last_run_duration_ms,
    })
}

pub(crate) fn record_last_index_run(
    conn: &Connection,
    title: &str,
    finished_at_ms: u64,
    duration_ms: Option<u64>,
) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO internal_meta(key, value) VALUES (?1, ?2)",
        params![
            INTERNAL_META_LAST_RUN_FINISHED_AT_MS_KEY,
            finished_at_ms.to_string()
        ],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO internal_meta(key, value) VALUES (?1, ?2)",
        params![INTERNAL_META_LAST_RUN_TITLE_KEY, title],
    )?;
    match duration_ms {
        Some(duration_ms) => {
            conn.execute(
                "INSERT OR REPLACE INTO internal_meta(key, value) VALUES (?1, ?2)",
                params![
                    INTERNAL_META_LAST_RUN_DURATION_MS_KEY,
                    duration_ms.to_string()
                ],
            )?;
        }
        None => {
            conn.execute(
                "DELETE FROM internal_meta WHERE key = ?1",
                params![INTERNAL_META_LAST_RUN_DURATION_MS_KEY],
            )?;
        }
    }
    Ok(())
}

pub(crate) fn read_index_logs(limit: Option<usize>) -> Result<Vec<IndexLogEntry>> {
    let max_items = limit.unwrap_or(80).clamp(1, INDEX_LOG_CAPACITY);
    let guard: std::sync::MutexGuard<'_, VecDeque<IndexLogEntry>> = index_log_buffer()
        .lock()
        .map_err(|_| AppError::OperationFailed)?;
    let start = guard.len().saturating_sub(max_items);
    Ok(guard.iter().skip(start).cloned().collect())
}

pub(crate) fn list_markdown_files_via_find(root: &Path) -> Result<Vec<PathBuf>> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if path.is_dir() {
                if crate::workspace_paths::should_skip_workspace_walk_dir(&name, &path) {
                    continue;
                }
                walk(root, &path, out)?;
                continue;
            }

            if !path.is_file() || crate::workspace_paths::should_skip_workspace_walk_file(&path) {
                continue;
            }

            let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
                continue;
            };

            if (ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
                && !has_hidden_dir_component(root, &path)
            {
                out.push(path);
            }
        }
        Ok(())
    }

    let mut files = Vec::new();
    walk(root, root, &mut files)?;
    Ok(files)
}
