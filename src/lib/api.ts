import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toEchoesPack, type EchoesPack } from './echoes'

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

type ComputeEchoesPackPayload = {
  anchor_path: string
  limit?: number
  include_recent_activity?: boolean
}

export async function selectWorkingFolder(): Promise<string | null> {
  return await invoke('select_working_folder')
}

export async function clearWorkingFolder(): Promise<void> {
  await invoke('clear_working_folder')
}

export async function setWorkingFolder(path: string): Promise<string> {
  return await invoke('set_working_folder', { path })
}

export async function listChildren(dirPath: string): Promise<TreeNode[]> {
  return await invoke('list_children', { dirPath })
}

export async function listMarkdownFiles(): Promise<string[]> {
  return await invoke('list_markdown_files')
}

export async function pathExists(path: string): Promise<boolean> {
  return await invoke('path_exists', { path })
}

export async function readTextFile(path: string): Promise<string> {
  return await invoke('read_text_file', { path })
}

export async function readFileMetadata(path: string): Promise<FileMetadata> {
  return await invoke('read_file_metadata', { path })
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke('write_text_file', { path, content })
}

export async function reindexMarkdownFileLexical(path: string): Promise<void> {
  await invoke('reindex_markdown_file_lexical', { path })
}

export async function reindexMarkdownFileSemantic(path: string): Promise<void> {
  await invoke('reindex_markdown_file_semantic', { path })
}

export async function refreshSemanticEdgesCacheNow(): Promise<void> {
  await invoke('refresh_semantic_edges_cache_now')
}

export async function removeMarkdownFileFromIndex(path: string): Promise<void> {
  await invoke('remove_markdown_file_from_index', { path })
}

export async function createEntry(
  parentPath: string,
  name: string,
  kind: EntryKind,
  conflictStrategy: ConflictStrategy
): Promise<string> {
  return await invoke('create_entry', { parentPath, name, kind, conflictStrategy })
}

export async function renameEntry(
  path: string,
  newName: string,
  conflictStrategy: ConflictStrategy
): Promise<string> {
  return await invoke('rename_entry', { path, newName, conflictStrategy })
}

export async function duplicateEntry(
  path: string,
  conflictStrategy: ConflictStrategy
): Promise<string> {
  return await invoke('duplicate_entry', { path, conflictStrategy })
}

export async function copyEntry(
  sourcePath: string,
  targetDirPath: string,
  conflictStrategy: ConflictStrategy
): Promise<string> {
  return await invoke('copy_entry', { sourcePath, targetDirPath, conflictStrategy })
}

export async function moveEntry(
  sourcePath: string,
  targetDirPath: string,
  conflictStrategy: ConflictStrategy
): Promise<string> {
  return await invoke('move_entry', { sourcePath, targetDirPath, conflictStrategy })
}

export async function trashEntry(path: string): Promise<string> {
  return await invoke('trash_entry', { path })
}

export async function openPathExternal(path: string): Promise<void> {
  await invoke('open_path_external', { path })
}

export async function openExternalUrl(url: string): Promise<void> {
  await invoke('open_external_url', { url })
}

export async function revealInFileManager(path: string): Promise<void> {
  await invoke('reveal_in_file_manager', { path })
}

export async function initDb(): Promise<void> {
  await invoke('init_db')
}

export async function ftsSearch(query: string): Promise<Array<{ path: string; snippet: string; score: number }>> {
  return await invoke('fts_search', { query })
}

export async function backlinksForPath(path: string): Promise<Array<{ path: string }>> {
  return await invoke('backlinks_for_path', { path })
}

/** Fetches the indexed wikilink graph payload used by Cosmos view. */
export async function getWikilinkGraph(): Promise<WikilinkGraph> {
  return await invoke('get_wikilink_graph')
}

/**
 * Computes a local Echoes suggestion pack for a note anchor.
 */
export async function computeEchoesPack(
  anchorPath: string,
  options: {
    limit?: number
    includeRecentActivity?: boolean
  } = {}
): Promise<EchoesPack> {
  const payload: ComputeEchoesPackPayload = {
    anchor_path: anchorPath
  }
  if (options.limit != null) {
    payload.limit = options.limit
  }
  if (options.includeRecentActivity != null) {
    payload.include_recent_activity = options.includeRecentActivity
  }
  const result = await invoke('compute_echoes_pack', { payload })
  return toEchoesPack(result as Parameters<typeof toEchoesPack>[0])
}

export async function updateWikilinksForRename(
  oldPath: string,
  newPath: string
): Promise<{ updated_files: number }> {
  return await invoke('update_wikilinks_for_rename', { oldPath, newPath })
}

export async function rebuildWorkspaceIndex(): Promise<{ indexed_files: number; canceled: boolean }> {
  return await invoke('rebuild_workspace_index')
}

export async function requestIndexCancel(): Promise<void> {
  await invoke('request_index_cancel')
}

export async function readIndexRuntimeStatus(): Promise<IndexRuntimeStatus> {
  return await invoke('read_index_runtime_status')
}

export async function readIndexLogs(limit = 80): Promise<IndexLogEntry[]> {
  return await invoke('read_index_logs', { limit })
}

