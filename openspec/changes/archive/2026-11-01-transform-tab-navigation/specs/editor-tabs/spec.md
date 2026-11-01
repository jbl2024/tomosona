# Spec Delta

## Purpose

Present, label, state, close, reorder, pin and reopen the documents a pane holds, so that many open notes stay legible and never disappear unexpectedly.

## ADDED Requirements

### Requirement: Clean tab titles
Tab labels SHALL show the document name without its Markdown extension. The file on disk SHALL keep its extension and path. A tab whose document shares its name with another open document SHALL indicate the containing folder in its tooltip.

#### Scenario: Extension hidden
- **WHEN** a note named `Gestion du temps.md` is open
- **THEN** its tab reads `Gestion du temps` and the file on disk is unchanged

#### Scenario: Homonym disambiguation
- **WHEN** two open notes share the same file name
- **THEN** each tab's tooltip shows the containing folder

### Requirement: Tab width and truncation
Tabs SHALL keep a comfortable width range and truncate only at the end of the title. The full title SHALL be available on hover and on keyboard focus. A tab SHALL NOT scroll its title horizontally.

#### Scenario: Long title
- **WHEN** a title exceeds the tab width
- **THEN** it is truncated at the end and the full title appears on hover and on keyboard focus

#### Scenario: Many tabs
- **WHEN** the strip cannot show every tab at a comfortable width
- **THEN** tabs keep their width and the strip scrolls instead of shrinking them

### Requirement: Tab states
The strip SHALL distinguish active, unsaved, saving, protected, inaccessible, pinned and failed-save states. It SHALL NOT show every indicator at once: the strip carries only what is immediately needed and the tooltip carries the detail.

#### Scenario: Unsaved marker
- **WHEN** a document has unsaved changes
- **THEN** its tab shows an unsaved marker that disappears once the change is saved

#### Scenario: Failed save
- **WHEN** a save fails
- **THEN** the tab shows a persistent failure indicator distinguishable from the unsaved marker

#### Scenario: Combined states
- **WHEN** a document is pinned, protected and unsaved
- **THEN** the strip shows at most the pinned and unsaved indicators and the tooltip carries the protection detail

### Requirement: Protection indication on tabs
A protected document's tab SHALL indicate protection and SHALL distinguish a page that is locked from one unlocked for the current session. The indicator of a page unlocked for the session SHALL lock that page again when activated, without selecting the tab. The tooltip SHALL state which, and SHALL NOT describe the page as encrypted unless the protection mechanism actually encrypts it.

#### Scenario: Unlocked protected page
- **WHEN** a protected page is unlocked for the session
- **THEN** its tab indicates protection and the tooltip says it is unlocked for this session

#### Scenario: Locked protected page
- **WHEN** a protected page is locked
- **THEN** its tab indicates protection and the tooltip says a password is needed to open it

#### Scenario: Stable indicator
- **WHEN** the user navigates between documents
- **THEN** the protection indicator does not change appearance for the same protection state

#### Scenario: Lock from the tab
- **WHEN** the user activates the protection indicator of a page unlocked for the session
- **THEN** the page is locked again and the indicator switches to the locked state

### Requirement: Close affordance
Each tab SHALL reserve space for its close control so revealing it never moves the title. The close control SHALL be visible on the active tab and on hover or keyboard focus for inactive tabs, and SHALL remain reachable by keyboard and on touch.

#### Scenario: Hover an inactive tab
- **WHEN** the pointer enters an inactive tab
- **THEN** its close control appears without the title shifting

#### Scenario: Keyboard reach
- **WHEN** a tab has keyboard focus
- **THEN** its close control is reachable and operable

### Requirement: Closing without losing context
Closing a tab SHALL NOT disturb the displayed document unless the closed tab was active. Closing the active tab SHALL return to the most recently consulted tab in that pane. Closing the last tab SHALL return the pane to its home surface. Unsaved changes SHALL NOT be discarded silently.

#### Scenario: Close an inactive tab
- **WHEN** the user closes a tab that is not active
- **THEN** the displayed document does not change

#### Scenario: Close the active tab
- **WHEN** the user closes the active tab
- **THEN** the pane shows the most recently consulted tab, not the neighbouring one

#### Scenario: Close the last tab
- **WHEN** the user closes the last tab of a pane
- **THEN** the pane shows its home surface

#### Scenario: Unsaved changes
- **WHEN** the user closes a tab with unsaved changes
- **THEN** the changes are not discarded without an explicit choice

