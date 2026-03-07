# Semantic Search + Cosmos Semantic Links

## Overview

This document describes the semantic indexing and retrieval layer used by search and Cosmos.

Goals:
- Keep lexical search behavior (FTS5 + BM25) intact.
- Add local semantic ranking with no external API calls.
- Add semantic links in Cosmos when vectors are available.
- Preserve graceful fallback to lexical-only behavior.

Pulse handoff:
- Cosmos can hand a selected node plus visible neighborhood to Pulse.
- Pulse in Cosmos is limited to meso-level transformation of that graph context.
- Cosmos remains an exploration surface, not a long-form authoring surface.

## Runtime Components

Backend runtime (`src-tauri`):
- `semantic.rs` provides embedding model lifecycle, vector helpers, and sqlite-vec integration.
- `lib.rs` integrates semantic indexing into `reindex_markdown_file` and `rebuild_workspace_index`.

Model note:
- The current `fastembed` crate version in this repo exposes `EmbeddingModel::BGEM3`.
- If a quantized enum variant becomes available in a later version, the model selection can be switched without changing indexing contracts.

Frontend runtime (`src`):
- Regular search still calls `fts_search`.
- Cosmos consumes graph edges of type `wikilink` and `semantic`.
- Cosmos sidebar exposes a semantic-edge visibility toggle.

## Data Model

SQLite tables:
- `chunks`: lexical chunk storage.
- `chunks_fts`: FTS5 index over chunk text.
- `embeddings`: chunk-level vectors (`chunk_id`, `model`, `dim`, `vector`).
- `note_embeddings`: note-level vectors (`path`, `model`, `dim`, `vector`, `updated_at_ms`).
- `note_embeddings_vec`: sqlite-vec virtual table for note KNN queries.

Vector encoding:
- vectors are stored as little-endian `f32` BLOBs in persistent tables.
- vectors are normalized before persistence.

## Indexing Flow

On save/reindex:
1. Chunk markdown and write lexical tables (`chunks`, `note_links`, `note_properties`).
2. Generate chunk embeddings (best effort).
3. Upsert chunk vectors into `embeddings`.
4. Compute note centroid from chunk vectors.
5. Upsert note vector into `note_embeddings` and `note_embeddings_vec`.

On rebuild:
1. Clear lexical/vector tables.
2. Reindex every markdown file.

Failure behavior:
- embedding/model/vector extension errors do not abort indexing.
- lexical indexing always remains available.

## Search Ranking

`fts_search` performs hybrid ranking:
1. Retrieve lexical candidates with BM25 (`top 200`).
2. Embed query text (best effort).
3. Compute semantic similarity for candidate chunks with stored vectors.
4. Min-max normalize lexical and semantic scores.
5. Blend into hybrid score:
   - lexical weight: `0.35`
   - semantic weight: `0.65`
6. Return top `25` results.

Fallback:
- if query embeddings or chunk vectors are unavailable, ranking falls back to lexical score.

## Cosmos Semantic Links

Graph edges:
- `wikilink`: explicit user-authored links.
- `semantic`: inferred nearest-neighbor note links.

Generation:
1. For each note, query sqlite-vec nearest neighbors.
2. Keep at most `3` semantic neighbors per note.
3. Apply similarity threshold `0.62`.
4. Skip self-edges and dedupe duplicates.
5. Keep wikilink edges as-is and append semantic edges.

UI behavior:
- semantic links are visible by default.
- user can hide them via sidebar toggle.
- semantic links use distinct visual styling in Cosmos.

## sqlite-vec Runtime

`sqlite-vec` is integrated as a Rust crate dependency and registered with SQLite
via `sqlite3_auto_extension` during backend startup.

Operational implications:
- no manual `.dylib/.so/.dll` placement is required for local development,
- no environment variable is required to locate extension files.

If registration fails at runtime, semantic features are disabled and lexical features continue.
