# Backend Index Architecture

## Ownership

| Module | Owns | Exists To |
| --- | --- | --- |
| `lib.rs` | Tauri command surface, shared error/result types, shared runtime state and logging | keep the IPC assembly point small and avoid burying feature logic in the entrypoint |
| `workspace_runtime.rs` | active workspace, workspace-local DB opening, internal workspace file paths | keep workspace lifecycle separate from index/query logic |
| `workspace_paths.rs` | path normalization, hidden-path rules, note key helpers, wikilink rewrite helpers | centralize path safety rules so every backend command uses the same boundary checks |
| `markdown_index.rs` | markdown parsing, frontmatter/property extraction, lexical note-level reindex | isolate note-level parsing and indexing from workspace orchestration |
| `index_schema.rs` | schema creation/reset, rebuild workflow, runtime cancel/log/status | keep index lifecycle and status management in one place |
| `wikilink_graph.rs` | graph payloads, backlinks, rename-driven wikilink updates | own graph-facing projections without leaking rename or search concerns upward |
| `search_index.rs` | search query parsing, property filters, lexical scoring | keep query evaluation separate from persistence and graph updates |

## Rules

- Keep modules concrete and free-function based.
- Do not introduce service containers or traits unless a real constraint appears.
- Keep path rules centralized in `workspace_paths.rs`.
- Keep schema/reset rules centralized in `index_schema.rs`.
- Keep `lib.rs` as assembly, not as the primary place where business logic lives.
