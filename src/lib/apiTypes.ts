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

export type WorkspaceFsChange = {
  kind: WorkspaceFsChangeKind
  path?: string
  old_path?: string
  new_path?: string
  parent?: string
  old_parent?: string
  new_parent?: string
  is_dir?: boolean
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

export type IndexRuntimeStatus = {
  model_name: string
  model_state: string
  model_init_attempts: number
  model_last_started_at_ms: number | null
  model_last_finished_at_ms: number | null
  model_last_duration_ms: number | null
  model_last_error: string | null
}

export type IndexLogEntry = {
  ts_ms: number
  message: string
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
  has_api_key: boolean
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

export type AppSettingsEmbeddingProfile = {
  id: string
  label: string
  provider: string
  model: string
  has_api_key: boolean
  base_url: string | null
}

export type AppSettingsEmbeddings = {
  mode: 'internal' | 'external'
  external: AppSettingsEmbeddingProfile | null
}

export type AppSettingsView = {
  exists: boolean
  path: string
  llm: AppSettingsLlm | null
  embeddings: AppSettingsEmbeddings
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
  embeddings: {
    mode: 'internal' | 'external'
    external?: {
      id: string
      label: string
      provider: string
      model: string
      api_key?: string
      preserve_existing_api_key: boolean
      base_url?: string | null
    } | null
  }
}

export type WriteAppSettingsResult = {
  path: string
  embeddings_changed: boolean
}

export type CodexDiscoveredModel = {
  id: string
  display_name: string
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

export type PulseSourceKind = 'editor_selection' | 'editor_note' | 'second_brain_context' | 'cosmos_focus'

export type PulseActionId =
  | 'rewrite'
  | 'condense'
  | 'expand'
  | 'change_tone'
  | 'synthesize'
  | 'outline'
  | 'brief'
  | 'extract_themes'
  | 'identify_tensions'

export type PulseTransformationRequest = {
  request_id?: string
  source_kind: PulseSourceKind
  action_id: PulseActionId
  instructions?: string
  context_paths: string[]
  source_text?: string
  selection_label?: string
  session_id?: string
  cosmos_selected_node_id?: string
  cosmos_neighbor_paths?: string[]
}

export type PulseTransformationResponse = {
  request_id: string
  output_id: string
}

export type PulseStreamEvent = {
  request_id: string
  output_id: string
  chunk: string
  done: boolean
  error: string | null
  title: string | null
  provenance_paths: string[]
}

export type WikilinkGraphNode = {
  id: string
  path: string
  label: string
  degree: number
  tags: string[]
  cluster: number | null
}

/**
 * Graph edge returned by backend Cosmos payload.
 *
 * - `wikilink`: explicit markdown link.
 * - `semantic`: inferred nearest-neighbor link from note embeddings.
 */
export type WikilinkGraphEdge = {
  source: string
  target: string
  type: 'wikilink' | 'semantic'
  score?: number | null
}

export type WikilinkGraph = {
  nodes: WikilinkGraphNode[]
  edges: WikilinkGraphEdge[]
  generated_at_ms: number
}
