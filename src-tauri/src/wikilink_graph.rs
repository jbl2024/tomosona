//! Wikilink graph, backlinks and rename update helpers.

use std::{
    collections::{HashMap, HashSet},
    env,
    fs,
    path::{Path, PathBuf},
    time::Instant,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::{
    active_workspace_root, list_markdown_files_via_find, normalize_note_key,
    normalize_note_key_from_workspace_path, normalize_workspace_path,
    normalize_workspace_relative_path, note_key_basename, note_label_from_workspace_path,
    note_link_target, open_db, refresh_semantic_edges_cache_now_sync,
    reindex_markdown_file_now_sync,
    rewrite_wikilinks_for_note, workspace_absolute_path, AppError, Result,
};
use crate::markdown_index::{
    reindex_markdown_file_lexical_sync, reindex_markdown_file_semantic_sync,
};

#[derive(Serialize)]
pub(crate) struct GraphNodeDto {
    pub id: String,
    pub path: String,
    pub label: String,
    pub degree: usize,
    pub tags: Vec<String>,
    pub cluster: Option<usize>,
}

#[derive(Serialize)]
pub(crate) struct GraphEdgeDto {
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub edge_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f32>,
}

#[derive(Serialize)]
pub(crate) struct WikilinkGraphDto {
    pub nodes: Vec<GraphNodeDto>,
    pub edges: Vec<GraphEdgeDto>,
    pub generated_at_ms: u64,
}

#[derive(Serialize)]
pub(crate) struct Backlink {
    pub path: String,
}

#[derive(Serialize)]
pub(crate) struct SemanticLink {
    pub path: String,
    pub score: Option<f32>,
    pub direction: String,
}

#[derive(Serialize)]
pub(crate) struct WikilinkRewriteResult {
    pub updated_files: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct PathMoveInput {
    #[serde(alias = "fromPath")]
    pub from_path: String,
    #[serde(alias = "toPath")]
    pub to_path: String,
}

#[derive(Serialize)]
pub(crate) struct PathMoveRewriteResult {
    pub updated_files: usize,
    pub reindexed_files: usize,
    pub moved_markdown_files: usize,
}

fn should_log_open_perf(elapsed_ms: u128) -> bool {
    env::var("TOMOSONA_DEBUG_OPEN")
        .map(|value| value == "1")
        .unwrap_or(false)
        || elapsed_ms >= 75
}

fn log_open_perf(command: &str, path: &str, started_at: Instant, extra_fields: &[(&str, String)]) {
    let elapsed_ms = started_at.elapsed().as_millis();
    if !should_log_open_perf(elapsed_ms) {
        return;
    }

    let mut fields = vec![
        format!("cmd={command}"),
        format!("total_ms={elapsed_ms}"),
        format!("path={path}"),
    ];
    for (key, value) in extra_fields {
        fields.push(format!("{key}={value}"));
    }
    eprintln!("[open-perf] {}", fields.join(" "));
}

pub(crate) fn build_wikilink_graph_from_index(
    conn: &Connection,
    root_canonical: &Path,
    markdown_paths: &[String],
) -> Result<WikilinkGraphDto> {
    let mut nodes_set = HashSet::new();
    for path in markdown_paths {
        nodes_set.insert(path.clone());
    }

    let mut path_by_key: HashMap<String, String> = HashMap::new();
    let mut path_by_unique_basename: HashMap<String, Option<String>> = HashMap::new();
    for path in markdown_paths {
        if let Some(key) = normalize_note_key_from_workspace_path(root_canonical, path) {
            let basename = note_key_basename(&key);
            let existing = path_by_key.get(&key).cloned();
            if let Some(previous) = existing {
                if path.to_lowercase() < previous.to_lowercase() {
                    path_by_key.insert(key.clone(), path.clone());
                }
            } else {
                path_by_key.insert(key.clone(), path.clone());
            }

            match path_by_unique_basename.get(&basename) {
                Some(Some(previous)) if !previous.eq_ignore_ascii_case(path) => {
                    path_by_unique_basename.insert(basename, None);
                }
                Some(None) => {}
                _ => {
                    path_by_unique_basename.insert(basename, Some(path.clone()));
                }
            }
        }
    }

    let mut tags_by_path: HashMap<String, Vec<String>> = HashMap::new();
    let mut tag_stmt = conn.prepare(
        r#"
      SELECT path, value_text
      FROM note_properties
      WHERE key = 'tags' AND kind = 'list' AND value_text IS NOT NULL
      ORDER BY path, value_text
    "#,
    )?;
    let tag_rows = tag_stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    for row in tag_rows {
        let (path, value) = row?;
        if !nodes_set.contains(&path) {
            continue;
        }
        let entry = tags_by_path.entry(path).or_default();
        if !entry.iter().any(|item| item.eq_ignore_ascii_case(&value)) {
            entry.push(value);
        }
    }

    let mut degrees: HashMap<String, usize> = HashMap::new();
    let mut edges: Vec<GraphEdgeDto> = Vec::new();
    let mut seen_edges: HashSet<(String, String)> = HashSet::new();

    let mut edge_stmt = conn.prepare(
        r#"
      SELECT source_path, target_key
      FROM note_links
      ORDER BY source_path, target_key
    "#,
    )?;
    let edge_rows = edge_stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    for row in edge_rows {
        let (source_path, target_key) = row?;
        if !nodes_set.contains(&source_path) {
            continue;
        }
        let target_path = path_by_key.get(&target_key).cloned().or_else(|| {
            if target_key.contains('/') {
                return None;
            }
            path_by_unique_basename
                .get(&target_key)
                .and_then(|value| value.clone())
        });
        let Some(target_path) = target_path else {
            continue;
        };
        if source_path == target_path
            || !seen_edges.insert((source_path.clone(), target_path.clone()))
        {
            continue;
        }

        *degrees.entry(source_path.clone()).or_insert(0) += 1;
        *degrees.entry(target_path.clone()).or_insert(0) += 1;

        edges.push(GraphEdgeDto {
            source: source_path,
            target: target_path,
            edge_type: "wikilink".to_string(),
            score: None,
        });
    }

    let mut semantic_stmt = conn.prepare(
        r#"
      SELECT source_path, target_path, score
      FROM semantic_edges
      ORDER BY source_path, target_path
    "#,
    )?;
    let semantic_rows = semantic_stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, f32>(2)?,
        ))
    })?;

    for row in semantic_rows {
        let (source_path, target_path, score) = row?;
        if !nodes_set.contains(&source_path)
            || !nodes_set.contains(&target_path)
            || source_path == target_path
            || !seen_edges.insert((source_path.clone(), target_path.clone()))
        {
            continue;
        }
        edges.push(GraphEdgeDto {
            source: source_path.clone(),
            target: target_path.clone(),
            edge_type: "semantic".to_string(),
            score: Some(score),
        });
        *degrees.entry(source_path).or_insert(0) += 1;
        *degrees.entry(target_path).or_insert(0) += 1;
    }

    let mut node_paths: Vec<String> = markdown_paths.to_vec();
    node_paths.sort_by_key(|item| item.to_lowercase());
    node_paths.dedup_by(|a, b| a.eq_ignore_ascii_case(b));

    let nodes = node_paths
        .into_iter()
        .map(|path| GraphNodeDto {
            id: path.clone(),
            label: note_label_from_workspace_path(&path),
            degree: *degrees.get(&path).unwrap_or(&0),
            tags: tags_by_path.remove(&path).unwrap_or_default(),
            cluster: None,
            path: workspace_absolute_path(root_canonical, &path),
        })
        .collect();

    let generated_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0);

    Ok(WikilinkGraphDto {
        nodes,
        edges,
        generated_at_ms,
    })
}

