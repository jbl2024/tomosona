//! Markdown parsing and note-level indexing helpers.

use std::{
    collections::{hash_map::DefaultHasher, HashSet},
    fs,
    hash::{Hash, Hasher},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use rusqlite::params;

use crate::workspace_paths::{
    has_hidden_dir_component, normalize_existing_file, normalize_note_key,
    normalize_workspace_relative_from_input, normalize_workspace_relative_path,
};
use crate::{
    active_workspace_root, ensure_index_schema, ensure_within_root, log_index, open_db,
    refresh_semantic_edges_cache, refresh_semantic_edges_cache_now_sync, semantic,
    AppError, Result,
};
use crate::index_schema::record_last_index_run;

// Small semantic embedding batches reduce peak memory on large notes.
const SEMANTIC_EMBED_BATCH_SIZE: usize = 8;

#[derive(Debug, Clone)]
pub(crate) struct IndexedProperty {
    pub key: String,
    pub kind: &'static str,
    pub value_text: Option<String>,
    pub value_num: Option<f64>,
    pub value_bool: Option<i64>,
    pub value_date: Option<String>,
}

fn heading_anchor(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut previous_dash = false;

    for ch in text.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            previous_dash = false;
            continue;
        }

        if !previous_dash {
            out.push('-');
            previous_dash = true;
        }
    }

    out.trim_matches('-').to_string()
}

pub(crate) fn chunk_markdown(markdown: &str) -> Vec<(String, String)> {
    let mut chunks: Vec<(String, String)> = Vec::new();
    let mut current_anchor = String::new();
    let mut current_lines: Vec<String> = Vec::new();

    for raw_line in markdown.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let line = raw_line.trim_end().to_string();

        let heading_data = {
            let level = line.chars().take_while(|ch| *ch == '#').count();
            if !(1..=6).contains(&level) {
                None
            } else {
                let title = line[level..].trim();
                if title.is_empty() {
                    None
                } else {
                    Some((heading_anchor(title), title.to_string()))
                }
            }
        };

        if let Some((anchor, title)) = heading_data {
            if !current_lines.is_empty() {
                let text = current_lines.join("\n").trim().to_string();
                if !text.is_empty() {
                    chunks.push((current_anchor.clone(), text));
                }
            }

            current_anchor = anchor;
            current_lines.clear();
            current_lines.push(title);
            continue;
        }

        current_lines.push(line);
    }

    if !current_lines.is_empty() {
        let text = current_lines.join("\n").trim().to_string();
        if !text.is_empty() {
            chunks.push((current_anchor, text));
        }
    }

    if chunks.is_empty() {
        let fallback = markdown.trim();
        if !fallback.is_empty() {
            chunks.push((String::new(), fallback.to_string()));
        }
    }

    chunks
}

/// Adds note identity context to the first chunk to improve semantic grounding.
pub(crate) fn inject_relative_path_context(
    path_for_db: &str,
    mut chunks: Vec<(String, String)>,
) -> Vec<(String, String)> {
    if path_for_db.trim().is_empty() || chunks.is_empty() {
        return chunks;
    }
    if let Some((_, first_text)) = chunks.first_mut() {
        *first_text = format!("{path_for_db}\n{first_text}");
    }
    chunks
}

fn chunk_content_hash(anchor: &str, text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    anchor.hash(&mut hasher);
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub(crate) fn normalize_wikilink_target(raw: &str) -> Option<String> {
    let mut target = raw.trim().replace('\\', "/");
    if target.is_empty() {
        return None;
    }

    while target.starts_with('/') {
        target.remove(0);
    }

    while target.starts_with("./") {
        target = target[2..].to_string();
    }

    if target
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return None;
    }

    let target_lower = target.to_ascii_lowercase();
    if target_lower.ends_with(".markdown") {
        target.truncate(target.len().saturating_sub(".markdown".len()));
    } else if target_lower.ends_with(".md") {
        target.truncate(target.len().saturating_sub(".md".len()));
    }

    let key = crate::normalize_key_text(target.trim_matches('/'));
    if key.is_empty() {
        return None;
    }
    Some(key)
}

