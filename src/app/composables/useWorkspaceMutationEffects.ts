import type { Ref } from 'vue'
import type { FavoriteEntry, PathMove, PathMoveRewriteResult } from '../../shared/api/apiTypes'
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
  updateWikilinksForRename: (fromPath: string, toPath: string) => Promise<{ updated_files: number }>
  updateWikilinksForPathMoves: (moves: PathMove[]) => Promise<PathMoveRewriteResult>
  moveNoteHistoryEntries: (moves: PathMove[]) => Promise<void>
  runWorkspaceMutation: (task: () => Promise<WorkspaceMutationResult>) => Promise<void>
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
      const result = await options.updateWikilinksForRename(payload.from, payload.to)
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
      const result = await options.updateWikilinksForPathMoves(normalizedMoves)
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

  return {
    handlePathRenamed,
    handlePathsMoved
  }
}
