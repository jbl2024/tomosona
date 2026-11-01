# Tasks

## 1. Layout state and persistence

- [ ] 1.1 Add `recentTabIds` to `PaneState` and maintain it on every activation in `useMultiPaneWorkspaceState.ts`; verify with a test that activating A, B, C then closing C returns to B.
- [ ] 1.2 Normalize hydration: drop `home` tabs, seed `recentTabIds` from `activeTabId`, default a missing `pinned` to `false`; verify with a test that a layout persisted by the current build still loads and that an invalid payload still falls back to one pane.
- [ ] 1.3 Add a session-only `closedTabs` stack (pane id, tab, index, capped at 20) with `reopenLastClosedTab`; verify with tests for reopen, for the empty stack, and for the cap.
- [ ] 1.4 Document the new `PaneState` fields and the reopen stack in `src/app/components/panes/ARCHITECTURE.md`; verify the invariants listed there match the code.

## 2. Tab strip presentation

- [ ] 2.1 Strip the Markdown extension from tab labels while leaving the path untouched; verify with a test that a `Gestion du temps.md` tab reads `Gestion du temps`.
- [ ] 2.2 Add folder disambiguation to the tab tooltip when two open tabs share a file name; verify with a test on two homonyms.
- [ ] 2.3 Set the tab width range and end-only truncation, with the full title on hover and on keyboard focus; verify with a test that a long title truncates and exposes its full text.
- [ ] 2.4 Reserve the close-control space so revealing it never shifts the title, visible on the active tab and on hover or focus for inactive tabs; verify with a test that the title box does not move between the two states.
- [ ] 2.5 Render the tab state set (active, unsaved, saving, protected, inaccessible, pinned, failed save) with at most the immediately needed indicators and the detail in the tooltip; verify with tests for the unsaved marker, the failed-save marker and a pinned+protected+unsaved tab.
- [ ] 2.6 Distinguish a locked protected page from one unlocked for the session in the tab indicator and tooltip; verify with tests for both states and for indicator stability across navigation.
- [ ] 2.7 Move the active-pane affordance from the active tab to the strip container; verify with a test that the affordance is on the pane and that the active tab keeps only its own accent.

## 3. Overflow and tab list

- [ ] 3.1 Add measured scroll controls that appear only while the strip overflows, driven by a `ResizeObserver` that writes only when the overflow flag changes; verify with a test that the controls appear on overflow and disappear when the tabs fit.
- [ ] 3.2 Keep the active tab scrolled into view after a programmatic open from the palette or the explorer; verify with a test that opening a far tab scrolls it into view and updates the controls.
- [ ] 3.3 Add `EditorPaneTabList.vue` with full titles in visual order, the active tab marked, homonym folders, keyboard filtering and bulk close actions; verify with tests for full titles, filtering, activation and closing the other tabs.
- [ ] 3.4 Wire the tab list trigger into the strip and document the component in `src/app/components/panes/ARCHITECTURE.md`; verify the documented trigger matches the rendered control.

## 4. Pinned tabs

- [ ] 4.1 Implement pin and unpin as a pinned-prefix reorder in `useMultiPaneWorkspaceState.ts`; verify with tests that pinning moves the tab to the front and unpinning moves it to the first unpinned slot.
- [ ] 4.2 Make pinned tabs survive closing the other tabs and closing all unpinned tabs; verify with tests for both bulk actions.
- [ ] 4.3 Restore pinned tabs on reopen and confirm pinning does not change the note's favourite state; verify with a hydration test and a test asserting the favourite port is not called.
- [ ] 4.4 Render the pinned indicator and keep the pinned name visible rather than reducing pinned tabs to an icon; verify with a test that a pinned tab shows its name.
- [ ] 4.5 Make the close control of a pinned tab non-operable (unpin only from the context menu); verify with a test that activating it does not close the pinned tab.

## 5. Close semantics and reopen

- [ ] 5.1 Make closing an inactive tab leave the displayed document alone; verify with a test.
- [ ] 5.2 Make closing the active tab return to the most recently consulted tab from `recentTabIds`; verify with a test that it is not the neighbouring tab.
- [ ] 5.3 Make closing the last tab return the pane to its home surface; verify with a test.
- [ ] 5.4 Keep unsaved changes from being discarded silently on close; verify with a test that the close is blocked or confirmed and the buffer survives.
- [ ] 5.5 Bind `Cmd+Shift+T` to reopen the last closed tab and expose the command in the palette; verify with a keyboard test and a palette test, and confirm no existing binding changed.
- [ ] 5.6 Bind `Ctrl+Tab` / `Ctrl+Shift+Tab` to MRU cycling through `recentTabIds` in the active pane; verify with tests that the order is MRU (not visual) in both directions and that no existing binding changed.