fn parse_wikilink_targets(markdown: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut offset = 0usize;

    while let Some(start) = markdown[offset..].find("[[") {
        let content_start = offset + start + 2;
        let Some(end_rel) = markdown[content_start..].find("]]") else {
            break;
        };

        let content_end = content_start + end_rel;
        let content = &markdown[content_start..content_end];
        let target_with_optional_heading = content
            .split_once('|')
            .map(|(left, _)| left)
            .unwrap_or(content);
        let target = target_with_optional_heading
            .split_once('#')
            .map(|(left, _)| left)
            .unwrap_or(target_with_optional_heading)
            .trim();

        if !target.is_empty() {
            targets.push(target.to_string());
        }

        offset = content_end + 2;
    }

    targets
}

fn is_iso_date_token(input: &str) -> bool {
    if input.len() != 10 {
        return false;
    }
    let bytes = input.as_bytes();
    for (idx, value) in bytes.iter().enumerate() {
        if idx == 4 || idx == 7 {
            if *value != b'-' {
                return false;
            }
            continue;
        }
        if !value.is_ascii_digit() {
            return false;
        }
    }

    let year = input[0..4].parse::<u16>().ok().unwrap_or(0);
    let month = input[5..7].parse::<u8>().ok().unwrap_or(0);
    let day = input[8..10].parse::<u8>().ok().unwrap_or(0);
    year != 0 && (1..=12).contains(&month) && (1..=31).contains(&day)
}

fn parse_iso_date_targets(markdown: &str) -> Vec<String> {
    let mut out = Vec::new();
    for token in markdown.split(|ch: char| ch.is_whitespace() || ",.;:()[]{}<>!?\"'`".contains(ch))
    {
        if is_iso_date_token(token) {
            out.push(format!("journal/{token}"));
        }
    }
    out
}

pub(crate) fn parse_note_targets(markdown: &str) -> Vec<String> {
    let content = strip_yaml_frontmatter(markdown);
    let mut targets = HashSet::new();

    for target in parse_wikilink_targets(content) {
        if let Some(normalized) = normalize_wikilink_target(&target) {
            targets.insert(normalized);
        }
    }

    for target in parse_iso_date_targets(content) {
        targets.insert(crate::normalize_key_text(&target));
    }

    targets.into_iter().collect()
}

pub(crate) fn strip_yaml_frontmatter(markdown: &str) -> &str {
    if !markdown.starts_with("---\n") {
        return markdown;
    }
    let rest = &markdown[4..];
    if let Some(end) = rest.find("\n---\n") {
        return &rest[(end + 5)..];
    }
    markdown
}

fn extract_yaml_frontmatter(markdown: &str) -> Option<&str> {
    if !markdown.starts_with("---\n") {
        return None;
    }
    let rest = &markdown[4..];
    let end = rest.find("\n---\n")?;
    Some(&rest[..end])
}

pub(crate) fn unquote_yaml_scalar(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        let first = bytes[0] as char;
        let last = bytes[trimmed.len() - 1] as char;
        if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }
    trimmed.to_string()
}

pub(crate) fn is_iso_date_value(input: &str) -> bool {
    if input.len() != 10 {
        return false;
    }
    let bytes = input.as_bytes();
    for (idx, value) in bytes.iter().enumerate() {
        if idx == 4 || idx == 7 {
            if *value != b'-' {
                return false;
            }
            continue;
        }
        if !value.is_ascii_digit() {
            return false;
        }
    }
    true
}

