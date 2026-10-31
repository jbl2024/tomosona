# Tasks

## 1. Backend crypto foundation

- [x] 1.1 Add crypto crates to `src-tauri/Cargo.toml` (`argon2`, `chacha20poly1305`, `rand`, `zeroize`) and verify `cargo check` in `src-tauri` passes with no warnings from the new entries
- [x] 1.2 Create `src-tauri/src/page_protection.rs` with the versioned envelope format (marker line, base64 payload, KDF parameters, salt, nonce, ciphertext), the `is_encrypted_page` marker detection, and the Argon2id key derivation plus XChaCha20-Poly1305 encrypt/decrypt helpers; verify with unit tests covering encrypt/decrypt round-trip, wrong-password rejection, tampered-header rejection, unsupported-version error, and marker detection for plain/protected files
- [x] 1.3 Implement the in-memory session key cache (process-global `Mutex<HashMap>` with `Zeroize` on removal) with unlock/lock/status accessors; verify with unit tests that a successful unlock caches the key, a failed unlock caches nothing, and lock clears the key

## 2. Protection commands

- [x] 2.1 Implement `protect_page(path, password)`: validate the path within the active workspace root, refuse an already-protected page, encrypt the current plain content with a fresh salt/nonce, write the envelope atomically, cache the session key, record the internal write, and purge the page's index rows; verify with cargo tests that the file keeps its path/extension, its content is only the envelope, and re-protecting fails with a typed error
- [x] 2.2 Implement `unprotect_page(path, password)`, `change_page_password(path, currentPassword, nextPassword)`, and `lock_page(path)` with password verification against the stored envelope; verify with cargo tests that a wrong password leaves the file unchanged, unprotect restores plain Markdown, a changed password rejects the old one, and lock drops the session key without closing or clearing already-open views
- [x] 2.3 Register the new commands and `page_protection_status(paths)` in `lib.rs`'s invoke handler and verify `cargo check` passes and each command is listed in the handler

## 3. Read/save integration

- [x] 3.1 Extend `read_note_snapshot` to return a typed `PageLocked` error (with path payload) for a protected page without a cached key, and to decrypt transparently when unlocked; verify with cargo tests that a locked protected page never returns content, an unlocked page returns plaintext, and plain pages behave exactly as before
- [x] 3.2 Extend `save_note_buffer` to refuse locked protected pages (including `force` saves) with `PageLocked`, re-encrypt content on save through the cached key, and decrypt `disk_content` in the conflict payload when unlocked; verify with cargo tests covering save-after-unlock writing a fresh envelope, forced save refusal, and conflict payload contents
- [x] 3.3 Preserve existing history retention and snapshots; record new snapshots using the saved page representation (encrypted envelope for protected pages, plain Markdown otherwise). Read protected snapshots with their own password and restore each snapshot with its saved protection settings, coordinating editor state and cached keys. Test plain and encrypted history, unchanged existing snapshots, password changes and removal, and restores without plaintext writes for protected versions.

## 4. Index exclusion and side channels

- [x] 4.1 Make `reindex_markdown_file_lexical_sync` detect encrypted pages and purge their `chunks`, `note_links`, and `note_properties` rows without parsing; the rebuild uses this same path, so no separate detection is needed; verify with cargo tests that protecting a page removes its searchable content, rebuilding the index keeps it out, and unprotecting restores it
- [x] 4.2 Guard Markdown content reads (`convert_markdown_to_docx` and `read_text_file`) against protected pages: refuse with `PageLocked` while locked, operate on decrypted content while unlocked; verify with cargo tests for both states. Keep the existing formats of Pandoc, PDF, and spreadsheet previews.
- [x] 4.3 Add the `isProtected` flag to `TreeNode` filled by `list_children` via marker detection and verify with a cargo test that protected pages are flagged and plain pages are not

## 5. Frontend unlock flow

- [x] 5.1 Create `src/shared/api/pageProtectionApi.ts` with typed wrappers for protect/unlock/lock/unprotect/change-password/status and a typed error shape distinguishing `PageLocked` from other failures; verify with vitest unit tests on the wrapper mapping
- [x] 5.2 Build the password dialog component and the shell-level orchestration that maps a `PageLocked` read failure to the dialog, calls `unlockPage`, and retries the read; verify with vitest tests that a wrong password keeps the page closed, a correct password opens it, each page unlocks independently, locking leaves open views unchanged, and non-locked reads never show the dialog
- [x] 5.3 Add Protect with password, Remove protection, Change password, and Lock page actions to the editor's page menu, wired to the API wrappers with confirmation where applicable; verify with component tests that each action invokes the right wrapper and refreshes the protection status

## 6. Explorer, verification, documentation

- [x] 6.1 Render the lock badge on protected pages in the explorer from `isProtected` and on favorites/pane surfaces from `page_protection_status`, without content previews for protected pages; verify with component tests on the badge rendering and with a vitest check that no preview path renders protected content
- [x] 6.2 Run the full verification suite: `cargo test` in `src-tauri`, `npm run test` and `npm run build`, plus a manual end-to-end pass (protect a page, verify ciphertext on disk and absence from search, restart the app, confirm it is locked, unlock with a wrong then correct password, edit and save, re-check ciphertext on disk)
- [x] 6.3 Update documentation: module header comment for `page_protection.rs`, a `page_protection` row in `src-tauri/src/BACKEND_INDEX_ARCHITECTURE.md` ownership table, and a `CHANGELOG.md` `Unreleased > Added` entry; verify the documented ownership table matches the actual module layout