### Requirement: Reopening a closed tab
The most recently closed tab SHALL be reopenable from a command and a keyboard shortcut, restoring its document and its position in the pane.

#### Scenario: Reopen
- **WHEN** the user reopens the last closed tab
- **THEN** its document is open again in the pane it was closed from

#### Scenario: Nothing to reopen
- **WHEN** no tab has been closed in the session
- **THEN** the reopen command is unavailable

### Requirement: Overflow and active tab visibility
The strip SHALL scroll horizontally when its tabs do not fit, and SHALL show scroll controls only while overflow exists. The active tab SHALL always be scrolled into view, including when it is opened from the palette or the explorer.

#### Scenario: Scroll controls appear
- **WHEN** the tabs no longer fit
- **THEN** scroll controls appear, and they disappear once the tabs fit again

#### Scenario: Active tab stays visible
- **WHEN** a document is opened from the palette or the explorer
- **THEN** its tab is scrolled into view

### Requirement: Tab list
The strip SHALL offer a list of the pane's open tabs showing full titles in visual order, marking the active tab, disambiguating homonyms with their folder, and filtering from the keyboard. The list SHALL offer closing the other tabs and the tabs to the right.

#### Scenario: Full titles
- **WHEN** the tab list is open
- **THEN** every entry shows its complete title even when the strip truncates it

#### Scenario: Filter
- **WHEN** the user types in the tab list
- **THEN** the entries are filtered and the keyboard can activate one

#### Scenario: Bulk close
- **WHEN** the user chooses to close the other tabs
- **THEN** only the active tab and the pinned tabs remain open

### Requirement: Pinned tabs
A tab SHALL be pinnable and unpinnable from its context menu. A pinned tab SHALL stay at the front of its pane's strip, SHALL survive closing the other tabs and closing all unpinned tabs, and SHALL be restored when the workspace is reopened. A pinned tab's close control SHALL NOT close the tab. Pinning a tab SHALL NOT add the note to favourites.

#### Scenario: Pin moves to the front
- **WHEN** the user pins a tab
- **THEN** it moves to the front of its pane's strip and keeps its name

#### Scenario: Pin survives bulk close
- **WHEN** the user closes all unpinned tabs
- **THEN** pinned tabs remain open

#### Scenario: Pin is restored
- **WHEN** the workspace is reopened
- **THEN** pinned tabs are open and still pinned

#### Scenario: Pin is not a favourite
- **WHEN** the user pins a tab
- **THEN** the note's favourite state does not change

#### Scenario: Pinned tab close control
- **WHEN** the close control of a pinned tab is activated
- **THEN** the tab is not closed; unpinning is offered from the context menu

### Requirement: Tab context menu
The tab context menu SHALL offer pinning, moving the tab to the other pane, copying the note link, revealing the note in the explorer, and the close variants. It SHALL hide or disable the entries that do not apply to the current layout.

#### Scenario: Single pane
- **WHEN** only one pane exists
- **THEN** the entries that target another pane are unavailable

#### Scenario: Document already in the other pane
- **WHEN** the document is already open in the other pane
- **THEN** moving it there is unavailable

### Requirement: Tab gestures
Middle click on a tab SHALL close it. Double click on empty strip space SHALL offer note creation. Double click on a tab SHALL NOT trigger a special action. Dragging a tab SHALL reorder it within its pane.

#### Scenario: Middle click
- **WHEN** the user middle-clicks a tab
- **THEN** that tab closes

#### Scenario: Double click empty space
- **WHEN** the user double-clicks the empty part of the strip
- **THEN** note creation is offered

#### Scenario: Double click a tab
- **WHEN** the user double-clicks a tab
- **THEN** no special action occurs

#### Scenario: Reorder
- **WHEN** the user drags a tab within its strip
- **THEN** the tabs are reordered and the order persists

### Requirement: MRU keyboard cycling
`Ctrl+Tab` SHALL activate the next most recently consulted tab of the active pane, and `Ctrl+Shift+Tab` SHALL walk that MRU order backwards. The cycling order SHALL be the most-recently-consulted order, not the visual position order.

#### Scenario: Cycle to the recently consulted tab
- **WHEN** the user presses Ctrl+Tab
- **THEN** the previously consulted tab of the active pane becomes active, even when it is not visually adjacent

#### Scenario: Cycle backwards
- **WHEN** the user presses Ctrl+Shift+Tab after a forward cycle
- **THEN** the tab that was active before the forward cycle becomes active again