pub(crate) fn parse_yaml_frontmatter_properties(markdown: &str) -> Vec<IndexedProperty> {
    let Some(raw_yaml) = extract_yaml_frontmatter(markdown) else {
        return Vec::new();
    };

    let lines: Vec<&str> = raw_yaml.lines().collect();
    let mut out = Vec::new();
    let mut idx = 0usize;

    while idx < lines.len() {
        let line = lines[idx];
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('#')
            || line.starts_with(' ')
            || line.starts_with('\t')
        {
            idx += 1;
            continue;
        }

        let Some((raw_key, raw_value_part)) = line.split_once(':') else {
            idx += 1;
            continue;
        };

        let key = raw_key.trim().to_lowercase();
        if key.is_empty() {
            idx += 1;
            continue;
        }

        let value_part = raw_value_part.trim_start();

        if value_part == "|" {
            idx += 1;
            let mut text_lines: Vec<String> = Vec::new();
            while idx < lines.len() {
                let next = lines[idx];
                if let Some(stripped) = next.strip_prefix("  ") {
                    text_lines.push(stripped.to_string());
                    idx += 1;
                    continue;
                }
                if next.trim().is_empty() {
                    text_lines.push(String::new());
                    idx += 1;
                    continue;
                }
                break;
            }
            let text = text_lines.join("\n");
            out.push(IndexedProperty {
                key,
                kind: "text",
                value_text: Some(text.to_lowercase()),
                value_num: None,
                value_bool: None,
                value_date: None,
            });
            continue;
        }

        if value_part.starts_with('[') && value_part.ends_with(']') {
            let inner = value_part[1..value_part.len() - 1].trim();
            if !inner.is_empty() {
                for item in inner.split(',') {
                    let value = unquote_yaml_scalar(item);
                    if !value.is_empty() {
                        out.push(IndexedProperty {
                            key: key.clone(),
                            kind: "list",
                            value_text: Some(value.to_lowercase()),
                            value_num: None,
                            value_bool: None,
                            value_date: None,
                        });
                    }
                }
            }
            idx += 1;
            continue;
        }

        if value_part.is_empty() {
            idx += 1;
            let mut consumed = false;
            while idx < lines.len() {
                let next = lines[idx];
                let Some(item) = next.strip_prefix("  - ") else {
                    if next.trim().is_empty() {
                        idx += 1;
                        continue;
                    }
                    break;
                };
                consumed = true;
                let value = unquote_yaml_scalar(item);
                if !value.is_empty() {
                    out.push(IndexedProperty {
                        key: key.clone(),
                        kind: "list",
                        value_text: Some(value.to_lowercase()),
                        value_num: None,
                        value_bool: None,
                        value_date: None,
                    });
                }
                idx += 1;
            }
            if !consumed {
                out.push(IndexedProperty {
                    key,
                    kind: "text",
                    value_text: Some(String::new()),
                    value_num: None,
                    value_bool: None,
                    value_date: None,
                });
            }
            continue;
        }

        let scalar = unquote_yaml_scalar(value_part);
        if scalar.eq_ignore_ascii_case("true") || scalar.eq_ignore_ascii_case("false") {
            out.push(IndexedProperty {
                key,
                kind: "bool",
                value_text: Some(scalar.to_lowercase()),
                value_num: None,
                value_bool: Some(if scalar.eq_ignore_ascii_case("true") {
                    1
                } else {
                    0
                }),
                value_date: None,
            });
            idx += 1;
            continue;
        }

        if let Ok(num) = scalar.parse::<f64>() {
            if num.is_finite() {
                out.push(IndexedProperty {
                    key,
                    kind: "number",
                    value_text: Some(scalar.to_lowercase()),
                    value_num: Some(num),
                    value_bool: None,
                    value_date: None,
                });
                idx += 1;
                continue;
            }
        }

        if is_iso_date_value(&scalar) {
            out.push(IndexedProperty {
                key,
                kind: "date",
                value_text: Some(scalar.to_lowercase()),
                value_num: None,
                value_bool: None,
                value_date: Some(scalar),
            });
            idx += 1;
            continue;
        }

        out.push(IndexedProperty {
            key,
            kind: "text",
            value_text: Some(scalar.to_lowercase()),
            value_num: None,
            value_bool: None,
            value_date: None,
        });
        idx += 1;
    }

    out
}

