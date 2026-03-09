# Backend Index Architecture

## Ownership

- `lib.rs`
  - Tauri command surface
  - shared error/result types
  - shared runtime state and logging
- `workspace_runtime.rs`
  - active workspace
  - workspace-local DB opening
  - internal workspace file paths
- `workspace_paths.rs`
  - path normalization
  - hidden-path rules
  - note key helpers
  - wikilink rewrite helpers
- `markdown_index.rs`
  - markdown parsing
  - frontmatter/property extraction
  - lexical and semantic note-level reindex
- `index_schema.rs`
  - schema creation/reset
  - rebuild workflow
  - runtime cancel/log/status
- `wikilink_graph.rs`
  - graph payloads
  - backlinks
  - rename-driven wikilink updates
- `search_index.rs`
  - search query parsing
  - property filters
  - lexical/semantic/hybrid scoring

## Rules

- Keep modules concrete and free-function based.
- Do not introduce service containers or traits unless a real constraint appears.
- Keep path rules centralized in `workspace_paths.rs`.
- Keep schema/reset rules centralized in `index_schema.rs`.
- Keep `lib.rs` as assembly, not as the primary place where business logic lives.
