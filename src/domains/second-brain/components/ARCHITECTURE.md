# Second Brain Component Architecture

## Scope
This folder contains the modular frontend surface for the Second Brain view.

## Components
- `SecondBrainView.vue`: top-level chat surface orchestration.
- `SecondBrainSessionDropdown.vue`: quick session switch/create/delete from the header.
- `SecondBrainAtMentionsMenu.vue`: inline `@` suggestion list for context picks.

## State & Services
- State is centralized in composables under `src/domains/second-brain/composables/useSecondBrain*`.
- Backend calls are isolated in `src/domains/second-brain/lib/secondBrainApi.ts`.
- Modes contract is declared in `src/domains/second-brain/lib/secondBrainModes.ts`.
- `useSecondBrainAtMentions` resolves inline `@relative/path.md` mentions and extracts context paths before send.

## Design constraints
- Keep `App.vue` as integration shell only.
- Keep all LLM/network logic in Tauri backend.
- Use explicit context and no implicit cross-session memory.
- Do not auto-resume the latest session on pane open; session restore must be explicit.
