import { invoke } from '@tauri-apps/api/core'
import type {
  AppSettingsView,
  CodexDiscoveredModel,
  DiscoverLlmModelsPayload,
  DiscoverEmbeddingModelsPayload,
  LlmDiscoveredModel,
  SaveAppSettingsPayload,
  WriteAppSettingsResult
} from './apiTypes'

/**
 * Frontend IPC wrappers for application settings and provider discovery.
 */

/** Reads the current app settings from `~/.tomosona/conf.json`. */
export async function readAppSettings(): Promise<AppSettingsView> {
  return await invoke('read_app_settings')
}

/** Embedding model discovery is no longer available. */
export async function discoverEmbeddingModels(_payload: DiscoverEmbeddingModelsPayload): Promise<LlmDiscoveredModel[]> { return [] }

/** Writes app settings. */
export async function writeAppSettings(payload: SaveAppSettingsPayload): Promise<WriteAppSettingsResult> {
  return await invoke('write_app_settings', { payload })
}

/** Discovers Codex models available through the configured provider bridge. */
export async function discoverCodexModels(): Promise<CodexDiscoveredModel[]> {
  return await invoke('discover_codex_models')
}

/** Discovers models available through an OpenAI-compatible LLM endpoint. */
export async function discoverLlmModels(payload: DiscoverLlmModelsPayload): Promise<LlmDiscoveredModel[]> {
  return await invoke('discover_llm_models', { payload })
}
