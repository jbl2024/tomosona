//! Backlinks and rename update helpers.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::editor_sync::record_workspace_mutation_write;
use crate::markdown_index::{
    reindex_markdown_file_lexical_sync, reindex_markdown_file_semantic_sync,
};
use crate::{
    active_workspace_root, list_markdown_files_via_find, normalize_note_key,
    normalize_workspace_path,
    normalize_workspace_relative_path,
    note_link_target, open_db, refresh_semantic_edges_cache_now_sync,
    reindex_markdown_file_now_sync, rewrite_wikilinks_for_note, workspace_absolute_path, AppError,
    Result,
};

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

#[derive(Debug, Clone, Deserialize, Serialize)]
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
    pub expanded_markdown_moves: Vec<PathMoveInput>,
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
    Ok(out)
}

pub(crate) fn semantic_links_for_path(path: String) -> Result<Vec<SemanticLink>> {
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

        fs::write(&canonical_candidate, &updated_markdown)?;
        record_workspace_mutation_write(&canonical_candidate, &updated_markdown);
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
) -> Result<Vec<(String, String, PathBuf, PathBuf)>> {
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
            if old_target_key.is_empty()
                || old_target_key == normalize_note_key(root_canonical, &new_file)?
            {
                continue;
            }
            expanded.push((old_target_key, new_target, old_file, new_file));
        }
        return Ok(expanded);
    }

    if !new_path.is_file() {
        return Ok(Vec::new());
    }

    let old_target_key = normalize_note_key(root_canonical, &old_path)?;
    let new_target = note_link_target(root_canonical, &new_path)?;
    if old_target_key.is_empty() || old_target_key == normalize_note_key(root_canonical, &new_path)?
    {
        return Ok(Vec::new());
    }

    Ok(vec![(old_target_key, new_target, old_path, new_path)])
}

pub(crate) fn update_wikilinks_for_path_moves(
    moves: Vec<PathMoveInput>,
) -> Result<PathMoveRewriteResult> {
    let root_canonical = active_workspace_root()?;
    let mut note_moves: Vec<(String, String, PathBuf, PathBuf)> = Vec::new();

    for path_move in moves {
        note_moves.extend(collect_note_moves_for_path_move(
            &root_canonical,
            &path_move,
        )?);
    }

    if note_moves.is_empty() {
        return Ok(PathMoveRewriteResult {
            updated_files: 0,
            reindexed_files: 0,
            moved_markdown_files: 0,
            expanded_markdown_moves: Vec::new(),
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
        for (old_target_key, new_target, _, _) in &note_moves {
            let (rewritten, rewritten_changed) =
                rewrite_wikilinks_for_note(&updated_markdown, old_target_key, new_target);
            updated_markdown = rewritten;
            changed = changed || rewritten_changed;
        }

        if !changed {
            continue;
        }

        fs::write(&canonical_candidate, &updated_markdown)?;
        record_workspace_mutation_write(&canonical_candidate, &updated_markdown);
        reindex_paths.insert(canonical_candidate.to_string_lossy().to_string());
        changed_files += 1;
    }

    for (_, _, _, moved_note_path) in &note_moves {
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
        expanded_markdown_moves: note_moves
            .into_iter()
            .map(|(_, _, old_note_path, moved_note_path)| PathMoveInput {
                from_path: old_note_path.to_string_lossy().to_string(),
                to_path: moved_note_path.to_string_lossy().to_string(),
            })
            .collect(),
    })
}
