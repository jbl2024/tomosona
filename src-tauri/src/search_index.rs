//! Lexical search query parsing and helpers.

use std::collections::HashSet;

use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection};
use serde::Serialize;

use crate::markdown_index::{is_iso_date_value, unquote_yaml_scalar};
use crate::{
    active_workspace_root, ensure_index_schema, min_max_normalize, open_db,
    property_type_schema_path, workspace_absolute_path, AppError, Result, SEARCH_RESULT_LIMIT,
};

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
    Lexical,
}

#[derive(Debug)]
struct RankedSearchRow {
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
            if matches!(
                raw_type,
                "text" | "list" | "number" | "checkbox" | "date" | "tags"
            ) {
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
        if matches!(
            value.as_str(),
            "text" | "list" | "number" | "checkbox" | "date" | "tags"
        ) {
            sanitized.insert(normalized_key, value);
        }
    }
    let serialized =
        serde_json::to_string_pretty(&sanitized).map_err(|_| AppError::OperationFailed)?;
    std::fs::write(schema_path, serialized)?;
    Ok(())
}

pub(crate) fn read_property_value_suggestions(
    key: String,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<String>> {
    let normalized_key = key.trim().to_lowercase();
    if normalized_key.is_empty() {
        return Ok(Vec::new());
    }

    let normalized_query = query.unwrap_or_default().trim().to_lowercase();
    let limit = limit.unwrap_or(20).clamp(1, 100) as i64;

    let conn = open_db()?;
    ensure_index_schema(&conn)?;

    let mut values = Vec::new();
    if normalized_query.is_empty() {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT value_text
             FROM note_properties
             WHERE key = ?1
               AND value_text IS NOT NULL
               AND value_text <> ''
             ORDER BY value_text ASC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![normalized_key, limit], |row| {
            row.get::<_, String>(0)
        })?;
        for row in rows {
            values.push(row?);
        }
        return Ok(values);
    }

    let mut stmt = conn.prepare(
        "SELECT DISTINCT value_text
         FROM note_properties
         WHERE key = ?1
           AND value_text IS NOT NULL
           AND value_text <> ''
           AND instr(value_text, ?2) = 1
         ORDER BY value_text ASC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![normalized_key, normalized_query, limit], |row| {
        row.get::<_, String>(0)
    })?;
    for row in rows {
        values.push(row?);
    }
    Ok(values)
}

pub(crate) fn read_property_keys(limit: Option<usize>) -> Result<Vec<String>> {
    let limit = limit.unwrap_or(100).clamp(1, 200) as i64;

    let conn = open_db()?;
    ensure_index_schema(&conn)?;

    let mut values = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT DISTINCT key
         FROM note_properties
         WHERE key IS NOT NULL
           AND key <> ''
         ORDER BY lower(key) ASC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| row.get::<_, String>(0))?;
    for row in rows {
        values.push(row?);
    }
    Ok(values)
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

    let operators = [
        (">=", 2usize),
        ("<=", 2usize),
        (">", 1usize),
        ("<", 1usize),
        (":", 1usize),
        ("=", 1usize),
    ];
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
                    value: if value.eq_ignore_ascii_case("true") {
                        1
                    } else {
                        0
                    },
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
    let (mode, remainder) = if lowered.starts_with("lexical:") {
        (
            SearchMode::Lexical,
            trimmed["lexical:".len()..].trim_start(),
        )
    } else {
        (SearchMode::Lexical, trimmed)
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

fn path_set_for_property_filter(
    conn: &Connection,
    filter: &PropertyFilter,
) -> Result<HashSet<String>> {
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

fn paths_matching_property_filters(
    conn: &Connection,
    filters: &[PropertyFilter],
) -> Result<HashSet<String>> {
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
    SELECT chunks.path,
           snippet(chunks_fts, 2, '<b>', '</b>', '...', 12) AS snip,
           bm25(chunks_fts) AS score
    FROM chunks_fts
    JOIN chunks ON chunks_fts.rowid = chunks.id
    WHERE chunks_fts MATCH ?1
    ORDER BY score
    LIMIT ?2;
  "#,
    )?;

    let mut rows = stmt.query(params![text_query, SEARCH_RESULT_LIMIT as i64])?;
    let mut ranked_rows = Vec::new();
    while let Some(row) = rows.next()? {
        let path = row.get::<_, String>(1)?;
        if property_paths.is_some_and(|paths| !paths.contains(&path)) {
            continue;
        }
        ranked_rows.push(RankedSearchRow {
            path,
            snippet: row.get::<_, String>(1)?,
            lexical_score: row.get::<_, f64>(2)?,
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

pub(crate) fn fts_search_sync(query: String) -> Result<Vec<Hit>> {
    let conn = open_db()?;
    let root_canonical = active_workspace_root()?;
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }

    let (_mode, text_query, property_filters) = parse_search_query(q);
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

    let mut ranked_rows = collect_lexical_ranked_rows(&conn, &text_query, property_paths.as_ref())?;
    if ranked_rows.is_empty() {
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
            path: workspace_absolute_path(&root_canonical, &row.path),
            snippet: row.snippet.clone(),
            score,
        });
    }
    Ok(out)
}
