# Explorer Navigation Specification

## Purpose

Provide a clear, persistent and accessible view of the real workspace tree for navigating and creating files.

## Requirements

### Requirement: Clear tree presentation
The explorer SHALL display the actual workspace hierarchy, explicit expanded/collapsed folder chevrons, and distinct active-note, hover, focus and selection states. Markdown `.md` extensions SHALL be hidden by default and a persistent display preference SHALL restore them; actual filenames SHALL remain unchanged.

#### Scenario: Active note differs from selection
- **WHEN** a note is active in the editor while another tree entry is selected
- **THEN** the active note and selection are independently recognizable without a second selection state

#### Scenario: Narrow panel
- **WHEN** a name does not fit the panel
- **THEN** it is truncated without overflow and hovering reveals its full name and location

### Requirement: Focused toolbar and options
The toolbar SHALL prioritize new note, new folder and local filter. An overflow menu SHALL provide expand all, collapse all, reveal active note, sorting, extension display and refresh. Ordinary external changes SHALL refresh automatically; manual refresh remains available.

#### Scenario: Reveal on demand
- **WHEN** the user requests reveal of the active note
- **THEN** its ancestors open and its row becomes visible; ordinary editor navigation does not automatically disrupt the tree

### Requirement: Predictable sorting
The default sort SHALL place folders before notes and sort alphabetically. The explorer SHALL provide persistent sort alternatives, and SHALL keep row order stable during an active inline edit or selection gesture.

#### Scenario: Sorting persists
- **WHEN** the user selects a sort option and reopens the workspace
- **THEN** the selected order is restored

### Requirement: Contextual tree interactions
Clicking a folder name or chevron SHALL toggle it; clicking a note SHALL open it in the current tab. A folder row SHALL expose a contextual new-note action and an overflow action on hover or keyboard focus; a note row SHALL expose only its overflow action. Creation SHALL target the indicated folder and support inline naming.

#### Scenario: Create inside a closed folder
- **WHEN** the user activates the folder's plus action and names a note
- **THEN** the note is created in that folder, which becomes visible, without ambiguity about the destination

#### Scenario: Cancel creation
- **WHEN** inline creation is cancelled or its name is invalid
- **THEN** no unintended file is created and the destination remains clear

### Requirement: Relevant contextual menus
Right-click and row overflow SHALL provide the same actions and labels for the same target. Menus SHALL open near the target while remaining within the viewport. Actions SHALL be grouped and ordered by purpose as specified below; creation and paste labels SHALL make the destination explicit, and the favorite label SHALL reflect its current state.

#### Scenario: Note menu order
- **WHEN** the user opens a note menu
- **THEN** it presents, in order, open / open to the right / quick preview; copy note link / add or remove favorite; rename / move / duplicate; cut / copy; reveal / open externally; and trash, with separators between groups

#### Scenario: Folder menu order
- **WHEN** the user opens a folder menu
- **THEN** it presents, in order, open / expand subtree; new note here / new subfolder; rename / move / duplicate; cut / copy / paste here; reveal; and trash, with separators between groups

#### Scenario: Unavailable actions
- **WHEN** paste has no applicable clipboard contents or a restriction prevents an action
- **THEN** the action is unavailable and its reason is understandable

### Requirement: Local hierarchical filter
The filter SHALL search names throughout the workspace independently of full-text search, ignoring case and accents. It SHALL show only matching entries and their ancestor folders as a reduced tree, highlight matching text, and display the result count or an empty state. A matching folder SHALL NOT cause nonmatching descendants to appear.

#### Scenario: Matching folder
- **WHEN** a folder matches but its child does not
- **THEN** the folder is shown and the nonmatching child is hidden unless it is an ancestor of another matching entry

#### Scenario: Clear filter
- **WHEN** the filter is cleared
- **THEN** the exact prior expansion and scroll state is restored

#### Scenario: Filter keyboard controls
- **WHEN** Escape is pressed with a nonempty filter
- **THEN** the filter clears; a subsequent Escape leaves the field
- **WHEN** Enter is pressed with exactly one matching note
- **THEN** that note opens

### Requirement: Persistent tree context
The explorer SHALL persist expanded folders and scroll position per workspace, including descendant expansion when a parent is collapsed. It SHALL restore them on reopening and tolerate entries removed externally.

#### Scenario: Reopen parent
- **WHEN** a folder containing an expanded descendant is collapsed and reopened
- **THEN** the descendant's previous expansion state is restored

### Requirement: Keyboard and accessible controls
Visible tree rows SHALL support Up and Down navigation, Right to expand, Left to collapse or focus the parent, F2 to rename and Space to preview a note. Unmodified Up and Down SHALL move focus and single selection together without opening the entry; active-note state remains independent. Controls SHALL have accessible names, focus indications, and keyboard equivalents. Editing fields and dialogs SHALL retain their own key behavior.

#### Scenario: Keyboard traversal
- **WHEN** the tree has focus and the user presses Down
- **THEN** focus and single selection move to the next visible row without opening it; the active note remains unchanged

### Requirement: Explain protection and location
The lock indicator SHALL explain what is protected and the consequence for access. The current note's complete path SHALL remain accessible in the editor, including for deeply nested notes.

#### Scenario: Explain a lock
- **WHEN** the user activates the lock indicator
- **THEN** an understandable explanation of page protection is displayed without revealing protected content
