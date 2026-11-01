import { computed, ref, type Ref } from 'vue'
import type { FavoriteEntry, PathMove, PathMoveRewriteResult, WikilinkRewriteResult } from '../../shared/api/apiTypes'
import { getParentPath } from '../../domains/explorer/lib/explorerTreeUtils'
import { assessMutationReadiness, type OpenNoteBuffer } from '../lib/mutationReadiness'
import { createOperationReceipt, planReceiptRestore, type OperationReceipt, type ReceiptReferenceSnapshot } from '../lib/operationReceipt'
import { expandPathMoves, rewritePathWithMoves, sortPathMoves } from '../lib/pathMoves'
import type { WorkspaceMutationResult } from './useAppIndexingController'
import { createWorkspaceMutationScheduler } from './workspaceMutationScheduler'

/**
 * Module: useWorkspaceMutationEffects
 *
 * Purpose:
 * - Own app-level follow-up work after successful explorer/editor path moves.
 *
 * Boundaries:
 * - Explorer and DnD only emit completed move intents.
 * - This composable coordinates immediate local path patches, batch wikilink
 *   repair, and deferred workspace-wide state refreshes.
 */

export type UseWorkspaceMutationEffectsOptions = {
  workingFolderPath: Readonly<Ref<string>>
  allWorkspaceFiles: Readonly<Ref<string[]>>
  favoriteItems: Readonly<Ref<FavoriteEntry[]>>
  filesystemErrorMessage: Ref<string>
  getImmediatePathCandidates: () => string[]
  applyImmediateLocalPathMoves: (moves: PathMove[], expandedMarkdownMoves: PathMove[]) => void
  applyDeferredLocalPathMoves: (moves: PathMove[], expandedMarkdownMoves: PathMove[]) => void
  renameFavorite: (fromPath: string, toPath: string) => Promise<void>
  updateWikilinksForRename: (fromPath: string, toPath: string) => Promise<WikilinkRewriteResult>
  updateWikilinksForPathMoves: (moves: PathMove[]) => Promise<PathMoveRewriteResult>
  moveNoteHistoryEntries: (moves: PathMove[]) => Promise<void>
  runWorkspaceMutation: (task: () => Promise<WorkspaceMutationResult>) => Promise<void>
  /** Lists open editor buffers so unsaved notes can be flushed before link rewrites. */
  listOpenNotes?: () => OpenNoteBuffer[]
  /** Saves the open buffer at the given (already moved) path; resolves false on conflict/failure. */
  saveOpenNote?: (path: string) => Promise<boolean>
  /** IO ports used to validate and apply an undo receipt without overwriting. */
  pathExists: (path: string) => Promise<boolean>
  readTextFile: (path: string) => Promise<string>
  writeTextFile: (path: string, content: string) => Promise<void>
  moveEntry: (sourcePath: string, targetDirPath: string, strategy: 'fail' | 'rename' | 'overwrite') => Promise<string>
}

/**
 * Flushes unsaved buffers of open notes affected by the moves before any link
 * rewrite touches disk. Failures are reported but never abort the move batch:
 * the existing save/conflict flow still protects those buffers afterwards.
 */
async function reconcileDirtyOpenNotes(moves: PathMove[], options: UseWorkspaceMutationEffectsOptions) {
  if (!options.listOpenNotes || !options.saveOpenNote) return
  // Local state was already patched to the new paths, so map open notes back
  // through the reversed moves to find the ones the mutation just affected.
  const reverseMoves = moves.map((move) => ({ from: move.to, to: move.from }))
  const { dirtyAffected } = assessMutationReadiness({ moves: reverseMoves, openNotes: options.listOpenNotes() })
  for (const note of dirtyAffected) {
    try {
      const saved = await options.saveOpenNote(note.from)
      if (!saved) {
        options.filesystemErrorMessage.value = `Unsaved changes in "${note.from}" could not be saved before updating links. Resolve the conflict before saving.`
      }
    } catch (err) {
      options.filesystemErrorMessage.value = err instanceof Error ? err.message : 'Could not save an open note before updating links.'
    }
  }
}

