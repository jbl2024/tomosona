# Command Palette Specification

## Purpose

Turns the palette into the app's universal entry point: one keyboard-first surface to find and open notes, search note content, run commands, create notes, and surface context-relevant actions, without requiring the user to know where a feature lives.

## Requirements

### Requirement: Initial browse state
When the palette opens with an empty query, it SHALL show the most recently viewed notes (newest first, title without extension, folder shown for disambiguation), favorites without duplicates, and a short list of quick actions. The search field SHALL receive focus, the first result SHALL be preselected, and the list SHALL stay deliberately short.

#### Scenario: Fresh open shows recent notes and quick actions
- **WHEN** the palette opens after notes have been viewed
- **THEN** the three most recent notes are listed newest first with their folder, followed by quick actions such as create note, open today's note, and open favorites, and the first entry is preselected

#### Scenario: No history yet
- **WHEN** the palette opens and no note has ever been consulted
- **THEN** only the startup actions are shown

### Requirement: Note search matches titles tolerantly
Note search SHALL be case-insensitive, accent-insensitive, recognize partial words, support multiple words in any order, and tolerate simple typos. Title matches SHALL rank above content matches.

#### Scenario: Partial and reordered words
- **WHEN** the user types `atom notes` or `notes atom`
- **THEN** a note titled `Créer des notes atomiques` is among the results

#### Scenario: Accent and case folding
- **WHEN** the user types `methode zettel`
- **THEN** the note `Méthode Zettelkasten` is found

#### Scenario: Same title in several notes
- **WHEN** several notes share the matched title
- **THEN** their folder keeps them distinguishable in the results

### Requirement: Note open targets
Opening a note result SHALL support three targets: current tab (`Enter` or click), new tab (`Cmd+Enter`), and adjacent pane (`Alt+Enter`). The palette SHALL close after opening, except for actions designed for successive operations.

#### Scenario: Open in current tab
- **WHEN** the user presses `Enter` on a note result
- **THEN** the note opens in the current tab and the palette closes

#### Scenario: Open in adjacent pane
- **WHEN** the user presses `Alt+Enter` on a note result
- **THEN** the note opens in an adjacent pane

### Requirement: Content search results
Content search SHALL use the workspace full-text index and present, per matching note: the note title, the folder and section when available, and a short snippet around the matched terms. Each match SHALL be an individually selectable result row (keyboard and pointer), with consecutive matches from one note rendered as one visual group that shows the title once; match counts per note and in total SHALL be capped so one file cannot flood the result list.

#### Scenario: Phrase found in note bodies
- **WHEN** the user searches `granularité fine`
- **THEN** matching notes are listed under the content category with a snippet containing the matched terms

#### Scenario: Multiple passages in one note
- **WHEN** a note contains several matching passages
- **THEN** the matches appear as consecutive rows sharing the note title, each selectable by keyboard and pointer, and opening one reveals the occurrence whose context matches that match's snippet

### Requirement: Content results navigate to the passage
Opening a content result SHALL open the note, scroll to the matching passage, temporarily highlight the matched text, and leave the document immediately editable.

#### Scenario: Jump to the passage
- **WHEN** the user opens a content result
- **THEN** the note opens scrolled to the matching passage with the text temporarily highlighted

### Requirement: Command search with aliases
Commands SHALL be findable from multiple common formulations (keywords), SHALL show a short description of their effect, and SHALL display their keyboard shortcut on the right when one exists.

#### Scenario: Alias reaches the command
- **WHEN** the user searches `docx` or `convertir`
- **THEN** the Word export command is offered

#### Scenario: Description before execution
- **WHEN** command results are displayed
- **THEN** each shows a one-line description of its effect, and commands with shortcuts show them on the right

### Requirement: Unavailable commands are visible but not executable
A command that requires a missing context (for example an open note) MAY remain visible when it explicitly matches the query, SHALL NOT be executable, and SHALL state why it is unavailable.

#### Scenario: Rename without an open note
- **WHEN** the user searches `renommer` with no note open
- **THEN** the rename command appears marked unavailable with the reason "open a note to rename it" and cannot be executed

### Requirement: Create a note from the palette
When the query matches no note, the palette SHALL offer to create a note titled with the query. The creation action SHALL also be available when matches exist, ranked below relevant results, and SHALL NEVER create automatically without explicit validation. After creation the note SHALL open with the typed text as its title and the cursor in the body.

#### Scenario: No match offers creation
- **WHEN** the query matches nothing and the user validates the create action
- **THEN** a new note is created with the query as title, in the default new-note folder, opens immediately, and the cursor is in the body

#### Scenario: Matches exist
- **WHEN** the query matches existing notes
- **THEN** matching notes come first and the create action remains available below them

