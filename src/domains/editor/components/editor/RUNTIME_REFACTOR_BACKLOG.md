# Editor Runtime Refactor Backlog

This file tracks the remaining KISS-oriented cleanup items for editor runtimes.
It is intentionally short and decision-oriented: each item states why it still
matters, what it would improve, and how urgent it is.

## Status

The editor refactor is structurally complete:
- `EditorView.vue` is now a shell
- document / interaction / chrome responsibilities are split
- runtime contracts are grouped
- the biggest lifecycle bug on chrome listeners is fixed

What remains is mostly surface cleanup, not architecture rescue.

## `useEditorChromeRuntime`

### 1. Trim `EditorView.vue` aliases and local pass-throughs if they stop earning their keep
- Why: the grouped API reduced noise, but `EditorView.vue` still carries a few compatibility-oriented local bindings.
- Impact: small readability gain; avoids the shell slowly drifting back toward glue code.
- Priority: `low`

## `useEditorInteractionRuntime`

### 1. Remove the static `SLASH_COMMANDS` computed wrapper
- Why: wrapping a static constant in `computed()` creates fake reactivity and extra mental overhead.
- Impact: tiny implementation simplification, slightly clearer intent for future readers.
- Priority: `low`

### 2. Group wikilink overlay state in the public return
- Why: `wikilinkOpen`, `wikilinkIndex`, `wikilinkLeft`, `wikilinkTop`, and `wikilinkResults` describe one UI surface but are still exposed separately.
- Impact: cleaner runtime API, less destructuring noise in consumers, easier future extraction if wikilink UI grows.
- Priority: `low`

## `useEditorDocumentRuntime`

### 1. Remove or fully justify `void documentPersistence`
- Why: it is a transitional trick to preserve a named internal grouping without consuming it.
- Impact: avoids a surprising pattern that looks like dead code or a hidden contract.
- Priority: `low`

### 2. Group frontmatter/property outputs under a single public object
- Why: the runtime return still flattens many values directly from `useFrontmatterProperties`.
- Impact: better API readability, less destructuring in `EditorView.vue`, clearer ownership of metadata editing concerns.
- Priority: `low`

## Prioritization rule

When revisiting this backlog, use this order:
1. Fix any real bug or lifecycle issue first.
2. Prefer API grouping over extraction.
3. Extract only when a grouped API still hides an independently changing subsystem.
