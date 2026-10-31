# Proposal

## Why

Markdown notes commonly start with `# Title` on the first line, and many workflows name the file after that title. Tomosona already derives the editor title field from the filename, so these notes render the same title twice: once in the title field and again as a large duplicated heading at the top of the body. The two also drift apart: renaming the note updates the title field but leaves the first line stale.

## What Changes

- Detect when the first non-empty line of a note's body (after frontmatter) is a level-1 heading (`# ...`) whose text equals the filename without extension: the rich text editor hides that heading from the body, and the existing title field becomes its sole editable representation.
- Editing the title (the existing title-driven rename flow) rewrites the hidden heading, so the filename and the first line stay in sync after renames — including self-healing when a title must be sanitized into a different filename.
- Saving a note whose heading is hidden always regenerates `# <title>` as the first line of the file on disk: the heading is derived state, never lost.
- Creating a new empty markdown note seeds it with `# <filename-without-extension>` as its first line, on every creation path (the New File modal and wikilinks to not-yet-existing notes), so the sync invariant holds from creation and files stay portable to other markdown tools. When a template is applied, template content is written verbatim.
- Raw/source mode is unaffected: it shows the file exactly as stored, and its saves stay verbatim (the sync re-evaluates on the next rich editor load).
- When the first non-empty line does not match (different text, other heading level, renamed externally), the editor keeps rendering it as normal content.

## Capabilities

### New Capabilities
- `note-title-heading`: owns the contract between a note's filename, its first level-1 heading, and the editor title field — detection/hiding on load, title-driven rewrite on save, seeding of new notes, and the non-matching fallback.

### Modified Capabilities

(None. The existing `page-protection` spec is unrelated.)

## Impact

- Editor domain load/save pipeline: `useEditorFileLifecycle` (load strips the matched heading before markdown conversion; save re-prefixes it), markdown conversion in `markdownBlocks.ts` is fed the stripped body.
- Title state: `useEditorTitleState` and the title commit/rename flow (`renameFileFromTitle`) — the hidden heading follows title edits.
- New-file creation, both paths: `submitNewFileFromModal` in `useAppShellWorkspaceEntries` (writes the file to disk, seeds `# <stem>` when no template is selected) and `useAppShellOpenFlow.openOrPrepareMarkdown` (seeds virtual documents with `# <filename stem>`); the title-only autosave skip in `useAppNotePersistence` (`isTitleOnlyContent`) must keep treating "heading-only" new notes as empty.
- Outline: the hidden heading is excluded from the editor outline since it is no longer part of the rendered body.
- New pure helpers for match/strip/re-prefix with unit tests; on-disk markdown files gain the `# <filename>` first line (visible, intended behavior).
