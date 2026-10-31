# Design

## Context

Notes are plain Markdown files in a workspace folder. The editor reads them through `read_note_snapshot` and saves through `save_note_buffer` (`src-tauri/src/editor_sync.rs`, atomic writes). A per-workspace SQLite index stores full-text chunks (FTS), wikilinks, and frontmatter properties; note history keeps the last 20 plaintext snapshots under `.tomosona/note-history/`. The workspace watcher reindexes files on change. Several other commands read note content directly from disk (generic text read, DOCX conversion, pandoc/PDF previews). There is no crypto dependency in the backend today.

See `proposal.md` for motivation and `specs/page-protection/spec.md` for the behavioral contract.

## Goals / Non-Goals

**Goals:**

- Per-page password protection with content encrypted at rest, decryption only after password entry.
- Keep the page at the same path and extension so links, favorites, panes, and workspace layout keep working.
- Encrypt protected page files and new protected history snapshots; leave existing history snapshots unchanged.
- Fit the existing architecture: free-function Rust modules, typed IPC wrappers, no new layers.

**Non-Goals:**

- Workspace-level master password or one password shared by several pages.
- Hiding file names, or encrypting attachments/assets.
- Auto-lock timers, biometrics, keyfiles, or password recovery.
- Protecting pages outside the active workspace.

## Decisions

### D1 — Encryption scheme: Argon2id + XChaCha20-Poly1305

Derive a 32-byte key from the password with Argon2id (per-page random 16-byte salt, interactive params: m = 64 MiB, t = 3, p = 1), then encrypt with XChaCha20-Poly1305 (AEAD) using a fresh random 24-byte nonce per write. The AEAD associated data is the envelope header (version, KDF parameters, salt, nonce) so tampering with parameters fails decryption.

Rationale: AEAD gives confidentiality and integrity in one primitive; Argon2id is the standard memory-hard KDF against offline brute force. XChaCha20-Poly1305 avoids AES-NI dependence on older macs and has a large nonce space, making random-nonce reuse a non-issue. Alternative considered: AES-256-GCM (equally acceptable; ChaCha chosen for constant-time software performance) and the `age` format (rejected: brings a larger dependency surface and a file format we do not control).

New `src-tauri` crates: `argon2`, `chacha20poly1305`, `rand`, `zeroize`. No frontend crypto: all key material stays in the Rust process.

### D2 — File format: text envelope inside the existing `.md` file

A protected page stays a `.md` file at its exact path. Its whole content is replaced by:

```
-----BEGIN TOMOSONA ENCRYPTED PAGE-----
<base64 of versioned envelope: format version, kdf params, salt, nonce, ciphertext>
-----END TOMOSONA ENCRYPTED PAGE-----
```

Detection is a first-line prefix check (`is_encrypted_page` reads the marker line only). Rationale: renaming to `.md.enc` would break existing path references (favorites, panes, wikilinks) and the extension is part of the note identity; a text envelope keeps the file UTF-8 text-safe so atomic writes, watchers, and diff tools keep behaving. Alternatives considered: a YAML frontmatter key (rejected — the payload is not valid YAML text and parsers would still try to index the file) and binary files (rejected—breaks text tooling).

An unrecognized envelope version produces a typed "unsupported encrypted format" error, never content.

### D3 — Session keys live in an in-memory Rust cache

A `page_protection.rs` module owns a process-global `Mutex<HashMap<normalized_path, PageKey>>` (same pattern as `editor_sync::internal_write_slot`). `unlock_page(path, password)` derives the key, attempts AEAD open on the stored envelope, and caches the key only on success; wrong password or corrupted payload returns a typed error without caching anything. Keys are `Zeroize`d on lock and drop, never written to disk, and vanish when the process exits (this is what makes unlock state session-scoped).

All crypto stays in Rust. The frontend never receives keys, salts, or derived material — only success/failure results.

### D4 — Transparent integration into the existing read/save commands

- `read_note_snapshot`: if the file is an encrypted page and no cached key exists, return a typed `PageLocked` error (payload includes the path). With a cached key, decrypt and return plaintext content plus the normal file version.
- `save_note_buffer`: refuse with `PageLocked` when the target is an encrypted page without a cached key (including `force` saves — a forced save would silently replace ciphertext with plaintext). With a cached key, encrypt and write the envelope atomically, then record the internal write as today.
- The conflict payload (`disk_content`) decrypts through the cached key so conflict resolution keeps working; a locked page never reaches the conflict branch because reading it requires unlocking first.

