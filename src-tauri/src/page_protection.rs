//! Password-based serialization for protected page content.
//!
//! This module owns the authenticated envelope; callers own file access and lifecycle.

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use std::{
    collections::HashMap,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use zeroize::Zeroizing;

const BEGIN: &str = "-----BEGIN TOMOSONA ENCRYPTED PAGE-----";
const END: &str = "-----END TOMOSONA ENCRYPTED PAGE-----";
const HEADER_LEN: usize = 1 + 12 + 16 + 24;

// Serialize file transitions with saves and indexing so stale reads cannot
// overwrite or re-index a page after it becomes protected.
pub(crate) fn page_io_guard() -> crate::Result<std::sync::MutexGuard<'static, ()>> {
    static GUARD: OnceLock<Mutex<()>> = OnceLock::new();
    GUARD
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| crate::AppError::OperationFailed)
}

pub(crate) fn is_encrypted_content(content: &str) -> bool {
    content.lines().next() == Some(BEGIN)
}

pub(crate) fn read_page(path: &Path) -> crate::Result<String> {
    let content = std::fs::read_to_string(path)?;
    if !is_encrypted_content(&content) {
        return Ok(content);
    }
    let canonical = std::fs::canonicalize(path)?;
    decrypt_cached(&canonical, &content).map_err(|error| match error {
        ProtectionError::Locked => crate::AppError::PageLocked(path.to_string_lossy().into_owned()),
        other => protection_error(other),
    })
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ProtectionError {
    InvalidEnvelope,
    UnsupportedVersion,
    DecryptionFailed,
    Locked,
}

type Result<T> = std::result::Result<T, ProtectionError>;

pub(crate) fn is_encrypted_page(path: &Path) -> std::io::Result<bool> {
    let mut line = Vec::new();
    File::open(path)?
        .take((BEGIN.len() + 2) as u64)
        .read_to_end(&mut line)?;
    let marker = BEGIN.as_bytes();
    Ok(line.starts_with(marker)
        && (line.len() == marker.len()
            || line.get(marker.len()) == Some(&b'\n')
            || line.get(marker.len()..) == Some(b"\r\n")))
}

fn derive(password: &str, header: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
    let number = |offset| u32::from_be_bytes(header[offset..offset + 4].try_into().unwrap());
    let (memory, iterations, parallelism) = (number(1), number(5), number(9));
    // Bound untrusted KDF parameters before allocating memory.
    if !(8..=262_144).contains(&memory)
        || !(1..=10).contains(&iterations)
        || !(1..=4).contains(&parallelism)
    {
        return Err(ProtectionError::InvalidEnvelope);
    }
    let params = Params::new(memory, iterations, parallelism, Some(32))
        .map_err(|_| ProtectionError::InvalidEnvelope)?;
    let mut key = Zeroizing::new([0; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), &header[13..29], key.as_mut())
        .map_err(|_| ProtectionError::InvalidEnvelope)?;
    Ok(key)
}

pub(crate) fn encrypt(content: &str, password: &str) -> Result<String> {
    let mut header = [0u8; HEADER_LEN];
    header[0] = 1;
    header[1..5].copy_from_slice(&65536u32.to_be_bytes());
    header[5..9].copy_from_slice(&3u32.to_be_bytes());
    header[9..13].copy_from_slice(&1u32.to_be_bytes());
    OsRng.fill_bytes(&mut header[13..]);
    let key = derive(password, &header)?;
    let cipher = XChaCha20Poly1305::new_from_slice(key.as_ref())
        .map_err(|_| ProtectionError::InvalidEnvelope)?;
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&header[29..53]),
            Payload {
                msg: content.as_bytes(),
                aad: &header,
            },
        )
        .map_err(|_| ProtectionError::DecryptionFailed)?;
    let mut data = header.to_vec();
    data.extend(ciphertext);
    Ok(format!("{BEGIN}\n{}\n{END}\n", STANDARD.encode(data)))
}

fn parse_envelope(envelope: &str) -> Result<Vec<u8>> {
    let mut lines = envelope.lines();
    if lines.next() != Some(BEGIN) {
        return Err(ProtectionError::InvalidEnvelope);
    }
    let data = STANDARD
        .decode(lines.next().ok_or(ProtectionError::InvalidEnvelope)?)
        .map_err(|_| ProtectionError::InvalidEnvelope)?;
    if lines.next() != Some(END) || lines.next().is_some() || data.len() < HEADER_LEN + 16 {
        return Err(ProtectionError::InvalidEnvelope);
    }
    if data[0] != 1 {
        return Err(ProtectionError::UnsupportedVersion);
    }
    Ok(data)
}

