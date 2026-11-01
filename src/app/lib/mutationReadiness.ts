/**
 * Module: mutationReadiness
 *
 * Purpose:
 * - Decide which open editor buffers a proposed path mutation touches so the
 *   shell can reconcile unsaved changes through the existing save flow before
 *   any file is moved or rewritten.
 *
 * Boundaries:
 * - Pure assessment over proposed moves and open-buffer state; no filesystem
 *   access and no mutation.
 * - Folder moves cover their descendants, so a note inside a moved folder is
 *   reported once with the folder's mapping, not again per child move.
 */

import type { PathMove } from '../../shared/api/apiTypes'
import { rewritePathWithMoves } from './pathMoves'

/** Minimal view of an open editor buffer used for readiness checks. */
export type OpenNoteBuffer = {
  path: string
  dirty: boolean
}

/** One open note affected by the proposed moves. */
export type AffectedOpenNote = {
  from: string
  to: string
  dirty: boolean
}

/** Readiness outcome for a proposed mutation batch. */
export type MutationReadiness = {
  /** Every open note whose path changes, including clean buffers. */
  affected: AffectedOpenNote[]
  /** Affected notes with unsaved changes; these need save/conflict handling first. */
  dirtyAffected: AffectedOpenNote[]
}

/** Inputs for assessing a proposed mutation against open editor buffers. */
export type MutationReadinessInput = {
  moves: PathMove[]
  openNotes: OpenNoteBuffer[]
}

/**
 * Maps each open note through the proposed moves and flags unsaved buffers.
 *
 * Paths that no move rewrites are ignored; results are sorted by source path
 * for stable reporting.
 */
export function assessMutationReadiness(input: MutationReadinessInput): MutationReadiness {
  const affected: AffectedOpenNote[] = []

  for (const note of input.openNotes) {
    const to = rewritePathWithMoves(note.path, input.moves)
    if (!to || to === note.path) continue
    affected.push({ from: note.path, to, dirty: note.dirty })
  }

  affected.sort((left, right) => left.from.localeCompare(right.from))
  return {
    affected,
    dirtyAffected: affected.filter((note) => note.dirty)
  }
}
