# Design

## Context

See proposal.md for motivation. Current pipeline facts that shape the approach:

- **Load** (`useEditorFileLifecycle`): snapshot → `parseAndStoreFrontmatter` → body (after frontmatter) → `markdownToEditorData(body)` → TipTap blocks; title is set from the file name via `noteTitleFromPath(path)` (`useEditorTitleState.syncLoadedTitle`).
- **Save** (`useEditorFileLifecycle`): `serializeCurrentDocBlocks()` → title commit → `renameFileFromTitle(initialPath, requestedTitle)` (renames the file, sanitizing the title) → `editorDataToMarkdown(blocks)` → `composeMarkdownDocument(bodyMarkdown, frontmatterYaml)` → persist. There is a skip when the composed markdown equals the last loaded text.
- **New files** (`useAppShellOpenFlow.openOrPrepareMarkdown(path, titleLine)`): creates a virtual document `{ content: '', titleLine }`; autosave in `useAppNotePersistence` skips persisting while `isTitleOnlyContent(content, titleLine)` (content empty or equal to the title line).
- Title/rename state is per-path and moves with renames (`moveTitlePathState`, `moveFrontmatterPathState`); virtual docs move on folder renames (`appShellPathMoveEffects`).
- Source mode (`useSourceEditorRuntime`) edits the raw file text and is intentionally out of scope for hiding.

## Goals / Non-Goals

**Goals:**

- The first `# <filename stem>` heading is hidden in the rich editor and edited through the existing title field / rename flow.
- Round-trip stability: opening a note and saving it without edits must not produce spurious diffs (the skip-compare in save relies on this).
- The heading is derived state: regenerated from the title on every save while the match holds, never stored in editor content.

**Non-Goals:**

- No rewriting of files that do not match (opening a note never modifies it).
- No hiding in source mode (raw view is verbatim by design).
- No setext-style heading support (`Title` + `===` underline): only the ATX `# ` form requested.
- No UI toggle to force-show the hidden heading; the match condition is the single switch.

## Decisions

### 1. Pure helper module for match / strip / compose
New `src/domains/editor/lib/noteTitleHeading.ts` with three pure functions over strings (no editor, no path I/O):
- `matchTitleHeading(body, title)` — returns the matched heading text when the first non-empty line is `# <text>` with `text.trim() === title.trim()`, else null. Only ATX level-1 (`^#\s+`), per request. First non-empty line (not strictly the first line) because `parseFrontmatterEnvelope` returns the body untrimmed: files written as frontmatter + blank line + heading are the common case and must sync.
- `stripTitleHeading(body)` — consumes the leading blank lines plus the matched heading line; the remainder is the editor body.
- `composeTitleHeading(title, body)` — renders the canonical stored form: `# <title>`, one blank line, then the body.

Rationale: the lifecycle layer owns filename/title context; `markdownBlocks.ts` stays content-agnostic. Alternatives: filtering inside the markdown conversion (rejected: conversion lacks path/title context and would leak the concept into a generic layer); TipTap plugin hiding the node in the view (rejected: the heading would remain in the doc model, leaking into outline, saves, and block menus).

### 2. Path-scoped hidden state in the document runtime
`useEditorDocumentRuntime` owns a `titleHeadingByPath` ref (like `frontmatterByPath`), storing whether the loaded body had a matched hidden heading and its matched text. Lifecycle reads/writes it; it moves with renames alongside the existing `moveTitlePathState` / `moveFrontmatterPathState` calls in the save flow.

