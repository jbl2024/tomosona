//! Draft persistence and publish/export helpers for Second Brain sessions.
//!
//! These flows share filesystem validation, markdown merging and DB lookup logic.
//! Keeping them together avoids repeating path safety checks across command wrappers.

use std::{fs, path::PathBuf};

use rusqlite::params;

use super::{
    super::{
        active_workspace_root, ensure_index_schema, now_ms, open_db,
        reindex_markdown_file_now_sync, AppError, Result,
    },
    draft::{read_draft, write_draft},
    paths::{
        chrono_like_today, ensure_within, normalize_workspace_markdown_relative, sanitize_file_name,
    },
    session_exists,
    session_store::{load_session, set_target_note_path},
    AppendMessageToDraftPayload, ExportSessionMarkdownResult, InsertAssistantIntoTargetPayload,
    InsertAssistantIntoTargetResult, PublishDraftToExistingNotePayload,
    PublishDraftToNewNotePayload, PublishDraftToNewNoteResult, SaveDraftPayload,
    SetSessionTargetNotePayload, SetSessionTargetNoteResult,
};

pub(super) fn save_draft(payload: SaveDraftPayload) -> Result<()> {
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    ensure_session_exists(&conn, &payload.session_id)?;

    write_draft(&payload.session_id, &payload.content_md)?;
    conn.execute(
        "INSERT INTO second_brain_drafts (session_id, content_md, updated_at_ms)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET content_md = excluded.content_md, updated_at_ms = excluded.updated_at_ms",
        params![payload.session_id, payload.content_md, now_ms() as i64],
    )?;
    Ok(())
}

