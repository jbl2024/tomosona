import {
  dedupeWorkspacePaths,
  toWorkspaceAbsolutePath
} from '../../explorer/lib/workspacePaths'

const SECOND_BRAIN_LAST_SESSION_ID_STORAGE_PREFIX = 'tomosona:second-brain:last-session-id:'

/**
 * Returns an absolute workspace path for Second Brain context updates.
 *
 * - Absolute input paths are preserved (slashes normalized).
 * - Relative input paths are resolved under the provided workspace path.
 */
export function toAbsoluteWorkspacePath(workspacePath: string, path: string): string {
  return toWorkspaceAbsolutePath(workspacePath, path)
}

/**
 * Normalizes context paths for backend update payloads.
 *
 * - Converts all paths to absolute workspace paths.
 * - Drops empty entries.
 * - Deduplicates while preserving first-seen order.
 */
export function normalizeContextPathsForUpdate(workspacePath: string, paths: string[]): string[] {
  return dedupeWorkspacePaths(paths.map((path) => toAbsoluteWorkspacePath(workspacePath, path)))
}

/**
 * Builds a workspace-scoped storage key for persisted Second Brain session ids.
 */
export function workspaceScopedSecondBrainSessionKey(workspacePath: string): string {
  return `${SECOND_BRAIN_LAST_SESSION_ID_STORAGE_PREFIX}${encodeURIComponent(String(workspacePath ?? '').trim())}`
}
