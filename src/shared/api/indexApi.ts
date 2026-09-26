import { invoke } from '@tauri-apps/api/core'
import type {
  IndexLogEntry,
  IndexOverviewStats,
  PathMove,
  PathMoveRewriteResult,
} from './apiTypes'

/**
 * Frontend IPC wrappers for indexing, search, and graph data.
 */

/** Initializes the workspace database and runtime dependencies. */
export async function initDb(): Promise<void> {
  await invoke('init_db')
}

/** Reindexes a single markdown file in the lexical index. */
export async function reindexMarkdownFileLexical(path: string): Promise<void> {
  await invoke('reindex_markdown_file_lexical', { path })
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

/** Reads persisted index overview counts for the active workspace. */
export async function readIndexOverviewStats(): Promise<IndexOverviewStats> {
  return await invoke('read_index_overview_stats')
}

/** Reads recent indexing log entries for the active workspace. */
export async function readIndexLogs(limit = 80): Promise<IndexLogEntry[]> {
  return await invoke('read_index_logs', { limit })
}

/** Reads indexed property value suggestions for a given property key. */
export async function readPropertyValueSuggestions(
  key: string,
  query = '',
  limit = 20
): Promise<string[]> {
  return await invoke('read_property_value_suggestions', {
    key,
    query,
    limit
  })
}

/** Reads distinct indexed property keys for the active workspace. */
export async function readPropertyKeys(limit = 100): Promise<string[]> {
  return await invoke('read_property_keys', { limit })
}

/** Reads the persisted property type schema for the active workspace. */
export async function readPropertyTypeSchema(): Promise<Record<string, string>> {
  return await invoke('read_property_type_schema')
}

/** Persists the property type schema for the active workspace. */
export async function writePropertyTypeSchema(schema: Record<string, string>): Promise<void> {
  await invoke('write_property_type_schema', { schema })
}
