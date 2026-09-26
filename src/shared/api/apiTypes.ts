/**
 * Shared frontend IPC types used by the Tauri command wrappers.
 *
 * This file contains types only. Domain-specific invoke/listen wrappers live
 * in dedicated modules so consumers can depend on smaller contracts.
 */

export type TreeNode = {
  name: string
  path: string
  is_dir: boolean
  is_markdown: boolean
  has_children: boolean
}

export type ConflictStrategy = 'fail' | 'rename' | 'overwrite'
export type EntryKind = 'file' | 'folder'
export type WorkspaceFsChangeKind = 'created' | 'removed' | 'renamed' | 'modified'

export type FileVersion = {
  mtimeMs: number
  size: number
}

export type WorkspaceFsChange = {
  kind: WorkspaceFsChangeKind
  path?: string
  old_path?: string
  new_path?: string
  parent?: string
  old_parent?: string
  new_parent?: string
  is_dir?: boolean
  version?: FileVersion
}

export type WorkspaceFsChangedPayload = {
  session_id: number
  root: string
  changes: WorkspaceFsChange[]
  ts_ms: number
}

export type FileMetadata = {
  created_at_ms: number | null
  updated_at_ms: number | null
}

export type CreateExtractedNoteResult = {
  path: string
  link_target: string
}

export type ReadNoteSnapshotResult = {
  path: string
  content: string
  version: FileVersion | null
}

export type SaveNoteSuccess = {
  ok: true
  version: FileVersion | null
}

export type SaveNoteConflict = {
  ok: false
  reason: 'CONFLICT'
  diskVersion: FileVersion
  diskContent: string
}

export type SaveNoteError = {
  ok: false
  reason: 'NOT_FOUND' | 'IO_ERROR'
  message: string
}

export type SaveNoteResult = SaveNoteSuccess | SaveNoteConflict | SaveNoteError

export type NoteHistoryEntry = {
  snapshotId: string
  notePath: string
  createdAtMs: number
  reason: string
  contentSize: number
  contentHash: string
}

export type NoteHistorySnapshot = {
  entry: NoteHistoryEntry
  content: string
}

export type MoveHistoryPath = {
  from: string
  to: string
}

export type AboutMetadata = {
  version: string
  build_commit: string | null
  build_channel: string
  platform_label: string
  app_support_dir: string
  tauri_version: string | null
}

export type FavoriteEntry = {
  path: string
  added_at_ms: number
  exists: boolean
}

export type IndexOverviewStats = {
  semantic_links_count?: number
  processed_notes_count: number
  workspace_notes_count: number
  last_run_finished_at_ms: number | null
  last_run_title: string | null
  last_run_duration_ms: number | null
}

export type IndexLogEntry = {
  ts_ms: number
  message: string
}

export type PathMove = {
  from: string
  to: string
}

export type PathMoveRewriteResult = {
  updated_files: number
  reindexed_files: number
  moved_markdown_files: number
  expanded_markdown_moves: PathMove[]
}

export type SecondBrainConfigStatus = {
  configured: boolean
  provider: string | null
  model: string | null
  profile_id: string | null
  supports_streaming: boolean
  supports_image_input: boolean
  supports_audio_input: boolean
  error: string | null
}

export type AppSettingsLlmProfile = {
  id: string
  label: string
  provider: string
  model: string
  api_key: string
  default_temperature: number
  system_prompt: string
  base_url: string | null
  default_mode: string | null
  capabilities: {
    text: boolean
    image_input: boolean
    audio_input: boolean
    tool_calling: boolean
    streaming: boolean
  }
}

export type AppSettingsLlm = {
  active_profile: string
  profiles: AppSettingsLlmProfile[]
}

export type AppSettingsView = {
  exists: boolean
  path: string
  llm: AppSettingsLlm | null
  embeddings: { mode: 'internal' | 'external'; external: { id: string; label: string; provider: string; model: string; api_key: string; base_url: string | null } | null }
}

export type SaveAppSettingsPayload = {
  llm: {
    active_profile: string
    profiles: Array<{
      id: string
      label: string
      provider: string
      model: string
      api_key?: string
      default_temperature: number
      system_prompt: string
      preserve_existing_api_key: boolean
      base_url?: string | null
      default_mode?: string | null
      capabilities: {
        text: boolean
        image_input: boolean
        audio_input: boolean
        tool_calling: boolean
        streaming: boolean
      }
    }>
  }
  embeddings: { mode: 'internal' | 'external'; external?: { id: string; label: string; provider: string; model: string; api_key?: string; preserve_existing_api_key: boolean; base_url?: string | null } | null }
}

export type WriteAppSettingsResult = {
  path: string
  embeddings_changed?: boolean
}

export type CodexDiscoveredModel = {
  id: string
  display_name: string
}

export type LlmDiscoveredModel = {
  id: string
  display_name: string
  group?: string | null
}

export type DiscoverLlmModelsPayload = {
  profile_id: string
  provider: string
  api_key?: string
  preserve_existing_api_key: boolean
  base_url?: string | null
}

export type DiscoverEmbeddingModelsPayload = {
  profile_id: string
  api_key?: string
  preserve_existing_api_key: boolean
  base_url?: string | null
}

export type IndexRuntimeStatus = {
  model_name: string
  model_state: string
  model_init_attempts: number
  model_last_started_at_ms: number | null
  model_last_finished_at_ms: number | null
  model_last_duration_ms: number | null
  model_last_error: string | null
}

export type SecondBrainAttachmentMeta = {
  id: string
  kind: string
  mime: string
  name: string
  size_bytes: number
}

export type SecondBrainSessionSummary = {
  session_id: string
  title: string
  created_at_ms: number
  updated_at_ms: number
  context_count: number
  target_note_path: string
  context_paths: string[]
}

export type SecondBrainContextItem = {
  path: string
  token_estimate: number
}

export type SecondBrainMessage = {
  id: string
  role: 'user' | 'assistant'
  mode: string
  content_md: string
  citations_json: string
  attachments_json: string
  created_at_ms: number
}

export type SecondBrainSessionPayload = {
  session_id: string
  title: string
  provider: string
  model: string
  created_at_ms: number
  updated_at_ms: number
  target_note_path: string
  context_items: SecondBrainContextItem[]
  messages: SecondBrainMessage[]
  draft_content: string
}

export type SecondBrainStreamEvent = {
  session_id: string
  message_id: string
  chunk: string
  done: boolean
  error: string | null
}
