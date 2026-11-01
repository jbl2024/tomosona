/**
 * Module: operationReceipt
 *
 * Purpose:
 * - Represent the most recent recoverable workspace mutation as a bounded,
 *   session-scoped receipt and validate its restoration before any write.
 *
 * Boundaries:
 * - Receipts are plain data; this module never touches the filesystem.
 * - Restoration is planned, never executed here: callers apply the plan
 *   through existing mutation commands with explicit conflict strategies.
 * - Validation never overwrites: an occupied original path, a vanished
 *   destination or a reference file changed since the operation are reported
 *   as issues and left intact.
 */

import { normalizeWorkspacePath, toWorkspacePathKey } from '../../domains/explorer/lib/workspacePaths'
import type { PathMove } from '../../shared/api/apiTypes'
import { sortPathMoves } from './pathMoves'

/** Content of one reference-bearing note captured around a mutation. */
export type ReceiptReferenceSnapshot = {
  path: string
  before: string
  after: string
}

/** One recoverable operation: path mappings plus changed reference contents. */
export type OperationReceipt = {
  id: string
  kind: 'move' | 'rename' | 'trash'
  moves: PathMove[]
  referenceSnapshots: ReceiptReferenceSnapshot[]
  createdAtMs: number
}

/** Inputs for creating a receipt; id and timestamp are injectable for tests. */
export type CreateOperationReceiptInput = {
  kind: OperationReceipt['kind']
  moves: PathMove[]
  referenceSnapshots?: ReceiptReferenceSnapshot[]
  id?: string
  now?: () => number
}

/** Creates a receipt, dropping no-op moves and normalizing paths. */
export function createOperationReceipt(input: CreateOperationReceiptInput): OperationReceipt {
  const moves = sortPathMoves(input.moves)
  return {
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    moves,
    referenceSnapshots: input.referenceSnapshots ?? [],
    createdAtMs: (input.now ?? Date.now)()
  }
}

/** Why one entry of a receipt cannot be restored safely right now. */
export type RestoreIssue = {
  path: string
  reason: 'occupied_source' | 'missing_destination' | 'changed_content'
}

/** Validated restoration plan for a receipt; empty moves mean nothing to do. */
export type ReceiptRestorePlan = {
  /** Reversed moves to execute (current location -> original location). */
  moves: PathMove[]
  /** Reference files whose captured `after` content is still current. */
  referenceRestores: { path: string; content: string }[]
  issues: RestoreIssue[]
}

/** Inputs for validating restoration against current filesystem state. */
export type PlanReceiptRestoreInput = {
  receipt: OperationReceipt
  /** Paths that currently exist on disk. */
  currentPaths: string[]
  /** Current content of the receipt's reference-bearing notes. */
  currentContents: Record<string, string>
}

function cleanPath(path: string): string {
  return normalizeWorkspacePath(path).replace(/\/+$/, '')
}

/**
 * Plans a safe undo for a receipt without overwriting anything.
 *
 * A move is restored only when its current destination still exists and its
 * original location is free; a reference is restored only when the file still
 * holds the exact post-operation content. Anything else becomes an issue and
 * is left untouched.
 */
export function planReceiptRestore(input: PlanReceiptRestoreInput): ReceiptRestorePlan {
  const { receipt } = input
  const existing = new Set(input.currentPaths.map((path) => toWorkspacePathKey(cleanPath(path))))
  const moves: PathMove[] = []
  const issues: RestoreIssue[] = []

  for (const move of receipt.moves) {
    const from = cleanPath(move.from)
    const to = cleanPath(move.to)
    if (!from || !to || from === to) continue
    if (!existing.has(toWorkspacePathKey(to))) {
      issues.push({ path: to, reason: 'missing_destination' })
      continue
    }
    if (existing.has(toWorkspacePathKey(from))) {
      issues.push({ path: from, reason: 'occupied_source' })
      continue
    }
    moves.push({ from: to, to: from })
  }

  const referenceRestores: { path: string; content: string }[] = []
  for (const snapshot of receipt.referenceSnapshots) {
    const path = cleanPath(snapshot.path)
    if (!path) continue
    const current = input.currentContents[path]
    if (current === snapshot.after) {
      referenceRestores.push({ path, content: snapshot.before })
    } else if (current !== snapshot.before) {
      // Covers both externally changed content and unverifiable content.
      issues.push({ path, reason: 'changed_content' })
    }
  }

  return {
    moves: sortPathMoves(moves),
    referenceRestores,
    issues
  }
}
