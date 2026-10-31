# Proposal

## Why

Workspace pages are stored as plain Markdown files, so anyone (or any tool) with access to the workspace folder can read every note. We need per-page password protection: a page's content is encrypted at rest and can only be read after entering that page's password.

## What Changes

- Add per-page password protection: each protected page has its own password, chosen when the page is protected.
- Encrypt page content at rest with a key derived from the password (Argon2id) and authenticated encryption (AEAD); the password itself is never stored.
- Keep the page visible in the explorer with a lock badge; the file name stays readable, the content does not.
- Opening a protected page prompts for its password; on success the page is unlocked for the session and edits/saves keep working transparently (content is re-encrypted on save).
- Excluding protected pages from full-text search, wikilink graph, and note properties while they are protected (locked or unlocked): their content never enters the workspace index.
- Preserve the existing history behavior: new snapshots retain the page content and protection state at the time they are saved; existing snapshots are never rewritten or deleted.
- Require the page to be unlocked for content operations such as DOCX export, previews, and plain text reads; allow them once unlocked.
- Add actions to remove protection (requires the current password, decrypts the file back to plain Markdown) and to change a page's password (requires the current password).

## Capabilities

### New Capabilities

- `page-protection`: Password-based protection of individual workspace pages — encrypted storage, unlock/lock lifecycle, protection management (protect, unprotect, change password), and exclusion from indexes and other content surfaces while protection is enabled.

### Modified Capabilities

None. `openspec/specs/` is currently empty, so this change introduces the project's first capability delta.

## Impact

- **Rust backend (`src-tauri`)**: new page-protection module (envelope format, Argon2id key derivation, AEAD encrypt/decrypt, in-memory session key cache); new Tauri commands (protect/unlock/unprotect/change password/status); `read_note_snapshot` and `save_note_buffer` extended to serve and persist encrypted pages; `TreeNode` extended with a protection flag; the shared lexical reindex path excludes protected pages, including during rebuilds; note history stores protected snapshots encrypted and leaves existing snapshots unchanged; DOCX conversion and content previews require protected pages to be unlocked.
- **Frontend (`src`)**: typed API wrappers for the new commands; lock badge in the explorer; password prompt dialog on open; protect/unprotect/change-password entry points in the editor; handling of wrong-password and locked-page errors.
- **Dependencies**: new Rust crypto crates (Argon2id KDF + AEAD cipher), the first crypto dependencies in `src-tauri`.
- **Storage**: protected pages stay `.md` files containing a text envelope with the encrypted payload, so the extension, path, and file name are preserved (existing links and workspace layout keep working).
