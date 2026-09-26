# Design Document

Editor.js as a Structured Markdown Editor
Local-First Knowledge Environment
(Tauri 2 + Vue 3)

## 1. Vision

This project is a local-first professional knowledge environment.

It stores files as Markdown on disk.
It uses a block-based internal editing model.
It rewrites Markdown files in a normalized, deterministic format.

The editor is the primary interface.
Markdown files remain readable and portable.

The goal is long-term stability, clarity, and reliability.

## 2. Core Principles

### Local-first

- Files are stored on disk.
- No cloud dependency.
- User owns their data.
- Git-compatible.

### Block-native editing

- Editor.js block model is the runtime representation.
- Advanced features operate on blocks, not raw text.

### Normalized Markdown

- Files are fully rewritten on save.
- Formatting consistency > preserving original layout.
- Markdown is deterministic and stable.

### Separation of concerns

Frontend:

- Editing
- Block model
- Conversion
- UX

Backend:

- File IO
- Indexing
- Search
- Embeddings
- Watcher

Backend never depends on Editor.js JSON.

## 3. Document Representations

Each document exists in three layers:

1. Markdown on disk (persistent storage)
2. Parsed Markdown AST (transient)
3. Editor.js block model (active editing state)

The block model is the primary working structure.

On save:

Blocks -> Markdown -> Disk -> Index update

## 4. Markdown Normalization Strategy

Files are normalized on every save.

Normalization rules:

- ATX headings only (#)
- One blank line between blocks
- Fenced code blocks only
- Stable indentation rules
- Ordered lists normalized
- Trailing whitespace removed
- Consistent line endings
- Deterministic serialization

Opening and saving a file may reformat it once.
Subsequent saves remain stable.

## 5. Supported Block Types (v1)

- Heading (levels 1-6)
- Paragraph
- Ordered list
- Unordered list
- Code block
- Quote
- Horizontal rule
- Raw block fallback

Future:

- Table
- Task list
- Callouts
- Wiki links
- Block references

## 6. Conversion Pipeline

### On open

1. Read Markdown from disk
2. Parse with markdown parser
3. Convert AST -> Editor.js blocks
4. Render blocks

### On save

1. Extract blocks
2. Serialize blocks -> Markdown AST
3. Serialize AST -> normalized Markdown
4. Write file
5. Trigger reindex

Full rewrite is intentional.

## 7. Indexing Model

After each save:

- Markdown is parsed
- Document is chunked (by heading/section)
- SQLite FTS5 updated (BM25)
- Metadata stored in local database

Search operates on normalized Markdown.

This guarantees consistent results.

## 8. File Ownership Philosophy

Markdown files remain on disk to ensure:

- Transparency
- Long-term readability
- Git compatibility
- Backup simplicity
- No lock-in

The local database stores only:

- Index
- Embeddings
- Metadata

It is disposable and rebuildable.

## 9. Autosave Strategy

- Manual save (Cmd/Ctrl+S)
- Optional idle autosave (2-3 seconds)
- No per-keystroke disk write

Save triggers indexing asynchronously.

## 10. Performance Constraints

Target:

- Instant open for typical files
- No visible lag
- Index update non-blocking
- No full reparse unless needed

## 11. Professional Stability Requirements

- Deterministic serialization
- No silent data loss
- No exotic markdown rewriting
- No experimental block types in v1
- Clean error handling
- Clear conflict handling on external file change

This is a work tool, not a playground.

## Strategic Validation

This architecture gives you:

- Structured editing
- Clean Markdown
- Fast search
- Block-level extensibility
- No cloud dependency
- No data lock-in
- Stable long-term daily use

And most importantly:

You are not building a toy.
You are building a tool you can rely on.