function normalizeMoves(moves: PathMove[]): PathMove[] {
  return sortPathMoves(moves).filter((move, index, allMoves) =>
    index === allMoves.findIndex((candidate) => candidate.from.toLowerCase() === move.from.toLowerCase())
  )
}

async function renameFavoritesForMoves(
  moves: PathMove[],
  favoriteItems: FavoriteEntry[],
  renameFavorite: (fromPath: string, toPath: string) => Promise<void>
) {
  for (const favorite of favoriteItems) {
    const nextPath = rewritePathWithMoves(favorite.path, moves)
    if (!nextPath || nextPath === favorite.path) continue
    await renameFavorite(favorite.path, nextPath)
  }
}

export function useWorkspaceMutationEffects(options: UseWorkspaceMutationEffectsOptions) {
  let mutationQueue = Promise.resolve()
  const deferredScheduler = createWorkspaceMutationScheduler()
  const lastReceipt = ref<OperationReceipt | null>(null)
  const canUndo = computed(() => Boolean(lastReceipt.value))

  function recordReceipt(kind: OperationReceipt['kind'], moves: PathMove[], snapshots: ReceiptReferenceSnapshot[]) {
    lastReceipt.value = createOperationReceipt({ kind, moves, referenceSnapshots: snapshots })
  }

  function enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
    const run = mutationQueue.catch(() => undefined).then(task)
    mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  function applyImmediateLocalMoves(moves: PathMove[]) {
    const normalizedMoves = normalizeMoves(moves)
    if (!normalizedMoves.length) {
      return { normalizedMoves, expandedMarkdownMoves: [] as PathMove[] }
    }

    const expandedMarkdownMoves = expandPathMoves(normalizedMoves, options.getImmediatePathCandidates())
    options.applyImmediateLocalPathMoves(normalizedMoves, expandedMarkdownMoves)
    return { normalizedMoves, expandedMarkdownMoves }
  }

  async function scheduleDeferredLocalSync(moves: PathMove[], expandedMarkdownMoves: PathMove[]) {
    await deferredScheduler.schedule(() => {
      options.applyDeferredLocalPathMoves(moves, expandedMarkdownMoves)
    })
  }

  async function handlePathRenamedNow(payload: { from: string; to: string }) {
    const root = options.workingFolderPath.value
    if (!root) return

    const normalizedMoves = normalizeMoves([{ from: payload.from, to: payload.to }])
    if (!normalizedMoves.length) return

    try {
      await renameFavoritesForMoves(normalizedMoves, options.favoriteItems.value, options.renameFavorite)
    } catch (err) {
      options.filesystemErrorMessage.value = err instanceof Error ? err.message : 'Could not update favorite.'
    }

    await options.runWorkspaceMutation(async () => {
      await reconcileDirtyOpenNotes(normalizedMoves, options)
      const result = await options.updateWikilinksForRename(payload.from, payload.to)
      recordReceipt('rename', normalizedMoves, result.rewritten_snapshots)
      await scheduleDeferredLocalSync(normalizedMoves, normalizedMoves)
      try {
        await options.moveNoteHistoryEntries(normalizedMoves)
      } catch (err) {
        options.filesystemErrorMessage.value = err instanceof Error ? err.message : 'Could not update note history.'
      }
      return {
        updatedFiles: result.updated_files,
        reindexedFiles: result.updated_files
      }
    })
  }

  async function handlePathsMovedNow(moves: PathMove[]) {
    const root = options.workingFolderPath.value
    const normalizedMoves = normalizeMoves(moves)
    if (!root || !normalizedMoves.length) return

    try {
      await renameFavoritesForMoves(normalizedMoves, options.favoriteItems.value, options.renameFavorite)
    } catch (err) {
      options.filesystemErrorMessage.value = err instanceof Error ? err.message : 'Could not update favorite.'
    }

    await options.runWorkspaceMutation(async () => {
      await reconcileDirtyOpenNotes(normalizedMoves, options)
      const result = await options.updateWikilinksForPathMoves(normalizedMoves)
      recordReceipt('move', normalizedMoves, result.rewritten_snapshots)
      await scheduleDeferredLocalSync(normalizedMoves, result.expanded_markdown_moves)
      try {
        await options.moveNoteHistoryEntries(result.expanded_markdown_moves)
      } catch (err) {
        options.filesystemErrorMessage.value = err instanceof Error ? err.message : 'Could not update note history.'
      }
      return {
        updatedFiles: result.updated_files,
        reindexedFiles: result.reindexed_files
      }
    })
  }

  function handlePathRenamed(payload: { from: string; to: string }) {
    const root = options.workingFolderPath.value
    if (!root) return Promise.resolve()
    applyImmediateLocalMoves([{ from: payload.from, to: payload.to }])
    return enqueueMutation(() => handlePathRenamedNow(payload))
  }

  function handlePathsMoved(moves: PathMove[]) {
    const root = options.workingFolderPath.value
    if (!root) return Promise.resolve()
    const { normalizedMoves } = applyImmediateLocalMoves(moves)
    if (!normalizedMoves.length) return Promise.resolve()
    return enqueueMutation(() => handlePathsMovedNow(moves))
  }

  /**
   * Restores the most recent recoverable mutation. Validates current disk state
   * first and never overwrites: occupied originals, vanished destinations and
   * externally changed files are reported and left intact. On any applied
   * change the receipt is consumed and local views are re-synced.
   */
  async function undoLastMutation(): Promise<boolean> {
    const current = lastReceipt.value
    const root = options.workingFolderPath.value
    if (!current || !root) return false

    const involved = new Set<string>()
    for (const move of current.moves) {
      involved.add(move.from)
      involved.add(move.to)
    }
    for (const snapshot of current.referenceSnapshots) {
      involved.add(snapshot.path)
    }
    const currentPaths: string[] = []
    await Promise.all(
      Array.from(involved).map(async (path) => {
        try {
          if (await options.pathExists(path)) currentPaths.push(path)
        } catch {
          // Treat unreadable paths as absent; restoration stays conservative.
        }
      })
    )
    const currentContents: Record<string, string> = {}
    for (const snapshot of current.referenceSnapshots) {
      try {
        currentContents[snapshot.path] = await options.readTextFile(snapshot.path)
      } catch {
        // Missing or unreadable: planReceiptRestore reports it as changed.
      }
    }

    const plan = planReceiptRestore({ receipt: current, currentPaths, currentContents })
    if (plan.issues.length) {
      const reasons = plan.issues
        .map((issue) => {
          if (issue.reason === 'occupied_source') return `"${issue.path}" already exists`
          if (issue.reason === 'missing_destination') return `"${issue.path}" no longer exists`
          return `"${issue.path}" changed since the operation`
        })
        .join('; ')
      options.filesystemErrorMessage.value = `Undo stopped safely: ${reasons}.`
    }

    const appliedMoves: PathMove[] = []
    for (const move of plan.moves) {
      try {
        const restored = await options.moveEntry(move.from, getParentPath(move.to), 'fail')
        appliedMoves.push({ from: move.from, to: restored })
      } catch (err) {
        options.filesystemErrorMessage.value = err instanceof Error ? err.message : `Could not restore "${move.from}".`
      }
    }
    for (const restore of plan.referenceRestores) {
      try {
        await options.writeTextFile(restore.path, restore.content)
      } catch (err) {
        options.filesystemErrorMessage.value = err instanceof Error ? err.message : `Could not restore references in "${restore.path}".`
      }
    }

    if (!appliedMoves.length && !plan.referenceRestores.length) {
      return false
    }

    if (appliedMoves.length) {
      applyImmediateLocalMoves(appliedMoves)
      await scheduleDeferredLocalSync(appliedMoves, appliedMoves)
      try {
        await options.moveNoteHistoryEntries(appliedMoves)
      } catch (err) {
        options.filesystemErrorMessage.value = err instanceof Error ? err.message : 'Could not update note history.'
      }
    }
    lastReceipt.value = null
    return true
  }

  return {
    handlePathRenamed,
    handlePathsMoved,
    undoLastMutation,
    canUndo,
    lastReceipt
  }
}
