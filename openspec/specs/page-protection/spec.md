# Page Protection Specification

## Purpose

Lets users protect individual workspace pages with a password so their content is encrypted at rest and unreadable without that password, while the page itself stays visible in the workspace.

## Requirements

### Requirement: Protect a page with a password
The system SHALL allow the user to protect an existing page by choosing a password for it. Protecting a page SHALL keep the page at its current path and file name, and SHALL store the page content encrypted with a key derived from that password. The system SHALL NOT store the password or the derived key on disk.

#### Scenario: Protect a page from the editor
- **WHEN** the user protects an unlocked, plain page and provides a password
- **THEN** the page stays at the same path with the same file name, its content on disk is replaced by an encrypted payload, and reading it requires the password

#### Scenario: Password is not recoverable from storage
- **WHEN** a page has been protected
- **THEN** neither the password nor a value that allows decrypting without the password is stored in the workspace or app data

### Requirement: Protected page content is unreadable at rest
While a page is protected, the system SHALL store its current file and new history snapshots in encrypted form. Existing history snapshots SHALL retain their original protection settings and remain accessible under those settings.

#### Scenario: File content on disk
- **WHEN** a page is protected
- **THEN** the page file contains the encrypted payload and no readable plaintext of the page content

#### Scenario: Plain text read of a locked protected page
- **WHEN** a protected page that is not unlocked in the current session is opened or read
- **THEN** the system refuses to return its content and presents a password form in the note pane instead of an editable view

### Requirement: Unlock a protected page with its password
The system SHALL require the current page password before returning its protected content. On a correct password, the page SHALL become unlocked for the session and its decrypted content SHALL be editable, with saves re-encrypting the content transparently. On a wrong password, the system SHALL reject the unlock without revealing any content.

#### Scenario: Correct password unlocks the page
- **WHEN** the user enters the correct password for a protected page
- **THEN** the page opens with its decrypted content and can be edited and saved; each save persists the content re-encrypted

#### Scenario: Wrong password is rejected
- **WHEN** the user enters a wrong password for a protected page
- **THEN** no content is revealed and the user is told that the password is incorrect or the file is damaged

#### Scenario: Corrupted or tampered payload
- **WHEN** a protected page's stored payload fails integrity verification during an unlock attempt
- **THEN** the system reports that the password is incorrect or the file is damaged and reveals no content

### Requirement: Unlock state is session-scoped
Each protected page SHALL be unlocked independently using its own password. An unlocked page SHALL remain unlocked for the current app session until the user locks it or the app exits. Locking SHALL hide and prevent editing of the page in open views until it is unlocked again, without discarding unsaved edits. Unlock state SHALL NOT persist across app restarts, and the system SHALL NOT persist decryption keys to disk.

#### Scenario: App restart clears unlock state
- **WHEN** the app is restarted after a protected page was unlocked
- **THEN** the page is locked again and requires its password

#### Scenario: Manual lock
- **WHEN** the user locks an unlocked protected page
- **THEN** open views show the password form and prevent editing until the page is unlocked again, without discarding unsaved edits

### Requirement: Protected pages are visible with a lock indication
The system SHALL keep protected pages visible in the workspace explorer with an indication that they are protected, and SHALL keep their file name readable. It SHALL NOT display protected page content in list previews.

#### Scenario: Explorer shows a lock indication
- **WHEN** the explorer lists a protected page
- **THEN** the page is listed under its existing name with a lock indication and without content preview

### Requirement: Protected pages are excluded from search and graph indexes
While a page is protected, the system SHALL exclude its content from full-text search results, wikilink graph edges, and frontmatter property indexes, regardless of unlock state.

#### Scenario: Search returns no protected content
- **WHEN** a search matches text that exists only inside a protected page
- **THEN** the search returns no result for that page

#### Scenario: Protecting a page removes its index entries
- **WHEN** a page becomes protected
- **THEN** any previously indexed content, links, and properties of that page are removed from the indexes

#### Scenario: Unprotecting a page restores its index entries
- **WHEN** a protected page is unprotected
- **THEN** its content becomes searchable and its links and properties are indexed again

### Requirement: History retains each version's protection settings
The system SHALL preserve history retention and existing snapshots. New snapshots SHALL retain the content and protection settings at the time of saving. Reading a protected snapshot SHALL require its own password. Restoring a snapshot SHALL restore its content and protection settings without writing protected content in plaintext.

#### Scenario: History before protection remains unchanged
- **WHEN** an existing plain page with history is protected
- **THEN** its existing snapshots remain unchanged and accessible as before

#### Scenario: Save a protected version
- **WHEN** a protected page is saved
- **THEN** its history snapshot is encrypted and can be read with that version's password

#### Scenario: Change or remove a password
- **WHEN** the page password is changed or removed
- **THEN** existing snapshots retain their original protection settings and protected snapshots require their original password

#### Scenario: Restore an earlier version
- **WHEN** a user restores a history snapshot
- **THEN** the page has the content and protection settings recorded in that snapshot

### Requirement: Content side channels respect protection
Features that read page content outside the editor (such as document export and file previews) SHALL refuse to operate on a protected page while it is locked, and SHALL operate on its decrypted content once it is unlocked.

#### Scenario: Export of a locked protected page is refused
- **WHEN** the user triggers a content export or preview for a protected page that is not unlocked
- **THEN** the operation is refused with a clear error and no output file is produced

#### Scenario: Export of an unlocked protected page
- **WHEN** the user exports or previews a protected page that is unlocked
- **THEN** the operation works using its decrypted content

### Requirement: Remove protection with the current password
The system SHALL allow the user to remove protection from a page after verifying the page's current password. On success, the page content SHALL be restored as plain Markdown at the same path.

#### Scenario: Unprotect with correct password
- **WHEN** the user removes protection with the correct password
- **THEN** the page file contains its plain Markdown content again and no password is required to read it

#### Scenario: Unprotect with wrong password
- **WHEN** the user attempts to remove protection with a wrong password
- **THEN** the page stays protected and an incorrect-password error is returned

### Requirement: Change a page's password
The system SHALL allow the user to change a protected page's password after verifying the current password. On success, the page SHALL remain protected with its content re-encrypted under the new password.

#### Scenario: Change password then unlock with the new password
- **WHEN** the user changes a protected page's password and later unlocks the page
- **THEN** the new password unlocks the page and the old password is rejected

#### Scenario: Change password with wrong current password
- **WHEN** the user attempts to change the password with a wrong current password
- **THEN** the page's password is unchanged
