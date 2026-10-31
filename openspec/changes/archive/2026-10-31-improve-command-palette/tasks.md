# Tasks

## 1. P1 — Search foundations and universal mode

- [x] 1.1 Create the pure matcher/ranking module `src/app/lib/paletteSearch.ts` (per-word AND in any order, subsequence typo tolerance, ranking ladder: exact title > title starts-with > partial title > content score > command, tie-breakers recency/favorite/current folder applied when the signal is available, frequency when tracked) and verify its unit suite passes the example matrix from the versioned source spec (`docs/design/13_command_palette.md`): `zettel`, `notes atom`/`atom notes`, `methode zettel`, `roadmap`, `docx`/`convertir`, `renommer`/`changer nom`, plus case/accent folding, tie-breaker ordering for comparable results, and no-match cases
- [x] 1.2 Rework `useAppQuickOpen` around a unified result model (note / passage / command / create, with category grouping) and verify its tests cover: browse state (three recent notes newest first with folder, favorites deduped, quick actions, first result preselected), no-history startup state, and categorized ranked results for a universal query
- [x] 1.3 Extend `PaletteAction` with `keywords`, `description`, `shortcutLabel`, and availability (`isEnabled` + `unavailableReason` evaluated at render time), fill the catalog in `useAppShellPaletteActions`, and verify tests cover alias lookup (`docx`, `convertir`, `changer nom`), description rendering data, and unavailable-with-reason behavior
- [x] 1.4 Wire search modes and entry shortcuts: `>` (commands, existing), `#` (content), `?` (help placeholder until 3.3), reversible prefixes, and `Cmd+K` universal / `Cmd+P` universal alias / `Cmd+Shift+P` commands in `useAppShellKeyboard` (the planned notes-only filter for `Cmd+P` was dropped during manual review as redundant); update the shortcuts modal entries (`useAppShellViewModels` shortcut sections) to describe the palette entries truthfully; verify keyboard-layer tests cover the entries and that `>` prefix removal returns to universal mode
- [x] 1.5 Rework `QuickOpenModal.vue` for sectioned categories, right-aligned shortcuts, unavailable command rows, and the no-result state (message + create action + "search in commands" switch), and verify component tests cover each rendered state including narrow-screen abbreviation of secondary text
- [x] 1.6 Implement the create-note action from the palette query (sanitize via `sanitizeTitleForFileName`, reuse the seeded new-note creation flow, open the note, cursor in body, default folder), and verify tests cover: no-match creation, creation available below existing matches, and that nothing is created without explicit validation
- [x] 1.7 Complete keyboard interaction: `Cmd+A` selects the query, backspace edits prefixes, `Esc` closes, and closing without acting restores the editor caret and selection exactly (selection snapshot at open); verify focus-restoration tests pass from the editor surface

## 2. P2 — Content search and deep navigation

- [x] 2.1 Integrate `indexApi.ftsSearch` behind a debounced query (~150-200ms), merge passage results progressively into the unified list (never moving the current selection), group passages per note (count + expandable, capped per note), and verify tests cover grouping, capping, and selection stability on late arrivals
- [x] 2.2 Implement passage opening: `openTabWithAutosave` then `revealSnippet` on the ready session, plus a transient single-range highlight port in the editor (cleared on first edit or timeout), and verify tests cover scroll-to-passage, temporary highlight, and that the document remains immediately editable
- [x] 2.3 Implement open targets: `Cmd+Enter` opens a note as a new tab in the active pane and `Alt+Enter` opens in the adjacent pane via existing pane targeting; verify tests cover the three targets (current, new tab, adjacent pane) and that the palette closes after opening
- [x] 2.4 Add secondary actions behind `Tab` on results (copy note link, add to favorites, open in new tab, open in adjacent pane, reveal file location), keeping `Enter` as the primary open, and verify tests cover the Tab menu rendering, action execution, and that the primary path is unchanged

## 3. P3 — Contextual fluidity

- [x] 3.1 Capture a context snapshot when the palette opens (active file, editor selection text, explorer selection, is-daily-note) and rank context suggestions first in the browse state per context (no document, active note, explorer selection, daily note), and verify tests cover each context's suggestion set and that non-contextual results remain reachable
- [x] 3.2 Implement selection actions surfaced from the editor-selection context (transform to heading/list, copy as Markdown, extract to a new note reusing the existing extract flow with the original passage preserved and a link inserted), and verify tests cover the extract end-to-end behavior and the preservation default
- [x] 3.3 Implement the `?` help mode (shortcut explanations and help entries filtered by query, opening existing docs/shortcuts surfaces), and verify tests cover mode filtering and its reversibility
- [x] 3.4 Add light personalization to the browse state (recently executed and frequently used commands, favorites), and verify tests cover predictable ordering: explicit query results always rank by relevance, habits only influence the empty-query state

## 4. Final verification

- [x] 4.1 Run the full frontend verification (`npx vue-tsc --noEmit`, `npx vitest run`, `npx vite build`) and walk the UX success-criteria table from the versioned source spec (`docs/design/13_command_palette.md`, section 16) manually in the dev app (find by partial title, find by phrase, find command by common wording, create from query, act on selection, multi-target opening, keyboard-only operation, cancel restores context, unavailable command understandable, useful no-result state)

## Workflow follow-up

- After all tasks are checked, run the OpenSpec archive workflow (`/openspec-archive-change`) to sync `command-palette` into the main specs
- Per repo AGENTS.md, do not edit `CHANGELOG.md`: releases are generated by `make release`
