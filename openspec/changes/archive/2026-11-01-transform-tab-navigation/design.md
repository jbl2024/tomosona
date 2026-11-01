# Design

## Context

See `proposal.md` for motivation and `specs/` for the requirements.

Current state that shapes the approach:

- `useMultiPaneWorkspaceState.ts` owns `MultiPaneLayout` (`root` split tree,
  `panesById`, `activePaneId`) and is the single mutation point. `PaneTab` is a
  tagged union (`document` | `file-inspector` | `home`) that already carries
  `pinned`, and hydration already reads it back — but nothing ever sets it.
- `EditorPaneTabs.vue` is presentational: it emits intents and owns only the
  context-menu position. It renders `fileName(path)` verbatim, so `.md` shows.
- `src/app/components/panes/ARCHITECTURE.md` states two invariants this change
  keeps: *a document path can exist in at most one pane at a time* and *no
  duplicate document instance*. `App.vue` enforces the first by redirecting an
  open request to the pane that already holds the path, which is why a tab moves
  between panes instead of being reopened there.
- Pane history already exists at shell level (`TopbarNavigationControls.vue`,
  `useAppShellHistoryUi.ts`) with `Cmd+[` / `Cmd+]` on macOS and `Alt+←/→`
  elsewhere. The pane strip's `←` `→` are `request-move-tab`, not history.
- `useDocumentHistory` records note entries as path-only (`record(path)` carries
  no scroll anchor), so today's back/forward restores the document but not the
  reading position.
- `Cmd+1..4` focuses panes (`useAppShellKeyboard.ts`), `Cmd+W` closes the active
  tab, `Cmd+Tab` cycles to the next tab. `Cmd+Shift+T` is free.
- `EditorPathBreadcrumb.vue` renders `toWorkspaceRelativePath(...)` as inert
  text. `App.vue:2076` passes the same relative path to the status bar as
  `activeFileLabel`, which is the duplication to remove.
- `@vue-dnd-kit/core` is already a dependency and already used by the explorer
  for row dragging.

## Goals / Non-Goals

**Goals:**

- Keep `useMultiPaneWorkspaceState` the only owner of tab and pane state; the
  strip, the tab list and the breadcrumb stay presentational and emit intents.
- Make every new behaviour survive a reload: pinned order, tab order, per-pane
  MRU, active pane.
- Deliver the tab strip as one coherent rewrite rather than a layer of patches
  over the current markup.

**Non-Goals:**

- No change to file format, paths, protection or the explorer's own behaviour.
- No new runtime dependency.
- No reassignment of existing shortcuts; `Cmd+1..4` keeps focusing panes and the
  pane strip keeps its move-tab buttons.
- No exact pixel metrics (strip height, breadcrumb height, tab width) in the
  specs; those stay implementation details decided during implementation.
- No hold-Ctrl recent-documents overlay in this change; the tab list popover
  covers the same need.
- No CRDT or collaborative editing.

## Decisions

### Tab state stays in the layout, not in the strip

`PaneState` gains `recentTabIds: string[]` (most recent first, capped at the tab
count) so "close the active tab returns to the most recently consulted tab" is a
pure state read. `openTabs` keeps a single ordered array where pinned tabs form a
prefix; pinning moves a tab to the front of that prefix and unpinning moves it to
the first unpinned slot.

*Alternatives considered:* a separate `pinnedTabs` array — rejected, it
duplicates ordering and doubles the persistence surface. Deriving MRU from
timestamps — rejected, it needs a clock and is not reproducible in tests.

### Reopen stack is session-only

A shell-level `closedTabs` stack (pane id, tab, index, capped at 20) backs
`Cmd+Shift+T`. It is deliberately **not** persisted: restoring a reopen stack
across restarts would let a user resurrect a tab from a previous session with no
way to tell where it came from.

*Alternative considered:* persisting it alongside the layout — rejected for the
reason above.

### Overflow uses measured scroll controls, not CSS masks

The strip keeps `overflow-x: auto` with a hidden scrollbar and gains explicit
scroll buttons whose visibility is driven by `scrollLeft` / `scrollWidth` /
`clientWidth` read through a `ResizeObserver`. `revealActiveTab` already exists
and keeps the active tab in view; it gains the same measurement so the buttons
update after a programmatic scroll.

