# Document Breadcrumb Specification

## Purpose

Turn the active document's location into a navigation surface, so that reaching a note's folder or its document actions does not require hunting through the explorer.

## Requirements

### Requirement: Interactive breadcrumb
The active document's location SHALL be presented as a breadcrumb of workspace-relative segments above the editor. Each segment SHALL be focusable and SHALL expose its actions.

#### Scenario: Segments
- **WHEN** a note at `Projets/AsciiArts.md` is active
- **THEN** the breadcrumb shows `Projets` and `AsciiArts` as separate segments

#### Scenario: Full path on hover
- **WHEN** the pointer rests on the breadcrumb
- **THEN** the complete path is shown

### Requirement: Folder segment reveals in explorer
Activating a folder segment SHALL reveal that folder in the explorer. It SHALL NOT change the active document.

#### Scenario: Reveal
- **WHEN** the user activates the `Projets` segment
- **THEN** the explorer reveals and expands that folder and the active document does not change

### Requirement: Document segment actions
Activating the document segment SHALL offer the document's actions. Right-clicking any segment SHALL open that segment's contextual actions.

#### Scenario: Document actions
- **WHEN** the user activates the document segment
- **THEN** the document's actions are offered

#### Scenario: Segment context menu
- **WHEN** the user right-clicks a folder segment
- **THEN** that folder's contextual actions open

### Requirement: Condensation in narrow panes
When the pane is too narrow for every segment, intermediate segments SHALL condense into an expandable ellipsis. The first and last segments SHALL remain visible.

#### Scenario: Condense
- **WHEN** the breadcrumb does not fit
- **THEN** intermediate segments collapse into an ellipsis while the first and last remain visible

#### Scenario: Expand
- **WHEN** the user activates the ellipsis
- **THEN** the hidden segments become reachable

### Requirement: Breadcrumb is not editable
The breadcrumb SHALL NOT be editable in place. Renaming SHALL keep its dedicated action so internal links stay safe.

#### Scenario: No inline rename
- **WHEN** the user activates a breadcrumb segment
- **THEN** no inline rename field appears

#### Scenario: Rename keeps its action
- **WHEN** the user renames a note
- **THEN** the existing rename action performs it

### Requirement: Status bar keeps operational information
The status bar SHALL NOT repeat the active document's full path. It SHALL keep operational information such as save state, errors and synchronisation state.

#### Scenario: No duplicated path
- **WHEN** a document is active
- **THEN** its full path appears in the breadcrumb and not in the status bar

#### Scenario: Operational information remains
- **WHEN** a save fails
- **THEN** the status bar reports it
