import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceMutationEffects } from './useWorkspaceMutationEffects'
import type { OpenNoteBuffer } from '../lib/mutationReadiness'
import type { PathMove } from '../../shared/api/apiTypes'

type IoMocks = {
  pathExists: (path: string) => Promise<boolean>
  readTextFile: (path: string) => Promise<string>
  writeTextFile: (path: string, content: string) => Promise<void>
  moveEntry: (sourcePath: string, targetDirPath: string, strategy: string) => Promise<string>
}

function createEffects(
  openNotes: OpenNoteBuffer[],
  saveOpenNote: (path: string) => Promise<boolean>,
  io?: Partial<IoMocks>,
  moveSnapshots: { path: string; before: string; after: string }[] = []
) {
  const filesystemErrorMessage = ref('')
  const updateWikilinksForPathMoves = vi.fn(async (_moves: PathMove[]) => ({
    updated_files: moveSnapshots.length,
    reindexed_files: 0,
    moved_markdown_files: 1,
    expanded_markdown_moves: [{ from: '/vault/a.md', to: '/vault/b.md' }],
    rewritten_snapshots: moveSnapshots
  }))
  const updateWikilinksForRename = vi.fn(async () => {
    order.push('rewrite-links')
    return { updated_files: 0, rewritten_snapshots: [] }
  })
  const order: string[] = []
  const ioMocks: IoMocks = {
    pathExists: io?.pathExists ?? (async () => false),
    readTextFile: io?.readTextFile ?? (async () => ''),
    writeTextFile: io?.writeTextFile ?? (async () => {}),
    moveEntry: io?.moveEntry ?? (async (sourcePath: string) => sourcePath)
  }

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
    },
    pathExists: ioMocks.pathExists,
    readTextFile: ioMocks.readTextFile,
    writeTextFile: ioMocks.writeTextFile,
    moveEntry: ioMocks.moveEntry
  })

  return { effects, filesystemErrorMessage, order, updateWikilinksForPathMoves, updateWikilinksForRename, ioMocks }
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

describe('useWorkspaceMutationEffects undo', () => {
  it('restores the last move and consumes the receipt', async () => {
    const moveEntry = vi.fn(async (sourcePath: string) => sourcePath.replace('/vault/b.md', '/vault/a.md'))
    const { effects, ioMocks } = createEffects([], async () => true, {
      pathExists: async (path) => path === '/vault/b.md',
      moveEntry
    })

    await effects.handlePathsMoved([{ from: '/vault/a.md', to: '/vault/b.md' }])
    expect(effects.canUndo.value).toBe(true)

    const undone = await effects.undoLastMutation()
    expect(undone).toBe(true)
    expect(moveEntry).toHaveBeenCalledWith('/vault/b.md', '/vault', 'fail')
    expect(effects.canUndo.value).toBe(false)
    expect(ioMocks.moveEntry).toBe(moveEntry)
  })

  it('never overwrites an occupied original path during undo', async () => {
    const moveEntry = vi.fn(async (sourcePath: string) => sourcePath)
    const { effects, filesystemErrorMessage } = createEffects([], async () => true, {
      pathExists: async (path) => path === '/vault/b.md' || path === '/vault/a.md',
      moveEntry
    })

    await effects.handlePathsMoved([{ from: '/vault/a.md', to: '/vault/b.md' }])
    const undone = await effects.undoLastMutation()

    expect(undone).toBe(false)
    expect(moveEntry).not.toHaveBeenCalled()
    expect(filesystemErrorMessage.value).toContain('already exists')
  })

  it('restores rewritten reference content only when the file still matches the post-operation state', async () => {
    const snapshots = [{ path: '/vault/notes/source.md', before: '[[a]]', after: '[[b]]' }]
    const writeTextFile = vi.fn(async () => {})
    const { effects } = createEffects([], async () => true, {
      pathExists: async (path) => path === '/vault/b.md' || path === '/vault/notes/source.md',
      readTextFile: async () => '[[b]]',
      writeTextFile,
      moveEntry: async (sourcePath: string) => sourcePath.replace('/vault/b.md', '/vault/a.md')
    }, snapshots)

    await effects.handlePathsMoved([{ from: '/vault/a.md', to: '/vault/b.md' }])
    const undone = await effects.undoLastMutation()

    expect(undone).toBe(true)
    expect(writeTextFile).toHaveBeenCalledWith('/vault/notes/source.md', '[[a]]')
  })

  it('refuses reference restore when the file was edited after the operation', async () => {
    const snapshots = [{ path: '/vault/notes/source.md', before: '[[a]]', after: '[[b]]' }]
    const writeTextFile = vi.fn(async () => {})
    const { effects, filesystemErrorMessage } = createEffects([], async () => true, {
      pathExists: async (path) => path === '/vault/b.md' || path === '/vault/notes/source.md',
      readTextFile: async () => 'edited externally',
      writeTextFile,
      moveEntry: async (sourcePath: string) => sourcePath.replace('/vault/b.md', '/vault/a.md')
    }, snapshots)

    await effects.handlePathsMoved([{ from: '/vault/a.md', to: '/vault/b.md' }])
    await effects.undoLastMutation()

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(filesystemErrorMessage.value).toContain('changed since the operation')
  })
})
