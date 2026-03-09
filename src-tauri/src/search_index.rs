//! Search query parsing and hybrid search helpers.

use std::{collections::HashSet, path::Path};

use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection};
use serde::Serialize;

use crate::{
    active_workspace_root, min_max_normalize, open_db, property_type_schema_path, semantic,
    workspace_absolute_path, AppError, Result,
    HYBRID_LEXICAL_WEIGHT, HYBRID_SEMANTIC_WEIGHT, SEARCH_CANDIDATE_LIMIT, SEARCH_RESULT_LIMIT,
    SEMANTIC_THRESHOLD,
};
use crate::markdown_index::{is_iso_date_value, unquote_yaml_scalar};

#[derive(Serialize)]
pub(crate) struct Hit {
    pub path: String,
    pub snippet: String,
    pub score: f64,
}

#[derive(Debug, Clone)]
pub(crate) enum PropertyFilter {
    Has { key: String },
    EqText { key: String, value: String },
    EqBool { key: String, value: i64 },
    EqNum { key: String, value: f64 },
    EqDate { key: String, value: String },
    GtNum { key: String, value: f64 },
    GteNum { key: String, value: f64 },
    LtNum { key: String, value: f64 },
    LteNum { key: String, value: f64 },
    GtDate { key: String, value: String },
    GteDate { key: String, value: String },
    LtDate { key: String, value: String },
    LteDate { key: String, value: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SearchMode {
    Hybrid,
    Semantic,
    Lexical,
}

#[derive(Debug)]
struct RankedSearchRow {
    chunk_id: i64,
    path: String,
    snippet: String,
    lexical_score: f64,
}

pub(crate) fn read_property_type_schema() -> Result<std::collections::HashMap<String, String>> {
    let schema_path = property_type_schema_path()?;
    if !schema_path.exists() {
        return Ok(std::collections::HashMap::new());
    }

    let raw = std::fs::read_to_string(schema_path)?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|_| AppError::InvalidOperation("Property type schema is invalid.".to_string()))?;

    let mut out = std::collections::HashMap::new();
    if let Some(object) = parsed.as_object() {
        for (key, value) in object {
            let normalized_key = key.trim().to_lowercase();
            if normalized_key.is_empty() {
                continue;
            }
            let Some(raw_type) = value.as_str() else {
                continue;
            };
            if matches!(raw_type, "text" | "list" | "number" | "checkbox" | "date" | "tags") {
                out.insert(normalized_key, raw_type.to_string());
            }
        }
    }
    Ok(out)
}

pub(crate) fn write_property_type_schema(
    schema: std::collections::HashMap<String, String>,
) -> Result<()> {
    let schema_path = property_type_schema_path()?;
    let mut sanitized = std::collections::HashMap::new();
    for (key, value) in schema {
        let normalized_key = key.trim().to_lowercase();
        if normalized_key.is_empty() {
            continue;
        }
        if matches!(value.as_str(), "text" | "list" | "number" | "checkbox" | "date" | "tags") {
            sanitized.insert(normalized_key, value);
        }
    }
    let serialized =
        serde_json::to_string_pretty(&sanitized).map_err(|_| AppError::OperationFailed)?;
    std::fs::write(schema_path, serialized)?;
    Ok(())
}

fn is_property_key_token(input: &str) -> bool {
    let trimmed = input.trim();
    !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

fn parse_property_filter_token(token: &str) -> Option<PropertyFilter> {
    let token = token.trim();
    if token.is_empty() {
        return None;
    }

    if let Some(raw_key) = token.strip_prefix("has:") {
        let key = raw_key.trim().to_lowercase();
        if is_property_key_token(&key) {
            return Some(PropertyFilter::Has { key });
        }
        return None;
    }

    let operators = [(">=", 2usize), ("<=", 2usize), (">", 1usize), ("<", 1usize), (":", 1usize), ("=", 1usize)];
    for (op, len) in operators {
        let Some(position) = token.find(op) else {
            continue;
        };
        if position == 0 {
            return None;
        }
        let key = token[..position].trim().to_lowercase();
        if !is_property_key_token(&key) {
            return None;
        }
        let raw_value = token[(position + len)..].trim();
        if raw_value.is_empty() {
            return None;
        }
        let value = unquote_yaml_scalar(raw_value);

        if op == ":" || op == "=" {
            if value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("false") {
                return Some(PropertyFilter::EqBool {
                    key,
                    value: if value.eq_ignore_ascii_case("true") { 1 } else { 0 },
                });
            }
            if let Ok(number) = value.parse::<f64>() {
                let number: f64 = number;
                if number.is_finite() {
                    return Some(PropertyFilter::EqNum { key, value: number });
                }
            }
            if is_iso_date_value(&value) {
                return Some(PropertyFilter::EqDate { key, value });
            }
            return Some(PropertyFilter::EqText {
                key,
                value: value.to_lowercase(),
            });
        }

        if is_iso_date_value(&value) {
            return match op {
                ">" => Some(PropertyFilter::GtDate { key, value }),
                ">=" => Some(PropertyFilter::GteDate { key, value }),
                "<" => Some(PropertyFilter::LtDate { key, value }),
                "<=" => Some(PropertyFilter::LteDate { key, value }),
                _ => None,
            };
        }

        if let Ok(number) = value.parse::<f64>() {
            let number: f64 = number;
            if number.is_finite() {
                return match op {
                    ">" => Some(PropertyFilter::GtNum { key, value: number }),
                    ">=" => Some(PropertyFilter::GteNum { key, value: number }),
                    "<" => Some(PropertyFilter::LtNum { key, value: number }),
                    "<=" => Some(PropertyFilter::LteNum { key, value: number }),
                    _ => None,
                };
            }
        }
        return None;
    }
    None
}

pub(crate) fn parse_search_query(raw: &str) -> (SearchMode, String, Vec<PropertyFilter>) {
    let trimmed = raw.trim();
    let lowered = trimmed.to_ascii_lowercase();
    let (mode, remainder) = if lowered.starts_with("semantic:") {
        (SearchMode::Semantic, trimmed["semantic:".len()..].trim_start())
    } else if lowered.starts_with("lexical:") {
        (SearchMode::Lexical, trimmed["lexical:".len()..].trim_start())
    } else if lowered.starts_with("hybrid:") {
        (SearchMode::Hybrid, trimmed["hybrid:".len()..].trim_start())
    } else {
        (SearchMode::Hybrid, trimmed)
    };

    let mut text_terms = Vec::new();
    let mut filters = Vec::new();
    for token in remainder.split_whitespace() {
        if let Some(filter) = parse_property_filter_token(token) {
            filters.push(filter);
        } else {
            text_terms.push(token.to_string());
        }
    }
    (mode, text_terms.join(" "), filters)
}

fn path_set_for_property_filter(conn: &Connection, filter: &PropertyFilter) -> Result<HashSet<String>> {
    let (sql, args): (&str, Vec<SqlValue>) = match filter {
        PropertyFilter::Has { key } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1",
            vec![SqlValue::Text(key.clone())],
        ),
        PropertyFilter::EqText { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_text = ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Text(value.clone())],
        ),
        PropertyFilter::EqBool { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_bool = ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Integer(*value)],
        ),
        PropertyFilter::EqNum { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_num = ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Real(*value)],
        ),
        PropertyFilter::EqDate { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_date = ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Text(value.clone())],
        ),
        PropertyFilter::GtNum { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_num > ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Real(*value)],
        ),
        PropertyFilter::GteNum { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_num >= ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Real(*value)],
        ),
        PropertyFilter::LtNum { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_num < ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Real(*value)],
        ),
        PropertyFilter::LteNum { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_num <= ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Real(*value)],
        ),
        PropertyFilter::GtDate { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_date > ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Text(value.clone())],
        ),
        PropertyFilter::GteDate { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_date >= ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Text(value.clone())],
        ),
        PropertyFilter::LtDate { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_date < ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Text(value.clone())],
        ),
        PropertyFilter::LteDate { key, value } => (
            "SELECT DISTINCT path FROM note_properties WHERE key = ?1 AND value_date <= ?2",
            vec![SqlValue::Text(key.clone()), SqlValue::Text(value.clone())],
        ),
    };

    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query(params_from_iter(args.iter()))?;
    let mut out = HashSet::new();
    while let Some(row) = rows.next()? {
        out.insert(row.get(0)?);
    }
    Ok(out)
}

