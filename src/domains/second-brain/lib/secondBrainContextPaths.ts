/**
 * Path normalization helpers for Second Brain context management.
 *
 * Keep this module as the single source of truth for how the frontend turns
 * workspace-relative paths into backend-safe absolute paths and storage keys.
 */
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
 *
 * The UI uses this before emitting context to the backend so every persisted
 * path is rooted in the current workspace and is safe to compare later.
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
 *
 * This keeps the update payload stable and prevents duplicate chips or token
 * estimate drift when the same note is added from different entry points.
 */
export function normalizeContextPathsForUpdate(workspacePath: string, paths: string[]): string[] {
  return dedupeWorkspacePaths(paths.map((path) => toAbsoluteWorkspacePath(workspacePath, path)))
}

/**
 * Builds a workspace-scoped storage key for persisted Second Brain session ids.
 *
 * The key is namespaced by workspace so multiple vaults do not leak the last
 * session selection into each other.
 */
export function workspaceScopedSecondBrainSessionKey(workspacePath: string): string {
  return `${SECOND_BRAIN_LAST_SESSION_ID_STORAGE_PREFIX}${encodeURIComponent(String(workspacePath ?? '').trim())}`
}
