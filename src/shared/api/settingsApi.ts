import { invoke } from '@tauri-apps/api/core'
import type {
  AppSettingsView,
  CodexDiscoveredModel,
  SaveAppSettingsPayload,
  WriteAppSettingsResult
} from './apiTypes'

/**
 * Frontend IPC wrappers for application settings and provider discovery.
 */

/** Reads redacted app settings from `~/.tomosona/conf.json`. */
export async function readAppSettings(): Promise<AppSettingsView> {
  return await invoke('read_app_settings')
}

/** Writes app settings and reports whether embedding identity changed. */
export async function writeAppSettings(payload: SaveAppSettingsPayload): Promise<WriteAppSettingsResult> {
  return await invoke('write_app_settings', { payload })
}

/** Discovers Codex models available through the configured provider bridge. */
export async function discoverCodexModels(): Promise<CodexDiscoveredModel[]> {
  return await invoke('discover_codex_models')
}