pub(crate) fn reindex_markdown_file_lexical_sync(path: String) -> Result<()> {
    let started_at = Instant::now();
    let root = active_workspace_root()?;
    let file_path = normalize_existing_file(&path)?;
    ensure_within_root(&root, &file_path)?;

    let normalized_path = fs::canonicalize(&file_path)?;
    if has_hidden_dir_component(&root, &normalized_path) {
        log_index(&format!(
            "reindex:skip_hidden path={}",
            normalized_path.to_string_lossy()
        ));
        return Ok(());
    }
    let markdown = fs::read_to_string(&normalized_path)?;
    let content_for_indexing = strip_yaml_frontmatter(&markdown);
    let chunks = chunk_markdown(content_for_indexing);
    let targets = parse_note_targets(&markdown);
    let properties = parse_yaml_frontmatter_properties(&markdown);
    let chunk_count = chunks.len();
    let target_count = targets.len();
    let property_count = properties.len();
    let mtime = fs::metadata(&normalized_path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or(0)
        });

    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    let tx = conn.unchecked_transaction()?;
    let path_for_db = normalize_workspace_relative_path(&root, &normalized_path)?;
    let chunks = inject_relative_path_context(&path_for_db, chunks);
    log_index(&format!("reindex:start path={path_for_db}"));
    let source_key = normalize_note_key(&root, &normalized_path)?;

    tx.execute(
        "DELETE FROM note_links WHERE source_path = ?1",
        params![path_for_db.clone()],
    )?;
    tx.execute(
        "DELETE FROM note_properties WHERE path = ?1",
        params![path_for_db.clone()],
    )?;

    for (chunk_ord, (anchor, text)) in chunks.into_iter().enumerate() {
        let chunk_hash = chunk_content_hash(&anchor, &text);
        tx.execute(
            "INSERT INTO chunks(path, chunk_ord, anchor, text, content_hash, mtime)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(path, chunk_ord) DO UPDATE SET
               anchor = excluded.anchor,
               text = excluded.text,
               content_hash = excluded.content_hash,
               mtime = excluded.mtime",
            params![
                path_for_db,
                chunk_ord as i64,
                anchor,
                text,
                chunk_hash,
                mtime
            ],
        )?;
    }
    tx.execute(
        "DELETE FROM embeddings
         WHERE chunk_id IN (
           SELECT id FROM chunks WHERE path = ?1 AND chunk_ord >= ?2
         )",
        params![path_for_db.clone(), chunk_count as i64],
    )?;
    tx.execute(
        "DELETE FROM chunks WHERE path = ?1 AND chunk_ord >= ?2",
        params![path_for_db.clone(), chunk_count as i64],
    )?;

    for target in targets {
        if target == source_key {
            continue;
        }
        tx.execute(
            "INSERT INTO note_links(source_path, target_key) VALUES (?1, ?2)",
            params![path_for_db, target],
        )?;
    }

    for property in properties {
        tx.execute(
            "INSERT INTO note_properties(path, key, kind, value_text, value_num, value_bool, value_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                path_for_db,
                property.key,
                property.kind,
                property.value_text,
                property.value_num,
                property.value_bool,
                property.value_date
            ],
        )?;
    }

    tx.commit()?;
    let total_ms = started_at.elapsed().as_millis();
    log_index(&format!(
        "reindex:done path={path_for_db} chunks={chunk_count} targets={target_count} properties={property_count} embedding=deferred embedding_ms=0 total_ms={total_ms}"
    ));
    let _ = record_last_index_run(&conn, "Indexed file content", crate::now_ms());
    Ok(())
}

fn embed_chunk_texts_in_batches<F>(
    path_for_db: &str,
    embed_texts: &[String],
    embed_positions: &[usize],
    mut embed_batch: F,
) -> Result<Vec<(usize, Vec<f32>)>>
where
    F: FnMut(&[String]) -> std::result::Result<Vec<Vec<f32>>, String>,
{
    if embed_texts.is_empty() {
        return Ok(Vec::new());
    }

    let batch_count = embed_texts.len().div_ceil(SEMANTIC_EMBED_BATCH_SIZE);
    log_index(&format!(
        "semantic:reindex:embed_batches path={path_for_db} chunks_to_embed={} batch_size={} batch_count={batch_count}",
        embed_texts.len(),
        SEMANTIC_EMBED_BATCH_SIZE
    ));

    let mut out = Vec::with_capacity(embed_positions.len());
    for (batch_index, (texts, positions)) in embed_texts
        .chunks(SEMANTIC_EMBED_BATCH_SIZE)
        .zip(embed_positions.chunks(SEMANTIC_EMBED_BATCH_SIZE))
        .enumerate()
    {
        let batch_number = batch_index + 1;
        log_index(&format!(
            "semantic:reindex:embed_batch:start path={path_for_db} batch_index={batch_number} batch_len={}",
            texts.len()
        ));

        let batch_vectors =
            embed_batch(texts).map_err(|err| AppError::InvalidOperation(err.to_string()))?;
        if batch_vectors.len() != positions.len() {
            return Err(AppError::OperationFailed);
        }

        log_index(&format!(
            "semantic:reindex:embed_batch:done path={path_for_db} batch_index={batch_number} batch_len={}",
            texts.len()
        ));

        for (target_pos, vector) in positions.iter().copied().zip(batch_vectors.into_iter()) {
            out.push((target_pos, vector));
        }
    }

    Ok(out)
}

