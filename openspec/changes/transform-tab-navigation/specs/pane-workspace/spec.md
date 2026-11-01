# Spec Delta

## Purpose

Divide the workspace into panes that each own their documents and reading context, so that several notes can be consulted and edited side by side without losing track of which pane is being worked in.

## ADDED Requirements

### Requirement: Active pane identification
Exactly one pane SHALL be active at a time and SHALL be identifiable without a heavy contrast jump between panes. Interacting with a pane's strip or surface SHALL make it active.

#### Scenario: Focus follows interaction
- **WHEN** the user clicks a tab in the inactive pane
- **THEN** that pane becomes active

#### Scenario: Single active pane
- **WHEN** two panes are open
- **THEN** only one shows the active-pane affordance

### Requirement: Per-pane independent state
Each pane SHALL own its tab selection, navigation history, reading position per document, and tab menu. Changing one pane's selection SHALL NOT change another pane's.

#### Scenario: Independent selection
- **WHEN** the user switches tabs in the left pane
- **THEN** the right pane keeps its own active tab

#### Scenario: Independent reading position
- **WHEN** the same document is open in both panes
- **THEN** scrolling one pane does not move the other

### Requirement: History restores reading position
Navigating back or forward in the shell history to a document SHALL restore the pane's stored reading position for that document, not only the document itself.

#### Scenario: Back restores the reading position
- **WHEN** the user goes back in the shell history to a document previously consulted in the active pane
- **THEN** the document opens at the reading position that pane stored for it

### Requirement: Moving a tab between panes
A tab SHALL be movable from one pane's strip to another's by dragging, with the drop target clearly marked. The moved tab SHALL keep its document, its unsaved changes and its pinned state.

#### Scenario: Drag to the other strip
- **WHEN** the user drags a tab onto the other pane's strip
- **THEN** the tab moves there and becomes that pane's active tab

#### Scenario: Unsaved changes survive
- **WHEN** a tab with unsaved changes is moved to another pane
- **THEN** the changes are still present in the destination pane

#### Scenario: Empty source pane
- **WHEN** the last tab of a pane is moved away
- **THEN** the source pane shows its home surface

### Requirement: Duplicate view of one document
The same document SHALL be openable in both panes as two views of one document. Edits SHALL be shared between the views and reading positions SHALL stay independent. Duplicating a view SHALL NOT create or copy a file.

#### Scenario: Shared edits
- **WHEN** the document is edited in one pane
- **THEN** the other pane shows the same content

#### Scenario: Independent positions
- **WHEN** the two views are scrolled to different sections
- **THEN** each keeps its own position

#### Scenario: No file created
- **WHEN** a view is duplicated
- **THEN** the workspace contains no additional file

#### Scenario: Open-to-the-right command
- **WHEN** the user runs the palette's open-to-the-right command on the active document
- **THEN** the document opens in the other pane as a second view and no file is created

### Requirement: Closing and joining panes
A pane SHALL be closable without closing its tabs one by one. Joining panes SHALL preserve the open tabs as far as possible and SHALL NOT discard unsaved changes.

#### Scenario: Close a pane
- **WHEN** the user closes a pane
- **THEN** its tabs close and the remaining pane keeps its own tabs

#### Scenario: Join panes
- **WHEN** the user joins two panes
- **THEN** the tabs of both are preserved in the remaining pane

#### Scenario: Unsaved changes on join
- **WHEN** a joined pane holds unsaved changes
- **THEN** they are not discarded silently

### Requirement: Empty pane home surface
A pane with no open document SHALL show its home surface directly. It SHALL NOT present a placeholder that looks like a tab but cannot be navigated or acted on like one.

#### Scenario: No open document
- **WHEN** a pane has no open tab
- **THEN** it shows its home surface with note creation and recent notes

#### Scenario: No fake tab
- **WHEN** a pane is empty
- **THEN** the strip shows no tab-shaped placeholder

### Requirement: Pane navigation controls
The pane strip SHALL expose moving the active tab to the adjacent pane with explicit icons and tooltips. Pane history SHALL remain a shell-level control and SHALL NOT be duplicated in the pane strip.

#### Scenario: Explicit controls
- **WHEN** the user hovers a pane navigation control
- **THEN** its tooltip states what it does

#### Scenario: History stays in the top bar
- **WHEN** the user looks for back and forward
- **THEN** they are available in the top bar and not in the pane strip
