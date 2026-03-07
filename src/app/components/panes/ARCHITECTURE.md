# Multi-Pane Editor Architecture

## Scope
This module provides a VS Code-style multi-pane shell for mixed editor surfaces:
- document notes,
- Cosmos graph view,
- Second Brain chat.

## Data Model
- `MultiPaneLayout` stores `root` split tree, `panesById`, and `activePaneId`.
- `PaneTab` is a tagged union with `type`:
  - `document` with `path`,
  - `cosmos`,
  - `second-brain-chat`.
- `SplitNode` is either:
  - `{ kind: 'pane', paneId }`
  - `{ kind: 'split', axis, a, b, ratio: 0.5 }`

## Key Invariants
- Maximum 4 panes.
- Exactly one active pane at any time.
- A document path can exist in at most one pane at a time.
- Special surfaces are unique by type across the full layout (max one `cosmos`, one `second-brain-chat`).
- Splitting a pane creates an empty pane, then focuses the new pane.
- Split ratio is fixed to `0.5` in MVP for predictable rendering and simpler maintenance.

## UI Composition
- `EditorPaneGrid.vue` renders panes from the layout and mounts one `PaneSurfaceHost` per pane.
- `PaneSurfaceHost.vue` chooses the active surface renderer based on tab `type`.
- `EditorPaneTabs.vue` renders pane-local typed tabs and pane-local tab actions.
- `MultiPaneToolbarMenu.vue` exposes split/focus/move/reset actions in the top toolbar.
- `CosmosPaneSurface.vue` embeds Cosmos controls + graph with an internal resizer.
- `SecondBrainPaneSurface.vue` mounts the Second Brain chat surface directly (no dedicated explorer split).

## Command Flow
1. UI emits user intent (`split`, `focus`, `move tab`, `close pane`, `reset`).
2. `useMultiPaneWorkspaceState` mutates layout state while enforcing invariants.
3. App routes open actions to the active pane and applies uniqueness redirect (focus existing tab instead of duplicating).
4. Surface-specific handlers (Cosmos/Second Brain) run inside pane surfaces.
5. Session snapshot is persisted in `sessionStorage` and restored on reload.

## Persistence
- Storage key: `tomosona:editor:multi-pane`.
- Persist only serializable layout state (no editor instances).
- Hydration validates shape and constraints; invalid payload falls back to one pane.

## KISS Rationale
- No tab drag across panes in MVP (explicit move command only).
- No duplicate document or duplicate special-surface instance.
- `Join panes` merges all unique tabs (document + surfaces) into one pane and keeps the active tab when possible.
