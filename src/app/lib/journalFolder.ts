/**
 * Module: journalFolder
 *
 * Purpose:
 * - Own the workspace-scoped journal folder preference used by daily notes and
 *   the explorer's chronological journal view.
 *
 * Boundaries:
 * - Pure storage helpers: no filesystem access and no Vue state.
 * - The default keeps the historical lowercase `journal` location so existing
 *   workspaces keep working without any migration.
 */

import { normalizeWorkspacePath } from '../../domains/explorer/lib/workspacePaths'

/** Journal folder used when a workspace has no usable preference. */
export const DEFAULT_JOURNAL_FOLDER = 'journal'

/** Returns the localStorage key holding the journal folder for a workspace. */
export function journalFolderStorageKey(root: string): string {
  return `tomosona.journal.folder.${root}`
}

/**
 * Normalizes a user-provided journal folder into a workspace-relative path.
 *
 * Returns `null` for empty input and for paths that escape the workspace, for
 * example `../notes` or `journal/../../etc`.
 */
export function normalizeJournalFolder(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = normalizeWorkspacePath(raw).replace(/^\/+/, '').replace(/\/+$/, '')
  if (!cleaned) return null
  const segments = cleaned.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null
  return segments.join('/')
}

/**
 * Reads the configured journal folder for a workspace.
 *
 * Falls back to `DEFAULT_JOURNAL_FOLDER` when the preference is absent,
 * malformed, or escapes the workspace.
 */
export function readJournalFolder(root: string): string {
  if (!root) return DEFAULT_JOURNAL_FOLDER
  try {
    return normalizeJournalFolder(window.localStorage.getItem(journalFolderStorageKey(root))) ?? DEFAULT_JOURNAL_FOLDER
  } catch {
    return DEFAULT_JOURNAL_FOLDER
  }
}

/** Persists the journal folder for a workspace; invalid input is ignored. */
export function writeJournalFolder(root: string, folder: string): void {
  const normalized = normalizeJournalFolder(folder)
  if (!root || !normalized) return
  try {
    window.localStorage.setItem(journalFolderStorageKey(root), normalized)
  } catch {
    // Preference persistence is best effort; the default stays usable.
  }
}

/** Builds the absolute journal folder path for a workspace. */
export function journalFolderPath(root: string, folder: string): string {
  const normalized = normalizeJournalFolder(folder) ?? DEFAULT_JOURNAL_FOLDER
  return `${normalizeWorkspacePath(root).replace(/\/+$/, '')}/${normalized}`
}
