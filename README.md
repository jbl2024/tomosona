# Tomosona

<p align="center">
  <img src="./public/meditor.svg" alt="Logo Tomosona" width="140" />
</p>

<p align="center">
  A local-first second brain for writing, linking, exploring, and transforming your Markdown notes.
</p>

## Overview

Tomosona is a desktop application built with `Tauri 2`, `Rust`, and `Vue 3`.
It works directly on a workspace of Markdown files stored on your machine.

The idea is straightforward:

- your notes stay as plain `.md` files that remain readable outside the app;
- the app adds a local index under `.tomosona/` to power search, backlinks, and graph features;
- AI features are optional and plug into your local configuration;
- no cloud layer is required to organize, retrieve, and connect your notes.

## Product Principles

### 1. Local-first

Tomosona does not replace your files with a proprietary format. A workspace remains a normal folder you can use with other tools.

### 2. Markdown as the source of truth

Notes are stored as `.md` files, with frontmatter support for properties. UI metadata stays separate from note content wherever possible.

### 3. Navigation through links and context

The app is not limited to a file tree. It combines an explorer, wikilinks, backlinks, the Cosmos graph, hybrid search, and contextual suggestions.

### 4. AI in service of the workspace

`Second Brain` and `Pulse` use your notes as explicit context. They are meant to support writing and analysis, not replace your knowledge base.

## Core Features

### Workspace and app shell

- open a local workspace folder and keep a list of recent workspaces;
- a home launchpad to resume a workspace, open recent notes, and trigger common actions;
- a workspace setup wizard with starter structures for knowledge bases, journals, and project-oriented workspaces;
- navigation history, command palette, quick open, and built-in keyboard shortcuts;
- a multi-pane layout for opening multiple notes, Cosmos, and Second Brain side by side.

### Markdown editor

- a rich editor built on Tiptap while preserving a Markdown-first workflow;
- `[[...]]` wikilinks with autocomplete;
- slash commands `/`;
- drag handles and block menus;
- tables with width and alignment support;
- checklists, quotes, callouts, HTML blocks, and Mermaid;
- inline find inside the document;
- support for large documents and persistent per-note editing sessions.

### Note organization

- a Markdown file explorer;
- create, rename, duplicate, move, delete, and reveal entries in the system file manager;
- daily notes with fast access;
- guided wikilink rewrite flows on rename;
- heading overview and document navigation;
- a right panel for backlinks, semantic links, properties, and Echoes.

### Properties and structure

- frontmatter property editing;
- a per-workspace property type schema stored in `.tomosona/property-types.json`;
- a metadata experience designed to stay portable and Markdown/Obsidian-friendly;
- structured property editing without locking content into a custom file format.

### Search and indexing

- a local SQLite index in `.tomosona/tomosona.sqlite`;
- lexical full-text search;
- local semantic search with hybrid lexical + semantic reranking;
- index rebuild flows and indexing status in the UI;
- reindexing on save and graph refresh integration.

### Cosmos

- an interactive graph view of notes and their relationships;
- explicit links from wikilinks;
- inferred semantic links when embeddings are available;
- search, focus, recentering, and neighborhood exploration;
- open a note from the graph or send graph context into Pulse / Second Brain.

### Echoes

- contextual note suggestions to surface relevant related material;
- built from backlinks, semantic neighbors, recency, and structural signals;
- available in the editor and in Second Brain to enrich context without manual searching.

### Second Brain

- a dedicated chat surface for the workspace;
- persistent sessions;
- explicit context injection via `@relative/path.md`;
- streamed responses;
- open referenced notes in another pane when appropriate;
- local LLM provider configuration in `~/.tomosona/conf.json`.

Currently supported providers:

- OpenAI
- OpenAI Codex
- OpenAI-compatible
- Groq
- Anthropic

### Pulse

