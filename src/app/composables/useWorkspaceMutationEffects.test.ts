import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { FavoriteEntry, PathMove } from '../../shared/api/apiTypes'
import { useWorkspaceMutationEffects } from './useWorkspaceMutationEffects'
import { rewritePathWithMoves } from '../lib/pathMoves'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}

function createEffects() {
  const workingFolderPath = ref('/vault')
  const allWorkspaceFiles = ref([
    '/vault/journal/2026-03-06.md',
    '/vault/journal/2026-03-07.md',
    '/vault/notes/a.md'
  ])
  const favoriteItems = ref<FavoriteEntry[]>([
    { path: '/vault/journal/2026-03-06.md', added_at_ms: 1, exists: true }
  ])
  const filesystemErrorMessage = ref('')
  const applyLocalPathMoves = vi.fn((moves: PathMove[], expandedMarkdownMoves: PathMove[]) => {
    allWorkspaceFiles.value = allWorkspaceFiles.value.map((path) => rewritePathWithMoves(path, moves))
    return expandedMarkdownMoves
  })
  const renameFavorite = vi.fn(async () => {})
  const updateWikilinksForRename = vi.fn(async () => ({ updated_files: 2 }))
  const updateWikilinksForPathMoves = vi.fn(async () => ({
    updated_files: 3,
    reindexed_files: 4,
    moved_markdown_files: 2
  }))
  const runWorkspaceMutation = vi.fn(async (task: () => Promise<unknown>) => {
    await task()
  })
  const bumpEchoesRefreshToken = vi.fn()

  return {
    workingFolderPath,
    allWorkspaceFiles,
    favoriteItems,
    filesystemErrorMessage,
    applyLocalPathMoves,
    renameFavorite,
    updateWikilinksForRename,
    updateWikilinksForPathMoves,
    runWorkspaceMutation,
    bumpEchoesRefreshToken,
    effects: useWorkspaceMutationEffects({
      workingFolderPath,
      allWorkspaceFiles,
      favoriteItems,
      filesystemErrorMessage,
      applyLocalPathMoves,
      renameFavorite,
      updateWikilinksForRename,
      updateWikilinksForPathMoves,
      runWorkspaceMutation,
      bumpEchoesRefreshToken
    })
  }
}

