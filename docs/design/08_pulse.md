# Pulse v1 Design

## Goal
Pulse is Tomosona's transformation layer. It converts explicit source material into a useful written output without acting as a general chat surface.

## Product role
- Editor: transforms selected text or the current note.
- Second Brain: transforms the explicit note context already assembled there.
- Cosmos: transforms one selected node plus its current visible neighborhood.

Pulse does not replace:
- Cosmos exploration
- Echoes retrieval
- Second Brain conversation/stateful deliberation

## Runtime architecture
- Backend implementation reuses `src-tauri/src/second_brain` runtime pieces:
  - config/profile resolution
  - provider/model execution
  - streaming and cancellation plumbing
  - workspace path normalization
- Pulse does not persist its own sessions or drafts in v1.
- Persistent output continues through the existing Second Brain session/draft flow when needed.

## API contract
- Command: `run_pulse_transformation`
- Cancel command: `cancel_pulse_stream`
- Stream events:
  - `pulse://start`
  - `pulse://delta`
  - `pulse://complete`
  - `pulse://error`

Request fields:
- `source_kind`
- `action_id`
- optional `instructions`
- explicit `context_paths`
- optional `source_text`
- optional `selection_label`
- optional `session_id`
- optional Cosmos metadata

## Action set
Initial actions:
- `rewrite`
- `condense`
- `expand`
- `change_tone`
- `synthesize`
- `outline`
- `brief`
- `extract_themes`
- `identify_tensions`

Prompt constraints:
- operate only on supplied material
- no implicit retrieval
- markdown output
- surface uncertainty when source material is incomplete

## UX model
- Pulse always generates a preview first.
- No output is applied automatically.
- Apply behavior depends on the host surface:
  - Editor: replace selection, insert below, send to Second Brain
  - Second Brain: replace draft, append to draft
  - Cosmos: send to Second Brain, append to draft

## Provenance
- Pulse reports the explicit note paths used for the transformation.
- Provenance is shown as concise source metadata, not mandatory inline citation formatting.

## v1 scope limits
- No Pulse-specific saved workspace state
- No autonomous retrieval
- No multi-select Cosmos workflow
- No direct long-form authoring surface in Cosmos
