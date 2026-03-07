/**
 * Module: workspacePaths
 *
 * Purpose:
 * - Centralize pure frontend helpers that normalize and compare workspace
 *   paths across Explorer, editor shell, and Second Brain features.
 *
 * Invariants:
 * - All helpers normalize to forward slashes.
 * - Helpers do not touch the filesystem and do not resolve symlinks.
 * - Canonical path keys are frontend-only comparison keys and stay
 *   case-insensitive to preserve current behavior.
 */

/**
 * Normalizes a workspace path into a trimmed forward-slash string.
 *
 * The function removes duplicate separators and strips a single leading `./`
 * prefix, for example `./notes\\today.md` -> `notes/today.md`.
 */
export function normalizeWorkspacePath(path: string): string {
  return String(path ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
}

/**
 * Returns `true` when the normalized path is absolute.
 *
 * Supported absolute forms are Unix roots (`/vault`) and Windows drive paths
 * (`C:/vault`).
 */
export function isAbsoluteWorkspacePath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path)
  if (!normalized) return false
  if (normalized.startsWith('/')) return true
  return /^[A-Za-z]:\//.test(normalized)
}

/**
 * Returns a workspace-relative path when the target is under the workspace.
 *
 * If the path is equal to the workspace root, the function returns `.`.
 * Paths outside the workspace are returned normalized but otherwise unchanged.
 */
export function toWorkspaceRelativePath(workspacePath: string, path: string): string {
  const normalizedPath = normalizeWorkspacePath(path)
  const normalizedRoot = normalizeWorkspacePath(workspacePath).replace(/\/+$/, '')
  if (!normalizedRoot) return normalizedPath
  if (normalizedPath === normalizedRoot) return '.'
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return normalizedPath
}

/**
 * Resolves a path under the workspace root unless it is already absolute.
 *
 * For example `notes/today.md` under `/vault` becomes `/vault/notes/today.md`.
 */
export function toWorkspaceAbsolutePath(workspacePath: string, path: string): string {
  const normalizedPath = normalizeWorkspacePath(path)
  if (!normalizedPath) return ''
  if (isAbsoluteWorkspacePath(normalizedPath)) return normalizedPath

  const normalizedWorkspace = normalizeWorkspacePath(workspacePath).replace(/\/+$/, '')
  if (!normalizedWorkspace) return normalizedPath
  return `${normalizedWorkspace}/${normalizedPath}`
}

/**
 * Builds the canonical comparison key used for frontend path equality checks.
 *
 * The key is normalized, trimmed, and lowercased to match existing
 * case-insensitive lookup behavior.
 */
export function toWorkspacePathKey(path: string): string {
  return normalizeWorkspacePath(path).toLowerCase()
}

/**
 * Deduplicates a list of paths using the canonical comparison key.
 *
 * The first normalized occurrence wins and the original order is preserved.
 */
export function dedupeWorkspacePaths(paths: string[]): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const path of paths) {
    const normalized = normalizeWorkspacePath(path)
    if (!normalized) continue
    const key = toWorkspacePathKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(normalized)
  }

  return deduped
}