describe('useWorkspaceMutationEffects', () => {
  it('routes a rename through local updates, favorite updates, and mutation orchestration', async () => {
    const ctx = createEffects()

    await ctx.effects.handlePathRenamed({ from: '/vault/notes/a.md', to: '/vault/notes/b.md' })

    expect(ctx.applyLocalPathMoves).toHaveBeenCalledWith(
      [{ from: '/vault/notes/a.md', to: '/vault/notes/b.md' }],
      [{ from: '/vault/notes/a.md', to: '/vault/notes/b.md' }]
    )
    expect(ctx.runWorkspaceMutation).toHaveBeenCalledOnce()
    expect(ctx.updateWikilinksForRename).toHaveBeenCalledWith('/vault/notes/a.md', '/vault/notes/b.md')
    expect(ctx.bumpEchoesRefreshToken).toHaveBeenCalledOnce()
  })

  it('handles batch moves and expands folder descendants for local note state', async () => {
    const ctx = createEffects()
    const moves: PathMove[] = [{ from: '/vault/journal', to: '/vault/archive/journal' }]

    await ctx.effects.handlePathsMoved(moves)

    expect(ctx.applyLocalPathMoves).toHaveBeenCalledWith(
      moves,
      [
        {
          from: '/vault/journal/2026-03-06.md',
          to: '/vault/archive/journal/2026-03-06.md'
        },
        {
          from: '/vault/journal/2026-03-07.md',
          to: '/vault/archive/journal/2026-03-07.md'
        }
      ]
    )
    expect(ctx.renameFavorite).toHaveBeenCalledWith(
      '/vault/journal/2026-03-06.md',
      '/vault/archive/journal/2026-03-06.md'
    )
    expect(ctx.updateWikilinksForPathMoves).toHaveBeenCalledWith(moves)
    expect(ctx.bumpEchoesRefreshToken).toHaveBeenCalledOnce()
  })

  it('does nothing for an empty move batch', async () => {
    const ctx = createEffects()

    await ctx.effects.handlePathsMoved([])

    expect(ctx.applyLocalPathMoves).not.toHaveBeenCalled()
    expect(ctx.runWorkspaceMutation).not.toHaveBeenCalled()
    expect(ctx.bumpEchoesRefreshToken).not.toHaveBeenCalled()
  })

  it('serializes rapid successive move batches instead of overlapping them', async () => {
    const ctx = createEffects()
    const first = deferred<void>()
    const second = deferred<void>()
    const callOrder: string[] = []

    ctx.runWorkspaceMutation
      .mockImplementationOnce(async (task: () => Promise<unknown>) => {
        callOrder.push('run-1:start')
        await task()
        await first.promise
        callOrder.push('run-1:end')
      })
      .mockImplementationOnce(async (task: () => Promise<unknown>) => {
        callOrder.push('run-2:start')
        await task()
        await second.promise
        callOrder.push('run-2:end')
      })

    const firstMove = ctx.effects.handlePathsMoved([{ from: '/vault/notes/a.md', to: '/vault/notes/b.md' }])
    const secondMove = ctx.effects.handlePathsMoved([{ from: '/vault/notes/b.md', to: '/vault/notes/c.md' }])
    await flushMicrotasks()

    expect(ctx.updateWikilinksForPathMoves).toHaveBeenCalledTimes(1)
    expect(ctx.updateWikilinksForPathMoves).toHaveBeenNthCalledWith(1, [
      { from: '/vault/notes/a.md', to: '/vault/notes/b.md' }
    ])

    first.resolve()
    await firstMove
    await flushMicrotasks()

    expect(ctx.updateWikilinksForPathMoves).toHaveBeenCalledTimes(2)
    expect(ctx.updateWikilinksForPathMoves).toHaveBeenNthCalledWith(2, [
      { from: '/vault/notes/b.md', to: '/vault/notes/c.md' }
    ])

    second.resolve()
    await secondMove

    expect(callOrder).toEqual([
      'run-1:start',
      'run-1:end',
      'run-2:start',
      'run-2:end'
    ])
    expect(ctx.bumpEchoesRefreshToken).toHaveBeenCalledTimes(2)
  })

  it('applies successive folder and file moves using the updated local workspace state', async () => {
    const ctx = createEffects()

    await ctx.effects.handlePathsMoved([{ from: '/vault/journal', to: '/vault/archive/journal' }])
    await ctx.effects.handlePathsMoved([
      {
        from: '/vault/archive/journal/2026-03-06.md',
        to: '/vault/archive/journal/2026-03-06-renamed.md'
      }
    ])

    expect(ctx.applyLocalPathMoves).toHaveBeenNthCalledWith(
      1,
      [{ from: '/vault/journal', to: '/vault/archive/journal' }],
      [
        {
          from: '/vault/journal/2026-03-06.md',
          to: '/vault/archive/journal/2026-03-06.md'
        },
        {
          from: '/vault/journal/2026-03-07.md',
          to: '/vault/archive/journal/2026-03-07.md'
        }
      ]
    )
    expect(ctx.applyLocalPathMoves).toHaveBeenNthCalledWith(
      2,
      [
        {
          from: '/vault/archive/journal/2026-03-06.md',
          to: '/vault/archive/journal/2026-03-06-renamed.md'
        }
      ],
      [
        {
          from: '/vault/archive/journal/2026-03-06.md',
          to: '/vault/archive/journal/2026-03-06-renamed.md'
        }
      ]
    )
    expect(ctx.allWorkspaceFiles.value).toContain('/vault/archive/journal/2026-03-06-renamed.md')
    expect(ctx.allWorkspaceFiles.value).not.toContain('/vault/journal/2026-03-06.md')
  })
})
