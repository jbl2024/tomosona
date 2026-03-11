# App Shell Architecture

## Mission
- `App.vue` is the shell composer for the desktop frontend.
- It wires domain controllers, shell workflows, and shell UI surfaces.
- It must not become the implementation home for cross-cutting workflows.

## Boundaries
- Allowed dependency direction: `app -> domains`.
- Forbidden dependency direction: `domains -> app`.
- Domain modules keep domain behavior:
  - `editor`: document/session/editing behavior
  - `cosmos`: graph/query/selection/preview behavior
  - `second-brain`: session/context/draft behavior
  - `favorites`: favorite persistence and workspace sync
  - `explorer`: tree rendering and file tree interactions
- Shell modules own:
  - global keyboard behavior
  - modal orchestration and focus restore
  - launchpad/recent items
  - back/forward history menu UI
  - workspace boot/reset flows spanning multiple domains
  - command routing from topbar/palette/launchpad/sidebar

## Ownership Rules
- If a behavior can be understood within one domain, keep it in that domain.
- If a behavior coordinates two domains or more, place it in the shell.
- If a shell workflow starts depending on a domain's internal state shape, enrich the domain's public API instead.
- `App.vue` should mainly create controllers, derive typed view-models, and render the shell.

## Shell Composables
- `useAppModalController`: modal selector derivation, focus restore, tab trapping.
- `useAppShellSearch`: global search state, debounce, grouping, mode switching.
- `useAppShellLaunchpad`: recent workspaces, recent notes, launchpad row derivation.
- `useAppShellHistoryUi`: back/forward menu long press, outside click, resize positioning.
- Existing higher-level controllers remain domain or shell orchestrators:
  - `useAppWorkspaceController`
  - `useAppNavigationController`
  - `useAppIndexingController`
  - `useAppSecondBrainBridge`

## View-model Rules
- Pane surface props should be passed as typed shell view-models.
- Do not pass large inline object literals from `App.vue` when a named computed view-model can express the same contract.
- Do not use `any` for pane-native surface data.

## Adding Features
### Add a new command palette action
- Put the domain behavior in the owning domain/controller.
- Put shell routing and UI wiring in the shell.
- Reuse existing shell command helpers before adding a new inline handler in `App.vue`.

### Add a new shell modal
- Add visibility state and focus ownership through the shell modal controller.
- Keep modal-specific DOM focus logic out of `App.vue`.

### Add a new cross-domain workflow
- Create or extend a shell composable with grouped ports.
- Keep the workflow in the shell only if it coordinates multiple domains.

## Anti-patterns
- Adding new cross-cutting watchers inline in `App.vue`.
- Duplicating the same shell command across topbar, launchpad, and palette handlers.
- Reimplementing domain behavior in the shell.
- Growing pane props with anonymous inline objects and `any`.
- Adding "misc" composables that only move refs around without owning a workflow.
