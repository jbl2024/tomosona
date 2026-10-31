# Proposal

## Why

The palette today is two separate lists behind one modal: a filename substring filter (no titles, no fuzzy matching, no content search, no creation) and a `>`-prefixed command list (no aliases, no descriptions, no availability state). The user must already know where a feature lives to reach it. The goal is a universal entry point: describe what you want — a note, a phrase inside a note, a command, a new note — and the palette surfaces it, fully keyboard-driven, context-aware, and discreet.

## What Changes

- **Universal search**: one query matches note titles (case/accent-insensitive, partial words, multi-word in any order, typo-tolerant), note content (via the existing FTS index), and command names/aliases — with explicit categories and a documented ranking (title exact > title start > title partial > content > command).
- **Initial state**: recent notes (with folder for disambiguation), favorites without duplicates, quick actions, first result preselected; deliberately short.
- **Content results**: snippets with section context, grouped per note (expandable passages), opening jumps straight to the passage with a temporary highlight.
- **Commands**: findable from several common formulations, with a short description, a right-aligned shortcut when one exists, and an explicit unavailable state (visible when explicitly matched, never executable, reason shown).
- **Create from the palette**: a `Create "<query>"` action when nothing matches (also available when matches exist, never prioritized over them); creation reuses the seeded-title new-note flow, opens the note, and places the cursor in the body.
- **Modes and entries**: prefixes `>` (commands), `#` (content), `?` (help) are optional and reversible; `Cmd+K` (universal), `Cmd+P` (notes only), `Cmd+Shift+P` (commands only) open the same palette with a different initial filter.
- **Context awareness**: suggestions adapt to the current context — no document open, active note, editor text selection (extract to note, transforms), explorer file selection, daily note — surfacing relevant actions without hiding the rest.
- **Keyboard-complete**: arrows/Enter/Esc, `Cmd+Enter` new tab, `Alt+Enter` adjacent pane, `Tab` secondary actions on a result, full focus restoration on cancel; a selection acted on from the palette uses the initial editor selection.
- **Edge states**: explicit no-result state (message + create + filter switch), confirmation only for destructive actions, progressive results that never move the selection unexpectedly, empty field on reopen, narrow-screen degradation.

## Capabilities

### New Capabilities
- `command-palette`: the universal palette's behavior contract — initial state, note/title/content/command search and ranking, creation, modes and shortcuts, context-aware suggestions, keyboard interaction, secondary actions, and edge states.

### Modified Capabilities

(None. `page-protection` and `note-title-heading` are unrelated.)

## Impact

- Palette state and matching: `useAppQuickOpen` (result model, ranking, modes), `QuickOpenModal.vue` (sectioned categories, secondary keybindings), keyboard plumbing in `useAppShellModalInteractions` / App.vue.
- Command catalog: `useAppShellPaletteActions` (keywords/aliases, descriptions, availability, shortcut labels).
- Shortcuts: `useAppShellKeyboard` — `Cmd+P` becomes the notes filter (today both `Cmd+K` and `Cmd+P` open `>` command mode), `Cmd+Shift+P` keeps commands; `Cmd+K` stays the universal entry.
- Content search: `indexApi.ftsSearch` (path + snippet + score already returned) with debounced progressive results; passage reveal via `useEditorNavigation.revealSnippet` plus a temporary highlight.
- Open targets: current tab, new tab (`Cmd+Enter`), adjacent pane (`Alt+Enter`) through the existing `openTabWithAutosave` pane-targeting options and multi-pane layout.
- Context ports: active file, editor selection snapshot, explorer selection, favorites/recent data; extract-to-note reuses the existing extracted-note flow.
- Implementation is phased by the source spec's priorities (P1 fundamentals, P2 deep search/navigation, P3 contextual fluidity) — the full source spec is versioned at `docs/design/13_command_palette.md`; see tasks.md.