fn paths_matching_property_filters(conn: &Connection, filters: &[PropertyFilter]) -> Result<HashSet<String>> {
    let mut acc: Option<HashSet<String>> = None;
    for filter in filters {
        let next = path_set_for_property_filter(conn, filter)?;
        if let Some(existing) = acc.as_mut() {
            existing.retain(|item| next.contains(item));
        } else {
            acc = Some(next);
        }
    }
    Ok(acc.unwrap_or_default())
}

fn collect_lexical_ranked_rows(
    conn: &Connection,
    text_query: &str,
    property_paths: Option<&HashSet<String>>,
) -> Result<Vec<RankedSearchRow>> {
    let mut stmt = conn.prepare(
        r#"
    SELECT chunks.id,
           chunks.path,
           snippet(chunks_fts, 2, '<b>', '</b>', '...', 12) AS snip,
           bm25(chunks_fts) AS score
    FROM chunks_fts
    JOIN chunks ON chunks_fts.rowid = chunks.id
    WHERE chunks_fts MATCH ?1
    ORDER BY score
    LIMIT ?2;
  "#,
    )?;

    let mut rows = stmt.query(params![text_query, SEARCH_CANDIDATE_LIMIT])?;
    let mut ranked_rows = Vec::new();
    while let Some(row) = rows.next()? {
        let path = row.get::<_, String>(1)?;
        if property_paths.is_some_and(|paths| !paths.contains(&path)) {
            continue;
        }
        ranked_rows.push(RankedSearchRow {
            chunk_id: row.get::<_, i64>(0)?,
            path,
            snippet: row.get::<_, String>(2)?,
            lexical_score: row.get::<_, f64>(3)?,
        });
    }
    Ok(ranked_rows)
}

