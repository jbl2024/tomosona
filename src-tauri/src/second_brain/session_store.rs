use rusqlite::{params, Connection};
use serde::Serialize;

use super::super::{now_ms, AppError, Result};

#[derive(Debug, Clone, Serialize)]
pub struct SessionSummary {
    pub session_id: String,
    pub title: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub context_count: usize,
    pub target_note_path: String,
    pub context_paths: Vec<String>,
    pub alter_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContextItem {
    pub path: String,
    pub token_estimate: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageRow {
    pub id: String,
    pub role: String,
    pub mode: String,
    pub content_md: String,
    pub citations_json: String,
    pub attachments_json: String,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionPayload {
    pub session_id: String,
    pub title: String,
    pub provider: String,
    pub model: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub target_note_path: String,
    pub alter_id: String,
    pub context_items: Vec<ContextItem>,
    pub messages: Vec<MessageRow>,
    pub draft_content: String,
}

pub fn estimate_tokens(text: &str) -> usize {
    let chars = text.chars().count();
    chars.div_ceil(4)
}

pub fn create_session(
    conn: &Connection,
    session_id: &str,
    title: &str,
    provider: &str,
    model: &str,
    alter_id: &str,
) -> Result<(u64, u64)> {
    let ts = now_ms();
    conn.execute(
        "INSERT INTO second_brain_sessions (id, title, provider, model, alter_id, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![session_id, title, provider, model, alter_id, ts as i64],
    )?;
    Ok((ts, ts))
}

pub fn list_sessions(conn: &Connection, limit: usize) -> Result<Vec<SessionSummary>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.title, s.created_at_ms, s.updated_at_ms,
                (SELECT COUNT(*) FROM second_brain_context_items c WHERE c.session_id = s.id) as context_count
                ,COALESCE((SELECT target_note_path FROM second_brain_session_targets t WHERE t.session_id = s.id), ''),
                COALESCE(s.alter_id, '')
         FROM second_brain_sessions s
         ORDER BY s.updated_at_ms DESC
         LIMIT ?1",
    )?;

    let rows = stmt.query_map(params![limit as i64], |row| {
        Ok(SessionSummary {
            session_id: row.get::<_, String>(0)?,
            title: row.get::<_, String>(1)?,
            created_at_ms: row.get::<_, i64>(2)? as u64,
            updated_at_ms: row.get::<_, i64>(3)? as u64,
            context_count: row.get::<_, i64>(4)? as usize,
            target_note_path: row.get::<_, String>(5)?,
            alter_id: row.get::<_, String>(6)?,
            context_paths: Vec::new(),
        })
    })?;

    let mut out = Vec::new();
    for item in rows {
        let mut row = item?;
        let mut context_stmt = conn.prepare(
            "SELECT path FROM second_brain_context_items WHERE session_id = ?1 ORDER BY sort_order ASC",
        )?;
        let context_rows = context_stmt.query_map(params![row.session_id.clone()], |ctx_row| {
            ctx_row.get::<_, String>(0)
        })?;
        let mut context_paths = Vec::new();
        for path in context_rows {
            context_paths.push(path?);
        }
        row.context_paths = context_paths;
        out.push(row);
    }
    Ok(out)
}

pub fn upsert_context(
    conn: &Connection,
    session_id: &str,
    context_items: &[ContextItem],
) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM second_brain_context_items WHERE session_id = ?1",
        params![session_id],
    )?;

    for (index, item) in context_items.iter().enumerate() {
        tx.execute(
            "INSERT INTO second_brain_context_items(session_id, path, sort_order, token_estimate) VALUES (?1, ?2, ?3, ?4)",
            params![session_id, item.path, index as i64, item.token_estimate as i64],
        )?;
    }

    tx.execute(
        "UPDATE second_brain_sessions SET updated_at_ms = ?2 WHERE id = ?1",
        params![session_id, now_ms() as i64],
    )?;
    tx.commit()?;

    Ok(context_items.iter().map(|item| item.token_estimate).sum())
}

pub fn insert_message(conn: &Connection, msg: &MessageRow, session_id: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO second_brain_messages (id, session_id, role, mode, content_md, citations_json, attachments_json, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            msg.id,
            session_id,
            msg.role,
            msg.mode,
            msg.content_md,
            msg.citations_json,
            msg.attachments_json,
            msg.created_at_ms as i64
        ],
    )?;
    conn.execute(
        "UPDATE second_brain_sessions SET updated_at_ms = ?2 WHERE id = ?1",
        params![session_id, now_ms() as i64],
    )?;
    Ok(())
}

