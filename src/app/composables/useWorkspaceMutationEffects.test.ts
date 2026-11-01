import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceMutationEffects } from './useWorkspaceMutationEffects'
import type { OpenNoteBuffer } from '../lib/mutationReadiness'
import type { PathMove } from '../../shared/api/apiTypes'

function createEffects(openNotes: OpenNoteBuffer[], saveOpenNote: (path: string) => Promise<boolean>) {
  const filesystemErrorMessage = ref('')
  const updateWikilinksForPathMoves = vi.fn(async (_moves: PathMove[]) => ({
    updated_files: 0,
    reindexed_files: 0,
    moved_markdown_files: 1,
    expanded_markdown_moves: [{ from: '/vault/a.md', to: '/vault/b.md' }]
  }))
  const updateWikilinksForRename = vi.fn(async () => {
    order.push('rewrite-links')
    return { updated_files: 0 }
  })
  const order: string[] = []

  const effects = useWorkspaceMutationEffects({
    workingFolderPath: ref('/vault'),
    allWorkspaceFiles: ref(['/vault/a.md']),
    favoriteItems: ref([]),
    filesystemErrorMessage,
    getImmediatePathCandidates: () => ['/vault/a.md'],
    applyImmediateLocalPathMoves: vi.fn(),
    applyDeferredLocalPathMoves: vi.fn(),
    renameFavorite: vi.fn(async () => {}),
    updateWikilinksForRename,
    updateWikilinksForPathMoves: vi.fn(async (moves: PathMove[]) => {
      order.push('rewrite-links')
      return await updateWikilinksForPathMoves(moves)
    }),
    moveNoteHistoryEntries: vi.fn(async () => {}),
    runWorkspaceMutation: async (task) => {
      await task()
    },
    listOpenNotes: () => openNotes,
    saveOpenNote: async (path) => {
      order.push(`save:${path}`)
      return await saveOpenNote(path)
    }
  })

  return { effects, filesystemErrorMessage, order, updateWikilinksForPathMoves, updateWikilinksForRename }
}

describe('useWorkspaceMutationEffects dirty-buffer coordination', () => {
  it('saves an affected dirty open note at its new path before rewriting links', async () => {
    const { effects, order, updateWikilinksForPathMoves } = createEffects(
      [{ path: '/vault/b.md', dirty: true }, { path: '/vault/other.md', dirty: true }],
      async () => true
    )

    await effects.handlePathsMoved([{ from: '/vault/a.md', to: '/vault/b.md' }])

    expect(order).toEqual(['save:/vault/b.md', 'rewrite-links'])
    expect(updateWikilinksForPathMoves).toHaveBeenCalled()
  })

  it('reports a clear message when an affected dirty buffer cannot be saved', async () => {
    const { effects, filesystemErrorMessage, order } = createEffects(
      [{ path: '/vault/b.md', dirty: true }],
      async () => false
    )

    await effects.handlePathsMoved([{ from: '/vault/a.md', to: '/vault/b.md' }])

    expect(order).toEqual(['save:/vault/b.md', 'rewrite-links'])
    expect(filesystemErrorMessage.value).toContain('/vault/b.md')
    expect(filesystemErrorMessage.value).toContain('could not be saved')
  })

  it('does not save clean or unaffected open notes', async () => {
    const saveOpenNote = vi.fn(async () => true)
    const { effects, order } = createEffects(
      [{ path: '/vault/b.md', dirty: false }, { path: '/vault/other.md', dirty: true }],
      saveOpenNote
    )

    await effects.handlePathsMoved([{ from: '/vault/a.md', to: '/vault/b.md' }])

    expect(saveOpenNote).not.toHaveBeenCalled()
    expect(order).toEqual(['rewrite-links'])
  })

  it('flushes the renamed note buffer before the rename link rewrite', async () => {
    const { effects, order } = createEffects(
      [{ path: '/vault/renamed.md', dirty: true }],
      async () => true
    )

    await effects.handlePathRenamed({ from: '/vault/a.md', to: '/vault/renamed.md' })

    expect(order).toEqual(['save:/vault/renamed.md', 'rewrite-links'])
  })
})
