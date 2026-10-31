# Design

## Context

See proposal.md for motivation. The full source spec (functional/UX, in French) is versioned at `docs/design/13_command_palette.md`; its example tables (search rules, command aliases, UX success criteria) are the reference matrices for tests. Current implementation facts that shape the approach:

- One modal surface exists: `QuickOpenModal.vue`, driven by `useAppQuickOpen` (query, `>` action mode, browse mode with recent notes + daily + five browse actions) and rendered from `AppShellOverlays`. Keyboard handling lives in `useAppShellModalInteractions` (App.vue port).
- Note matching today is a substring `includes` over file paths with an existing `normalizeSearchText` (lowercase + NFD accent folding); titles are not treated separately, there is no scoring, no multi-word, no fuzzy.
- Content search already exists in the backend: `indexApi.ftsSearch(query)` returns `{ path, snippet, score }` from the workspace index that files are reindexed into on save. The sidebar search panel (Cmd+Shift+F) already consumes snippets (`searchSnippets.ts`).
- Passage reveal exists: `useEditorNavigation.revealSnippet(snippet)` scrolls to the first text node containing normalized text; `revealAnchor` covers headings/blocks.
- Open targets exist: `openTabWithAutosave(path, { targetPaneId, revealInTargetPane })` and the multi-pane layout own tabs and panes.
- Command catalog: the `PaletteAction` type is defined in `useAppQuickOpen.ts` (`{ id, label, family, run, closeBeforeRun }`) and the catalog of actions is instantiated in `useAppShellPaletteActions`, grouped into families. `useAppShellKeyboard` binds `Cmd+K` and `Cmd+P` to `openCommandPalette()`, which calls `openQuickOpen('>')` — both currently open command mode.
- New-note creation from the recent `sync-filename-heading` change seeds `# <title>` and hides it — a palette "create note" action gets correct title behavior for free.
- Extract-to-note plumbing already exists in the editor interaction runtime (`createExtractedNote` + note embed/link restore flows); selection snapshots exist (`selectionSnapshot.ts`, caret capture).
- No `Cmd+K` binding exists in the editor surface today (verified), so the palette can own it globally.

## Goals / Non-Goals

**Goals:**

- One palette surface with a unified result model; the user types anything and gets categorized, ranked results.
- Reuse existing machinery: FTS index, revealSnippet, pane targeting, palette action catalog, new-note seeding, extract flow.
- Fully keyboard-driven with exact focus restoration; progressive results that do not steal the selection.
- Phased delivery matching the source spec's priorities (P1 fundamentals, P2 content search/navigation, P3 context) so each phase is shippable.

**Non-Goals:**

- No plugin/extension mechanism or user-defined commands.
- No settings UI beyond what exists; "personalization" is limited to signals the app already records (recent notes, favorites, action recency/frequency).
- No replacement of `[[`, `/`, block menus, context menu, or the explorer — the palette surfaces the same actions, it does not become the only way.
- No custom fuzzy-matching library dependency; the matcher stays small, pure, and testable.

## Decisions

### 1. Evolve the existing palette composable and modal; keep one surface
`useAppQuickOpen` already owns query/mode/result state and `QuickOpenModal.vue` already renders sections. The change extends them in place: a new result model inside the existing composable rather than a parallel palette component. Alternative: a fresh `useCommandPalette` composable — rejected: it would duplicate the open/close/focus plumbing that already works and force a migration of `AppShellOverlays` wiring.

### 2. Unified result model with categories
A single discriminated union feeds the list: `note` (path, title, folder, match kind), `passage` (path, title, folder, section, snippet, snippet id), `command` (action id), `create` (proposed title). Categories render as section headers; ranking is a pure function over the union. This keeps the modal dumb (render + keyboard) and the composable testable.

### 3. Pure matcher/ranking module (`src/app/lib/paletteSearch.ts`)
Extends the existing `normalizeSearchText` folding with: per-word AND matching in any order (all query words must match somewhere), subsequence-based typo tolerance per word, and a documented scoring ladder — exact title > title starts-with > partial title > content (FTS score) > command (label/keyword). Tie-breakers (recent note, favorite, current folder, and open frequency once tracked) apply to comparable results only when the signal is available — recency, favorite, and folder exist today, frequency arrives with P3 personalization. Pure functions with a dedicated test suite (the example table in the versioned source spec, `docs/design/13_command_palette.md`, becomes the test matrix). Alternatives: reuse the sidebar search's matching — rejected: it is snippet-oriented, not ranked-title-oriented; a dependency on an external fuzzy lib — rejected per repo KISS rules.

### 4. Command catalog enrichment
`PaletteAction` gains `keywords: string[]`, `description: string`, `shortcutLabel?: string`, and availability: `isEnabled?: () => boolean` plus `unavailableReason?: string`. `useAppShellPaletteActions` fills these for existing actions; the modal renders unavailable actions as non-executable with the reason when they explicitly match. Availability is computed at render time, not at catalog definition time, so state changes (note opened/closed) are reflected without rebuilding the catalog.