fn decrypt_with_key(data: &[u8], key: &[u8; 32]) -> Result<String> {
    let header = &data[..HEADER_LEN];
    let cipher =
        XChaCha20Poly1305::new_from_slice(key).map_err(|_| ProtectionError::InvalidEnvelope)?;
    let plain = cipher
        .decrypt(
            XNonce::from_slice(&header[29..53]),
            Payload {
                msg: &data[HEADER_LEN..],
                aad: header,
            },
        )
        .map_err(|_| ProtectionError::DecryptionFailed)?;
    String::from_utf8(plain).map_err(|_| ProtectionError::InvalidEnvelope)
}

pub(crate) fn decrypt(envelope: &str, password: &str) -> Result<String> {
    let data = parse_envelope(envelope)?;
    let key = derive(password, &data[..HEADER_LEN])?;
    decrypt_with_key(&data, &key)
}

struct PageKey {
    key: Zeroizing<[u8; 32]>,
    parameters: [u8; 29],
}

fn cache() -> &'static Mutex<HashMap<PathBuf, PageKey>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, PageKey>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn unlock(path: &Path, envelope: &str, password: &str) -> Result<()> {
    let data = parse_envelope(envelope)?;
    let key = derive(password, &data[..HEADER_LEN])?;
    decrypt_with_key(&data, &key)?;
    let parameters = data[..29]
        .try_into()
        .map_err(|_| ProtectionError::InvalidEnvelope)?;
    cache()
        .lock()
        .map_err(|_| ProtectionError::InvalidEnvelope)?
        .insert(path.to_path_buf(), PageKey { key, parameters });
    Ok(())
}

pub(crate) fn lock(path: &Path) {
    if let Ok(mut keys) = cache().lock() {
        keys.remove(path);
    }
}

pub(crate) fn is_unlocked(path: &Path) -> bool {
    cache()
        .lock()
        .map(|keys| keys.contains_key(path))
        .unwrap_or(false)
}

pub(crate) fn move_cached_paths(from: &Path, to: &Path) {
    if let Ok(mut keys) = cache().lock() {
        let paths: Vec<_> = keys
            .keys()
            .filter(|path| path.starts_with(from))
            .cloned()
            .collect();
        let moved: Vec<_> = paths
            .into_iter()
            .filter_map(|path| {
                let suffix = path.strip_prefix(from).ok()?.to_path_buf();
                keys.remove(&path).map(|key| (to.join(suffix), key))
            })
            .collect();
        keys.retain(|path, _| !path.starts_with(to));
        keys.extend(moved);
    }
}

pub(crate) fn decrypt_cached(path: &Path, envelope: &str) -> Result<String> {
    let data = parse_envelope(envelope)?;
    let keys = cache().lock().map_err(|_| ProtectionError::Locked)?;
    let entry = keys.get(path).ok_or(ProtectionError::Locked)?;
    if data[..29] != entry.parameters {
        return Err(ProtectionError::Locked);
    }
    decrypt_with_key(&data, &entry.key)
}

pub(crate) fn encrypt_cached(path: &Path, content: &str) -> Result<String> {
    let keys = cache().lock().map_err(|_| ProtectionError::Locked)?;
    let entry = keys.get(path).ok_or(ProtectionError::Locked)?;
    let mut header = [0; HEADER_LEN];
    header[..29].copy_from_slice(&entry.parameters);
    OsRng.fill_bytes(&mut header[29..]);
    let cipher = XChaCha20Poly1305::new_from_slice(entry.key.as_ref())
        .map_err(|_| ProtectionError::InvalidEnvelope)?;
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&header[29..]),
            Payload {
                msg: content.as_bytes(),
                aad: &header,
            },
        )
        .map_err(|_| ProtectionError::DecryptionFailed)?;
    let mut data = header.to_vec();
    data.extend(ciphertext);
    Ok(format!("{BEGIN}\n{}\n{END}\n", STANDARD.encode(data)))
}

fn checked_path(path: &str) -> crate::Result<PathBuf> {
    let root = crate::active_workspace_root()?;
    let path = crate::fs_ops::normalize_path(path)?;
    crate::fs_ops::ensure_within_root(&root, &path)?;
    Ok(std::fs::canonicalize(path)?)
}

