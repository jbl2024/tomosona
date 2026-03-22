# Design Document

Properties System (Obsidian-Compatible Frontmatter)
Local-First Knowledge Environment
(Tauri 2 + Vue 3)

## 1. Purpose

This document defines the properties system used by tomosona.

Goals:

- Keep note metadata fully compatible with Obsidian frontmatter.
- Make metadata editing easy in UI without forcing users into raw YAML.
- Preserve portability and readability of Markdown files.
- Persist UI typing preferences per workspace without polluting notes.

Non-goals:

- Introducing proprietary metadata blocks in note files.
- Replacing YAML frontmatter with a custom storage format.

## 2. Core Principles

### YAML is canonical

Frontmatter at the top of the markdown file is the source of truth for metadata.

### UI typing is local state

Property types used by UI controls are stored separately in a workspace-local schema, not in markdown files.

### Round-trip safety

The editor must preserve property keys and values through open/edit/save cycles, including unknown or custom keys.

### Local-first behavior

All metadata and schema operations run locally through Tauri commands and filesystem APIs.

## 3. File and Data Model

### 3.1 Markdown document layout

A note may contain:

1. Optional YAML frontmatter block at top
2. Markdown body content

Frontmatter delimiters:

- opening: `---` at file start
- closing: `---` line after YAML

### 3.2 Frontmatter runtime model (frontend)

Frontend parses frontmatter into a normalized model with:

- `fields`: list of key/value entries
- `type`: UI type (`text`, `list`, `number`, `checkbox`, `date`, `tags`)
- `styleHint`: serialization preference (`inline-list`, `block-list`, `literal-block`, `plain`)
- `parseErrors`: validation and syntax errors
- `body`: markdown content without frontmatter

### 3.3 Property type schema (workspace-local)

Per-workspace file:

- `<workspace>/.tomosona/property-types.json`

Stores sparse mapping:

- `normalized_property_name -> type`

Example:

```json
{
  "deadline": "date",
  "priority": "number",
  "tags": "tags"
}
```

This file stores typing preferences only. It does not store property values.

## 4. Type Resolution

When opening a note, each property type is resolved in this order:

1. Workspace schema mapping (`property-types.json`)
2. Reserved defaults
3. Value inference

Reserved defaults:

- `tags -> tags`
- `aliases -> list`
- `cssclasses -> list`

Inference:

- boolean -> `checkbox`
- number -> `number`
- array -> `list`
- `YYYY-MM-DD` -> `date`
- fallback -> `text`

## 5. UI Modes

### 5.1 Structured mode

Default mode with row-based property editor:

- key input
- type selector
- type-aware value input
- add/remove row

Reserved keys (`tags`, `aliases`, `cssclasses`) are type-locked in UI.

The quick-add menu stays intentionally small and second-brain-oriented:

- `tags`
- `aliases`
- `date`
- `deadline`
- `status`
- `category`
- `created`
- `updated`
- `priority`
- `version`

### 5.2 Raw YAML mode

Advanced mode with direct YAML editing.

Behavior:

- uses monospace textarea
- validates parse state
- displays line-based errors
- structured mode is disabled when parse errors exist

## 6. Load/Save Flow

### On open

1. Load property schema from workspace `.tomosona`.
2. Split markdown into frontmatter + body.
3. Parse frontmatter into fields and parse errors.
4. Resolve property UI types.
5. Render body in Editor.js.
6. Render properties panel state.

### On save

1. Serialize Editor.js blocks to markdown body.
2. Serialize frontmatter fields (or raw YAML in raw mode).
3. Compose final markdown as frontmatter + body.
4. Write file through Tauri.
5. Reindex markdown file.

## 7. Validation and Error Handling

Structured validation currently enforces:

- duplicate keys are errors
- invalid date strings for `date` fields are errors

Empty newly-added rows are treated as draft rows:

- not serialized into YAML until key is present
- do not force immediate error state

YAML parse failures switch editing focus to raw mode and show diagnostics.

## 8. Schema Persistence Rules

Schema is intentionally sparse.

Current writes occur when:

- user changes a property type
- user renames/edits a property key

Schema is not eagerly populated for all inferred/default properties on open.

Rationale:

- keep schema file small
- avoid hard-locking inferred types unnecessarily
- store explicit user intent

## 9. Backend Integration

Tauri commands:

- `read_property_type_schema(folder_path)`
- `write_property_type_schema(folder_path, schema)`

Path and safety rules:

- schema path is always under `<workspace>/.tomosona`
- `.tomosona` directory is created as needed
- only supported types are accepted on write
- invalid schema JSON is rejected with safe error

Indexing behavior:

- frontmatter is stripped before chunking and target parsing
- prevents metadata noise in search and wikilink/date extraction

## 10. Obsidian Compatibility Notes

Supported metadata shapes include:

- text
- number
- boolean
- date
- list (inline and multiline)
- wikilink strings (for example `"[[Bob]]"`)
- multiline literals (`|`)

Compatibility constraints:

- frontmatter remains plain YAML
- no proprietary metadata is injected into note files
- custom keys are allowed

## 11. Known Limitations

- YAML parser is intentionally narrow and not a full YAML implementation.
- Full fidelity for all YAML edge cases is not guaranteed.
- Nested object properties are not supported in structured mode.
- Raw mode is the fallback for advanced YAML constructs.

## 12. Future Improvements

1. Replace lightweight parser with a robust YAML parser while preserving round-trip behavior.
2. Add explicit property ordering drag-and-drop.
3. Add property templates and quick-add presets.
4. Improve multiline and style-preservation fidelity.
5. Add dedicated unit tests for frontmatter parser/serializer and schema behavior.

## 13. Summary

The properties system keeps markdown frontmatter portable and Obsidian-compatible while providing a practical typed editing experience. UI types are persisted per workspace in `.tomosona/property-types.json`, allowing consistent UX without contaminating note files.
