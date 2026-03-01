# tomosona

tomosona is a local-first desktop Markdown workspace built with Tauri 2, Vue 3, and Rust.

At a high level, it provides:
- Local folder-based notes and files
- Markdown editing and navigation
- Full-text search across your workspace
- Daily-note and wiki-link workflows
- Cross-platform desktop packaging through Tauri

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
- `%USERPROFILE%\\.tomosona\\conf.json` (Windows)

Schema:

- `active_profile`: id of the profile to use.
- `profiles[]`: one or more provider profiles.

Each profile supports:

- `id`, `label`
- `provider` (for example: `openai`, `openai_compatible`, `groq`, `anthropic`)
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
