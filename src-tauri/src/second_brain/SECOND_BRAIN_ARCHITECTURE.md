# Second Brain Architecture

## Ownership

- `mod.rs`
  - public Tauri command surface
  - IPC payload/result types
  - thin wrappers and shared lightweight helpers (`load_config`, `next_id`, `session_exists`)
- `paths.rs`
  - workspace boundary checks
  - markdown path normalization
  - safe publish filename/date helpers
- `stream_control.rs`
  - process-local cancellation state for streamed assistant and Pulse flows
- `context.rs`
  - session context lookup
  - mention extraction and prioritization
  - markdown file loading for prompt inputs
- `prompt_builder.rs`
  - prompt text assembly
  - token budgeting
  - Pulse action normalization
- `message_flow.rs`
  - `send_second_brain_message` workflow
- `pulse_flow.rs`
  - `run_pulse_transformation` workflow
- `draft_publish.rs`
  - draft persistence
  - target note insertion
  - publish/export flows

## Why It Is Split This Way

The split is by concrete responsibility, not by reusable abstraction.

The goal is to keep each module easy to read and cheap to change:
- prompt rules change in `prompt_builder.rs`
- path rules change in `paths.rs`
- stream cancel behavior changes in `stream_control.rs`
- message or Pulse flow changes stay in their dedicated workflow modules

## What Stays In `mod.rs`

`mod.rs` remains the public entrypoint for the domain:
- Tauri commands stay there
- payload/result structs stay there so frontend IPC contracts stay easy to find
- shared helpers that are truly cross-cutting and small stay there

## Anti-Patterns To Avoid

- Re-growing `mod.rs` into a catch-all module
- Adding generic traits or service containers without a concrete need
- Hiding straightforward filesystem or DB logic behind “manager” layers
- Repeating workspace/path validation in multiple flows instead of using `paths.rs`