pub(crate) fn reindex_markdown_file_semantic_sync(path: String) -> Result<()> {
    let started_at = Instant::now();
    let root = active_workspace_root()?;
    let path_for_db = normalize_workspace_relative_from_input(&root, &path)?;
    log_index(&format!("semantic:reindex:start path={path_for_db}"));

    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    let tx = conn.unchecked_transaction()?;
    let mut stmt = tx.prepare(
        r#"
      SELECT c.id, c.text, c.content_hash, e.model, e.content_hash, e.dim, e.vector
      FROM chunks c
      LEFT JOIN embeddings e ON e.chunk_id = c.id
      WHERE c.path = ?1
      ORDER BY c.chunk_ord ASC
    "#,
    )?;
    let mut rows = stmt.query(params![path_for_db.clone()])?;

    let model_name = semantic::embedding_model_name();
    let mut chunk_ids: Vec<i64> = Vec::new();
    let mut chunk_hashes: Vec<String> = Vec::new();
    let mut chunk_vectors: Vec<Option<Vec<f32>>> = Vec::new();
    let mut embed_texts: Vec<String> = Vec::new();
    let mut embed_positions: Vec<usize> = Vec::new();
    let mut reused = 0usize;
    let mut reembedded = 0usize;

    while let Some(row) = rows.next()? {
        let chunk_id: i64 = row.get(0)?;
        let chunk_text: String = row.get(1)?;
        let chunk_hash: String = row.get(2)?;
        let embedding_model: Option<String> = row.get(3)?;
        let embedding_hash: Option<String> = row.get(4)?;
        let embedding_dim: Option<i64> = row.get(5)?;
        let embedding_blob: Option<Vec<u8>> = row.get(6)?;

        let mut reused_vector: Option<Vec<f32>> = None;
        if let (Some(model), Some(hash), Some(dim), Some(blob)) = (
            embedding_model,
            embedding_hash,
            embedding_dim,
            embedding_blob,
        ) {
            if model == model_name && hash == chunk_hash {
                reused_vector = semantic::blob_to_vector(&blob, dim as usize);
            }
        }

        if let Some(mut vector) = reused_vector {
            semantic::normalize_in_place(&mut vector);
            reused += 1;
            chunk_vectors.push(Some(vector));
        } else {
            embed_positions.push(chunk_vectors.len());
            embed_texts.push(chunk_text);
            chunk_vectors.push(None);
        }

        chunk_ids.push(chunk_id);
        chunk_hashes.push(chunk_hash);
    }

    drop(rows);
    drop(stmt);

    if !embed_texts.is_empty() {
        // Process note chunks in small batches to limit local embedding memory spikes.
        let new_vectors =
            embed_chunk_texts_in_batches(&path_for_db, &embed_texts, &embed_positions, |texts| {
                semantic::embed_texts(texts)
            })?;

        for (target_pos, mut vector) in new_vectors {
            semantic::normalize_in_place(&mut vector);
            let chunk_id = chunk_ids[target_pos];
            let content_hash = chunk_hashes[target_pos].clone();
            tx.execute(
                "INSERT INTO embeddings(chunk_id, model, dim, content_hash, vector) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(chunk_id) DO UPDATE SET
                   model=excluded.model,
                   dim=excluded.dim,
                   content_hash=excluded.content_hash,
                   vector=excluded.vector",
                params![
                    chunk_id,
                    model_name.clone(),
                    vector.len() as i64,
                    content_hash,
                    semantic::vector_to_blob(&vector)
                ],
            )?;
            chunk_vectors[target_pos] = Some(vector);
            reembedded += 1;
        }
    }

    let resolved_vectors: Vec<Vec<f32>> = chunk_vectors.into_iter().flatten().collect();
    if resolved_vectors.is_empty() {
        tx.execute(
            "DELETE FROM note_embeddings WHERE path = ?1",
            params![path_for_db.clone()],
        )?;
        semantic::try_delete_note_vector(&tx, &path_for_db);
    } else if let Some(note_vector) = semantic::centroid(&resolved_vectors) {
        let updated_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis() as i64)
            .unwrap_or(0);
        tx.execute(
            "INSERT INTO note_embeddings(path, model, dim, vector, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(path) DO UPDATE SET model=excluded.model, dim=excluded.dim, vector=excluded.vector, updated_at_ms=excluded.updated_at_ms",
            params![
                path_for_db.clone(),
                model_name,
                note_vector.len() as i64,
                semantic::vector_to_blob(&note_vector),
                updated_at_ms
            ],
        )?;
        if let Err(err) = semantic::try_ensure_vec_table(&tx, note_vector.len()) {
            log_index(&format!(
                "semantic:reindex:vec_table_unavailable path={path_for_db} dim={} err={err}",
                note_vector.len()
            ));
            return Err(AppError::OperationFailed);
        }
        if let Err(err) = semantic::try_upsert_note_vector(&tx, &path_for_db, &note_vector) {
            log_index(&format!(
                "semantic:reindex:vec_upsert_failed path={path_for_db} dim={} err={err}",
                note_vector.len()
            ));
            return Err(AppError::OperationFailed);
        }
    }

    tx.commit()?;
    let total_chunks = chunk_ids.len();
    log_index(&format!(
        "semantic:reindex:done path={path_for_db} chunks_total={total_chunks} chunks_reused={reused} chunks_reembedded={reembedded} total_ms={}",
        started_at.elapsed().as_millis()
    ));
    let _ = record_last_index_run(&conn, "Semantic note updated", crate::now_ms());
    Ok(())
}

