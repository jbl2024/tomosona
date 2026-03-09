//! Context loading and mention prioritization for Second Brain prompts.
//!
//! This module stays close to the persistence layer: it reads session context rows,
//! session messages, and the referenced markdown files, then prepares deterministic
//! prompt inputs for downstream prompt construction.

use std::{collections::HashSet, fs};

use rusqlite::params;

use super::{
    super::{active_workspace_root, open_db, Result},
    paths::normalize_markdown_path,
    session_store::{estimate_tokens, ContextItem, MessageRow},
};

#[derive(Debug, Clone)]
pub(super) struct ContextPromptEntry {
    pub path: String,
    pub content: String,
}

/// Loads context items from frontend paths after validating each markdown file.
pub(super) fn load_context_items(paths: &[String]) -> Result<Vec<ContextItem>> {
    let root = active_workspace_root()?;
    let mut out = Vec::new();
    for path in paths {
        let normalized = normalize_markdown_path(path)?;
        let content = fs::read_to_string(root.join(&normalized))?;
        out.push(ContextItem {
            path: normalized,
            token_estimate: estimate_tokens(&content),
        });
    }
    Ok(out)
}

pub(super) fn read_session_context(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Vec<ContextItem>> {
    let mut stmt = conn.prepare(
        "SELECT path, token_estimate FROM second_brain_context_items WHERE session_id = ?1 ORDER BY sort_order ASC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok(ContextItem {
            path: row.get::<_, String>(0)?,
            token_estimate: row.get::<_, i64>(1)? as usize,
        })
    })?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

pub(super) fn read_session_messages(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Vec<MessageRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, role, mode, content_md, citations_json, attachments_json, created_at_ms
         FROM second_brain_messages
         WHERE session_id = ?1
         ORDER BY created_at_ms ASC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok(MessageRow {
            id: row.get::<_, String>(0)?,
            role: row.get::<_, String>(1)?,
            mode: row.get::<_, String>(2)?,
            content_md: row.get::<_, String>(3)?,
            citations_json: row.get::<_, String>(4)?,
            attachments_json: row.get::<_, String>(5)?,
            created_at_ms: row.get::<_, i64>(6)? as u64,
        })
    })?;
    let mut messages = Vec::new();
    for row in rows {
        messages.push(row?);
    }
    Ok(messages)
}

/// Reads prioritized markdown context entries from persisted session context paths.
pub(super) fn load_prioritized_session_entries(
    session_id: &str,
    message: &str,
) -> Result<Vec<ContextPromptEntry>> {
    let conn = open_db()?;
    let context_items = read_session_context(&conn, session_id)?;
    let mentions = extract_mentioned_markdown_paths(message);
    let prioritized = prioritize_context_items(&context_items, &mentions);
    load_context_entries_from_items(&prioritized)
}

/// Reads explicit Pulse context paths after validation.
pub(super) fn load_context_entries_from_paths(paths: &[String]) -> Result<Vec<ContextPromptEntry>> {
    let items = load_context_items(paths)?;
    load_context_entries_from_items(&items)
}

fn load_context_entries_from_items(items: &[ContextItem]) -> Result<Vec<ContextPromptEntry>> {
    let root = active_workspace_root()?;
    let mut entries = Vec::with_capacity(items.len());
    for item in items {
        let content = fs::read_to_string(root.join(&item.path))?;
        entries.push(ContextPromptEntry {
            path: item.path.clone(),
            content,
        });
    }
    Ok(entries)
}

fn normalize_mention_candidate(raw: &str) -> Option<String> {
    let trimmed = raw.trim_matches(|ch: char| {
        matches!(
            ch,
            '(' | ')'
                | '['
                | ']'
                | '{'
                | '}'
                | '<'
                | '>'
                | '"'
                | '\''
                | '`'
                | ','
                | '.'
                | ';'
                | ':'
                | '!'
                | '?'
        )
    });
    if !trimmed.starts_with('@') {
        return None;
    }
    let path = trimmed[1..].trim();
    if path.is_empty() {
        return None;
    }
    let normalized = path.trim_start_matches("./").replace('\\', "/");
    let lower = normalized.to_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".markdown") {
        Some(normalized)
    } else {
        None
    }
}

/// Extracts markdown mention tokens like `@journal/2026-03-03.md`.
pub(super) fn extract_mentioned_markdown_paths(message: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for token in message.split_whitespace() {
        if let Some(path) = normalize_mention_candidate(token) {
            let key = path.to_lowercase();
            if seen.insert(key) {
                out.push(path);
            }
        }
    }
    out
}

/// Reorders context so explicit message mentions come first while preserving stable order.
pub(super) fn prioritize_context_items(
    context_items: &[ContextItem],
    mentions: &[String],
) -> Vec<ContextItem> {
    let mention_set: HashSet<String> = mentions.iter().map(|item| item.to_lowercase()).collect();
    let mut prioritized = Vec::with_capacity(context_items.len());
    for item in context_items {
        if mention_set.contains(&item.path.to_lowercase()) {
            prioritized.push(item.clone());
        }
    }
    for item in context_items {
        if !mention_set.contains(&item.path.to_lowercase()) {
            prioritized.push(item.clone());
        }
    }
    prioritized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_markdown_mentions_and_deduplicates() {
        let mentions = extract_mentioned_markdown_paths(
            "Use @foo/bar.md and @foo/bar.md plus (@journal/2026-03-03.markdown).",
        );
        assert_eq!(
            mentions,
            vec![
                "foo/bar.md".to_string(),
                "journal/2026-03-03.markdown".to_string()
            ]
        );
    }

    #[test]
    fn ignores_non_markdown_mentions() {
        let mentions = extract_mentioned_markdown_paths("ignore @foo/bar.txt and @ folder");
        assert!(mentions.is_empty());
    }

    #[test]
    fn prioritizes_mentioned_context_items_first() {
        let items = vec![
            ContextItem {
                path: "notes/a.md".to_string(),
                token_estimate: 10,
            },
            ContextItem {
                path: "notes/b.md".to_string(),
                token_estimate: 10,
            },
            ContextItem {
                path: "notes/c.md".to_string(),
                token_estimate: 10,
            },
        ];
        let mentions = vec!["notes/c.md".to_string()];
        let ordered = prioritize_context_items(&items, &mentions);
        assert_eq!(ordered[0].path, "notes/c.md");
        assert_eq!(ordered[1].path, "notes/a.md");
        assert_eq!(ordered[2].path, "notes/b.md");
    }
}