Protect/unprotect are explicit commands, not implicit behaviors:

- `protect_page(path, password)`: requires the page to currently exist as plain content; reads it, encrypts with a fresh salt/nonce, writes the envelope, purges the page's index rows (D5), and caches the key so the just-protected page stays editable without re-prompting.
- `unprotect_page(path, password)`: verifies, decrypts, writes plain Markdown back, drops the cached key, and triggers a lexical reindex so the page returns to search.
- `change_page_password(path, current, next)`: verifies the current password, re-encrypts with a fresh salt under the new password; content unchanged.
- `lock_page(path)`: drops the cached key for future decryptions; already-open views and their content remain unchanged.
- `page_protection_status(paths)`: batch query returning protected/locked flags so any UI surface (explorer, favorites, pane tabs) can render badges.

### D5 — Index exclusion happens in the backend reindex paths

`reindex_markdown_file_lexical_sync` checks `is_encrypted_page` first: for protected pages it deletes the path's `chunks`, `note_links`, and `note_properties` rows and returns without parsing. The full rebuild already calls this function for each page, so it needs no separate detection. Protect and watcher-triggered reindex use the same exclusion; unprotect triggers normal reindexing, restoring entries.

### D6 — Preserve history with each version's protection settings

Keep the existing history retention, listing, and restore workflow. Record the actual persisted page representation as the snapshot: plain Markdown for an unprotected page, its encrypted envelope for a protected page. Existing snapshots are not modified or deleted when protection is added, removed, or changed.

A snapshot is read using its own representation. An encrypted snapshot requires the password that protected that version, even if the current page password has since changed or protection has been removed. Restoring a snapshot restores its content and protection settings as saved; a protected snapshot remains encrypted on disk. Coordinate the restore with the editor and key cache so the restored state is reflected correctly and unsaved edits are not silently lost. History retention remains unchanged.

### D7 — Side channels check protection before reading

Markdown content reads outside the editor (`convert_markdown_to_docx` and `read_text_file`) use the cached-key helper. When a protected page is unlocked, they operate on decrypted content; when locked, they return `PageLocked` and produce no output. Pandoc, PDF, and spreadsheet previews keep their existing supported formats and do not gain Markdown preview support. `open_path_external` and file-manager reveal are untouched — they open the file as-is (ciphertext), which is safe and expected.

### D8 — Frontend: typed API module, shell-owned dialog, editor actions

- New transport-only wrappers in `src/shared/api/pageProtectionApi.ts` (protect, unlock, lock, unprotect, change password, status) plus a typed error shape so callers can distinguish "page locked" from other failures.
- Opening flow: the app-level note persistence layer maps the `PageLocked` error to a password dialog; on success it retries the read, so editors and session composables do not know about encryption.
- Each protected page is unlocked independently with its own password. Locking it affects future decryptions only and does not close or clear already-open views.
- Editor page menu gains: Protect with password, Remove protection, Change password, Lock page. The dialog itself is a focused modal component following the existing dialog/composable pattern; the shell (App-level orchestration) owns showing it, matching how other app-level modals work.
- The explorer renders the lock badge from a new `isProtected` flag on `TreeNode` (filled by `list_children` via the marker check).

## Risks / Trade-offs

- [Forgotten password = unrecoverable content] → The dialog states that the password cannot be recovered; no backdoor exists by design. Documented in the dialog copy.
- [Argon2id unlock latency on low-end machines] → Interactive parameters (~64 MiB, t=3) keep unlock under a few hundred ms on modern hardware; parameters are stored in the envelope so they can be tuned later without invalidating old files.
- [File name, size, and mtime remain observable] → Accepted per scope (page stays visible with a lock badge); the spec's confidentiality claim is about content only.
- [Plaintext exists in process memory while unlocked] → Inherent to the feature; mitigated by zeroizing keys on lock and never persisting them. The editor already buffers unsaved content in memory.
- [External tools see ciphertext] → Expected consequence of encrypt-at-rest; the envelope marker makes the format self-describing for future tooling.
- [Downgrade/rollback leaves unreadable pages] → Rollback procedure: unprotect all pages first; an envelope that survives an app downgrade renders only the typed "unsupported format" error, no corruption.

## Migration Plan

No history migration: existing snapshots retain their original representation and protection settings. Existing plain pages remain plain until protected. Protection is applied per page on demand. The envelope carries a format version from day one, so a future format change can read v1 files explicitly. Rollback: unprotect protected pages before running an older build.
