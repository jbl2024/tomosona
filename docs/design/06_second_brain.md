# Second Brain v1 Design

## Goal
Second Brain provides a dedicated deliberation view where AI answers are constrained to an explicit note context and transformed into reusable graph-linked outputs.

## Frontend architecture
- Entry point in `App.vue` as a dedicated sidebar mode and special tab.
- View implementation in `src/components/second-brain`.
- Stateful orchestration in composables:
  - `useSecondBrainState`
  - `useSecondBrainSessions`
  - `useSecondBrainDeliberation`
  - `useSecondBrainDraft`
- API layer in `src/lib/secondBrainApi.ts` and type-safe wrappers in `src/lib/api.ts`.

## Backend architecture
- Module: `src-tauri/src/second_brain`.
- Config parsing and validation in `config.rs`.
- Mode registry in `modes.rs`.
- LLM execution bridge in `llm.rs`.
- Session persistence in SQLite via `session_store.rs`.
- Draft file storage in `.tomosona/second-brain/drafts/<session_id>.md` via `draft.rs`.

## Config schema
`~/.tomosona/conf.json` (or `%USERPROFILE%\\.tomosona\\conf.json` on Windows):
- `active_profile`
- `profiles[]` with:
  - `provider`
  - `model`
  - `api_key`
  - optional `base_url`
  - capability flags (`text`, `streaming`, `image_input`, `audio_input`, `tool_calling`)

## Streaming contract
Events:
- `second-brain://assistant-start`
- `second-brain://assistant-delta`
- `second-brain://assistant-complete`
- `second-brain://assistant-error`

Payload fields:
- `session_id`
- `message_id`
- `chunk`
- `done`
- optional `error`

## Safety constraints
- Context paths must be markdown files under active workspace root.
- API keys are never returned to frontend.
- Errors are normalized to UI-safe messages.

## Multimodal scaffold
- Attachment metadata is accepted and persisted.
- Runtime generation is currently text-only.
- Capability flags gate unsupported attachment usage.