## 6. Tab context menu and gestures

- [ ] 6.1 Extend the tab context menu with pin, duplicate into the other pane, move to the other pane, copy note link, reveal in explorer and the close variants; verify with a test on the rendered entries.
- [ ] 6.2 Hide or disable the entries that do not apply to the current layout; verify with tests for a single pane and for a document already open in the other pane.
- [ ] 6.3 Add middle-click close, double-click on empty strip space to offer note creation, and no special action on double-clicking a tab; verify with a test per gesture.
- [ ] 6.4 Add drag reorder within a strip using `@vue-dnd-kit/core`, clamping a dragged tab to its own pinned or unpinned region; verify with tests for a reorder and for a drag that would cross the pinned boundary.

## 7. Breadcrumb and status bar

- [ ] 7.1 Turn `EditorPathBreadcrumb.vue` into focusable segments with the full path on hover; verify with a test on a nested path.
- [ ] 7.2 Route a folder segment activation through the explorer reveal port, extended to accept a folder path, without changing the active document; verify with a test that the reveal port receives the folder and the active document is unchanged.
- [ ] 7.3 Offer the document actions from the document segment and the segment actions on right-click; verify with a test per segment kind.
- [ ] 7.4 Condense intermediate segments into an expandable ellipsis in a narrow pane, keeping the first and last visible; verify with a test that the ellipsis appears and reveals the hidden segments.
- [ ] 7.5 Keep the breadcrumb non-editable and confirm renaming still goes through its dedicated action; verify with a test that activating a segment opens no rename field.
- [ ] 7.6 Stop passing the relative path to the status bar and keep the document name, save state, index state and signals; verify with a test that the path is absent and a failed save is still reported.

## 8. Panes

- [ ] 8.1 Render an empty pane's home surface directly instead of a `No open files` placeholder; verify with a test that an empty pane shows the home surface and no tab-shaped placeholder.
- [ ] 8.2 Replace the ambiguous `O` and `A` strip buttons with explicit icons and tooltips on the move-tab controls, moving the close actions into the tab list and context menu; verify with a test on the rendered controls and their accessible names.
- [ ] 8.3 Make interacting with a pane's strip or surface activate that pane and keep exactly one active-pane affordance; verify with a test that clicking the inactive pane's tab activates it.
- [ ] 8.4 Keep each pane's tab selection, reading position and tab menu independent; verify with a test that switching tabs in one pane leaves the other unchanged.
- [ ] 8.5 Add cross-pane tab dragging with a marked drop target, preserving the document, unsaved changes and pinned state; verify with tests for the move, for unsaved changes and for the source pane becoming empty.
- [ ] 8.6 Add closing a pane without closing its tabs one by one and make joining panes preserve the tabs of both without discarding unsaved changes; verify with tests for close, join and join with unsaved changes.
- [ ] 8.7 Expose an open-to-the-right command in the palette that duplicates the active document into the other pane; verify with a palette test that the document opens there as a second view and no file is created.
- [ ] 8.8 Make shell history back/forward restore the active pane's stored reading position for the target document; verify with a test that going back restores both the document and its reading position.

## 9. Duplicate views

- [ ] 9.1 Relax the uniqueness invariant from one path per workspace to one tab per pane and update the open redirect in `App.vue`; verify with a test that opening a document already in the other pane adds a tab there and that opening it twice in the same pane does not.
- [ ] 9.2 Add the shell-owned per-path document buffer so both views read and write the same in-memory content, with the focused view authoritative and the unfocused view applying the buffer on focus; verify with a test that an edit in one pane appears in the other and that each view keeps its own scroll position.
- [ ] 9.3 Confirm duplicating a view creates no file and that undo stays per view; verify with a test on the workspace file list and a test that an undo in one view does not alter the other.
- [ ] 9.4 Update the invariants in `src/app/components/panes/ARCHITECTURE.md` to describe per-pane uniqueness and the shared buffer; verify the documented invariants match the code.

## 10. Integration verification

- [ ] 10.1 Run `npx vitest run` and `npx vue-tsc --noEmit`; resolve regressions and record the counts.
- [ ] 10.2 Run `npm run build` and `cargo check` in `src-tauri`; record the outcome.
- [ ] 10.3 Exercise the tab strip, tab list, pinning, reopen, cross-pane drag and duplicate views in the running app; record any platform limitation.

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived result and that the synced specs validate.