export async function readPropertyTypeSchema(): Promise<Record<string, string>> {
  return await invoke('read_property_type_schema')
}

export async function writePropertyTypeSchema(schema: Record<string, string>): Promise<void> {
  await invoke('write_property_type_schema', { schema })
}

/** Reads redacted app settings from `~/.tomosona/conf.json`. */
export async function readAppSettings(): Promise<AppSettingsView> {
  return await invoke('read_app_settings')
}

/** Writes app settings and reports whether embedding identity changed. */
export async function writeAppSettings(payload: SaveAppSettingsPayload): Promise<WriteAppSettingsResult> {
  return await invoke('write_app_settings', { payload })
}

export async function discoverCodexModels(): Promise<CodexDiscoveredModel[]> {
  return await invoke('discover_codex_models')
}

export async function listenWorkspaceFsChanged(
  handler: (payload: WorkspaceFsChangedPayload) => void
): Promise<UnlistenFn> {
  return await listen<WorkspaceFsChangedPayload>('workspace://fs-changed', (event) => {
    handler(event.payload)
  })
}

export async function readSecondBrainConfigStatus(): Promise<SecondBrainConfigStatus> {
  return await invoke('read_second_brain_config_status')
}

export async function writeSecondBrainGlobalConfig(contentJson: string): Promise<{ path: string }> {
  return await invoke('write_second_brain_global_config', { payload: { content_json: contentJson } })
}

export async function listSecondBrainSessions(limit = 80): Promise<SecondBrainSessionSummary[]> {
  return await invoke('list_second_brain_sessions', { limit })
}

export async function createSecondBrainSession(payload: {
  title?: string
  context_paths: string[]
}): Promise<{ session_id: string; created_at_ms: number }> {
  return await invoke('create_second_brain_session', { payload })
}

export async function loadSecondBrainSession(sessionId: string): Promise<SecondBrainSessionPayload> {
  return await invoke('load_second_brain_session', { sessionId })
}

export async function deleteSecondBrainSession(sessionId: string): Promise<void> {
  await invoke('delete_second_brain_session', { sessionId })
}

export async function updateSecondBrainContext(payload: {
  session_id: string
  context_paths: string[]
}): Promise<{ token_estimate: number }> {
  return await invoke('update_second_brain_context', { payload })
}

export async function cancelSecondBrainStream(payload: {
  session_id: string
  message_id?: string
}): Promise<void> {
  await invoke('cancel_second_brain_stream', { payload })
}

export async function sendSecondBrainMessage(payload: {
  session_id: string
  mode: string
  message: string
  attachments?: SecondBrainAttachmentMeta[]
}): Promise<{ user_message_id: string; assistant_message_id: string }> {
  return await invoke('send_second_brain_message', { payload })
}

export async function runPulseTransformation(
  payload: PulseTransformationRequest
): Promise<PulseTransformationResponse> {
  return await invoke('run_pulse_transformation', { payload })
}

export async function cancelPulseStream(payload: {
  request_id: string
  output_id?: string
}): Promise<void> {
  await invoke('cancel_pulse_stream', { payload })
}

export async function saveSecondBrainDraft(payload: {
  session_id: string
  content_md: string
}): Promise<void> {
  await invoke('save_second_brain_draft', { payload })
}

export async function appendMessageToDraft(payload: {
  session_id: string
  message_id: string
}): Promise<string> {
  return await invoke('append_message_to_second_brain_draft', { payload })
}

export async function publishDraftToNewNote(payload: {
  session_id: string
  target_dir: string
  file_name: string
  sources: string[]
}): Promise<{ path: string }> {
  return await invoke('publish_second_brain_draft_to_new_note', { payload })
}

export async function publishDraftToExistingNote(payload: {
  session_id: string
  target_path: string
}): Promise<void> {
  await invoke('publish_second_brain_draft_to_existing_note', { payload })
}

export async function listenSecondBrainStream(
  eventName:
    | 'second-brain://assistant-start'
    | 'second-brain://assistant-delta'
    | 'second-brain://assistant-complete'
    | 'second-brain://assistant-error',
  handler: (payload: SecondBrainStreamEvent) => void
): Promise<UnlistenFn> {
  return await listen<SecondBrainStreamEvent>(eventName, (event) => {
    handler(event.payload)
  })
}

export async function listenPulseStream(
  eventName: 'pulse://start' | 'pulse://delta' | 'pulse://complete' | 'pulse://error',
  handler: (payload: PulseStreamEvent) => void
): Promise<UnlistenFn> {
  return await listen<PulseStreamEvent>(eventName, (event) => {
    handler(event.payload)
  })
}

export async function setSecondBrainSessionTargetNote(payload: {
  session_id: string
  target_path: string
}): Promise<{ target_note_path: string }> {
  return await invoke('set_second_brain_session_target_note', { payload })
}

export async function insertSecondBrainAssistantIntoTargetNote(payload: {
  session_id: string
  message_id: string
}): Promise<{ target_note_path: string }> {
  return await invoke('insert_second_brain_assistant_into_target_note', { payload })
}

export async function exportSecondBrainSessionMarkdown(sessionId: string): Promise<{ path: string }> {
  return await invoke('export_second_brain_session_markdown', { sessionId })
}
