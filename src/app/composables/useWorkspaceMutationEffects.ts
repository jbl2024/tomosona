import type { Ref } from 'vue'
import type { FavoriteEntry, PathMove, PathMoveRewriteResult } from '../../shared/api/apiTypes'
import { expandPathMoves, rewritePathWithMoves, sortPathMoves } from '../lib/pathMoves'
import type { WorkspaceMutationResult } from './useAppIndexingController'

/**
 * Module: useWorkspaceMutationEffects
 *
 * Purpose:
 * - Own app-level follow-up work after successful explorer/editor path moves.
 *
 * Boundaries:
 * - Explorer and DnD only emit completed move intents.
 * - This composable coordinates local path rewrites, favorite updates,
 *   batch wikilink repair, and derived-surface invalidation.
 */

export type UseWorkspaceMutationEffectsOptions = {
  workingFolderPath: Readonly<Ref<string>>
  allWorkspaceFiles: Readonly<Ref<string[]>>
  favoriteItems: Readonly<Ref<FavoriteEntry[]>>
  filesystemErrorMessage: Ref<string>
  applyLocalPathMoves: (moves: PathMove[], expandedMarkdownMoves: PathMove[]) => void
  renameFavorite: (fromPath: string, toPath: string) => Promise<void>
  updateWikilinksForRename: (fromPath: string, toPath: string) => Promise<{ updated_files: number }>
  updateWikilinksForPathMoves: (moves: PathMove[]) => Promise<PathMoveRewriteResult>
  runWorkspaceMutation: (task: () => Promise<WorkspaceMutationResult>) => Promise<void>
  bumpEchoesRefreshToken: () => void
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

  function enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
    const run = mutationQueue.catch(() => undefined).then(task)
    mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  async function handlePathRenamedNow(payload: { from: string; to: string }) {
    const root = options.workingFolderPath.value
    if (!root) return

    const moves = normalizeMoves([{ from: payload.from, to: payload.to }])
    if (!moves.length) return

    const expandedMarkdownMoves = expandPathMoves(moves, options.allWorkspaceFiles.value)
    options.applyLocalPathMoves(moves, expandedMarkdownMoves)

    try {
      await renameFavoritesForMoves(moves, options.favoriteItems.value, options.renameFavorite)
    } catch (err) {
      options.filesystemErrorMessage.value = err instanceof Error ? err.message : 'Could not update favorite.'
    }

    await options.runWorkspaceMutation(async () => {
      const result = await options.updateWikilinksForRename(payload.from, payload.to)
      return {
        updatedFiles: result.updated_files,
        reindexedFiles: result.updated_files
      }
    })
    options.bumpEchoesRefreshToken()
  }

  async function handlePathsMovedNow(moves: PathMove[]) {
    const root = options.workingFolderPath.value
    const normalizedMoves = normalizeMoves(moves)
    if (!root || !normalizedMoves.length) return

    const expandedMarkdownMoves = expandPathMoves(normalizedMoves, options.allWorkspaceFiles.value)
    options.applyLocalPathMoves(normalizedMoves, expandedMarkdownMoves)

    try {
      await renameFavoritesForMoves(normalizedMoves, options.favoriteItems.value, options.renameFavorite)
    } catch (err) {
      options.filesystemErrorMessage.value = err instanceof Error ? err.message : 'Could not update favorite.'
    }

    await options.runWorkspaceMutation(async () => {
      const result = await options.updateWikilinksForPathMoves(normalizedMoves)
      return {
        updatedFiles: result.updated_files,
        reindexedFiles: result.reindexed_files
      }
    })
    options.bumpEchoesRefreshToken()
  }

  function handlePathRenamed(payload: { from: string; to: string }) {
    return enqueueMutation(() => handlePathRenamedNow(payload))
  }

  function handlePathsMoved(moves: PathMove[]) {
    return enqueueMutation(() => handlePathsMovedNow(moves))
  }

  return {
    handlePathRenamed,
    handlePathsMoved
  }
}
