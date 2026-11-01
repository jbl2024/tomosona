# Tasks

## 1. Presentation and contextual creation

- [ ] 1.1 Simplify toolbar and add overflow options, shared context menus and disabled reasons; test mouse, keyboard, placement near the target, viewport positioning, group order, destination labels, favorite state and menu parity.
- [x] 1.2 Add chevrons, distinct active/focused/selected states, extension preference, truncation and lock explanation; test narrow widths, protection and preference persistence.
- [x] 1.3 Add accessible folder plus and inline creation in the intended destination; test closed folders, cancellation, invalid names and existing creation/title-heading behavior.
- [x] 1.4 Add folders-first alphabetical default and persistent sort choices; test stable order during edits, existing workspaces and malformed preferences.

## 2. Safe mutations and recovery

- [x] 2.1 Extend typed workspace mutation contracts and native preflight for normalized paths, containment, symlinks, permissions, stale sources and collisions; test invalid and cross-workspace cases in Rust.
- [x] 2.2 Implement safe reference impact detection and updates using existing resolution semantics, including folder moves, aliases, fragments, relative links, ambiguity and locked pages; test warnings, cancellation and preservation.
- [x] 2.3 Coordinate dirty editor buffers and path mappings with tabs, history, favorites, indexing, protection and title-heading behavior; test open and unsaved notes and failure paths.
- [x] 2.4 Add bounded operation receipts and validated restoration of moved, renamed and trashed entries and changed references; test external edits, occupied paths, partial failures and rollback failures without overwrites.
- [x] 2.5 Route existing rename, cut/paste, deletion and DnD through the safe boundary; test per-entry outcomes, explicit collision choices, trash recovery and undo affordance.
- [x] 2.6 Complete inline rename with preserved extension, stable row, Enter/Escape and clear collisions; test file and folder renames, invalid names and undo.
- [x] 2.7 Update explorer architecture and exported API documentation for mutation ownership, reference limits and undo lifecycle; review against implemented behavior.

## 3. Moving and selection

- [ ] 3.1 Implement searchable destination picker with recent folders, root and invalid-target explanations for single and multiple entries; test distant targets, collisions and stale destinations.
- [ ] 3.2 Extend existing DnD with target feedback, hover expansion and edge scrolling; test normalized selections, self/descendant rejection, no-op targets, filtered-tree restriction and undo.
- [ ] 3.3 Complete Cmd/Ctrl and Shift selection and contextual group bar for cross-folder selections; test no accidental opening, parent/child normalization, mixed eligibility, copy and trash outcomes.

## 4. Filtering and navigation state

- [x] 4.1 Extend the local tree filter with match highlighting, counts, empty state, Enter and two-step Escape while retaining accent-insensitive fuzzy behavior; test matching folders without nonmatching descendants, ancestors, unloaded branches and unique results.
- [x] 4.2 Preserve expansion and scroll around filtering and across workspace restarts; test collapsed parents, stale paths, external changes and explicit reveal without unwanted navigation.
- [ ] 4.3 Complete tree keyboard controls, focus restoration and accessible labels; test synchronized single selection and focus, independent active-note state, traversal, arrows, F2, Space and key isolation in inputs and dialogs.
- [x] 4.4 Ensure deeply nested active paths remain accessible from the editor and test explorer/editor synchronization on navigation and rename.

## 5. Quick preview

- [ ] 5.1 Add temporary read-only rendered preview with title, path, open and close actions; test Escape, Space, focus restoration and unchanged tabs/history/tree state.
- [ ] 5.2 Integrate protected and dirty-note access without plaintext persistence; test refusal for locked pages, rendered preview for unlocked pages, unsaved content, unreadable files and stale asynchronous responses.

## 6. Journal, lower priority

- [ ] 6.1 Add workspace journal-folder preference and reuse daily open/create flow with the existing default; test existing notes, missing folders and no duplicate or automatic migration.
- [ ] 6.2 Add optional chronological view derived from valid dated notes; test grouping, ordering, today label in the local date, duplicates, invalid dates and unchanged physical locations.
- [ ] 6.3 Add explicit dated-note organization preview and execute via safe mutation and undo; test cancellation, collisions, link warnings and partial failures.

## 7. Integration verification

- [ ] 7.1 Run relevant frontend tests and production build plus `cargo check` and affected Rust tests; resolve regressions and record results.
- [ ] 7.2 Exercise end-to-end mouse and keyboard flows, external watcher changes, protected notes and undo on supported platforms; record any platform limitations.
- [ ] 7.3 Measure filtering, navigation and organization on representative nested 500- and 1,000-note workspaces; fix demonstrated responsiveness regressions and record results.
