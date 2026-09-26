# Second Brain Component Architecture

## Scope
This folder contains the modular frontend surface for the Second Brain view.

## Ownership Map

| Module | Owns | Exists To |
| --- | --- | --- |
| `SecondBrainView.vue` | render shell, props, emits, local DOM refs | keep the view thin so it does not own backend or workflow state |
| `useSecondBrainViewState.ts` | façade that assembles the sub-workflows | give the shell one stable surface without merging responsibilities |
| `useSecondBrainSessionWorkflow.ts` | session loading, explicit context updates, Echoes anchoring, session lifecycle | keep persistence and session state separate from composer and stream timing |
| `useSecondBrainStreamRuntime.ts` | stream subscriptions, cancellation, auto-scroll, assistant render buffer | keep backend stream timing and DOM observer details out of the composer |
| `useSecondBrainConversationRuntime.ts` | composer input, mentions, copy/export | keep user input and export behavior separate from session persistence and stream lifecycle |

## Components
- `SecondBrainView.vue`: render shell for the chat surface.
- `SecondBrainSessionDropdown.vue`: quick session switch/create/delete from the header.
- `SecondBrainAtMentionsMenu.vue`: inline `@` suggestion list for context picks.

## State & Services
- `useSecondBrainViewState.ts` is the façade that stitches the session and
  conversation workflows together.
- `useSecondBrainSessionWorkflow.ts` owns session loading, explicit context
  updates, Echoes context anchoring, and session lifecycle
  actions.
- `useSecondBrainStreamRuntime.ts` owns stream subscriptions, cancellation,
  thread scroll state, and assistant message rendering.
- `useSecondBrainConversationRuntime.ts` owns assistant streaming,
  copy/export helpers and mention-driven context
  orchestration.
- `SecondBrainView.vue` should only bind props, emits, and render the surface.
- Backend calls are isolated in `src/domains/second-brain/lib/secondBrainApi.ts`.
- Modes contract is declared in `src/domains/second-brain/lib/secondBrainModes.ts`.
- `useSecondBrainAtMentions` resolves inline `@relative/path.md` mentions and extracts context paths before send.
- The Second Brain uses its configured default generation temperature.

## Design constraints
- Keep `App.vue` as integration shell only.
- Keep all LLM/network logic in Tauri backend.
- Use explicit context and no implicit cross-session memory.
- Do not auto-resume the latest session on pane open; session restore must be explicit.
- Do not reintroduce direct backend API calls or stream subscriptions into `SecondBrainView.vue`.
- Keep persistence in the session workflow, composition behavior in the conversation workflow, and streaming behavior in the stream runtime.
- Keep assistant streaming and thread behavior in the stream runtime.
