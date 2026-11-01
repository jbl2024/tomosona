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

## Mutation preflight foundation

The typed workspace API exposes read-only move, rename and trash preflight, plus source-metadata
revalidation for moves. Results are advisory snapshots: permissions, paths, contents and
filesystem identities can change afterward, and size/mtime alone cannot prove
identity. Existing mutations do not yet use these commands. The future mutation
workflow must validate again at the write boundary and handle failures and
partial results without assuming a preflight guarantees success.
