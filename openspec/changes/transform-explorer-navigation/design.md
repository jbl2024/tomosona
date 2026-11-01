# Design

## Context

`src/domains/explorer/ARCHITECTURE.md` describes the existing ownership boundaries. The tree already has inline rename, multi-selection, a folder-aware accent-insensitive fuzzy filter, DnD and persisted expansion. DnD is disabled during filtering. `useExplorerOperations` performs sequential file mutations and uses conflict prompts; trash currently moves into `.tomosona-trash`. The watcher and path-change events already coordinate some workspace updates. Daily paths currently use `journal/YYYY/MM/YYYY-MM-DD.md`. These pieces do not themselves guarantee undo or safe link rewriting.

## Goals / Non-Goals

**Goals:** Extend existing workflows incrementally, keep filesystem truth in Rust, keep UI orchestration local, and deliver recoverability before exposing new organization gestures. Preserve the existing protection and title-heading contracts.

**Non-Goals:** Replace files with an abstract page database, build a general document manager, add hover previews, or duplicate favorites and recent files inside the tree. Do not introduce a general-purpose command/event framework or dependencies without a demonstrated need.

## Decisions

### Tree state and interactions
Extend the current tree state, selection manager, filter and keyboard handlers rather than replacing them. Store expansion, scroll, sort and extension preferences per workspace with safe defaults and stale-path pruning. Derive filter rows independently of saved expansion and restore the snapshot on exit; distinguish actual matching entries from ancestor rows for counts and Enter. Keep existing fuzzy name matching and accent folding, but show only matching entries and their ancestors; a folder match alone does not expose nonmatching descendants. Highlight matched characters and do not treat a matching ancestor path as a match for every child. Preserve DnD's filtered-tree restriction with an explanation rather than dropping onto an incomplete structural view. Use accessible focusable controls for hover actions and a single shared menu model for right-click and overflow, with the specified action order, contextual labels and placement near the target. Unmodified arrow navigation synchronizes focus and single selection without changing the active note. Reuse app localization conventions instead of hard-coding French examples.

### One operation boundary
Route rename, move, cut/paste, drag, group actions and journal organization through one explicit workspace mutation workflow, extending current APIs rather than bypassing them. Normalize selected ancestors; preflight workspace containment, symlinks, permissions, collisions, stale state, open dirty buffers and reference impact before writing. Keep filesystem operations and path validation in Rust, invoke via typed wrappers, and coordinate editor/navigation/index state at the shell boundary. Return per-entry results, including partial failures, rather than reporting a group as wholly successful. Existing conflict choices must never overwrite without explicit consent; inline rename reports collision for correction.

### Links and undo
Use the existing link parser/resolution semantics as the source of truth and only rewrite references that can be resolved unambiguously. Include inbound and relative outbound links affected by moving files or folders; preserve aliases, fragments and syntax. Locked protected content is excluded from the index, so it is an explicitly reported unknown, not proof of safety. On uncertainty present a clear risk and require confirmation or cancel; never decrypt or persist plaintext behind the user's back. Reconcile dirty editor buffers through their existing save/conflict flow before modifying them.

Represent the most recent recoverable operation as a bounded, session-scoped receipt containing successful path mappings, trash destinations and exact before/after data or equivalent safe restoration information for changed references. Undo checks identity and current content before restoration and never overwrites changed files; report conflicts and partial outcomes. No durable general history engine is needed. Prefer staged writes and rollback where feasible; explicitly report any partial commit or rollback failure. Do not promise atomicity across unrelated filesystem operations. Trash needs the returned destination and validated restore support; do not infer it from timestamps. The undo affordance remains accessible until superseded by another recoverable operation or workspace/session change, with a visible explanation when unavailable.

### Preview
Reuse the existing Markdown rendering and protected-content access paths in an isolated read-only preview, without routing through tab-opening or navigation history. Prefer the current in-memory document for a dirty open note if it can be read safely; otherwise explain why preview is unavailable rather than silently showing stale data. Restore tree focus on close; protect against stale async results when selection or workspace changes.

### Journal
Reuse the daily-note path/open flow; add a workspace-scoped journal-folder preference defaulting to the existing lowercase `journal` location, without moving or merging existing files. The chronological view derives entries from actual valid `YYYY-MM-DD.md` names under that folder, preserving duplicates with paths. Sorting and organization are separate: preview a complete move plan with collisions and link risks, then reuse the mutation boundary and undo receipt. No automatic migration of dispersed files.

### Performance and rollout
Reuse loaded tree snapshots and watcher invalidation; cancel or discard stale async work on workspace/query changes. Avoid synchronous repeated full-tree scans per keystroke; measure representative 500 and 1,000-note workspaces including nested folders. Deliver in ordered slices: presentation and contextual creation, safe mutation/undo and rename, destination picker/DnD, filter/state/keyboard, selection and preview, then journal. Do not ship a new mutation path ahead of its safety boundary.

## Risks / Trade-offs

- [References can be ambiguous or hidden in encrypted notes] → Preflight and explicit warning; never promise universal rewriting.
- [External edits or partial filesystem failures can invalidate undo] → Validate snapshots, avoid overwrites, report individual outcomes and retain recoverable data.
- [Loading every directory is expensive] → Reuse cached snapshots, invalidate incrementally and test responsiveness at target sizes.
- [Different platforms handle paths and permissions differently] → Exercise native validation, collisions and trash restoration on supported platforms; present safe errors.
- [Expansion, scroll and active editor can compete] → Restore workspace state first and reveal only on explicit request.

## Migration Plan

Default existing workspaces to hidden `.md`, alphabetical folders-first sorting and the current journal path; retain existing expansion state and tolerate absent or malformed preferences. No files move merely because the app is upgraded. Rollback removes new UI/preferences without deleting user files or trash; a deployment must not discard outstanding undo data during an operation. Test both fresh and existing workspaces.