### 5. Content search via FTS with debounce and progressive delivery
Query changes debounce (~150-200ms) before hitting `ftsSearch`; results merge into the union under the `passage` category. Until FTS returns, title/command results are already visible (they are synchronous) — this gives progressive behavior for free; the selection index only moves when results are inserted before it, which the merge function prevents by preferring append-after for late arrivals. Passages are grouped per note client-side (one expandable entry per note, passage count, capped passages per note).

### 6. Passage navigation: openTabWithAutosave + revealSnippet + transient highlight
Opening a passage: `openTabWithAutosave(path)` then, when the target editor session is ready, `revealSnippet(snippet)`. The temporary highlight is a small transient decoration added by a dedicated editor port (a timed, single-range highlight similar to the find toolbar's match highlight), cleared on first edit or after a timeout. The editor keeps ownership of highlighting; the palette only requests it.

### 7. Open targets through the pane model
`Enter` → current tab (existing `openTabWithAutosave`), `Cmd+Enter` → open as a new tab in the active pane without reusing the active tab, `Alt+Enter` → adjacent pane via the existing pane targeting (`targetPaneId`). Adjacency is resolved by the shell: the first existing pane in reading order after the active one (right neighbor, then below, matching the grid's row-first layout), falling back to any other existing pane; with no other pane, `Alt+Enter` degrades to a new tab in the active pane. The pane layout (`useMultiPaneWorkspaceState`) owns this resolution; the palette only passes a target hint, keeping pane policy out of the palette.

### 8. Creation reuses the seeded new-note flow
The create action calls the same creation path as the New File modal / wikilink creation (stem → seeded `# <title>` → open). The typed query is sanitized into a filename (existing `sanitizeTitleForFileName`); the seeded title heading keeps the note consistent from birth. Cursor-in-body after open rides the existing post-load focus behavior (first text cursor at body start, already implemented for new notes).

### 9. Context suggestions as a priority overlay, not a mode
A pure `contextSuggestions(context)` function ranks context-relevant actions first in the browse state (no document → startup actions; active note → note actions; selection present → selection actions; explorer selection → file actions; daily note → journal actions). Context is a snapshot captured when the palette opens (active path, editor selection text, explorer selection, is-daily-note), so actions operate on what the user saw. The palette never hides non-contextual results.

### 10. Selection actions and extract reuse existing editor flows
Selection actions map onto existing editor commands: transforms (heading/list/etc.) via the existing inline/block command handlers, copy-as-markdown via the existing clipboard flow, and extract-to-note via the existing `createExtractedNote` flow (create note from selection content, insert link, keep original passage per spec default). The palette contributes discovery, not new editor logic.

### 11. Shortcuts: same palette, three entry filters
`useAppShellKeyboard` keeps `Cmd+K` as the universal entry (empty query), changes `Cmd+P` to the notes-only initial filter, and adds `Cmd+Shift+P` as the commands-only filter (`>`). `openQuickOpen(initialQuery)` already accepts an initial query, so entry filters are a one-line change per binding. `Ctrl` replaces `Cmd` through the existing `isMod` platform abstraction.

## Risks / Trade-offs

- [Ranking quality is the hard part; a poor ladder makes the palette feel random] → The ladder is explicit, pure, and locked by tests derived from the source spec's example table (`zettel`, `notes atom`/`atom notes`, `methode zettel`, `roadmap`, `docx`/`convertir`, `renommer`).
- [FTS latency on large workspaces could lag typing] → Debounced queries, synchronous title/command results shown immediately, passages merged in when they arrive.
- [Context overlay could feel unpredictable] → Suggestions are ordered, never filtering; recent notes remain reachable via search; behavior is spec'd and tested per context.
- [Shortcut collisions] → Verified: no editor `Cmd+K` binding exists; `Cmd+P` currently duplicates `Cmd+K` so repurposing it is safe; `Cmd+Shift+P` label already exists in the shortcuts modal. The repurposing of `Cmd+P` (today: command mode, after: notes filter) is a habit change — the in-app shortcuts modal entries are updated as part of the work so the built-in reference stays truthful.
- [Scope is large] → Phased by priority (see tasks.md); each phase leaves the palette fully usable.
- [Progressive results moving the selection] → Late-arriving content results append after the current window rather than reordering above the selected index.

## Migration Plan

No data migration. The palette is additive UI; `>` keeps working, recent notes and daily results keep their semantics. Rollback is a plain revert; the FTS index and command catalog extensions are backward-compatible.

## Open Questions

- Action open-frequency tracking needs a persisted signal; P3 may start with recency + favorites only and add frequency later without changing the contract.
- The `?` help mode's content set (help pages vs. shortcut explanations) can be finalized during P3 without affecting the search model.