pub(crate) fn get_wikilink_graph() -> Result<WikilinkGraphDto> {
    let root_canonical = active_workspace_root()?;
    let conn = open_db()?;
    let markdown_files = list_markdown_files_via_find(&root_canonical)?;
    let mut markdown_paths = Vec::new();

    for candidate in markdown_files {
        let canonical_candidate = match fs::canonicalize(&candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let relative =
            match normalize_workspace_relative_path(&root_canonical, &canonical_candidate) {
                Ok(value) => value,
                Err(_) => continue,
            };
        markdown_paths.push(relative);
    }

    build_wikilink_graph_from_index(&conn, &root_canonical, &markdown_paths)
}

pub(crate) fn backlinks_for_path(path: String) -> Result<Vec<Backlink>> {
    let started_at = Instant::now();
    let root_canonical = active_workspace_root()?;
    let mut path_buf = PathBuf::from(path);
    if path_buf.as_os_str().is_empty() {
        return Err(AppError::InvalidPath);
    }
    if !path_buf.is_absolute() {
        path_buf = root_canonical.join(path_buf);
    }
    if path_buf.exists() {
        path_buf = fs::canonicalize(path_buf)?;
    }

    let target_key = normalize_note_key(&root_canonical, &path_buf)?;
    if target_key.is_empty() {
        return Ok(vec![]);
    }

    let conn = open_db()?;
    let mut stmt = conn.prepare(
        r#"
        SELECT DISTINCT source_path
        FROM note_links
        WHERE target_key = ?1
        ORDER BY source_path COLLATE NOCASE
    "#,
    )?;
    let rows = stmt.query_map([target_key.clone()], |row| row.get::<_, String>(0))?;
    let mut out: Vec<Backlink> = Vec::new();
    for row in rows {
        let source_path = row?;
        if source_path == target_key {
            continue;
        }
        out.push(Backlink {
            path: workspace_absolute_path(&root_canonical, &source_path),
        });
    }
    log_open_perf(
        "backlinks_for_path",
        &path_buf.to_string_lossy(),
        started_at,
        &[("count", out.len().to_string())],
    );
    Ok(out)
}

pub(crate) fn semantic_links_for_path(path: String) -> Result<Vec<SemanticLink>> {
    let started_at = Instant::now();
    let root_canonical = active_workspace_root()?;
    let mut path_buf = PathBuf::from(path);
    if path_buf.as_os_str().is_empty() {
        return Err(AppError::InvalidPath);
    }
    if !path_buf.is_absolute() {
        path_buf = root_canonical.join(path_buf);
    }
    if path_buf.exists() {
        path_buf = fs::canonicalize(path_buf)?;
    }

    let target_path = normalize_workspace_relative_path(&root_canonical, &path_buf)?;
    let conn = open_db()?;
    let mut stmt = conn.prepare(
        r#"
        SELECT target_path AS related_path, score, 'outgoing' AS direction
        FROM semantic_edges
        WHERE source_path = ?1
        UNION ALL
        SELECT source_path AS related_path, score, 'incoming' AS direction
        FROM semantic_edges
        WHERE target_path = ?1
        ORDER BY score DESC, related_path COLLATE NOCASE
    "#,
    )?;
    let rows = stmt.query_map([target_path], |row| {
        Ok(SemanticLink {
            path: workspace_absolute_path(&root_canonical, &row.get::<_, String>(0)?),
            score: row.get::<_, f32>(1).ok(),
            direction: row.get::<_, String>(2)?,
        })
    })?;

    let mut out: Vec<SemanticLink> = Vec::new();
    let mut positions_by_key: HashMap<String, usize> = HashMap::new();
    for row in rows {
        let item = row?;
        let key = item.path.to_lowercase();
        if let Some(index) = positions_by_key.get(&key).copied() {
            let existing: &mut SemanticLink = &mut out[index];
            let existing_score = existing.score.unwrap_or(-1.0);
            let next_score = item.score.unwrap_or(-1.0);
            if next_score > existing_score {
                *existing = item;
            }
            continue;
        }
        positions_by_key.insert(key, out.len());
        out.push(item);
    }

    log_open_perf(
        "semantic_links_for_path",
        &path_buf.to_string_lossy(),
        started_at,
        &[("count", out.len().to_string())],
    );
    Ok(out)
}

pub(crate) fn update_wikilinks_for_rename(
    old_path: String,
    new_path: String,
) -> Result<WikilinkRewriteResult> {
    let root_canonical = active_workspace_root()?;
    let old_note_path = normalize_workspace_path(&root_canonical, &old_path)?;
    let new_note_path = normalize_workspace_path(&root_canonical, &new_path)?;

    let old_target_key = normalize_note_key(&root_canonical, &old_note_path)?;
    let new_target = note_link_target(&root_canonical, &new_note_path)?;
    if old_target_key.is_empty()
        || old_target_key == normalize_note_key(&root_canonical, &new_note_path)?
    {
        return Ok(WikilinkRewriteResult { updated_files: 0 });
    }

    let markdown_files = list_markdown_files_via_find(&root_canonical)?;
    let mut changed_files = 0usize;

    for candidate in markdown_files {
        let canonical_candidate = match fs::canonicalize(&candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let markdown = match fs::read_to_string(&canonical_candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let (updated_markdown, changed) =
            rewrite_wikilinks_for_note(&markdown, &old_target_key, &new_target);
        if !changed {
            continue;
        }

        fs::write(&canonical_candidate, updated_markdown)?;
        reindex_markdown_file_now_sync(canonical_candidate.to_string_lossy().to_string())?;
        changed_files += 1;
    }

    Ok(WikilinkRewriteResult {
        updated_files: changed_files,
    })
}

fn collect_note_moves_for_path_move(
    root_canonical: &Path,
    path_move: &PathMoveInput,
) -> Result<Vec<(String, String, PathBuf)>> {
    let old_path = {
        let mut path = PathBuf::from(path_move.from_path.trim());
        if !path.is_absolute() {
            path = root_canonical.join(path);
        }
        if path.exists() {
            normalize_workspace_path(root_canonical, &path.to_string_lossy())?
        } else {
            let parent = path.parent().ok_or(AppError::InvalidPath)?;
            let parent_canonical = fs::canonicalize(parent)?;
            if !parent_canonical.starts_with(root_canonical) {
                return Err(AppError::InvalidPath);
            }
            parent_canonical.join(path.file_name().ok_or(AppError::InvalidPath)?)
        }
    };
    let new_path = normalize_workspace_path(root_canonical, &path_move.to_path)?;

    if new_path.is_dir() {
        let mut expanded = Vec::new();
        for new_file in list_markdown_files_via_find(&new_path)? {
            let Ok(relative) = new_file.strip_prefix(&new_path) else {
                continue;
            };
            let old_file = old_path.join(relative);
            let old_target_key = normalize_note_key(root_canonical, &old_file)?;
            let new_target = note_link_target(root_canonical, &new_file)?;
            if old_target_key.is_empty() || old_target_key == normalize_note_key(root_canonical, &new_file)? {
                continue;
            }
            expanded.push((old_target_key, new_target, new_file));
        }
        return Ok(expanded);
    }

    if !new_path.is_file() {
        return Ok(Vec::new());
    }

    let old_target_key = normalize_note_key(root_canonical, &old_path)?;
    let new_target = note_link_target(root_canonical, &new_path)?;
    if old_target_key.is_empty() || old_target_key == normalize_note_key(root_canonical, &new_path)? {
        return Ok(Vec::new());
    }

    Ok(vec![(old_target_key, new_target, new_path)])
}

pub(crate) fn update_wikilinks_for_path_moves(
    moves: Vec<PathMoveInput>,
) -> Result<PathMoveRewriteResult> {
    let root_canonical = active_workspace_root()?;
    let mut note_moves: Vec<(String, String, PathBuf)> = Vec::new();

    for path_move in moves {
        note_moves.extend(collect_note_moves_for_path_move(&root_canonical, &path_move)?);
    }

    if note_moves.is_empty() {
        return Ok(PathMoveRewriteResult {
            updated_files: 0,
            reindexed_files: 0,
            moved_markdown_files: 0,
        });
    }

    let markdown_files = list_markdown_files_via_find(&root_canonical)?;
    let mut changed_files = 0usize;
    let mut reindex_paths: HashSet<String> = HashSet::new();
    let moved_markdown_files = note_moves.len();

    for candidate in markdown_files {
        let canonical_candidate = match fs::canonicalize(&candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let markdown = match fs::read_to_string(&canonical_candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let mut updated_markdown = markdown;
        let mut changed = false;
        for (old_target_key, new_target, _) in &note_moves {
            let (rewritten, rewritten_changed) =
                rewrite_wikilinks_for_note(&updated_markdown, old_target_key, new_target);
            updated_markdown = rewritten;
            changed = changed || rewritten_changed;
        }

        if !changed {
            continue;
        }

        fs::write(&canonical_candidate, updated_markdown)?;
        reindex_paths.insert(canonical_candidate.to_string_lossy().to_string());
        changed_files += 1;
    }

    for (_, _, moved_note_path) in &note_moves {
        reindex_paths.insert(moved_note_path.to_string_lossy().to_string());
    }

    for path in &reindex_paths {
        reindex_markdown_file_lexical_sync(path.clone())?;
        reindex_markdown_file_semantic_sync(path.clone())?;
    }

    if !reindex_paths.is_empty() {
        refresh_semantic_edges_cache_now_sync()?;
    }

    Ok(PathMoveRewriteResult {
        updated_files: changed_files,
        reindexed_files: reindex_paths.len(),
        moved_markdown_files,
    })
}