pub fn update_session_title(conn: &Connection, session_id: &str, title: &str) -> Result<()> {
    conn.execute(
        "UPDATE second_brain_sessions SET title = ?2, updated_at_ms = ?3 WHERE id = ?1",
        params![session_id, title, now_ms() as i64],
    )?;
    Ok(())
}

pub fn set_target_note_path(
    conn: &Connection,
    session_id: &str,
    target_note_path: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO second_brain_session_targets(session_id, target_note_path, updated_at_ms)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET target_note_path = excluded.target_note_path, updated_at_ms = excluded.updated_at_ms",
        params![session_id, target_note_path, now_ms() as i64],
    )?;
    conn.execute(
        "UPDATE second_brain_sessions SET updated_at_ms = ?2 WHERE id = ?1",
        params![session_id, now_ms() as i64],
    )?;
    Ok(())
}

pub fn load_session(
    conn: &Connection,
    session_id: &str,
    draft_content: String,
) -> Result<SessionPayload> {
    let mut session_stmt = conn.prepare(
        "SELECT s.id, s.title, s.provider, s.model, s.created_at_ms, s.updated_at_ms,
                COALESCE((SELECT target_note_path FROM second_brain_session_targets t WHERE t.session_id = s.id), ''),
                COALESCE(s.alter_id, '')
         FROM second_brain_sessions s
         WHERE s.id = ?1",
    )?;

    let row = session_stmt.query_row(params![session_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)? as u64,
            row.get::<_, i64>(5)? as u64,
            row.get::<_, String>(6)?,
            row.get::<_, String>(7)?,
        ))
    });

    let (id, title, provider, model, created_at_ms, updated_at_ms, target_note_path, alter_id) =
        match row {
            Ok(value) => value,
            Err(_) => {
                return Err(AppError::InvalidOperation(
                    "Second Brain session not found.".to_string(),
                ))
            }
        };

    let mut context_stmt = conn.prepare(
        "SELECT path, token_estimate FROM second_brain_context_items WHERE session_id = ?1 ORDER BY sort_order ASC",
    )?;
    let context_rows = context_stmt.query_map(params![session_id], |row| {
        Ok(ContextItem {
            path: row.get::<_, String>(0)?,
            token_estimate: row.get::<_, i64>(1)? as usize,
        })
    })?;

    let mut context_items = Vec::new();
    for item in context_rows {
        context_items.push(item?);
    }

    let mut message_stmt = conn.prepare(
        "SELECT id, role, mode, content_md, citations_json, attachments_json, created_at_ms
         FROM second_brain_messages
         WHERE session_id = ?1
         ORDER BY created_at_ms ASC",
    )?;

    let message_rows = message_stmt.query_map(params![session_id], |row| {
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
    for item in message_rows {
        messages.push(item?);
    }

    Ok(SessionPayload {
        session_id: id,
        title,
        provider,
        model,
        created_at_ms,
        updated_at_ms,
        target_note_path,
        alter_id,
        context_items,
        messages,
        draft_content,
    })
}

pub fn set_session_alter_id(conn: &Connection, session_id: &str, alter_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE second_brain_sessions SET alter_id = ?2, updated_at_ms = ?3 WHERE id = ?1",
        params![session_id, alter_id, now_ms() as i64],
    )?;
    Ok(())
}

pub fn delete_session(conn: &Connection, session_id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM second_brain_context_items WHERE session_id = ?1",
        params![session_id],
    )?;
    tx.execute(
        "DELETE FROM second_brain_messages WHERE session_id = ?1",
        params![session_id],
    )?;
    tx.execute(
        "DELETE FROM second_brain_drafts WHERE session_id = ?1",
        params![session_id],
    )?;
    tx.execute(
        "DELETE FROM second_brain_session_targets WHERE session_id = ?1",
        params![session_id],
    )?;
    tx.execute(
        "DELETE FROM second_brain_sessions WHERE id = ?1",
        params![session_id],
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimates_tokens_with_char_heuristic() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcdefgh"), 2);
    }
}
