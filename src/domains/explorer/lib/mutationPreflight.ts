/**
 * Module: mutationPreflight
 *
 * Purpose:
 * - Turn raw native preflight entries into a small decision the explorer UI can
 *   act on: proceed, ask for a collision strategy, or stop with a clear reason.
 *
 * Boundaries:
 * - Pure classification of MovePreflightEntry values; no IPC and no filesystem
 *   access. The native commands remain the source of truth for safety.
 */

import type { MovePreflightEntry, MovePreflightIssue } from '../../../shared/api/apiTypes'

/** One entry the native preflight could not clear for a blocking reason. */
export type BlockedPreflightEntry = {
  sourcePath: string
  issue: MovePreflightIssue
  message: string
}

/** Classified result of a preflight pass over one or more entries. */
export type PreflightSummary = {
  /** Entries with no issue; safe to execute after revalidation. */
  ready: MovePreflightEntry[]
  /** Entries whose destination already exists; need a conflict strategy. */
  collisions: MovePreflightEntry[]
  /** Entries blocked by a non-collision issue, with a user-facing reason. */
  blocked: BlockedPreflightEntry[]
  /** True when at least one entry is blocked and the operation must not run. */
  hasBlockingIssues: boolean
}

/** Maps a blocking preflight issue to a safe, user-facing explanation. */
export function preflightIssueMessage(issue: MovePreflightIssue): string {
  switch (issue) {
    case 'invalid_source':
      return 'The source no longer exists.'
    case 'invalid_name':
      return 'The name is invalid.'
    case 'unavailable':
      return 'The destination is not writable.'
    case 'stale_source':
      return 'The file changed since it was checked. Refresh and try again.'
    case 'workspace_root':
      return 'The workspace root cannot be moved.'
    case 'symlink':
      return 'Symbolic links are not supported.'
    case 'read_only':
      return 'The source is read-only.'
    case 'descendant':
      return 'A folder cannot be moved into itself.'
    case 'same_location':
      return 'The entry is already in this folder.'
    case 'collision':
      return 'The destination already exists.'
  }
}

/**
 * Classifies preflight entries into ready, collision and blocked groups.
 *
 * Collision entries never block on their own: the existing conflict prompt
 * decides the strategy. Any other issue blocks the whole batch so partial
 * preflights are never reported as successful.
 */
export function summarizePreflight(entries: MovePreflightEntry[]): PreflightSummary {
  const ready: MovePreflightEntry[] = []
  const collisions: MovePreflightEntry[] = []
  const blocked: BlockedPreflightEntry[] = []

  for (const entry of entries) {
    if (!entry.issue) {
      ready.push(entry)
    } else if (entry.issue === 'collision') {
      collisions.push(entry)
    } else {
      blocked.push({ sourcePath: entry.sourcePath, issue: entry.issue, message: preflightIssueMessage(entry.issue) })
    }
  }

  return { ready, collisions, blocked, hasBlockingIssues: blocked.length > 0 }
}
