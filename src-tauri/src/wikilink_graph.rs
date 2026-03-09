//! Wikilink graph, backlinks and rename update helpers.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::Connection;
use serde::Serialize;

use crate::{
    active_workspace_root, list_markdown_files_via_find, normalize_note_key,
    normalize_note_key_from_workspace_path, normalize_workspace_path,
    normalize_workspace_relative_path, note_key_basename, note_label_from_workspace_path,
    note_link_target, open_db, reindex_markdown_file_now_sync,
    rewrite_wikilinks_for_note, workspace_absolute_path, AppError, Result,
};
use crate::markdown_index::parse_note_targets;

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
pub(crate) struct WikilinkRewriteResult {
    pub updated_files: usize,
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
        if source_path == target_path || !seen_edges.insert((source_path.clone(), target_path.clone())) {
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

    let markdown_files = list_markdown_files_via_find(&root_canonical)?;
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for candidate in markdown_files {
        let canonical_candidate = match fs::canonicalize(&candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let source_key = match normalize_note_key(&root_canonical, &canonical_candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if source_key == target_key {
            continue;
        }

        let markdown = match fs::read_to_string(&canonical_candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if !parse_note_targets(&markdown).iter().any(|item| item == &target_key) {
            continue;
        }

        let source_path = canonical_candidate.to_string_lossy().to_string();
        if seen.insert(source_path.clone()) {
            out.push(Backlink { path: source_path });
        }
    }

    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
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