pub(super) fn append_message_to_draft(payload: AppendMessageToDraftPayload) -> Result<String> {
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    ensure_session_exists(&conn, &payload.session_id)?;

    let message_content = conn
        .query_row(
            "SELECT content_md FROM second_brain_messages WHERE id = ?1 AND session_id = ?2",
            params![payload.message_id, payload.session_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| AppError::InvalidOperation("Message not found in session.".to_string()))?;

    let draft_content =
        merge_markdown_sections(&read_draft(&payload.session_id)?, &message_content);
    write_draft(&payload.session_id, &draft_content)?;

    conn.execute(
        "INSERT INTO second_brain_drafts (session_id, content_md, updated_at_ms)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET content_md = excluded.content_md, updated_at_ms = excluded.updated_at_ms",
        params![payload.session_id, draft_content, now_ms() as i64],
    )?;

    read_draft(&payload.session_id)
}

pub(super) fn publish_draft_to_new_note(
    payload: PublishDraftToNewNotePayload,
) -> Result<PublishDraftToNewNoteResult> {
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    ensure_session_exists(&conn, &payload.session_id)?;

    let root = active_workspace_root()?;
    let target_dir = PathBuf::from(&payload.target_dir);
    if !target_dir.exists() || !target_dir.is_dir() {
        return Err(AppError::InvalidPath);
    }
    let target_dir_canonical = fs::canonicalize(target_dir)?;
    if !target_dir_canonical.starts_with(&root) {
        return Err(AppError::InvalidPath);
    }

    let file_name = sanitize_file_name(&payload.file_name);
    let target_path = target_dir_canonical.join(file_name);
    if target_path.exists() {
        return Err(AppError::AlreadyExists);
    }

    let draft_content = read_draft(&payload.session_id)?;
    let frontmatter = build_new_note_frontmatter(&payload.session_id, &payload.sources);

    fs::write(&target_path, format!("{frontmatter}{draft_content}\n"))?;
    ensure_within(&root, &target_path)?;
    reindex_markdown_file_now_sync(target_path.to_string_lossy().to_string())?;

    Ok(PublishDraftToNewNoteResult {
        path: target_path.to_string_lossy().to_string(),
    })
}

pub(super) fn publish_draft_to_existing_note(
    payload: PublishDraftToExistingNotePayload,
) -> Result<()> {
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    ensure_session_exists(&conn, &payload.session_id)?;

    let root = active_workspace_root()?;
    let target_path = PathBuf::from(&payload.target_path);
    if !target_path.exists() || !target_path.is_file() {
        return Err(AppError::InvalidPath);
    }
    let canonical = fs::canonicalize(&target_path)?;
    if !canonical.starts_with(&root) {
        return Err(AppError::InvalidPath);
    }

    let existing = fs::read_to_string(&canonical)?;
    let draft_content = read_draft(&payload.session_id)?;
    let merged = merge_markdown_sections(&existing, &draft_content);
    fs::write(&canonical, merged)?;
    reindex_markdown_file_now_sync(canonical.to_string_lossy().to_string())?;

    Ok(())
}

pub(super) fn set_session_target_note_impl(
    payload: SetSessionTargetNotePayload,
) -> Result<SetSessionTargetNoteResult> {
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    ensure_session_exists(&conn, &payload.session_id)?;
    let target_relative = normalize_workspace_markdown_relative(&payload.target_path)?;
    set_target_note_path(&conn, &payload.session_id, &target_relative)?;
    Ok(SetSessionTargetNoteResult {
        target_note_path: target_relative,
    })
}

pub(super) fn insert_assistant_into_target_note_impl(
    payload: InsertAssistantIntoTargetPayload,
) -> Result<InsertAssistantIntoTargetResult> {
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    ensure_session_exists(&conn, &payload.session_id)?;

    let target_relative: String = conn
        .query_row(
            "SELECT target_note_path FROM second_brain_session_targets WHERE session_id = ?1",
            params![payload.session_id.clone()],
            |row| row.get(0),
        )
        .map_err(|_| {
            AppError::InvalidOperation("No target note is linked to this session.".to_string())
        })?;

    if target_relative.trim().is_empty() {
        return Err(AppError::InvalidOperation(
            "No target note is linked to this session.".to_string(),
        ));
    }

    let assistant_text: String = conn
        .query_row(
            "SELECT content_md FROM second_brain_messages WHERE id = ?1 AND session_id = ?2 AND role = 'assistant'",
            params![payload.message_id, payload.session_id.clone()],
            |row| row.get(0),
        )
        .map_err(|_| AppError::InvalidOperation("Assistant message not found.".to_string()))?;

    let root = active_workspace_root()?;
    let target_path = root.join(&target_relative);
    let existing = fs::read_to_string(&target_path).unwrap_or_default();
    let next = merge_markdown_sections(&existing, &assistant_text);
    fs::write(&target_path, next)?;
    reindex_markdown_file_now_sync(target_path.to_string_lossy().to_string())?;

    Ok(InsertAssistantIntoTargetResult {
        target_note_path: target_relative,
    })
}

pub(super) fn export_session_markdown(session_id: String) -> Result<ExportSessionMarkdownResult> {
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    ensure_session_exists(&conn, &session_id)?;

    let payload = load_session(&conn, &session_id, read_draft(&session_id)?)?;
    let root = active_workspace_root()?;
    let session_dir = root.join(".tomosona").join("second-brain").join("sessions");
    fs::create_dir_all(&session_dir)?;
    let out_path = session_dir.join(format!("{session_id}.md"));

    let context_list = payload
        .context_items
        .iter()
        .map(|item| format!("- {}", item.path))
        .collect::<Vec<_>>()
        .join("\n");

    let mut thread = String::new();
    for msg in &payload.messages {
        thread.push_str(&format!(
            "\n### {} ({})\n\n{}\n",
            if msg.role == "assistant" {
                "Assistant"
            } else {
                "User"
            },
            msg.mode,
            msg.content_md
        ));
    }

    let markdown = format!(
        "---\nsession_id: {}\ntitle: {}\ncreated_at_ms: {}\nupdated_at_ms: {}\ntarget_note_path: {}\n---\n\n## Context\n{}\n\n## Thread{}\n",
        payload.session_id,
        payload.title,
        payload.created_at_ms,
        payload.updated_at_ms,
        payload.target_note_path,
        context_list,
        thread
    );

    fs::write(&out_path, markdown)?;
    Ok(ExportSessionMarkdownResult {
        path: out_path.to_string_lossy().to_string(),
    })
}

fn ensure_session_exists(conn: &rusqlite::Connection, session_id: &str) -> Result<()> {
    if !session_exists(conn, session_id)? {
        return Err(AppError::InvalidOperation(
            "Second Brain session not found.".to_string(),
        ));
    }
    Ok(())
}

fn merge_markdown_sections(existing: &str, addition: &str) -> String {
    if existing.trim().is_empty() {
        return addition.to_string();
    }
    if addition.trim().is_empty() {
        return existing.to_string();
    }
    format!("{existing}\n\n---\n\n{addition}")
}

fn build_new_note_frontmatter(session_id: &str, sources: &[String]) -> String {
    let created = chrono_like_today();
    let mut frontmatter = String::new();
    frontmatter.push_str("---\n");
    frontmatter.push_str(&format!("created: {created}\n"));
    frontmatter.push_str("origin: ai\n");
    frontmatter.push_str("sources:\n");
    for source in sources {
        frontmatter.push_str(&format!("  - [[{}]]\n", source.trim()));
    }
    frontmatter.push_str(&format!("session_id: {session_id}\n"));
    frontmatter.push_str("---\n\n");
    frontmatter
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_markdown_sections_uses_separator() {
        assert_eq!(merge_markdown_sections("A", "B"), "A\n\n---\n\nB");
    }

    #[test]
    fn merge_markdown_sections_keeps_non_empty_side() {
        assert_eq!(merge_markdown_sections("", "B"), "B");
        assert_eq!(merge_markdown_sections("A", ""), "A");
    }

    #[test]
    fn frontmatter_contains_sources_and_session() {
        let frontmatter = build_new_note_frontmatter("sb-1", &["notes/a".to_string()]);
        assert!(frontmatter.contains("session_id: sb-1"));
        assert!(frontmatter.contains("[[notes/a]]"));
        assert!(frontmatter.contains("origin: ai"));
    }
}