pub(crate) fn build_prefix_fts_query(text_query: &str) -> Option<String> {
    let terms: Vec<String> = text_query
        .split_whitespace()
        .filter_map(|token| {
            let cleaned: String = token
                .trim_matches(|ch: char| !ch.is_alphanumeric() && ch != '_' && ch != '-')
                .chars()
                .filter(|ch| ch.is_alphanumeric() || *ch == '_' || *ch == '-')
                .collect();
            if cleaned.is_empty() {
                None
            } else {
                Some(format!("{cleaned}*"))
            }
        })
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" AND "))
    }
}

fn fallback_lexical_hits(
    conn: &Connection,
    root_canonical: &Path,
    text_query: &str,
    property_paths: Option<&HashSet<String>>,
) -> Result<Vec<Hit>> {
    let ranked_rows = collect_lexical_ranked_rows(conn, text_query, property_paths)?;
    if ranked_rows.is_empty() {
        return Ok(vec![]);
    }
    let lexical_relevance: Vec<f64> = ranked_rows.iter().map(|item| -item.lexical_score).collect();
    let lexical_norm = min_max_normalize(&lexical_relevance);

    let mut scored: Vec<(usize, f64)> = ranked_rows
        .iter()
        .enumerate()
        .map(|(index, _)| (index, lexical_norm[index]))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut out = Vec::new();
    for (index, score) in scored.into_iter().take(SEARCH_RESULT_LIMIT) {
        let row = &ranked_rows[index];
        out.push(Hit {
            path: workspace_absolute_path(root_canonical, &row.path),
            snippet: row.snippet.clone(),
            score,
        });
    }
    Ok(out)
}

pub(crate) fn semantic_snippet_preview(text: &str) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return "semantic match".to_string();
    }
    let mut preview = compact.chars().take(220).collect::<String>();
    if compact.chars().count() > 220 {
        preview.push_str("...");
    }
    preview
}

fn load_semantic_snippet(conn: &Connection, path: &str) -> Result<String> {
    let row = conn.query_row(
        "SELECT text FROM chunks WHERE path = ?1 ORDER BY id ASC LIMIT 1",
        params![path],
        |row| row.get::<_, String>(0),
    );
    match row {
        Ok(text) => Ok(semantic_snippet_preview(&text)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok("semantic match".to_string()),
        Err(err) => Err(AppError::Sqlite(err)),
    }
}

fn semantic_only_hits(
    conn: &Connection,
    root_canonical: &Path,
    text_query: &str,
    property_paths: Option<&HashSet<String>>,
) -> Result<Option<Vec<Hit>>> {
    let query_vec = semantic::embed_texts(&[text_query.to_string()])
        .ok()
        .and_then(|mut items| items.pop());
    let Some(mut query_vector) = query_vec else {
        return Ok(None);
    };
    semantic::normalize_in_place(&mut query_vector);
    let payload = semantic::vector_to_json(&query_vector);

    let mut stmt = match conn.prepare(
        r#"
        SELECT path, distance
        FROM note_embeddings_vec
        WHERE embedding MATCH ?1
        ORDER BY distance ASC
        LIMIT ?2
      "#,
    ) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };

    let mut rows = match stmt.query(params![payload, SEARCH_CANDIDATE_LIMIT]) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };

    let mut scored: Vec<(String, f64)> = Vec::new();
    while let Some(row) = rows.next()? {
        let path: String = row.get(0)?;
        if property_paths.is_some_and(|paths| !paths.contains(&path)) {
            continue;
        }
        let distance: f32 = row.get(1)?;
        let score = (1.0 - ((distance * distance) as f64 * 0.5)).clamp(0.0, 1.0);
        if score < f64::from(SEMANTIC_THRESHOLD) {
            continue;
        }
        scored.push((path, score));
    }

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let mut out = Vec::new();
    for (path, score) in scored.into_iter().take(SEARCH_RESULT_LIMIT) {
        let snippet = load_semantic_snippet(conn, &path)?;
        out.push(Hit {
            path: workspace_absolute_path(root_canonical, &path),
            snippet,
            score,
        });
    }
    Ok(Some(out))
}

