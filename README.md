# Tomosona

<p align="center">
  <a href="https://github.com/jbl2024/tomosona/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/jbl2024/tomosona/ci.yml?branch=main" alt="CI status" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/github/license/jbl2024/tomosona" alt="License" />
  </a>
  <a href="https://github.com/jbl2024/tomosona/releases">
    <img src="https://img.shields.io/github/v/release/jbl2024/tomosona" alt="Latest release" />
  </a>
</p>

<p align="center">
  <img src="./public/meditor.svg" alt="Logo Tomosona" width="140" />
</p>

<p align="center">
  A local-first Markdown workspace for writing, linking, and organizing your notes.
</p>

## Overview

Tomosona is a desktop application built with `Tauri 2`, `Rust`, and `Vue 3`.
It works directly on a workspace of Markdown files stored on your machine.

The idea is straightforward:

- your notes stay as plain `.md` files that remain readable outside the app;
- the app adds a local index under `.tomosona/` to power search and backlinks;
- no cloud layer is required to organize, retrieve, and connect your notes.

## Product Principles

### 1. Local-first

Tomosona does not replace your files with a proprietary format. A workspace remains a normal folder you can use with other tools.

### 2. Markdown as the source of truth

Notes are stored as `.md` files, with frontmatter support for properties. UI metadata stays separate from note content wherever possible.

### 3. Navigation through links and context

The app is not limited to a file tree. It combines an explorer, wikilinks, backlinks, and search.

## Core Features

### Workspace and app shell

- open a local workspace folder and keep a list of recent workspaces;
- a home launchpad to resume a workspace, open recent notes, and trigger common actions;
- a workspace setup wizard with starter structures for knowledge bases, journals, and project-oriented workspaces;
- a new note modal with a workspace template picker sourced from `_templates/`;
- navigation history, command palette, quick open, and built-in keyboard shortcuts;
- a multi-pane layout for opening multiple notes side by side.

### Markdown editor

- a rich editor built on Tiptap while preserving a Markdown-first workflow;
- `[[...]]` wikilinks with autocomplete;
- slash commands `/`;
- inline `@` macros for inserting the current date, time, note title, or note path;
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
- local per-note history with a right-pane snapshot browser and restore flow;
- heading overview and document navigation;
- a right panel for backlinks, properties, history, and document navigation.

### Convert to Word

- convert any Markdown file from the explorer context menu into a `.docx` file;
- the export is written next to the source note, using the same stem name;
- if a file with that name already exists, Tomosona adds a numeric suffix such as `note (1).docx`;
- if the workspace contains a `_templates/` folder, the first `.docx` in that folder is used as the Word template;
- files are picked by filename order, so `a.docx` is chosen before `b.docx`;
- if no valid template is available, Tomosona falls back to its built-in Word styling.

### Properties and structure

- frontmatter property editing;
- a per-workspace property type schema stored in `.tomosona/property-types.json`;
- a metadata experience designed to stay portable and Markdown/Obsidian-friendly;
- structured property editing without locking content into a custom file format.

### Search and indexing

- a local SQLite index in `.tomosona/tomosona.sqlite`;
- lexical full-text search;
- index rebuild flows and indexing status in the UI;
- reindexing on save and graph refresh integration.

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
- the Tauri IPC layer used by the shell, indexing, and search;

### Note-open debug mode

When investigating occasional freezes while opening a note, start the desktop app with backend note-open tracing enabled:

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

## Local Data

Within each workspace, Tomosona may create or maintain:

- `.tomosona/tomosona.sqlite` for the local index;
- `.tomosona/property-types.json` for the property schema;
- `.tomosona-trash/` for some delete/move workflows.

Your notes themselves remain standard `.md` files in your normal workspace tree.

## Project Status

The project is evolving quickly. Recent notable additions include:

- the launchpad and workspace setup wizard;
- inline find in the editor;
- the multi-pane shell.
