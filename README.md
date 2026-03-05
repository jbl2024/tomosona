# Tomosona

**Your local-first second brain — where your notes connect.**

Tomosona is a powerful Markdown workspace built for personal knowledge management. Whether you're building a second brain, keeping a daily journal, or organizing project notes, Tomosona helps your ideas flow and connect.

---

## What can you do with Tomosona?

### Build a connected knowledge network
Link your notes together with `[[wikilinks]]` — just type `[[` to autocomplete. See every connection in the **Cosmos graph view**, an interactive visualization of your notes and how they relate. Hover, click, and zoom to explore your knowledge from new angles.

### Open today's note instantly
Press `Cmd/Ctrl + D` and you're there. Daily notes are created only when you write — no empty files cluttering your folder. Navigate between dates effortlessly, building a chronological journal that grows with you.

### Write without friction
A powerful block-based editor with slash commands (`/`), drag handles, and rich formatting. Code blocks, tables, checklists, Mermaid diagrams, callouts — it's all there. Optimized for large documents too, handling 40K+ characters smoothly.

### Search everywhere, find anything
Full-text search across your entire workspace. Or switch to **semantic search** and let AI find notes that are conceptually related, even if they don't share the same words. Combine both with hybrid search for the best results.

### Let AI help you think
Chat with AI about your notes in the **Second Brain** panel. Select relevant notes and ask questions — Tomosona feeds them to your LLM as context. Supports OpenAI, OpenAI Codex, Anthropic Claude, Groq, or local models via Ollama. Streamed responses appear in real-time, and you can save conversations or insert AI output as new notes.

### Your data stays yours
Plain `.md` files on your disk. No cloud, no account required. SQLite indexes your notes for fast search and graph building, but everything lives locally. Your second brain, your machine, your rules.

---

## Requirements

- Node.js 20+ (22+ recommended)
- npm
- Rust stable toolchain
- Tauri system prerequisites for your OS
  - macOS: Xcode Command Line Tools
  - Linux: WebKitGTK and related Tauri dependencies

## Install

```bash
npm install
```

## Run

Frontend only (web dev server):
```bash
npm run dev
```

Desktop app (Tauri dev):
```bash
npm run tauri:dev
```

## Build

Frontend production bundle:
```bash
npm run build
```

Desktop app bundle/installers:
```bash
npm run tauri:build
```

## Second Brain config (`.tomosona/conf.json`)

Second Brain reads its LLM settings from a global user file:

- `~/.tomosona/conf.json` (macOS/Linux)
- `%USERPROFILE%\.tomosona\conf.json` (Windows)

Schema:

- `active_profile`: id of the profile to use.
- `profiles[]`: one or more provider profiles.

Each profile supports:

- `id`, `label`
- `provider` (for example: `openai`, `openai-codex`, `openai_compatible`, `groq`, `anthropic`)
- `model`
- `api_key`
- optional `base_url` (for local/OpenAI-compatible endpoints)
- `capabilities` (`text`, `image_input`, `audio_input`, `tool_calling`, `streaming`)
- optional `default_mode` (for example: `freestyle`)

### Example: OpenAI (remote)

```json
{
  "active_profile": "openai-remote",
  "profiles": [
    {
      "id": "openai-remote",
      "label": "OpenAI Remote",
      "provider": "openai",
      "api_key": "replace-me",
      "model": "gpt-4.1",
      "capabilities": {
        "text": true,
        "image_input": true,
        "audio_input": false,
        "tool_calling": true,
        "streaming": true
      },
      "default_mode": "freestyle"
    }
  ]
}
```

### Example: OpenAI-compatible local server

```json
{
  "active_profile": "openai-local",
  "profiles": [
    {
      "id": "openai-local",
      "label": "OpenAI Local",
      "provider": "openai_compatible",
      "base_url": "http://localhost:11434/v1",
      "api_key": "replace-me",
      "model": "gpt-oss-20b",
      "capabilities": {
        "text": true,
        "image_input": false,
        "audio_input": false,
        "tool_calling": true,
        "streaming": true
      },
      "default_mode": "freestyle"
    }
  ]
}
```

### Example: OpenAI Codex (OAuth via Codex CLI)

```json
{
  "active_profile": "openai-codex-profile",
  "profiles": [
    {
      "id": "openai-codex-profile",
      "label": "OpenAI Codex",
      "provider": "openai-codex",
      "model": "gpt-5.2-codex",
      "api_key": "",
      "capabilities": {
        "text": true,
        "image_input": false,
        "audio_input": false,
        "tool_calling": true,
        "streaming": true
      },
      "default_mode": "freestyle"
    }
  ]
}
```

Codex prerequisites:
- Authenticate Codex CLI first: `codex auth login`
- Ensure `~/.codex/auth.json` exists and has valid tokens
- `api_key` is not used by `openai-codex` in V1

### Example: Groq

```json
{
  "active_profile": "groq-prod",
  "profiles": [
    {
      "id": "groq-prod",
      "label": "Groq",
      "provider": "groq",
      "api_key": "replace-me",
      "model": "llama-3.3-70b-versatile",
      "capabilities": {
        "text": true,
        "image_input": false,
        "audio_input": false,
        "tool_calling": true,
        "streaming": true
      },
      "default_mode": "freestyle"
    }
  ]
}
```

### Example: Anthropic Claude

```json
{
  "active_profile": "claude-prod",
  "profiles": [
    {
      "id": "claude-prod",
      "label": "Claude",
      "provider": "anthropic",
      "api_key": "replace-me",
      "model": "claude-3-7-sonnet-latest",
      "capabilities": {
        "text": true,
        "image_input": true,
        "audio_input": false,
        "tool_calling": true,
        "streaming": true
      },
      "default_mode": "freestyle"
    }
  ]
}
```

Note:

- Keep your real API keys out of version control.
- JSON does not allow comments; use this README for field documentation.