*Alternative considered:* CSS-only fade masks — rejected, the requirement asks
for scroll controls, and a mask cannot be operated by keyboard.

### The tab list is its own component

`EditorPaneTabList.vue` (popover with `UiInput` filter and listbox semantics)
rather than an overloaded `UiMenu`: the list needs a text field, filtering and
full titles, none of which `UiMenu`/`UiMenuList` model.

### Drag reorder and cross-pane drag reuse `@vue-dnd-kit/core`

Same provider the explorer already uses, so pointer handling, the non-primary
button guard and the drop-target affordance stay consistent across the app.

*Alternative considered:* native HTML5 drag events — rejected, they cannot
express the drop-target marking the requirement asks for and would introduce a
second drag idiom.

### The active-pane affordance moves to the pane, not the tab

Today `active-pane` adds an inset shadow to the active *tab*. The affordance
moves to the strip container (a thin top accent plus a slightly stronger
background) so it reads as "this pane is active" rather than "this tab is
special", and the active *tab* keeps only its own accent.

### The `home` tab type stops being rendered as a tab

`PaneTab` keeps the `home` variant for the launchpad surface, but the strip no
longer renders it: an empty `openTabs` renders the home surface directly. This
is the "no fake tab" requirement.

### Breadcrumb reuses the existing reveal port

`EditorPathBreadcrumb.vue` becomes interactive and emits `reveal-folder`,
`document-actions` and `segment-context-menu`. The shell routes `reveal-folder`
through the existing `showExplorerForActiveFile` port, extended to accept a
folder path, so the explorer's reveal logic is not duplicated.

### Status bar drops the path

`App.vue` stops passing `toRelativePath(activeFilePath)` as `activeFileLabel`;
the status bar keeps the document name, the save state, the index state and the
editor signals. `signalSummary.path` stays as the internal guard it already is.

### MRU keyboard cycling reuses `recentTabIds`

`Ctrl+Tab` / `Ctrl+Shift+Tab` walk `recentTabIds` of the active pane in both
directions. This is a pure read of state the close semantics already maintain,
and it stays distinct from visual position order: `Cmd+1..4` remains pane focus
and no per-position tab shortcut is added. The hold-Ctrl recent-documents
overlay is deliberately deferred (see Non-Goals).

### Pinned tabs have no operable close control

A pinned tab's close control is not operable; the tab can only be unpinned from
its context menu. This is the "never closed by accident" requirement, and it
keeps exactly one way to unpin.

### History restore resolves through the pane's reading position

Back/forward in the shell history reopens the document and lets the pane restore
its own stored reading position for that document, instead of extending
`DocumentHistoryEntry` with a scroll anchor.

*Alternative considered:* storing scroll/selection in the history payload —
rejected, it duplicates state the pane already owns per document and would go
stale as soon as the reader scrolls after the entry was recorded.

## Risks / Trade-offs

- **Persisted layouts contain `home` tabs and no `recentTabIds`** → hydration
  normalizes: drop `home` tabs, seed `recentTabIds` from the current
  `activeTabId`, and treat a missing `pinned` as `false`. Invalid payloads keep
  falling back to one pane.
- **Pinned prefix ordering can be violated by a drag** → the reorder mutation
  clamps a dragged tab to its own region (pinned or unpinned) instead of trusting
  the drop index.
- **Scroll-button measurement can loop** → the observer only writes when the
  computed overflow flag changes, not on every resize tick.
- **The strip rewrite is large** → the presentational contract (props in, intents
  out) is preserved, so `EditorPaneTabs.test.ts` keeps asserting behaviour rather
  than markup, and the new behaviours land as separate tests.

## Migration Plan

1. Extend `PaneState` and hydration first (`recentTabIds`, pinned normalization,
   `home` tab removal) with tests, so persisted sessions from the current build
   keep loading.
2. Land the strip rewrite behind the same emitted intents, then the tab list,
   then pinning, then reopen.
3. Rollback is per step: each step is independently revertable because the
   persisted shape only ever gains optional fields.

## Open Questions

None. The decisions that would have changed the specs were settled before
writing: the pane `←` `→` buttons keep moving the active tab, `Cmd+1..4` keeps
focusing panes, pinned tabs have no operable close control, MRU cycling uses
`Ctrl+Tab`/`Ctrl+Shift+Tab` over `recentTabIds`, and history restore goes
through the pane's per-document reading position.
