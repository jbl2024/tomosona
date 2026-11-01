# Tasks

## 1. Layout state and persistence

- [x] 1.1 Add `recentTabIds` to `PaneState` and maintain it on every activation in `useMultiPaneWorkspaceState.ts`; verify with a test that activating A, B, C then closing C returns to B.
- [x] 1.2 Normalize hydration: drop `home` tabs, seed `recentTabIds` from `activeTabId`, default a missing `pinned` to `false`; verify with a test that a layout persisted by the current build still loads and that an invalid payload still falls back to one pane.
- [x] 1.3 Add a session-only `closedTabs` stack (pane id, tab, index, capped at 20) with `reopenLastClosedTab`; verify with tests for reopen, for the empty stack, and for the cap.
- [x] 1.4 Document the new `PaneState` fields and the reopen stack in `src/app/components/panes/ARCHITECTURE.md`; verify the invariants listed there match the code.

## 2. Tab strip presentation

- [x] 2.1 Strip the Markdown extension from tab labels while leaving the path untouched; verify with a test that a `Gestion du temps.md` tab reads `Gestion du temps`.
- [x] 2.2 Add folder disambiguation to the tab tooltip when two open tabs share a file name; verify with a test on two homonyms.
- [x] 2.3 Set the tab width range and end-only truncation, with the full title on hover and on keyboard focus; verify with a test that a long title truncates and exposes its full text.
- [x] 2.4 Reserve the close-control space so revealing it never shifts the title, visible on the active tab and on hover or focus for inactive tabs; verify with a test that the title box does not move between the two states.
- [x] 2.5 Render the tab state set (active, unsaved, saving, protected, inaccessible, pinned, failed save) with at most the immediately needed indicators and the detail in the tooltip; verify with tests for the unsaved marker, the failed-save marker and a pinned+protected+unsaved tab.
- [x] 2.6 Distinguish a locked protected page from one unlocked for the session in the tab indicator and tooltip; verify with tests for both states and for indicator stability across navigation.
- [x] 2.7 Move the active-pane affordance from the active tab to the strip container; verify with a test that the affordance is on the pane and that the active tab keeps only its own accent.

## 3. Overflow and tab list

- [x] 3.1 Add measured scroll controls that appear only while the strip overflows, driven by a `ResizeObserver` that writes only when the overflow flag changes; verify with a test that the controls appear on overflow and disappear when the tabs fit.
- [x] 3.2 Keep the active tab scrolled into view after a programmatic open from the palette or the explorer; verify with a test that opening a far tab scrolls it into view and updates the controls.
- [x] 3.3 Add `EditorPaneTabList.vue` with full titles in visual order, the active tab marked, homonym folders, keyboard filtering and bulk close actions; verify with tests for full titles, filtering, activation and closing the other tabs.
- [x] 3.4 Wire the tab list trigger into the strip and document the component in `src/app/components/panes/ARCHITECTURE.md`; verify the documented trigger matches the rendered control.

## 4. Pinned tabs

- [x] 4.1 Implement pin and unpin as a pinned-prefix reorder in `useMultiPaneWorkspaceState.ts`; verify with tests that pinning moves the tab to the front and unpinning moves it to the first unpinned slot.
- [x] 4.2 Make pinned tabs survive closing the other tabs and closing all unpinned tabs; verify with tests for both bulk actions.
- [x] 4.3 Restore pinned tabs on reopen and confirm pinning does not change the note's favourite state; verify with a hydration test and a test asserting the favourite port is not called.
- [x] 4.4 Render the pinned indicator and keep the pinned name visible rather than reducing pinned tabs to an icon; verify with a test that a pinned tab shows its name.
- [x] 4.5 Make the close control of a pinned tab non-operable (unpin only from the context menu); verify with a test that activating it does not close the pinned tab.

## 5. Close semantics and reopen