### 3. Strip on load, re-prefix on save, regenerate from the post-rename stem
- **Load**: after frontmatter parsing, `matchTitleHeading(body, noteTitleFromPath(path))`; on match, store state and pass `stripTitleHeading(body)` to `markdownToEditorData`. Title sync from the file name is unchanged — the match condition guarantees heading text equals the stem.
- **Save**: after the rename result is known, if the path has active hidden state, serialize the doc as-is and wrap: `composeTitleHeading(renameResult.title, bodyMarkdown)` before `composeMarkdownDocument`. The heading is regenerated from the **post-rename file name stem**, not the raw requested title: `renameFileFromTitle` always returns the stem of the resulting path, and the title field is synced from that same value, so a title that sanitizes differently (for example `A/B` → `A-B.md`) self-heals — heading, file name, and title field converge on the sanitized stem without any reload.
- Round-trip: for files already in canonical form (`# title`, one blank line, body), load strips exactly what save re-adds, so an unmodified open/save composes the identical text and keeps the no-op save skip working. It is not byte-perfect for other layouts: any deviation from the canonical form — leading blank lines before the heading, trailing whitespace in the heading, or a missing blank line between heading and body (`# T\nbody`) — is normalized on the first save. Matching and stripping compare trimmed text, so this is a one-time, benign rewrite per affected file.

### 4. Seed new notes on both creation paths
- **New File modal** (`submitNewFileFromModal` in `useAppShellWorkspaceEntries`): the modal already forces a markdown extension and computes the stem. When no template is selected it currently writes an empty file; it writes `# <stem>` instead. When a template is selected, template content is stored verbatim — template authors own their first line (a template that happens to start with `# <filename stem>` engages the sync naturally).
- **Wikilink to a non-existent note** (`useAppShellOpenFlow.openOrPrepareMarkdown`): the function already takes a `titleLine` parameter whose only call site passes `''`. Callers pass `# <stem>` and the virtual document is created with `content` and `titleLine` both equal to that seeded line. The load pipeline then treats virtual docs uniformly (the seed matches and is hidden with no special case), and `isTitleOnlyContent` keeps skipping autosave for notes that contain only the seeded heading, preserving the "do not persist empty notes" behavior. Folder renames move virtual docs untouched; the stem is unchanged, so the match holds.

### 5. Outline derives from the rendered document
The outline is built from the rendered TipTap doc, so a stripped heading is excluded automatically. Wikilink heading completion reads files from disk (`extractHeadingsFromMarkdown` over raw text) and still offers the stored heading — acceptable divergence: the anchor exists in the file.

## Risks / Trade-offs

- [Anchor reveal for `[[note#Title]]` stops working while the heading is hidden (node absent from the doc)] → Document as a known limitation; anchor links to the note title should be discouraged in favor of section anchors. A later change could map title anchors to the document start.
- [Titles that sanitize differently diverge from what the user typed] → Accepted and self-healing: file name, title field, and stored heading all converge on the sanitized stem, so the sync never breaks; the visible title field after the save shows the sanitized stem.
- [Deleting the heading in source mode and saving is not regenerated] → Intended escape hatch: source mode saves verbatim (the re-prefix lives only in the rich editor's save path in `useEditorFileLifecycle`); the sync re-evaluates on the next rich editor load and simply ends for that note.
- [External edits to the first line while open elsewhere could conflict with regeneration] → The existing save-buffer version check (expectedBaseVersion) guards concurrent writes; regeneration is part of the same buffer write. An external rename of an open note moves the hidden state through the existing `moveTitlePathState` call in `useEditorFilesystemSync`, so a rich editor save before the reload regenerates the heading from the new stem — the same self-heal as an in-app title rename.
- [Virtual docs seeded with a heading change the raw content seen if the user immediately switches to source mode] → Intended: source mode is verbatim; the user sees exactly what would be saved.
- [Repeated saves must not stack headings] → Composition always derives from the current title and replaces the body prefix, so saves do not accumulate lines. One bounded edge: while the sync is active, a heading typed manually at the top of the body is preserved as body content, so the stored file temporarily shows the regenerated title heading followed by the typed duplicate (exactly two heading lines). Each load strips only the first match, the duplicate stays visible, and strip-one/add-one keeps the file stable — no growth and no loss until the user deletes the duplicate or the match otherwise ends.

## Migration Plan

No data migration: detection is on the read path and regeneration on the write path. Files that never matched are never touched. Rollback is a plain revert; files already saved keep their `# <title>` line, which remains valid markdown.

## Open Questions

- None blocking. A future option (out of scope): a per-note toggle to opt out of the sync. The match condition is the only switch for now.
