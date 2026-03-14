import { invoke } from '@tauri-apps/api/core'
import { toEchoesPack, type EchoesPack } from '../../domains/echoes/lib/echoes'
import type {
  IndexLogEntry,
  IndexRuntimeStatus,
  PathMove,
  PathMoveRewriteResult,
  SemanticLink,
  WikilinkGraph
} from './apiTypes'

type ComputeEchoesPackPayload = {
  anchor_path: string
  limit?: number
  include_recent_activity?: boolean
}

/**
 * Frontend IPC wrappers for indexing, search, graph data, and Echoes transport.
 */

/** Initializes the workspace database and runtime dependencies. */
export async function initDb(): Promise<void> {
  await invoke('init_db')
}

/** Reindexes a single markdown file in the lexical index. */
export async function reindexMarkdownFileLexical(path: string): Promise<void> {
  await invoke('reindex_markdown_file_lexical', { path })
}

/** Reindexes a single markdown file in the semantic index. */
export async function reindexMarkdownFileSemantic(path: string): Promise<void> {
  await invoke('reindex_markdown_file_semantic', { path })
}

/** Refreshes derived semantic edge caches without a full rebuild. */
export async function refreshSemanticEdgesCacheNow(): Promise<void> {
  await invoke('refresh_semantic_edges_cache_now')
}

/** Removes a markdown file from the workspace index. */
export async function removeMarkdownFileFromIndex(path: string): Promise<void> {
  await invoke('remove_markdown_file_from_index', { path })
}

/** Executes full-text search against the active workspace index. */
export async function ftsSearch(query: string): Promise<Array<{ path: string; snippet: string; score: number }>> {
  return await invoke('fts_search', { query })
}

/** Returns backlinks for a given workspace note path. */
export async function backlinksForPath(path: string): Promise<Array<{ path: string }>> {
  return await invoke('backlinks_for_path', { path })
}

/** Returns semantic relations for a given workspace note path. */
export async function semanticLinksForPath(path: string): Promise<SemanticLink[]> {
  return await invoke('semantic_links_for_path', { path })
}

/** Fetches the indexed wikilink graph payload used by Cosmos view. */
export async function getWikilinkGraph(): Promise<WikilinkGraph> {
  return await invoke('get_wikilink_graph')
}

/** Updates workspace wikilinks after a note rename. */
export async function updateWikilinksForRename(
  oldPath: string,
  newPath: string
): Promise<{ updated_files: number }> {
  return await invoke('update_wikilinks_for_rename', { oldPath, newPath })
}

/** Updates workspace wikilinks after one or more successful path moves. */
export async function updateWikilinksForPathMoves(
  moves: PathMove[]
): Promise<PathMoveRewriteResult> {
  return await invoke('update_wikilinks_for_path_moves', {
    moves: moves.map((move) => ({
      fromPath: move.from,
      toPath: move.to
    }))
  })
}

/** Rebuilds the full workspace index. */
export async function rebuildWorkspaceIndex(): Promise<{ indexed_files: number; canceled: boolean }> {
  return await invoke('rebuild_workspace_index')
}

/** Requests cancellation for the active indexing run. */
export async function requestIndexCancel(): Promise<void> {
  await invoke('request_index_cancel')
}

/** Reads runtime status for indexing and embedding model initialization. */
export async function readIndexRuntimeStatus(): Promise<IndexRuntimeStatus> {
  return await invoke('read_index_runtime_status')
}

/** Reads recent indexing log entries for the active workspace. */
export async function readIndexLogs(limit = 80): Promise<IndexLogEntry[]> {
  return await invoke('read_index_logs', { limit })
}

/** Reads the persisted property type schema for the active workspace. */
export async function readPropertyTypeSchema(): Promise<Record<string, string>> {
  return await invoke('read_property_type_schema')
}

/** Persists the property type schema for the active workspace. */
export async function writePropertyTypeSchema(schema: Record<string, string>): Promise<void> {
  await invoke('write_property_type_schema', { schema })
}

/** Computes a local Echoes suggestion pack for a note anchor. */
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