- [x] 5.1 Make closing an inactive tab leave the displayed document alone; verify with a test.
- [x] 5.2 Make closing the active tab return to the most recently consulted tab from `recentTabIds`; verify with a test that it is not the neighbouring tab.
- [x] 5.3 Make closing the last tab return the pane to its home surface; verify with a test.
- [x] 5.4 Keep unsaved changes from being discarded silently on close; verify with a test that the close is blocked or confirmed and the buffer survives.
- [x] 5.5 Bind `Cmd+Shift+T` to reopen the last closed tab and expose the command in the palette; verify with a keyboard test and a palette test, and confirm no existing binding changed.
- [x] 5.6 Bind `Ctrl+Tab` / `Ctrl+Shift+Tab` to MRU cycling through `recentTabIds` in the active pane; verify with tests that the order is MRU (not visual) in both directions and that no existing binding changed.

## 6. Tab context menu and gestures

- [x] 6.1 Extend the tab context menu with pin, move to the other pane, copy note link, reveal in explorer and the close variants; verify with a test on the rendered entries.
- [x] 6.2 Hide or disable the entries that do not apply to the current layout; verify with tests for a single pane and for a document already open in the other pane.
- [x] 6.3 Add middle-click close, double-click on empty strip space to offer note creation, and no special action on double-clicking a tab; verify with a test per gesture.
- [x] 6.4 Add drag reorder within a strip using `@vue-dnd-kit/core`, clamping a dragged tab to its own pinned or unpinned region; verify with tests for a reorder and for a drag that would cross the pinned boundary.

## 7. Breadcrumb and status bar

- [x] 7.1 Turn `EditorPathBreadcrumb.vue` into focusable segments with the full path on hover; verify with a test on a nested path.
- [x] 7.2 Route a folder segment activation through the explorer reveal port, extended to accept a folder path, without changing the active document; verify with a test that the reveal port receives the folder and the active document is unchanged.
- [x] 7.3 Offer the document actions from the document segment and the segment actions on right-click; verify with a test per segment kind.
- [x] 7.4 Condense intermediate segments into an expandable ellipsis in a narrow pane, keeping the first and last visible; verify with a test that the ellipsis appears and reveals the hidden segments.
- [x] 7.5 Keep the breadcrumb non-editable and confirm renaming still goes through its dedicated action; verify with a test that activating a segment opens no rename field.
- [x] 7.6 Stop passing the relative path to the status bar and keep the document name, save state, index state and signals; verify with a test that the path is absent and a failed save is still reported.

## 8. Panes

- [x] 8.1 Render an empty pane's home surface directly instead of a `No open files` placeholder; verify with a test that an empty pane shows the home surface and no tab-shaped placeholder.
- [x] 8.2 Replace the ambiguous `O` and `A` strip buttons with explicit icons and tooltips on the move-tab controls, moving the close actions into the tab list and context menu; verify with a test on the rendered controls and their accessible names.
- [x] 8.3 Make interacting with a pane's strip or surface activate that pane and keep exactly one active-pane affordance; verify with a test that clicking the inactive pane's tab activates it.
- [x] 8.4 Keep each pane's tab selection, reading position and tab menu independent; verify with a test that switching tabs in one pane leaves the other unchanged.
- [x] 8.5 Add cross-pane tab dragging with a marked drop target, preserving the document, unsaved changes and pinned state; verify with tests for the move, for unsaved changes and for the source pane becoming empty.
- [x] 8.6 Add closing a pane without closing its tabs one by one and make joining panes preserve the tabs of both without discarding unsaved changes; verify with tests for close, join and join with unsaved changes.
- [x] 8.7 Make shell history back/forward restore the active pane's stored reading position for the target document; verify with a test that going back restores both the document and its reading position.

## 9. Integration verification

- [x] 9.1 Run `npx vitest run` and `npx vue-tsc --noEmit`; resolve regressions and record the counts. — 246 files, 1523 tests + 1 todo, all green; `vue-tsc --noEmit` clean.
- [x] 9.2 Run `npm run build` and `cargo check` in `src-tauri`; record the outcome. — `npm run build` succeeded (1.96s, only the pre-existing chunk-size warning); `cargo check` finished with no warnings.
- [x] 9.3 Exercise the tab strip, tab list, pinning, reopen and cross-pane drag in the running app; record any platform limitation. — Verified manually on macOS: strip, tab list, pinning, reopen and cross-pane drag all behave as specified; no platform limitation found.

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived result and that the synced specs validate.