pub(crate) fn protection_error(error: ProtectionError) -> crate::AppError {
    match error {
        ProtectionError::Locked => crate::AppError::InvalidOperation("Page is locked.".into()),
        ProtectionError::DecryptionFailed => {
            crate::AppError::InvalidOperation("Incorrect password or damaged file.".into())
        }
        ProtectionError::UnsupportedVersion => {
            crate::AppError::InvalidOperation("Unsupported encrypted format.".into())
        }
        ProtectionError::InvalidEnvelope => {
            crate::AppError::InvalidOperation("Invalid encrypted page.".into())
        }
    }
}

#[tauri::command]
pub(crate) fn protect_page(path: String, password: String) -> crate::Result<()> {
    let guard = page_io_guard()?;
    let path = checked_path(&path)?;
    if !path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
    {
        return Err(crate::AppError::InvalidOperation(
            "Only Markdown pages can be protected.".into(),
        ));
    }
    let plain = std::fs::read_to_string(&path)?;
    if is_encrypted_page(&path)? {
        return Err(crate::AppError::PageAlreadyProtected);
    }
    let envelope = encrypt(&plain, &password).map_err(protection_error)?;
    crate::editor_sync::write_atomically(&path, &envelope)?;
    unlock(&path, &envelope, &password).map_err(protection_error)?;
    if let Some(version) = crate::editor_sync::version_from_path(&path) {
        crate::editor_sync::record_internal_write(&path, version, &envelope);
    }
    drop(guard);
    crate::markdown_index::reindex_markdown_file_lexical_sync(path.to_string_lossy().into_owned())?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn unlock_page(path: String, password: String) -> crate::Result<()> {
    tauri::async_runtime::spawn_blocking(move || unlock_page_sync(path, password))
        .await
        .map_err(|_| crate::AppError::OperationFailed)?
}

// Key derivation is deliberately run off the UI thread by the command above.
fn unlock_page_sync(path: String, password: String) -> crate::Result<()> {
    let _guard = page_io_guard()?;
    let path = checked_path(&path)?;
    let envelope = std::fs::read_to_string(&path)?;
    unlock(&path, &envelope, &password).map_err(protection_error)
}

#[tauri::command]
pub(crate) fn lock_page(path: String) -> crate::Result<()> {
    let _guard = page_io_guard()?;
    let path = checked_path(&path)?;
    lock(&path);
    Ok(())
}

#[tauri::command]
pub(crate) fn unprotect_page(path: String, password: String) -> crate::Result<()> {
    let guard = page_io_guard()?;
    let path = checked_path(&path)?;
    let envelope = std::fs::read_to_string(&path)?;
    let plain = decrypt(&envelope, &password).map_err(protection_error)?;
    crate::editor_sync::write_atomically(&path, &plain)?;
    lock(&path);
    if let Some(version) = crate::editor_sync::version_from_path(&path) {
        crate::editor_sync::record_internal_write(&path, version, &plain);
    }
    drop(guard);
    crate::markdown_index::reindex_markdown_file_lexical_sync(path.to_string_lossy().into_owned())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn change_page_password(
    path: String,
    current_password: String,
    next_password: String,
) -> crate::Result<()> {
    let _guard = page_io_guard()?;
    let path = checked_path(&path)?;
    let envelope = std::fs::read_to_string(&path)?;
    let plain = decrypt(&envelope, &current_password).map_err(protection_error)?;
    let next = encrypt(&plain, &next_password).map_err(protection_error)?;
    crate::editor_sync::write_atomically(&path, &next)?;
    unlock(&path, &next, &next_password).map_err(protection_error)?;
    if let Some(version) = crate::editor_sync::version_from_path(&path) {
        crate::editor_sync::record_internal_write(&path, version, &next);
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProtectionStatus {
    path: String,
    is_protected: bool,
    is_locked: bool,
}

#[tauri::command]
pub(crate) fn page_protection_status(paths: Vec<String>) -> crate::Result<Vec<ProtectionStatus>> {
    paths
        .into_iter()
        .map(|input| {
            let root = crate::active_workspace_root()?;
            let raw_path = crate::fs_ops::normalize_path(&input)?;
            crate::fs_ops::ensure_parent_within_root(&root, &raw_path)?;
            let path = if raw_path.exists() {
                checked_path(&input)?
            } else {
                raw_path
            };
            let protected = path.is_file() && is_encrypted_page(&path)?;
            Ok(ProtectionStatus {
                path: input,
                is_protected: protected,
                is_locked: protected && !is_unlocked(&path),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trip_and_reject_wrong_password_and_tampering() {
        let envelope = encrypt("private note", "secret").unwrap();
        assert_eq!(decrypt(&envelope, "secret").unwrap(), "private note");
        assert_eq!(
            decrypt(&envelope, "wrong"),
            Err(ProtectionError::DecryptionFailed)
        );
        let mut data = STANDARD.decode(envelope.lines().nth(1).unwrap()).unwrap();
        data[29] ^= 1;
        let tampered = format!("{BEGIN}\n{}\n{END}\n", STANDARD.encode(&data));
        assert_eq!(
            decrypt(&tampered, "secret"),
            Err(ProtectionError::DecryptionFailed)
        );
        data[0] = 2;
        let unsupported = format!("{BEGIN}\n{}\n{END}\n", STANDARD.encode(&data));
        assert_eq!(
            decrypt(&unsupported, "secret"),
            Err(ProtectionError::UnsupportedVersion)
        );
    }
    #[test]
    fn cache_only_unlocks_after_verification_and_lock_clears_it() {
        let path = Path::new("cache-test-page");
        let envelope = encrypt("secret", "password").unwrap();
        assert!(unlock(path, &envelope, "wrong").is_err());
        assert!(!is_unlocked(path));
        unlock(path, &envelope, "password").unwrap();
        assert!(is_unlocked(path));
        let saved = encrypt_cached(path, "updated").unwrap();
        assert_eq!(decrypt_cached(path, &saved).unwrap(), "updated");
        let renamed = Path::new("cache-test-renamed");
        move_cached_paths(path, renamed);
        assert!(!is_unlocked(path));
        assert_eq!(decrypt_cached(renamed, &saved).unwrap(), "updated");
        lock(renamed);
        assert_eq!(
            decrypt_cached(renamed, &saved),
            Err(ProtectionError::Locked)
        );
    }
    #[test]
    fn protect_and_manage_page_password() {
        let _guard = crate::workspace_test_guard();
        let dir =
            std::env::temp_dir().join(format!("tomosona-protect-command-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let dir = std::fs::canonicalize(dir).unwrap();
        crate::set_active_workspace(&dir.to_string_lossy()).unwrap();
        let path = dir.join("page.md");
        std::fs::write(&path, "secret content").unwrap();
        let name = path.to_string_lossy().to_string();
        crate::markdown_index::reindex_markdown_file_lexical_sync(name.clone()).unwrap();
        assert_eq!(
            crate::search_index::fts_search_sync("secret".into())
                .unwrap()
                .len(),
            1
        );
        protect_page(name.clone(), "old".into()).unwrap();
        assert!(crate::search_index::fts_search_sync("secret".into())
            .unwrap()
            .is_empty());
        crate::index_schema::rebuild_workspace_index_sync().unwrap();
        assert!(crate::search_index::fts_search_sync("secret".into())
            .unwrap()
            .is_empty());
        let initial = std::fs::read_to_string(&path).unwrap();
        assert!(!initial.contains("secret content"));
        lock_page(name.clone()).unwrap();
        assert!(tauri::async_runtime::block_on(unlock_page(name.clone(), "wrong".into())).is_err());
        assert!(!is_unlocked(&path));
        tauri::async_runtime::block_on(unlock_page(name.clone(), "old".into())).unwrap();
        assert!(is_unlocked(&path));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), initial);
        assert!(matches!(
            protect_page(name.clone(), "old".into()),
            Err(crate::AppError::PageAlreadyProtected)
        ));
        assert!(change_page_password(name.clone(), "wrong".into(), "new".into()).is_err());
        assert_eq!(initial, std::fs::read_to_string(&path).unwrap());
        change_page_password(name.clone(), "old".into(), "new".into()).unwrap();
        let changed = std::fs::read_to_string(&path).unwrap();
        assert!(decrypt(&changed, "old").is_err());
        assert_eq!(decrypt(&changed, "new").unwrap(), "secret content");
        assert!(unprotect_page(name.clone(), "old".into()).is_err());
        unprotect_page(name, "new".into()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "secret content");
        assert_eq!(
            crate::search_index::fts_search_sync("secret".into())
                .unwrap()
                .len(),
            1
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn detects_marker() {
        let dir = std::env::temp_dir().join(format!("tomosona-protection-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("page.md");
        std::fs::write(&path, "plain").unwrap();
        assert!(!is_encrypted_page(&path).unwrap());
        std::fs::write(&path, format!("{BEGIN}\npayload\n")).unwrap();
        assert!(is_encrypted_page(&path).unwrap());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