pub(crate) fn reindex_markdown_file_now_sync(path: String) -> Result<()> {
    reindex_markdown_file_lexical_sync(path.clone())?;
    reindex_markdown_file_semantic_sync(path)?;
    refresh_semantic_edges_cache_now_sync()
}

pub(crate) fn remove_markdown_file_from_index_sync(path: String) -> Result<()> {
    let root = active_workspace_root()?;
    let path_for_db = normalize_workspace_relative_from_input(&root, &path)?;
    let source_key = normalize_note_key(&root, &root.join(&path_for_db))?;
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM chunks WHERE path = ?1",
        params![path_for_db.clone()],
    )?;
    tx.execute(
        "DELETE FROM note_links WHERE source_path = ?1 OR target_key = ?2",
        params![path_for_db.clone(), source_key],
    )?;
    tx.execute(
        "DELETE FROM note_properties WHERE path = ?1",
        params![path_for_db.clone()],
    )?;
    tx.execute(
        "DELETE FROM note_embeddings WHERE path = ?1",
        params![path_for_db.clone()],
    )?;
    semantic::try_delete_note_vector(&tx, &path_for_db);
    tx.execute(
        "DELETE FROM semantic_edges WHERE source_path = ?1 OR target_path = ?1",
        params![path_for_db.clone()],
    )?;
    tx.commit()?;

    if let Err(err) = refresh_semantic_edges_cache(&conn, &root) {
        log_index(&format!(
            "semantic_edges:refresh_error phase=remove_markdown_refresh err={} err_debug={:?}",
            err,
            err
        ));
    }
    log_index(&format!("reindex:removed path={path_for_db}"));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::embed_chunk_texts_in_batches;
    use crate::AppError;
    use std::cell::RefCell;

    #[test]
    fn embed_chunk_texts_in_batches_skips_empty_input() {
        let calls = RefCell::new(Vec::<usize>::new());
        let vectors = embed_chunk_texts_in_batches("notes/a.md", &[], &[], |texts| {
            calls.borrow_mut().push(texts.len());
            Ok(Vec::new())
        })
        .expect("empty batches");

        assert!(vectors.is_empty());
        assert!(calls.borrow().is_empty());
    }

    #[test]
    fn embed_chunk_texts_in_batches_handles_single_short_batch() {
        let texts = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let positions = vec![2usize, 4, 6];
        let calls = RefCell::new(Vec::<usize>::new());

        let vectors = embed_chunk_texts_in_batches("notes/a.md", &texts, &positions, |texts| {
            calls.borrow_mut().push(texts.len());
            Ok(texts.iter().map(|text| vec![text.len() as f32]).collect())
        })
        .expect("single batch");

        assert_eq!(*calls.borrow(), vec![3]);
        assert_eq!(
            vectors,
            vec![(2, vec![1.0]), (4, vec![1.0]), (6, vec![1.0])]
        );
    }

    #[test]
    fn embed_chunk_texts_in_batches_splits_exact_multiples() {
        let texts: Vec<String> = (0..16).map(|index| format!("chunk-{index}")).collect();
        let positions: Vec<usize> = (0..16).collect();
        let calls = RefCell::new(Vec::<usize>::new());

        let vectors = embed_chunk_texts_in_batches("notes/a.md", &texts, &positions, |texts| {
            calls.borrow_mut().push(texts.len());
            Ok(texts.iter().map(|text| vec![text.len() as f32]).collect())
        })
        .expect("exact multiple batches");

        assert_eq!(*calls.borrow(), vec![8, 8]);
        assert_eq!(vectors.len(), 16);
        assert_eq!(vectors.first().expect("first vector").0, 0);
        assert_eq!(vectors.last().expect("last vector").0, 15);
    }

    #[test]
    fn embed_chunk_texts_in_batches_handles_tail_batch_and_preserves_positions() {
        let texts: Vec<String> = (0..10).map(|index| format!("chunk-{index}")).collect();
        let positions = vec![9usize, 1, 7, 3, 8, 2, 5, 0, 6, 4];
        let calls = RefCell::new(Vec::<usize>::new());

        let vectors = embed_chunk_texts_in_batches("notes/a.md", &texts, &positions, |texts| {
            calls.borrow_mut().push(texts.len());
            Ok(texts
                .iter()
                .enumerate()
                .map(|(index, _)| vec![index as f32])
                .collect())
        })
        .expect("tail batch");

        assert_eq!(*calls.borrow(), vec![8, 2]);
        assert_eq!(vectors[0], (9, vec![0.0]));
        assert_eq!(vectors[7], (0, vec![7.0]));
        assert_eq!(vectors[8], (6, vec![0.0]));
        assert_eq!(vectors[9], (4, vec![1.0]));
    }

    #[test]
    fn embed_chunk_texts_in_batches_errors_on_mismatched_vector_count() {
        let texts: Vec<String> = (0..9).map(|index| format!("chunk-{index}")).collect();
        let positions: Vec<usize> = (0..9).collect();
        let calls = RefCell::new(Vec::<usize>::new());

        let err = embed_chunk_texts_in_batches("notes/a.md", &texts, &positions, |texts| {
            calls.borrow_mut().push(texts.len());
            if texts.len() == 1 {
                Ok(Vec::new())
            } else {
                Ok(texts.iter().map(|_| vec![1.0]).collect())
            }
        })
        .expect_err("mismatched vector count should fail");

        assert!(matches!(err, AppError::OperationFailed));
        assert_eq!(*calls.borrow(), vec![8, 1]);
    }

    #[test]
    fn embed_chunk_texts_in_batches_stops_after_batch_error() {
        let texts: Vec<String> = (0..10).map(|index| format!("chunk-{index}")).collect();
        let positions: Vec<usize> = (0..10).collect();
        let calls = RefCell::new(Vec::<usize>::new());

        let err = embed_chunk_texts_in_batches("notes/a.md", &texts, &positions, |texts| {
            calls.borrow_mut().push(texts.len());
            if texts.len() == 2 {
                Err("Semantic embedding inference failed.".to_string())
            } else {
                Ok(texts.iter().map(|_| vec![1.0]).collect())
            }
        })
        .expect_err("batch error should fail");

        assert!(matches!(err, AppError::InvalidOperation(_)));
        assert_eq!(*calls.borrow(), vec![8, 2]);
    }
}
