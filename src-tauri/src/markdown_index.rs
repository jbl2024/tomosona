//! Markdown parsing and note-level indexing helpers.

use std::{
    collections::{hash_map::DefaultHasher, HashSet},
    fs,
    hash::{Hash, Hasher},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use rusqlite::params;

use crate::index_schema::record_last_index_run;
use crate::workspace_paths::{
    has_hidden_dir_component, normalize_existing_file, normalize_note_key,
    normalize_workspace_relative_from_input, normalize_workspace_relative_path,
};
use crate::{
    active_workspace_root, ensure_index_schema, ensure_within_root, log_index, open_db, Result,
};

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
    tx.execute(
        "INSERT INTO note_processing(path, processed_at_ms) VALUES (?1, ?2)
         ON CONFLICT(path) DO UPDATE SET processed_at_ms=excluded.processed_at_ms",
        params![path_for_db.clone(), mtime],
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
        "reindex:done path={path_for_db} chunks={chunk_count} targets={target_count} properties={property_count} total_ms={total_ms}"
    ));
    let _ = record_last_index_run(
        &conn,
        "Indexed file content",
        crate::now_ms(),
        Some(total_ms as u64),
    );
    Ok(())
}

pub(crate) fn reindex_markdown_file_now_sync(path: String) -> Result<()> {
    reindex_markdown_file_lexical_sync(path)
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
        "DELETE FROM note_processing WHERE path = ?1",
        params![path_for_db.clone()],
    )?;
    tx.commit()?;
    log_index(&format!("reindex:removed path={path_for_db}"));
    Ok(())
}
