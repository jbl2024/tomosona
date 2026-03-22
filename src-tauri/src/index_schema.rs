//! Index schema and full-workspace rebuild helpers.

use std::{
    collections::VecDeque,
    fs,
    path::{Path, PathBuf},
    sync::atomic::Ordering,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::{
    active_workspace_root, ensure_within_root, has_hidden_dir_component, index_log_buffer,
    log_index, next_index_run_id, open_db, reindex_markdown_file_lexical_sync,
    reindex_markdown_file_semantic_sync, semantic, AppError, Result, INDEX_CANCEL_REQUESTED,
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
pub(crate) struct IndexRuntimeStatus {
    pub model_name: String,
    pub model_state: String,
    pub model_init_attempts: u32,
    pub model_last_started_at_ms: Option<u64>,
    pub model_last_finished_at_ms: Option<u64>,
    pub model_last_duration_ms: Option<u64>,
    pub model_last_error: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct IndexOverviewStats {
    pub semantic_links_count: u64,
    pub indexed_notes_count: u64,
    pub workspace_notes_count: u64,
    pub last_run_finished_at_ms: Option<u64>,
    pub last_run_title: Option<String>,
}

const INTERNAL_META_LAST_RUN_FINISHED_AT_MS_KEY: &str = "last_index_run_finished_at_ms";
const INTERNAL_META_LAST_RUN_TITLE_KEY: &str = "last_index_run_title";

fn sanitize_log_value(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '/' | ':') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn sqlite_error_tokens(err: &rusqlite::Error) -> String {
    let mut tokens = vec![format!("err={}", sanitize_log_value(&err.to_string()))];
    if let rusqlite::Error::SqliteFailure(code, message) = err {
        tokens.push(format!("sqlite_code={:?}", code.code));
        tokens.push(format!("sqlite_extended={}", code.extended_code));
        if let Some(message) = message {
            tokens.push(format!("sqlite_msg={}", sanitize_log_value(message)));
        }
    }
    tokens.push(format!("err_debug={}", sanitize_log_value(&format!("{err:?}"))));
    tokens.join(" ")
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> bool {
    let pragma = format!("PRAGMA table_info({table})");
    let mut stmt = match conn.prepare(&pragma) {
        Ok(stmt) => stmt,
        Err(_) => return false,
    };
    let rows = match stmt.query_map([], |row| row.get::<_, String>(1)) {
        Ok(rows) => rows,
        Err(_) => return false,
    };

    for name in rows.flatten() {
        if name == column {
            return true;
        }
    }
    false
}

fn schema_shape_needs_reset(conn: &Connection, current_version: i64) -> bool {
    if current_version == 0 {
        return false;
    }
    if current_version < 3 {
        return false;
    }

    !table_has_column(conn, "second_brain_sessions", "alter_id")
}

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

    let reset_for_version = current_version != INDEX_SCHEMA_VERSION;
    let reset_for_shape = !reset_for_version && schema_shape_needs_reset(conn, current_version);

    if reset_for_version || reset_for_shape {
        log_index(&format!(
            "schema:reset old_version={current_version} new_version={INDEX_SCHEMA_VERSION} reset_for_shape={reset_for_shape}"
        ));
        conn.execute_batch(
            r#"
      DROP TABLE IF EXISTS note_embeddings_vec;
      DROP TABLE IF EXISTS embeddings;
      DROP TABLE IF EXISTS chunks_fts;
      DROP TABLE IF EXISTS chunks;
      DROP TABLE IF EXISTS note_embeddings;
      DROP TABLE IF EXISTS note_links;
      DROP TABLE IF EXISTS note_properties;
      DROP TABLE IF EXISTS semantic_edges;
      DROP TABLE IF EXISTS second_brain_session_targets;
      DROP TABLE IF EXISTS second_brain_drafts;
      DROP TABLE IF EXISTS second_brain_messages;
      DROP TABLE IF EXISTS second_brain_context_items;
      DROP TABLE IF EXISTS second_brain_sessions;
      DELETE FROM internal_meta WHERE key IN ('last_index_run_finished_at_ms', 'last_index_run_title');
      DELETE FROM internal_meta WHERE key = 'index_schema_version';
    "#,
        )?;
    }

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

    CREATE TABLE IF NOT EXISTS embeddings (
      chunk_id INTEGER PRIMARY KEY,
      model TEXT NOT NULL,
      dim INTEGER NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      vector BLOB NOT NULL,
      FOREIGN KEY(chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS note_embeddings (
      path TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      dim INTEGER NOT NULL,
      vector BLOB NOT NULL,
      updated_at_ms INTEGER NOT NULL DEFAULT 0
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

    CREATE TABLE IF NOT EXISTS semantic_edges (
      source_path TEXT NOT NULL,
      target_path TEXT NOT NULL,
      score REAL NOT NULL,
      model TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(source_path, target_path)
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_edges_source ON semantic_edges(source_path);
    CREATE INDEX IF NOT EXISTS idx_semantic_edges_target ON semantic_edges(target_path);

    CREATE TABLE IF NOT EXISTS second_brain_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      alter_id TEXT NOT NULL DEFAULT '',
      created_at_ms INTEGER NOT NULL DEFAULT 0,
      updated_at_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_second_brain_sessions_updated ON second_brain_sessions(updated_at_ms DESC);

    CREATE TABLE IF NOT EXISTS second_brain_context_items (
      session_id TEXT NOT NULL,
      path TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(session_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_second_brain_context_session_order
      ON second_brain_context_items(session_id, sort_order ASC);

    CREATE TABLE IF NOT EXISTS second_brain_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'freestyle',
      content_md TEXT NOT NULL DEFAULT '',
      citations_json TEXT NOT NULL DEFAULT '[]',
      attachments_json TEXT NOT NULL DEFAULT '[]',
      created_at_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_second_brain_messages_session_created
      ON second_brain_messages(session_id, created_at_ms ASC);

    CREATE TABLE IF NOT EXISTS second_brain_drafts (
      session_id TEXT PRIMARY KEY,
      content_md TEXT NOT NULL DEFAULT '',
      updated_at_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS second_brain_session_targets (
      session_id TEXT PRIMARY KEY,
      target_note_path TEXT NOT NULL DEFAULT '',
      updated_at_ms INTEGER NOT NULL DEFAULT 0
    );

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

pub(crate) fn refresh_semantic_edges_cache_now_sync() -> Result<()> {
    let root = active_workspace_root()?;
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    refresh_semantic_edges_cache(&conn, &root)
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

pub(crate) fn refresh_semantic_edges_cache(conn: &Connection, root_canonical: &Path) -> Result<()> {
    let started_at = Instant::now();
    let run_id = next_index_run_id();
    let mut source_paths: Vec<String> = {
        let mut stmt = conn.prepare("SELECT path FROM note_embeddings_vec ORDER BY path")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        items
    };
    source_paths.sort_by_key(|item| item.to_lowercase());
    log_index(&format!(
        "semantic_edges:refresh_start run_id={} phase=scan_sources sources={} top_k={} threshold={}",
        run_id,
        source_paths.len(),
        crate::SEMANTIC_TOP_K_PER_NOTE,
        crate::SEMANTIC_THRESHOLD
    ));

    log_index(&format!(
        "semantic_edges:refresh_phase run_id={} phase=clear_cache",
        run_id
    ));
    conn.execute("DELETE FROM semantic_edges", [])
        .map_err(|err| {
            log_index(&format!(
                "semantic_edges:refresh_error run_id={} phase=clear_cache {}",
                run_id,
                sqlite_error_tokens(&err)
            ));
            AppError::Sqlite(err)
        })?;
    let updated_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0);

    let mut sources_with_vector = 0usize;
    let mut sources_query_ok = 0usize;
    let mut total_candidates = 0usize;
    let mut total_added = 0usize;
    let mut total_skipped_self = 0usize;
    let mut total_skipped_threshold = 0usize;
    let mut total_skipped_existing_link = 0usize;
    let mut total_skipped_missing_target_key = 0usize;

    let source_count = source_paths.len();
    for (source_index, source_path) in source_paths.into_iter().enumerate() {
        log_index(&format!(
            "semantic_edges:refresh_phase run_id={} phase=query_neighbors source_index={} source_total={} source_path={}",
            run_id,
            source_index + 1,
            source_count,
            source_path
        ));
        let mut stmt = conn.prepare(
            r#"
            SELECT path, distance
            FROM note_embeddings_vec
            WHERE embedding MATCH (SELECT embedding FROM note_embeddings_vec WHERE path = ?1)
            ORDER BY distance ASC
            LIMIT ?2
        "#,
        ).map_err(|err| {
            log_index(&format!(
                "semantic_edges:refresh_error run_id={} phase=prepare_query source_path={} {}",
                run_id,
                source_path,
                sqlite_error_tokens(&err)
            ));
            AppError::Sqlite(err)
        })?;
        let mut rows = stmt.query(params![
            source_path.clone(),
            crate::SEMANTIC_TOP_K_PER_NOTE + 1
        ]).map_err(|err| {
            log_index(&format!(
                "semantic_edges:refresh_error run_id={} phase=run_query source_path={} {}",
                run_id,
                source_path,
                sqlite_error_tokens(&err)
            ));
            AppError::Sqlite(err)
        })?;
        sources_with_vector += 1;
        sources_query_ok += 1;

        let mut added_for_source = 0i64;
        while let Some(row) = rows.next().map_err(|err| {
            log_index(&format!(
                "semantic_edges:refresh_error run_id={} phase=read_query_row source_path={} {}",
                run_id,
                source_path,
                sqlite_error_tokens(&err)
            ));
            AppError::Sqlite(err)
        })? {
            total_candidates += 1;
            let target_path: String = row.get(0)?;
            let distance: f32 = row.get(1)?;
            if target_path == source_path {
                total_skipped_self += 1;
                continue;
            }
            let score = (1.0 - ((distance * distance) * 0.5)).clamp(0.0, 1.0);
            if score < crate::SEMANTIC_THRESHOLD {
                total_skipped_threshold += 1;
                continue;
            }

            let Some(target_key) =
                crate::normalize_note_key_from_workspace_path(root_canonical, &target_path)
            else {
                total_skipped_missing_target_key += 1;
                continue;
            };

            let exists = conn.query_row(
                "SELECT 1 FROM note_links WHERE source_path = ?1 AND target_key = ?2 LIMIT 1",
                params![source_path.clone(), target_key],
                |_row| Ok(()),
            );
            if exists.is_ok() {
                total_skipped_existing_link += 1;
                continue;
            }

            conn.execute(
                "INSERT INTO semantic_edges(source_path, target_path, score, model, updated_at_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    source_path.clone(),
                    target_path.clone(),
                    score,
                    semantic::embedding_model_name(),
                    updated_at_ms
                ],
            )
            .map_err(|err| {
                log_index(&format!(
                    "semantic_edges:refresh_error run_id={} phase=insert_edge source_path={} target_path={} score={} {}",
                    run_id,
                    source_path,
                    target_path,
                    score,
                    sqlite_error_tokens(&err)
                ));
                AppError::Sqlite(err)
            })?;
            total_added += 1;
            added_for_source += 1;
            if added_for_source >= crate::SEMANTIC_TOP_K_PER_NOTE {
                break;
            }
        }
    }

    log_index(&format!(
        "semantic_edges:refresh_done run_id={} phase=done sources_with_vector={} sources_query_ok={} candidates={} added={} skip_self={} skip_threshold={} skip_existing_link={} skip_missing_target_key={} missing_vectors={} total_ms={}",
        run_id,
        sources_with_vector,
        sources_query_ok,
        total_candidates,
        total_added,
        total_skipped_self,
        total_skipped_threshold,
        total_skipped_existing_link,
        total_skipped_missing_target_key,
        0,
        started_at.elapsed().as_millis()
    ));
    let _ = record_last_index_run(conn, "Semantic links refreshed", crate::now_ms());
    Ok(())
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
    DELETE FROM embeddings;
    DELETE FROM note_embeddings;
    DELETE FROM chunks;
    DELETE FROM note_links;
    DELETE FROM note_properties;
    DELETE FROM semantic_edges;
  "#,
    )?;
    let _ = conn.execute("DELETE FROM note_embeddings_vec", []);

    let markdown_files = list_markdown_files_via_find(&root_canonical)?;
    let mut indexed_files = 0usize;
    let mut processed_files = 0usize;
    let mut semantic_indexed = 0usize;
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

    if !canceled {
        let markdown_files = list_markdown_files_via_find(&root_canonical)?;
        for candidate in markdown_files {
            if INDEX_CANCEL_REQUESTED.load(Ordering::SeqCst) {
                canceled = true;
                break;
            }
            let canonical_candidate = match fs::canonicalize(&candidate) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if ensure_within_root(&root_canonical, &canonical_candidate).is_err() {
                continue;
            }
            if reindex_markdown_file_semantic_sync(
                canonical_candidate.to_string_lossy().to_string(),
            )
            .is_ok()
            {
                semantic_indexed += 1;
            }
        }
    }

    if !canceled {
        let _ = refresh_semantic_edges_cache_now_sync();
    }

    log_index(&format!(
        "rebuild:done indexed={indexed_files} semantic_indexed={semantic_indexed} scanned={processed_files} canceled={canceled} total_ms={}",
        rebuild_started_at.elapsed().as_millis()
    ));
    if !canceled {
        let finished_at_ms = crate::now_ms();
        let _ = record_last_index_run(&conn, "Workspace rebuild done", finished_at_ms);
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

pub(crate) fn read_index_runtime_status() -> Result<IndexRuntimeStatus> {
    let status = semantic::runtime_status();
    Ok(IndexRuntimeStatus {
        model_name: status.model_name,
        model_state: status.model_state,
        model_init_attempts: status.model_init_attempts,
        model_last_started_at_ms: status.model_last_started_at_ms,
        model_last_finished_at_ms: status.model_last_finished_at_ms,
        model_last_duration_ms: status.model_last_duration_ms,
        model_last_error: status.model_last_error,
    })
}

pub(crate) fn read_index_overview_stats() -> Result<IndexOverviewStats> {
    let conn = open_db()?;
    let root = active_workspace_root()?;
    let semantic_links_count = conn.query_row("SELECT COUNT(*) FROM semantic_edges", [], |row| row.get::<_, i64>(0))? as u64;
    let indexed_notes_count = conn.query_row("SELECT COUNT(*) FROM note_embeddings", [], |row| row.get::<_, i64>(0))? as u64;
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
    Ok(IndexOverviewStats {
        semantic_links_count,
        indexed_notes_count,
        workspace_notes_count,
        last_run_finished_at_ms,
        last_run_title,
    })
}

pub(crate) fn record_last_index_run(conn: &Connection, title: &str, finished_at_ms: u64) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO internal_meta(key, value) VALUES (?1, ?2)",
        params![INTERNAL_META_LAST_RUN_FINISHED_AT_MS_KEY, finished_at_ms.to_string()],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO internal_meta(key, value) VALUES (?1, ?2)",
        params![INTERNAL_META_LAST_RUN_TITLE_KEY, title],
    )?;
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

#[cfg(test)]
mod tests {
    use super::{sanitize_log_value, sqlite_error_tokens};

    #[test]
    fn sanitize_log_value_replaces_whitespace_and_symbols() {
        assert_eq!(
            sanitize_log_value("UNIQUE constraint failed: semantic_edges(source_path, target_path)"),
            "UNIQUE_constraint_failed:_semantic_edges_source_path__target_path_"
        );
    }

    #[test]
    fn sqlite_error_tokens_include_debug_details_for_non_sqlite_failure_variants() {
        let tokens = sqlite_error_tokens(&rusqlite::Error::InvalidQuery);

        assert!(tokens.contains("err="));
        assert!(tokens.contains("err_debug=InvalidQuery"));
    }
}