pub(crate) fn fts_search_sync(query: String) -> Result<Vec<Hit>> {
    let conn = open_db()?;
    let root_canonical = active_workspace_root()?;
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }

    let (mode, text_query, property_filters) = parse_search_query(q);
    let property_paths = if property_filters.is_empty() {
        None
    } else {
        Some(paths_matching_property_filters(&conn, &property_filters)?)
    };

    if text_query.is_empty() {
        let Some(paths) = property_paths else {
            return Ok(vec![]);
        };
        let mut out: Vec<Hit> = paths
            .into_iter()
            .map(|path| Hit {
                path: workspace_absolute_path(&root_canonical, &path),
                snippet: "property match".to_string(),
                score: 0.0,
            })
            .collect();
        out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
        out.truncate(SEARCH_RESULT_LIMIT);
        return Ok(out);
    }

    if mode == SearchMode::Semantic {
        if let Some(hits) =
            semantic_only_hits(&conn, &root_canonical, &text_query, property_paths.as_ref())?
        {
            return Ok(hits);
        }
        return fallback_lexical_hits(&conn, &root_canonical, &text_query, property_paths.as_ref());
    }

    let mut ranked_rows = collect_lexical_ranked_rows(&conn, &text_query, property_paths.as_ref())?;
    if ranked_rows.is_empty() && mode == SearchMode::Hybrid {
        if let Some(prefix_query) = build_prefix_fts_query(&text_query) {
            if prefix_query != text_query {
                ranked_rows =
                    collect_lexical_ranked_rows(&conn, &prefix_query, property_paths.as_ref())?;
            }
        }
    }
    if ranked_rows.is_empty() {
        return Ok(vec![]);
    }

    let lexical_relevance: Vec<f64> = ranked_rows.iter().map(|item| -item.lexical_score).collect();
    let lexical_norm = min_max_normalize(&lexical_relevance);

    let mut scored: Vec<(usize, f64)> = if mode == SearchMode::Lexical {
        ranked_rows
            .iter()
            .enumerate()
            .map(|(index, _)| (index, lexical_norm[index]))
            .collect()
    } else {
        let mut semantic_norm = vec![0.0f64; ranked_rows.len()];
        let query_vec = semantic::embed_texts(&[text_query.clone()])
            .ok()
            .and_then(|mut items| items.pop());

        if let Some(mut query_vector) = query_vec {
            semantic::normalize_in_place(&mut query_vector);
            let mut semantic_scores = vec![0.0f64; ranked_rows.len()];
            for (index, row) in ranked_rows.iter().enumerate() {
                let embedding = conn.query_row(
                    "SELECT vector, dim FROM embeddings WHERE chunk_id = ?1",
                    params![row.chunk_id],
                    |db_row| Ok((db_row.get::<_, Vec<u8>>(0)?, db_row.get::<_, i64>(1)?)),
                );
                let Ok((blob, dim)) = embedding else {
                    continue;
                };
                let Some(vector) = semantic::blob_to_vector(&blob, dim as usize) else {
                    continue;
                };
                let Some(score) = semantic::cosine_similarity(&query_vector, &vector) else {
                    continue;
                };
                semantic_scores[index] = score as f64;
            }
            semantic_norm = min_max_normalize(&semantic_scores);
        }

        ranked_rows
            .iter()
            .enumerate()
            .map(|(index, _)| {
                let hybrid = lexical_norm[index] * HYBRID_LEXICAL_WEIGHT
                    + semantic_norm[index] * HYBRID_SEMANTIC_WEIGHT;
                (index, hybrid)
            })
            .collect()
    };

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let mut out = Vec::new();
    for (index, score) in scored.into_iter().take(SEARCH_RESULT_LIMIT) {
        let row = &ranked_rows[index];
        out.push(Hit {
            path: workspace_absolute_path(&root_canonical, &row.path),
            snippet: row.snippet.clone(),
            score,
        });
    }
    Ok(out)
}
