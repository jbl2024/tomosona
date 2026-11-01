# Workspace Organization

## Purpose

Let users safely reorganize real workspace files with recoverable operations and coherent references and views.

## ADDED Requirements

### Requirement: Inline rename
F2 and the context menu SHALL rename notes and folders inline. Enter confirms and Escape cancels. The Markdown extension SHALL be preserved and excluded from the initial editable selection; the row SHALL remain in place during editing. Invalid or duplicate names SHALL produce a clear error without overwriting another entry.

#### Scenario: Rename collision
- **WHEN** the requested name already exists in the same folder
- **THEN** the existing entry is untouched and the user can correct or cancel the rename

### Requirement: Multiple selection
Cmd/Ctrl-click SHALL toggle individual entries and Shift-click SHALL select a range of visible rows. These gestures SHALL NOT open a note. Selection can span folders; a contextual action bar SHALL appear only for multiple entries and offer move, copy and trash, plus export only if supported.

#### Scenario: Parent and child selected
- **WHEN** an operation targets a selected folder and its selected descendant
- **THEN** the descendant is processed only once as part of the folder

#### Scenario: Cross-folder selection
- **WHEN** entries from different parents are selected
- **THEN** the same group actions operate on all eligible selected entries and report ineligible entries

### Requirement: Move using destination picker
A move command SHALL support one or multiple entries and present searchable folder destinations, recent destinations and the workspace root. Invalid destinations, including the source folder itself and descendants of a moved folder, SHALL be unavailable with an explanation. Confirmation SHALL perform the move through the same safety rules as drag-and-drop.

#### Scenario: Search and move
- **WHEN** the user searches for a destination, selects a valid folder and confirms
- **THEN** eligible selected entries move there and the destination becomes recent

### Requirement: Drag and drop
Dragging a note, folder or normalized selection SHALL identify the destination clearly, expand a closed folder after a brief hover and scroll near tree edges. It SHALL reject self and descendant moves and no-op destinations. A successful move SHALL provide discreet confirmation and undo.

#### Scenario: Invalid descendant target
- **WHEN** a folder is dragged onto itself or a descendant
- **THEN** the drop is rejected and no files change

### Requirement: Preserve references safely
Rename and move operations SHALL preserve supported internal links whenever they can be resolved and updated safely, including references affected by folder moves. Before an operation that cannot guarantee this, the system SHALL identify the risk and ask for explicit confirmation or cancel; it SHALL NOT silently claim links remain valid.

#### Scenario: Protected or ambiguous references
- **WHEN** a locked protected note or an ambiguous reference cannot be inspected or updated safely
- **THEN** the user is warned of the limitation before continuing and no protected content is exposed

#### Scenario: Open and unsaved notes
- **WHEN** an affected note has unsaved changes
- **THEN** the operation preserves those changes and avoids overwriting them, or is blocked with a clear explanation

### Requirement: Recoverable operations
Successful rename, move and trash operations SHALL offer immediate undo that restores paths and any references changed by that operation. Deletion SHALL move entries to a recoverable trash rather than permanently deleting them. Undo SHALL validate current state and never overwrite subsequent external changes.

#### Scenario: Undo conflict
- **WHEN** the original location is occupied or an affected file has changed since the operation
- **THEN** undo stops safely, reports the conflict and leaves both versions intact

#### Scenario: Partial group failure
- **WHEN** only some entries in a group operation succeed
- **THEN** the user sees which succeeded and failed and can undo the successful subset without silently retrying it

### Requirement: Synchronize workspace views
Successful path changes SHALL update open tabs, active note, editor title, navigation history, favorites, indexes and explorer selection as applicable. Existing title-heading and protection contracts SHALL remain valid. Failed operations SHALL NOT leave those views claiming a change that did not occur.

#### Scenario: Rename an open note
- **WHEN** an open note is renamed in the explorer
- **THEN** its editor and navigation state follow the resulting path and subsequent save targets that path

### Requirement: Safe filesystem boundaries
Operations SHALL validate paths and workspace boundaries, reject invalid or stale sources and inaccessible targets, and return actionable errors without exposing sensitive paths. They SHALL NOT overwrite existing entries without an explicit conflict choice.

#### Scenario: External change before commit
- **WHEN** a source disappears or destination changes after the operation was prepared
- **THEN** the operation fails safely and the explorer refreshes to reflect reality
