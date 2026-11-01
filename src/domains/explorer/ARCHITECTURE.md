# Explorer Architecture

## Responsibilities

- `components/ExplorerTree.vue` orchestrates the explorer UI shell, tree focus,
  filtering, context menus, keyboard routing, and drag-and-drop provider.
- `components/ExplorerItem.vue` renders a single visible row and wires the
  row-level drag/drop refs onto the existing markup.
- `composables/useExplorerTreeState.ts` owns loaded tree snapshots, expansion
  state, visible-row derivation, and reveal-in-view behavior.
- `composables/useExplorerOperations.ts` owns explorer mutations and prompts.
  Drag and drop delegates final moves here instead of touching the filesystem
  directly.
- `composables/useExplorerDnD.ts` owns drag state, current drop target
  resolution, click suppression after drops, and translation from hover state
  to explorer move intents.
- `lib/explorerDndRules.ts` keeps DnD validation pure and testable.

## Drag And Drop MVP

- Library: `@vue-dnd-kit/core@2.2.0`.
- Scope: move files, folders, and normalized multi-selection within the visible
  explorer tree.
- Supported intents:
  - `inside` drops on folders move the dragged entries into that folder.
  - `before` / `after` drops on visible rows only target that row's parent
    directory. They do not create a persistent sort order.
- Unsupported in MVP:
  - drag-copy with modifier keys,
  - external file import,
  - dedicated keyboard drag-and-drop workflow,
  - filtered-tree drag and drop.

## Validation Rules

- Drag and drop is disabled while a filter query is active because filtered rows
  do not represent the full structural context of the workspace tree.
- A row in inline rename mode is neither draggable nor droppable.
- Multi-selection is normalized before move so descendants already covered by a
  selected parent are not moved twice.
- Invalid targets are rejected before invoking explorer operations:
  - moving a folder into itself,
  - moving a folder into one of its descendants,
  - `before` / `after` drops that would stay in the same parent and therefore
    have no effect under the explorer's alphabetical sort.

## Interaction Notes

- Drag activation uses a movement threshold so click, double-click, context
  actions, folder toggle, and inline rename remain the primary interactions.
- Starting a drag on an unselected row promotes that row to the active
  selection. Starting from a selected row moves the normalized selection.
- Folder moves reuse the existing confirmation prompt and name-conflict flow
  from `useExplorerOperations.ts`.
- The tree takes the keyboard back on every click, so keyboard navigation stays
  usable. Only actually opening a note (or a binary file) hands focus to the
  editor, and that hand-off happens after the open request is emitted so it wins
  over the tree focus. Clicking an entry that is already open therefore does not
  re-open it and leaves focus in the tree. The second click of a double-click
  (`event.detail > 1`) is excluded so opening a new note still leaves the caret
  in the editor.
- Clicks inside an editable control (the inline rename input) never reach row
  selection, so renaming is not interrupted by a focus change.

## Journal view

The explorer offers two views of the same workspace, toggled from the toolbar
and persisted per workspace as `tomosona.explorer.view.<root>`:

- the structural tree (default), and
- the chronological journal view.

`components/ExplorerJournalView.vue` renders the journal view and
`composables/useExplorerJournal.ts` owns its state: the workspace journal-folder
preference, the dated notes found under that folder, and the derived timeline.
`src/app/lib/journalTimeline.ts` derives month groups from real
`YYYY-MM-DD.md` names only, so undated or malformed files stay in the tree
instead of being misrepresented. Duplicate dates are all kept and show their
location relative to the journal folder. Entries open their real workspace path;
the view never moves anything.

While the journal view is active, `ExplorerToolbar` disables the actions that only
target the structural tree: new note, new folder, filter, expand/collapse, reveal,
sort, show extensions and refresh. Undo stays enabled because organizing the
journal produces workspace-level moves. The journal view owns its own header
(refresh, organize), so the reverse direction needs no extra state.

The journal folder is a workspace preference (`src/app/lib/journalFolder.ts`,
key `tomosona.journal.folder.<root>`) defaulting to the historical lowercase
`journal`. `dailyNotePath` takes it as an optional argument and the shell passes
the preference, so the palette, quick open and the journal view resolve the same
location. No existing file is migrated when the preference changes.

Organization is explicit: `src/app/lib/journalOrganization.ts` plans the moves of
dispersed dated notes into `<journal>/YYYY/MM/`, the preview dialog runs the
read-only native preflight to show destinations and collisions, and confirming
calls `executeMovePlan` in `useExplorerOperations.ts`. That path reuses the same
preflight, revalidation, conflict prompt and single `paths-moved` emission as
every other move, so the shell records one undo receipt for the whole batch.

## Mutation preflight foundation

The typed workspace API exposes read-only move, rename and trash preflight, plus source-metadata
revalidation for moves. Results are advisory snapshots: permissions, paths, contents and
filesystem identities can change afterward, and size/mtime alone cannot prove
identity. Rename, move, cut/paste, delete and drag-and-drop all run through this
boundary in `useExplorerOperations.ts` (`planMoveBatch` + `moveEntriesWithRevalidation`),
and `lib/mutationPreflight.ts` classifies results into ready, collision and blocked
so blocking issues stop the batch with a clear message while collisions keep using
the existing conflict prompt. Preflight never authorizes a write: every move is
revalidated at execution time and per-entry failures are reported without
assuming the batch succeeded.

## Safe mutation support modules

Shell-level pure helpers in `src/app/lib` back the mutation workflow; they never
touch the filesystem themselves:

- `noteLinkResolution.ts` shares note-link resolution with navigation so planning
  and opening use identical root/relative/ambiguity rules.
- `noteReferences.ts`, `noteReferenceImpact.ts`, `noteReferencePlan.ts` and
  `workspaceReferencePlan.ts` extract wiki/Markdown references from content and
  plan per-note and workspace-wide rewrites for proposed path moves. Aliases,
  fragments and untouched links are preserved; ambiguous, unresolved or
  unsupported references become warnings instead of silent rewrites, and locked
  protected notes are reported as uninspectable rather than assumed safe.
- `mutationReadiness.ts` maps open editor buffers through proposed moves and
  flags unsaved ones so the shell can reconcile them through the existing
  save/conflict flow before files change.
- `operationReceipt.ts` models the latest recoverable operation as a bounded
  session receipt (path mappings plus before/after reference contents).
  `planReceiptRestore` validates current state and never overwrites: occupied
  original paths, vanished destinations and externally changed files are
  reported as issues and left intact.
