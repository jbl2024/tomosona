# Proposal

## Why

The tab strip is the surface the user touches most, and today it carries noise
instead of information: every tab repeats its `.md` extension, long titles
collapse into indistinguishable stubs, a close button sits on every tab whether
or not it is wanted, and two unlabelled buttons (`O`, `A`) sit next to two arrows
that do something other than what arrows suggest. The path line above the editor
is a passive string, so the only way to reach a note's folder is to hunt for it
in the explorer.

The deeper problem is conceptual. Three things are conflated: a tab is a document,
a pane is a workspace holding tabs, and navigation is the history of what was
consulted in that pane. Because they are not separated, opening many documents
makes the workspace harder to use rather than more capable, and the two-pane
layout that already exists cannot be used the way people actually work — reading
one note while editing another, or comparing two distant sections of the same
note.

## What Changes

### Tab strip

- Tab titles drop the `.md` extension; the file on disk is unchanged.
- Tabs get a comfortable width range with end-only truncation, the full title on
  hover and keyboard focus, and the containing folder when two open notes share a
  name. No horizontal scrolling inside a tab.
- The close button is reserved space that is always laid out, visible on the
  active tab and on hover or keyboard focus for inactive tabs, so revealing it
  never shifts the title.
- Tab states are explicit and never all shown at once: active, unsaved (`●`),
  saving, protected, inaccessible, pinned, failed save. Detail moves to the
  tooltip.
- The protection indicator distinguishes a locked page from one unlocked for the
  session, and the tooltip says which.
- The strip scrolls horizontally with scroll buttons that appear only on overflow,
  and the active tab is always scrolled into view.
- A tab list opens from the strip: full titles, folder disambiguation for
  homonyms, keyboard filtering, visual order, active tab marked, plus bulk close
  actions.
- Tabs can be pinned. A pinned tab stays at the front of its pane, survives
  "close others" and "close all unpinned", is restored on reopen, and is
  unpinned from its context menu. Its close control is not operable, so a
  pinned tab is never closed by accident. Pinning a tab is not adding a
  favourite.
- Closing a tab never loses context: closing an inactive tab leaves the current
  document alone, closing the active tab returns to the most recently consulted
  tab in that pane, closing the last tab returns the pane to its home surface,
  and unsaved changes are never discarded silently.
- The last closed tab can be reopened from a command and a shortcut.
- `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle the active pane through its most recently
  consulted tabs (MRU order), independent of the visual tab order.
- The tab context menu gains pin, duplicate into the other pane, move to the
  other pane, copy note link, reveal in explorer, and close variants, and hides
  the entries that do not apply to the current layout.
- Middle click closes a tab; double click on empty strip space offers note
  creation; double click on a tab does nothing special; tabs can be reordered by
  dragging.

### Panes

- The active pane is identifiable at a glance without a heavy contrast jump
  between panes.
- Each pane keeps its own tab selection, navigation history, reading position per
  document, and tab menu.
- A tab can be dragged from one pane's strip to another's, with the drop target
  clearly marked.
- The same note can be open in both panes as two views of one document: edits are
  shared, reading positions are independent.
- An "open to the right" command in the palette opens the active document in the
  other pane as a second view.
- Shell history back/forward restores the pane's stored reading position for the
  returned document, not just the document itself.
- A pane can be closed without closing its tabs one by one, and joining panes
  preserves the open tabs as far as possible.
- An empty pane shows its home surface directly instead of a fake `No open files`
  tab.

### Breadcrumb

- The passive path line becomes an interactive breadcrumb: clicking a folder
  segment reveals that folder in the explorer, clicking the document segment
  offers document actions, right-clicking a segment opens its contextual actions,
  and hovering shows the full path.
- Intermediate segments condense into an expandable ellipsis when the pane is
  narrow.
- The breadcrumb is not editable in place; renaming keeps its dedicated action so
  links stay safe.
- The status bar stops repeating the full path and keeps only operational
  information.

### Navigation controls

- The pane's `←` `→` buttons keep their current meaning — moving the active tab to
  the adjacent pane — but gain explicit icons and tooltips. Pane history stays in
  the top bar, where it already lives.
- The ambiguous `O` and `A` buttons leave the strip; their actions move into the
  tab list and the tab context menu.

### Not breaking

No file format, path, or protection behaviour changes. `Cmd+W` keeps closing the
active tab, `Cmd+1..4` keeps focusing panes, and the existing top-bar history
shortcuts keep their bindings; back/forward now also restore the pane's reading
position for the returned document.

## Capabilities

### New Capabilities

- `editor-tabs`: how a pane presents, labels, states, closes, reorders, pins and
  reopens the documents it holds, including overflow and the tab list.
- `pane-workspace`: how panes divide the workspace, which one is active, what
  state each owns, and how documents move or duplicate between them.
- `document-breadcrumb`: how the active document's location is presented and used
  as navigation, and what the status bar is left with.

### Modified Capabilities

None. The protection indication in the explorer is unchanged; the tab-level
locked/unlocked distinction is new behaviour owned by `editor-tabs`.

## Impact

- `src/app/components/panes/EditorPaneTabs.vue` — rewritten around the new
  presentation, states, overflow, tab list and context menu.
- `src/app/components/panes/EditorPaneGrid.vue`, `PaneSurfaceHost.vue` — active
  pane affordance, empty-pane home surface, drag targets between strips.
- `src/app/composables/useMultiPaneWorkspaceState.ts` — pinned ordering, reopen
  stack, move and duplicate between panes, join preserving tabs. `PaneTab` already
  carries `pinned` and persists it, but nothing sets it today.
- `src/app/composables/useAppShellKeyboard.ts` — reopen shortcut and
  `Ctrl+Tab`/`Ctrl+Shift+Tab` MRU cycling; no existing binding changes.
- `src/domains/editor/components/editor/EditorPathBreadcrumb.vue` — becomes
  interactive and moves out of the passive path role.
- `src/app/components/app/WorkspaceStatusBar.vue` — drops the duplicated path.
- `src/app/components/app/TopbarNavigationControls.vue` — unchanged behaviour,
  reviewed for overlap with the new pane affordances.
- New shared UI: tab list popover, breadcrumb segments, drag-and-drop between
  strips.
- Tests: `EditorPaneTabs.test.ts`, `useMultiPaneWorkspaceState.test.ts`,
  `EditorPathBreadcrumb.test.ts`, `WorkspaceStatusBar.test.ts`, plus new coverage
  for pinning, reopen, overflow and cross-pane moves.
