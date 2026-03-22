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

export type IndexRuntimeStatus = {
  model_name: string
  model_state: string
  model_init_attempts: number
  model_last_started_at_ms: number | null
  model_last_finished_at_ms: number | null
  model_last_duration_ms: number | null
  model_last_error: string | null
}

export type IndexOverviewStats = {
  semantic_links_count: number
  indexed_notes_count: number
  workspace_notes_count: number
  last_run_finished_at_ms: number | null
  last_run_title: string | null
}

export type IndexLogEntry = {
  ts_ms: number
  message: string
}

export type SemanticLink = {
  path: string
  score: number | null
  direction: 'incoming' | 'outgoing'
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

export type AlterDefaultMode = 'neutral' | 'last_used'

export type AppSettingsAlters = {
  default_mode: AlterDefaultMode
  show_badge_in_chat: boolean
  default_influence_intensity: 'light' | 'balanced' | 'strong'
}

export type AppSettingsView = {
  exists: boolean
  path: string
  llm: AppSettingsLlm | null
  embeddings: AppSettingsEmbeddings
  alters: AppSettingsAlters
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
  alters: {
    default_mode: AlterDefaultMode
    show_badge_in_chat: boolean
    default_influence_intensity: 'light' | 'balanced' | 'strong'
  }
}

export type WriteAppSettingsResult = {
  path: string
  embeddings_changed: boolean
  alters: AppSettingsAlters
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
  alter_id?: string
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
  alter_id?: string
  context_items: SecondBrainContextItem[]
  messages: SecondBrainMessage[]
  draft_content: string
}

export type AlterInspirationSourceType = 'manual' | 'template' | 'reference_figure' | 'note'

export type AlterInspiration = {
  id: string
  label: string
  source_type: AlterInspirationSourceType
  weight: number | null
  reference_id: string | null
}

/** Runtime Alter style persisted with each workspace alter. */
export type AlterStyle = {
  tone: 'neutral' | 'direct' | 'socratic' | 'strategic' | 'creative'
  verbosity: 'short' | 'medium' | 'long'
  temperature: number
  contradiction_level: number
  exploration_level: number
  influence_intensity: 'light' | 'balanced' | 'strong'
  response_style: 'concise' | 'analytic' | 'dialectic' | 'frontal'
  cite_hypotheses: boolean
  signal_biases: boolean
}

export type AlterSummary = {
  id: string
  name: string
  slug: string
  description: string
  icon: string | null
  color: string | null
  category: string | null
  mission: string
  is_favorite: boolean
  is_built_in: boolean
  revision_count: number
  updated_at_ms: number
}

export type AlterPayload = {
  id: string
  name: string
  slug: string
  description: string
  icon: string | null
  color: string | null
  category: string | null
  mission: string
  inspirations: AlterInspiration[]
  principles: string[]
  reflexes: string[]
  values: string[]
  critiques: string[]
  blind_spots: string[]
  system_hints: string[]
  style: AlterStyle
  invocation_prompt: string
  is_favorite: boolean
  is_built_in: boolean
  created_at_ms: number
  updated_at_ms: number
}

export type AlterRevisionSummary = {
  revision_id: string
  alter_id: string
  created_at_ms: number
  reason: string | null
}

export type AlterRevisionPayload = {
  revision_id: string
  alter_id: string
  created_at_ms: number
  reason: string | null
  alter: AlterPayload
}

export type CreateAlterPayload = {
  name: string
  description: string
  icon?: string | null
  color?: string | null
  category?: string | null
  mission: string
  inspirations: AlterInspiration[]
  principles: string[]
  reflexes: string[]
  values: string[]
  critiques: string[]
  blind_spots: string[]
  system_hints: string[]
  style: AlterStyle
  is_favorite: boolean
}

export type UpdateAlterPayload = CreateAlterPayload & {
  id: string
  revision_reason?: string | null
}

export type PreviewAlterPayload = {
  draft: CreateAlterPayload
  prompt: string
}

export type PreviewAlterResult = {
  invocation_prompt: string
  preview_prompt: string
}

export type GenerateAlterDraftPayload = {
  prompt: string
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
