/**
 * Module: journalOrganization
 *
 * Purpose:
 * - Plan the explicit move of dispersed dated notes into the configured
 *   year/month hierarchy.
 *
 * Boundaries:
 * - Pure planning only: no I/O and no mutation. Execution goes through the
 *   explorer's safe mutation boundary so preflight, conflict handling, link
 *   rewriting and undo stay identical to every other move.
 * - Notes already at their canonical path are counted, never re-planned.
 */

import { normalizeWorkspacePath } from '../../domains/explorer/lib/workspacePaths'
import { DEFAULT_JOURNAL_FOLDER, normalizeJournalFolder } from './journalFolder'

/** One proposed move from a dispersed dated note to its canonical location. */
export type JournalOrganizationMove = {
  from: string
  to: string
  /** Calendar day in `YYYY-MM-DD` form. */
  date: string
}

/** Result of planning the journal organization. */
export type JournalOrganizationPlan = {
  moves: JournalOrganizationMove[]
  /** Dated notes already stored at their canonical path. */
  organized: number
  /** Dated notes outside the journal folder, left untouched. */
  skipped: number
}

/**
 * Builds the canonical destination for a dated note.
 *
 * Example: root `/vault`, folder `journal`, date `2026-03-13` gives
 * `/vault/journal/2026/03/2026-03-13.md`.
 */
export function journalNoteDestination(root: string, journalFolder: string, date: string): string {
  const normalizedRoot = normalizeWorkspacePath(root).replace(/\/+$/, '')
  const folder = normalizeJournalFolder(journalFolder) ?? DEFAULT_JOURNAL_FOLDER
  const [year, month] = date.split('-')
  return `${normalizedRoot}/${folder}/${year}/${month}/${date}.md`
}

/**
 * Plans the moves needed to organize dated notes under the journal folder.
 *
 * Only notes inside the journal folder are candidates: the journal never claims
 * ownership of dated files stored elsewhere in the workspace.
 */
export function planJournalOrganization(
  entries: readonly { path: string; date: string }[],
  options: { root: string; journalFolder: string }
): JournalOrganizationPlan {
  const normalizedRoot = normalizeWorkspacePath(options.root).replace(/\/+$/, '')
  const folder = normalizeJournalFolder(options.journalFolder) ?? DEFAULT_JOURNAL_FOLDER
  const journalPrefix = `${normalizedRoot}/${folder}/`
  const moves: JournalOrganizationMove[] = []
  let organized = 0
  let skipped = 0

  for (const entry of entries) {
    const destination = journalNoteDestination(normalizedRoot, folder, entry.date)
    if (entry.path === destination) {
      organized += 1
      continue
    }
    if (!entry.path.startsWith(journalPrefix)) {
      skipped += 1
      continue
    }
    moves.push({ from: entry.path, to: destination, date: entry.date })
  }

  return { moves, organized, skipped }
}
