# Editor ↔ Filesystem Sync v2

## Purpose

This document defines how Tomosona keeps the editor buffer synchronized with the filesystem without:

- reloading after its own saves,
- overwriting newer disk changes silently,
- reading full file content on every ordinary save path.

This design is specific to Tomosona's current architecture:

- Vue 3 editor runtime in `src/domains/editor`
- Rust/Tauri filesystem and watcher boundary in `src-tauri`
- one workspace-wide watcher subscription owned by the shell

## Ownership

### Rust / Tauri

Rust owns:

- `FileVersion` derivation from `mtime + size`
- conditional save validation
- atomic persistence
- internal-write registry
- watcher event filtering and version enrichment

Public commands:

- `read_note_snapshot(path)`
- `save_note_buffer({ path, content, expectedBaseVersion, requestId, force })`

### Vue editor runtime

The editor runtime owns:

- path-scoped session state
- `loadedText` as the last synchronized document text
- `baseVersion` and `currentDiskVersion`
- conflict state and conflict UI
- reload behavior for clean notes

Primary owner modules:

- `useEditorFileLifecycle`
- `useEditorDocumentRuntime`
- `useEditorFilesystemSync`

### Shell

The shell keeps the single `workspace://fs-changed` listener and relays those changes to mounted editor panes after workspace/favorites bookkeeping has run.

## File Version Model

Tomosona uses a lightweight version as the primary comparison key:

```ts
type FileVersion = {
  mtimeMs: number
  size: number
}
```

This version is cheap to compute and good enough for normal save validation and watcher decisions.

Tomosona uses `BLAKE3` only as a confirmation path for recent internal writes when watcher metadata is inconclusive.

## Save Rules

The editor saves conditionally against the last synchronized disk version.

Save is accepted when:

- `force === true`, or
- the current disk version matches `expectedBaseVersion`, or
- the file does not exist and `expectedBaseVersion === null`

Otherwise the backend returns:

- `CONFLICT` with current disk content and disk version, or
- `NOT_FOUND` / `IO_ERROR`

This prevents silent overwrite of external edits and also supports virtual notes on first save.

## Watcher Rules

The workspace watcher emits debounced filesystem changes.

For file `created` and `modified` changes, Rust:

1. reads current metadata,
2. attaches `version`,
3. checks whether the change matches a recent editor-owned write,
4. suppresses the event only if it was caused by `save_note_buffer`.

Rename and remove events continue to flow through for the rest of the shell.

## Frontend Behavior

### Clean note + external change

Tomosona reloads the note from disk and keeps the note clean.

### Dirty note + external change

Tomosona does not reload automatically. It stores a conflict and shows a small conflict banner.

Actions:

- `Load disk version`
- `Overwrite with my version`
- `Recreate file` for deletion conflicts

## Navigation Rule

Tomosona keeps its current navigation behavior:

- autosave-before-switch still runs before tab switches,
- if that save returns a conflict, the switch is blocked,
- the current note remains active with visible conflict state.

## Testing Strategy

Rust coverage should protect:

- snapshot reads,
- conditional save success and conflict paths,
- forced overwrite,
- first save for virtual notes,
- watcher suppression for internal writes,
- external write propagation.

Frontend coverage should protect:

- versioned load/save lifecycle,
- conflict state transitions,
- external reload vs conflict behavior,
- shell relay into mounted editor panes.

## Non-goals

- automatic merge
- inline diff UI
- content hashing as the primary version mechanism