- an AI transformation layer for reworking text or explicit note context;
- available from the editor, Second Brain, and Cosmos;
- actions such as `rewrite`, `condense`, `expand`, `outline`, `brief`, `extract_themes`, and `identify_tensions`;
- preview-first output before applying changes;
- flows to replace a selection, insert output, or hand off to Second Brain.

### Theming and ergonomics

- light, dark, and system themes;
- a top bar and dedicated shortcuts modal;
- native-feeling desktop shell behavior through Tauri;
- macOS-aware titlebar and shortcut handling.

## Architecture

```text
src/         Vue 3 frontend
src-tauri/   Tauri + Rust backend
public/      public assets
docs/        product and design documentation
```

Main technologies:

- `Vue 3`
- `Vite`
- `Tauri 2`
- `Rust`
- `SQLite`
- `Tiptap`
- `Mermaid`

## Requirements

- `Node.js` 20+ (`22+` recommended)
- `npm`
- stable `Rust` toolchain
- Tauri system prerequisites for your OS

Examples:

- macOS : Xcode Command Line Tools
- Linux : WebKitGTK and related Tauri dependencies

## Running in Development

### Install

```bash
npm install
```

### Frontend only

Useful when you only want to work on the Vue UI:

```bash
npm run dev
```

### Full desktop app with Tauri

This is the recommended command for developing the complete application:

```bash
npm run tauri:dev
```

This starts:

- the Vite dev server;
- the Tauri desktop window;
- the Rust backend;
- the Tauri IPC layer used by the shell, indexing, search, and AI features.

### Note-open debug mode

When investigating occasional freezes while opening a note, start the desktop app with backend note-open tracing enabled:

```bash
make tauri-dev-open-debug
```

This sets `TOMOSONA_DEBUG_OPEN=1` for the Tauri/Rust process and keeps the normal dev workflow.

To enable the matching frontend trace logs in the app window, open devtools and run:

```js
localStorage.setItem('tomosona.debug.open', '1')
```

Then reload the app window with `Cmd+R`.

What you get:

- frontend `[open-trace]` logs in devtools for the click-to-editor path;
- recent frontend trace entries in `window.__tomosonaOpenDebug.recent`;
- backend `[fs-perf]` logs for `read_text_file` and `list_children` in the terminal running Tauri.

## Build and Verification

Frontend build:

```bash
npm run build
```

Frontend tests:

```bash
npm run test
```

Desktop build:

```bash
npm run tauri:build
```

### Running the macOS app bundle

If you download the packaged app on macOS, Gatekeeper may block it because the app is not notarized yet.
Clear the quarantine attributes before launching it:

```bash
xattr -cr /Applications/tomosona.app
```

Recommended backend verification:

```bash
cd src-tauri
cargo check
```

## AI Configuration

Application settings are stored in:

- macOS / Linux : `~/.tomosona/conf.json`
- Windows : `%USERPROFILE%\\.tomosona\\conf.json`

The file contains two main sections:

- `llm` for `Second Brain` and `Pulse`
- `embeddings` for semantic search

Useful notes:

- API keys should never be committed;
- the `openai-codex` provider relies on local Codex CLI authentication;
- embeddings can stay in internal mode or use an external OpenAI-compatible provider depending on the settings configuration.

## Local Data

Within each workspace, Tomosona may create or maintain:

- `.tomosona/tomosona.sqlite` for the local index;
- `.tomosona/property-types.json` for the property schema;
- `.tomosona/second-brain/` for certain session artifacts and drafts;
- `.tomosona-trash/` for some delete/move workflows.

Your notes themselves remain standard `.md` files in your normal workspace tree.

## Project Status

The project is evolving quickly. Recent notable additions include:

- the launchpad and workspace setup wizard;
- Echoes contextual suggestions;
- Pulse and its transformation workflows;
- Codex model discovery in settings;
- inline find in the editor;
- the multi-pane shell and tighter Cosmos / Second Brain integration.