### Requirement: Search modes and entry shortcuts
The palette SHALL support optional, reversible prefixes: `>` for commands only, `#` for note content only, and `?` for help. The shortcuts `Cmd+K` and `Cmd+P` SHALL both open the universal palette (the universal search already covers notes, so `Cmd+P` is an alias), and `Cmd+Shift+P` SHALL open the palette with the commands filter; `Ctrl` replaces `Cmd` on the relevant platforms.

#### Scenario: Prefix filtering is reversible
- **WHEN** the user types `> déplacer` then removes the `>`
- **THEN** the search returns to universal mode

#### Scenario: Entry shortcuts pre-filter
- **WHEN** the user presses `Cmd+Shift+P`
- **THEN** the palette opens in commands-only mode

### Requirement: Context-aware suggestions
The palette SHALL surface actions relevant to the current context without hiding the others: startup actions when no document is open, actions on the active note, actions on the editor text selection (including extract to a new note), actions on the file selected in the explorer even when another note is open, and daily-note suggestions in the journal.

#### Scenario: Text selection actions
- **WHEN** the user selects a paragraph in the editor and opens the palette
- **THEN** selection actions are surfaced first, including extract to a new note

#### Scenario: Extract keeps the original passage
- **WHEN** the user runs extract to a new note on a selection
- **THEN** a new note is created from the selected content, a link to it is inserted in the source document, and the original passage is preserved

#### Scenario: Explorer selection context
- **WHEN** a file is selected in the explorer and the palette opens
- **THEN** the suggested actions apply to that file, not to the open editor note

### Requirement: Mixed results are ranked by relevance
A universal query MAY return notes, content matches, and commands. Results SHALL be grouped by visible category and ranked by relevance: exact title match, title starts with, partial title match, content match, then command match. Recency, favorite status, open frequency, and current folder MAY be used as tie-breakers for comparable results.

#### Scenario: Universal query mixes categories
- **WHEN** the user searches `atomique`
- **THEN** notes, a content match, and a single create action (titled with the query) appear under their own category headers in relevance order

### Requirement: Result list is deduplicated and capped
A note SHALL NOT appear multiple times without reason; when it matches both by title and content, the title result is kept with access to its passages. The visible list SHALL be limited to a small number of results (around six to eight), with the rest reachable by scrolling or a full search view.

#### Scenario: Note matching by title and content appears once
- **WHEN** a note matches the query both by title and by content
- **THEN** it appears once as a title result and its matching passages remain reachable from it

#### Scenario: Long result lists stay scannable
- **WHEN** more results exist than the visible cap
- **THEN** the list shows the top ranked results and the remaining ones are reachable without cluttering the first screen

### Requirement: Keyboard-complete navigation
The palette SHALL be fully operable by keyboard: arrows to move, `Enter` to open or execute, `Cmd+Enter` and `Alt+Enter` for open targets, `Esc` to close, `Cmd+A` to select the query. Opening the palette SHALL preserve the editor caret and selection, and canceling without acting SHALL restore them exactly. Selection-based actions executed from the palette SHALL operate on the initial selection.

#### Scenario: Cancel restores the editor
- **WHEN** the user opens the palette from the editor with a selection, navigates, and presses `Esc`
- **THEN** the editor caret and selection are exactly as before opening

#### Scenario: Selection survives the palette round-trip
- **WHEN** a selection-based action runs from the palette
- **THEN** it applies to the selection captured when the palette opened

### Requirement: Secondary actions on results
A result MAY offer secondary actions behind a dedicated key (`Tab`): copy note link, add to favorites, open in new tab, open in adjacent pane, reveal file location. The primary action stays "open", and secondary actions SHALL NOT slow the primary path.

#### Scenario: Tab reveals secondary actions
- **WHEN** the user presses `Tab` on a selected note result
- **THEN** the secondary actions for that result are shown while `Enter` still opens the note

### Requirement: Edge states
The palette SHALL provide: an explicit no-result message offering creation and a filter switch; confirmation only for actions with real data-loss risk; progressive result arrival without moving the current selection unexpectedly; an empty query field on reopen (no stale search); and abbreviated secondary information on narrow screens with unchanged keyboard behavior.

#### Scenario: No result
- **WHEN** the query matches nothing
- **THEN** a clear no-result message is shown with a create action and an offer to search within commands

#### Scenario: Progressive results keep the selection
- **WHEN** results arrive progressively while the user navigates
- **THEN** the selected entry does not change unexpectedly

### Requirement: The palette complements editor interactions
The palette SHALL NOT replace the editor's direct interactions: `[[` inserts note links, `/` transforms blocks, the context menu acts on visible elements, and the explorer browses files. Actions shared across these surfaces SHALL produce the same result, and common operations SHALL NOT require the palette.

#### Scenario: Block transform stays in the editor
- **WHEN** the user transforms a paragraph into a list via `/`
- **THEN** the result is identical to running the same action from the palette, and both remain available
