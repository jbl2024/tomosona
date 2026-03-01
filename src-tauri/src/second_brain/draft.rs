use std::{fs, path::PathBuf};

use super::super::{active_workspace_root, AppError, Result, INTERNAL_DIR_NAME};

const SECOND_BRAIN_DIR: &str = "second-brain";
const DRAFT_DIR: &str = "drafts";

pub fn draft_dir() -> Result<PathBuf> {
    let root = active_workspace_root()?;
    let dir = root
        .join(INTERNAL_DIR_NAME)
        .join(SECOND_BRAIN_DIR)
        .join(DRAFT_DIR);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn draft_file_path(session_id: &str) -> Result<PathBuf> {
    let clean = session_id.trim();
    if clean.is_empty() || clean.contains('/') || clean.contains('\\') {
        return Err(AppError::InvalidPath);
    }
    Ok(draft_dir()?.join(format!("{clean}.md")))
}

pub fn read_draft(session_id: &str) -> Result<String> {
    let path = draft_file_path(session_id)?;
    if !path.exists() {
        return Ok(String::new());
    }
    Ok(fs::read_to_string(path)?)
}

pub fn write_draft(session_id: &str, content_md: &str) -> Result<()> {
    let path = draft_file_path(session_id)?;
    fs::write(path, content_md)?;
    Ok(())
}

pub fn delete_draft(session_id: &str) -> Result<()> {
    let path = draft_file_path(session_id)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_session_id() {
        assert!(draft_file_path("../escape").is_err());
    }
}
