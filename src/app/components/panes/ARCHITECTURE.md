# Multi-Pane Editor Architecture

## Scope
This module provides a VS Code-style multi-pane shell for mixed editor surfaces:
- document notes.

## Data Model
- `MultiPaneLayout` stores `root` split tree, `panesById`, and `activePaneId`.
- `PaneTab` is a tagged union with `type`:
  - `document` with `path`.
- `PaneState` stores `openTabs`, `activeTabId`, `activePath`, and `recentTabIds`.
  - `recentTabIds` is the most-recently-consulted order, newest first. Closing
    the active tab returns to its head, and `Ctrl+Tab` walks it. It is state, not
    a derived value, because both behaviours need a stable order that survives a
    reload.
- `ClosedTabEntry` (`paneId`, `tab`, `index`) is the reopen stack entry.
- `SplitNode` is either:
  - `{ kind: 'pane', paneId }`
  - `{ kind: 'split', axis, a, b, ratio: 0.5 }`

## Key Invariants
- Maximum 4 panes.
- Exactly one active pane at any time.
- A document path can exist in at most one pane at a time.
- `recentTabIds` only ever holds ids of tabs currently open in that pane.
- Splitting a pane creates an empty pane, then focuses the new pane.
- Split ratio is fixed to `0.5` in MVP for predictable rendering and simpler maintenance.

## Reopen Stack
- `closedTabs` is a session-only stack, oldest first, capped at 20 entries.
- Every tab-level close pushes onto it: single close, close others, close
  left/right, close all.
- It is deliberately not persisted: restoring it across restarts would let a user
  resurrect a tab from a previous session with no way to tell where it came from.
- `reopenLastClosedTab` restores the tab in the pane it came from, falling back to
  the active pane when that pane no longer exists.

## UI Composition
- `EditorPaneGrid.vue` renders panes from the layout and mounts one `PaneSurfaceHost` per pane.
- `PaneSurfaceHost.vue` chooses the active surface renderer based on tab `type`.
- `EditorPaneTabs.vue` renders pane-local typed tabs and pane-local tab actions.
- `MultiPaneToolbarMenu.vue` exposes split/focus/move/reset actions in the top toolbar.

### Tab strip presentation
- A tab label is the document name without its Markdown extension. The path is
  never rewritten; it stays intact in the tooltip and in every port.
- Tabs are `130px` to `240px` wide and truncate at the end only. The full label
  is exposed through `title` and `aria-label`, so hover and keyboard focus both
  reach it.
- The close control is always in the DOM and always occupies its slot; only its
  opacity and pointer-events change. Revealing it never shifts the title.
- At most one transient marker is shown per tab, in priority order: failed save
  (`!`), saving (`~`), unsaved (`●`). Protection and pinning are stable,
  path-derived flags rendered separately.
- A protected note shows a closed lock while it is locked and an open lock once
  it was unlocked for the session. The tooltip spells out which of the two it
  is, so the pictogram never implies the note is currently inaccessible.
- A note that cannot be read at all shows `⚠` instead of the lock. The pane
  surface produces that flag, because the editor never emits a status for a
  path it failed to load.
- The active-pane affordance lives on the strip container (`is-active-pane`),
  not on the active tab. The active tab keeps only its own background and
  bottom accent, so the two signals never compete.
- `tabLabels.ts` owns the naming rules. The strip and the tab list both read
  from it, so a label can never differ between the two surfaces.

### Overflow and the tab list
- The strip scrolls horizontally and keeps a comfortable tab width rather than
  shrinking tabs indefinitely.
- The `‹` and `›` controls are rendered only while the strip overflows. A
  `ResizeObserver` on the scroll box drives the measurement, and the handler
  writes a flag only when it actually changes, so an observer firing every
  frame cannot cause a render loop.
- The active tab is scrolled into view after every programmatic open, and the
  overflow flags are refreshed right after.
- The `▾` control in the strip actions opens `EditorPaneTabList.vue`: full
  titles in visual order, the active tab marked, the folder shown for homonym
  tabs, keyboard filtering, and the bulk close actions. The list emits intents
  only; the shell owns every mutation.

### Pinned tabs
- Pinned tabs form a prefix of the strip. `setTabPinnedInPane` moves a tab to
  the front when pinning and to the first unpinned slot when unpinning.
- Pinned tabs survive "close others" and "close all unpinned tabs".
- A pinned tab's close control is disabled and a middle click is ignored; the
  only way to drop it is to unpin it from its context menu.
- Pinning is layout state only. It never touches the note, its path, or its
  favourite status, and `pinned` round-trips through persistence.

### Strip controls
- The strip actions carry explicit icons and accessible names: the tab list
  trigger, then moving the active tab to the previous and next pane. Pane
  history stays in the top bar and is never duplicated here.
- The bulk close actions live in the tab list and the tab context menu, not in
  the strip: four permanent buttons made the strip unreadable.

### Cross-pane drag
- `EditorPaneGrid` owns the `DnDProvider` for the whole grid, because the tab
  strip registers draggables and droppables at setup time. The explorer keeps
  its own separate provider; neither can be reused for the other.
- A tab is draggable only. The strip is the single drop target, so one handler
  resolves both cases from the hovered tab: a dragged id owned by the pane is a
  reorder relative to that tab's index and left/right placement, any other id is
  a move. Two overlapping droppables (strip plus tab) raced for the same drop and
  the strip won, which silently dropped every same-pane reorder.
- A same-pane drop that lands on no tab is a no-op, so a tab dragged back onto
  itself never jumps to the end of the strip. A foreign tab dropped on empty
  strip space still moves, and the strip marks itself with `is-drop-target`
  while that happens.
- The move goes through `moveTabToPane`, never `openDocumentInPane`: the latter
  redirects to the pane already holding the path, which closed the source tab
  without opening anything in the target. The tab object itself relocates, so
  its id, document and pinned state survive, and the source pane falls back to
  its home surface when it loses its last tab.

### Reading positions
- `usePaneReadingPositions` stores one scroll offset per pane and document, so
  the same note open in two panes keeps two independent positions.
- Shell history back/forward captures the outgoing position and restores the
  target's, so going back lands on the paragraph the reader left, not the top.

## Command Flow
1. UI emits user intent (`split`, `focus`, `move tab`, `close pane`, `reset`).
2. `useMultiPaneWorkspaceState` mutates layout state while enforcing invariants.
3. App routes open actions to the active pane and applies uniqueness redirect (focus existing tab instead of duplicating).
4. Surface-specific handlers run inside pane surfaces.
5. Session snapshot is persisted in `sessionStorage` and restored on reload.

## Persistence
- Storage key: `tomosona:editor:multi-pane`.
- Persist only serializable layout state (no editor instances).
- Hydration validates shape and constraints; invalid payload falls back to one pane.
- Hydration normalizes older payloads: a persisted `home` tab is dropped (an empty
  pane renders its home surface directly), a missing `pinned` becomes `false`, and
  `recentTabIds` is seeded from `activeTabId` when absent.

## KISS Rationale
- `Join panes` merges all unique document tabs into one pane and keeps the active tab when possible.
- Closing or joining panes saves the dirty documents of the affected panes first
  and aborts when a save does not clear the dirty flag, so unsaved changes are
  never discarded silently.
