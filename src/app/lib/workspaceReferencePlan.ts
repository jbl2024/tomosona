/**
 * Module: workspaceReferencePlan
 *
 * Purpose:
 * - Aggregate per-note reference plans for a proposed set of path moves so a
 *   mutation flow can warn about risky references before writing anything.
 *
 * Boundaries:
 * - Pure planning over provided contents: no filesystem access, no writes.
 * - Every workspace note with available content is scanned, because inbound
 *   links can live anywhere and moved notes carry their own outbound links.
 * - Locked protected notes cannot be inspected; they are reported as
 *   `lockedSources` and must be surfaced as an explicit unknown, never as
 *   proof that references are safe.
 */

import { toWorkspaceAbsolutePath, normalizeWorkspacePath } from '../../domains/explorer/lib/workspacePaths'
import type { PathMove } from '../../shared/api/apiTypes'
import { planContentReferenceImpact, type ContentReferencePlan } from './noteReferencePlan'

/** Planning inputs for one workspace-wide reference impact pass. */
export type WorkspaceReferencePlanInput = {
  workspacePath: string
  /** All markdown files in the workspace (absolute or workspace-relative). */
  markdownPaths: string[]
  moves: PathMove[]
  /** Note contents keyed by absolute or workspace-relative path. */
  contents: Record<string, string>
  /** Protected locked notes whose content must not be read or persisted. */
  lockedSourcePaths?: string[]
}

/** Reference plan for one scanned note. */
export type WorkspaceNoteReferencePlan = {
  sourcePath: string
  plan: ContentReferencePlan
}

/** Workspace-wide reference impact: per-note plans plus uninspectable notes. */
export type WorkspaceReferencePlan = {
  /** Notes with at least one rewrite or warning, sorted by source path. */
  notes: WorkspaceNoteReferencePlan[]
  /** Locked notes that could not be inspected for references. */
  lockedSources: string[]
}

function contentKey(root: string, path: string): string {
  return toWorkspaceAbsolutePath(root, normalizeWorkspacePath(path).replace(/\/+$/, ''))
}

/**
 * Plans reference rewrites and warnings across all provided note contents.
 *
 * Notes without rewrites or warnings are omitted from `notes`; locked notes
 * are never read and only appear in `lockedSources`.
 */
export function planWorkspaceReferenceImpact(input: WorkspaceReferencePlanInput): WorkspaceReferencePlan {
  const root = normalizeWorkspacePath(input.workspacePath).replace(/\/+$/, '')
  const notes: WorkspaceNoteReferencePlan[] = []
  const contentByKey = new Map<string, string>()
  for (const [key, content] of Object.entries(input.contents)) {
    const normalizedKey = contentKey(root, key)
    if (normalizedKey) contentByKey.set(normalizedKey, content)
  }

  for (const markdownPath of input.markdownPaths) {
    const sourcePath = contentKey(root, markdownPath)
    const content = contentByKey.get(sourcePath)
    if (typeof content !== 'string') continue
    const plan = planContentReferenceImpact(content, {
      workspacePath: root,
      sourcePath,
      markdownPaths: input.markdownPaths,
      moves: input.moves.map((move) => ({ from: contentKey(root, move.from), to: contentKey(root, move.to) }))
    })
    if (plan.rewrites.length || plan.warnings.length) {
      notes.push({ sourcePath, plan })
    }
  }

  const lockedSources = (input.lockedSourcePaths ?? [])
    .map((path) => contentKey(root, path))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))

  return {
    notes: notes.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    lockedSources
  }
}
