import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExplorerOperations } from './useExplorerOperations'
import type { MovePreflightEntry, PathMove, TreeNode } from '../../../shared/api/apiTypes'

const copyEntry = vi.fn<(sourcePath: string, targetDirPath: string, strategy: string) => Promise<string>>()
const duplicateEntry = vi.fn<(path: string, strategy: string) => Promise<string>>()
const moveEntry = vi.fn<(sourcePath: string, targetDirPath: string, strategy: string) => Promise<string>>()
const openPathExternal = vi.fn<(path: string) => Promise<void>>()
const preflightMoveEntries = vi.fn<(sourcePaths: string[], targetDirPath: string) => Promise<MovePreflightEntry[]>>()
const preflightRenameEntry = vi.fn<(sourcePath: string, newName: string) => Promise<MovePreflightEntry>>()
const preflightTrashEntries = vi.fn<(sourcePaths: string[]) => Promise<MovePreflightEntry[]>>()
const revalidateMoveEntry = vi.fn<(sourcePath: string, targetDirPath: string, expectedVersion: unknown) => Promise<MovePreflightEntry>>()
const renameEntry = vi.fn<(path: string, newName: string, strategy: string) => Promise<string>>()
const revealInFileManager = vi.fn<(path: string) => Promise<void>>()
const trashEntry = vi.fn<(path: string) => Promise<string>>()
const emitOpen = vi.fn<(path: string) => void>()

vi.mock('../../../shared/api/workspaceApi', () => ({
  copyEntry: (sourcePath: string, targetDirPath: string, strategy: string) =>
    copyEntry(sourcePath, targetDirPath, strategy),
  duplicateEntry: (path: string, strategy: string) => duplicateEntry(path, strategy),
  moveEntry: (sourcePath: string, targetDirPath: string, strategy: string) =>
    moveEntry(sourcePath, targetDirPath, strategy),
  openPathExternal: (path: string) => openPathExternal(path),
  preflightMoveEntries: (sourcePaths: string[], targetDirPath: string) => preflightMoveEntries(sourcePaths, targetDirPath),
  preflightRenameEntry: (sourcePath: string, newName: string) => preflightRenameEntry(sourcePath, newName),
  preflightTrashEntries: (sourcePaths: string[]) => preflightTrashEntries(sourcePaths),
  revalidateMoveEntry: (sourcePath: string, targetDirPath: string, expectedVersion: unknown) =>
    revalidateMoveEntry(sourcePath, targetDirPath, expectedVersion),
  renameEntry: (path: string, newName: string, strategy: string) =>
    renameEntry(path, newName, strategy),
  revealInFileManager: (path: string) => revealInFileManager(path),
  trashEntry: (path: string) => trashEntry(path)
}))

function readyPreflight(sourcePath: string): MovePreflightEntry {
  return { sourcePath, destinationPath: '/vault/dest', sourceVersion: null, issue: null }
}

function installDefaultPreflights() {
  preflightMoveEntries.mockImplementation(async (sourcePaths: string[]) => sourcePaths.map(readyPreflight))
  preflightRenameEntry.mockImplementation(async (sourcePath: string) => readyPreflight(sourcePath))
  preflightTrashEntries.mockImplementation(async (sourcePaths: string[]) => sourcePaths.map(readyPreflight))
  revalidateMoveEntry.mockImplementation(async (sourcePath: string) => readyPreflight(sourcePath))
}

function fileNode(path: string): TreeNode {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: false,
    is_markdown: true,
    has_children: false
  }
}

function dirNode(path: string): TreeNode {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: true,
    is_markdown: false,
    has_children: true
  }
}

function createOperations() {
  const focusedPath = ref('/vault/a.md')
  const selected = ref<string[]>(['/vault/a.md'])
  const emittedSelection = vi.fn((paths: string[]) => {
    selected.value = paths
  })
  const emittedMoves = vi.fn((moves: PathMove[]) => moves)
  const emittedError = vi.fn((message: string) => message)

  const ops = useExplorerOperations({
    folderPath: ref('/vault'),
    focusedPath,
    nodeByPath: ref<Record<string, TreeNode>>({
      '/vault/a.md': fileNode('/vault/a.md'),
      '/vault/long.note.markdown': {
        name: 'long.note.markdown',
        path: '/vault/long.note.markdown',
        is_dir: false,
        is_markdown: true,
        has_children: false
      },
      '/vault/raw.bin': {
        name: 'raw.bin',
        path: '/vault/raw.bin',
        is_dir: false,
        is_markdown: false,
        has_children: false
      },
      '/vault/folder': dirNode('/vault/folder')
    }),
    selectionPaths: computed(() => selected.value),
    clearSelection: () => {
      selected.value = []
    },
    isSelected: (path) => selected.value.includes(path),
    setSelection: (paths) => {
      selected.value = paths
    },
    emitSelection: emittedSelection,
    emitError: emittedError,
    emitOpen,
    emitPathRenamed: vi.fn(),
    emitPathsMoved: emittedMoves,
    emitPathsDeleted: vi.fn(),
    emitRequestCreate: vi.fn(),
    loadChildren: vi.fn(async () => {}),
    refreshLoadedDirs: vi.fn(async () => {})
  })

  return { ops, focusedPath, selected, emittedSelection, emittedMoves, emittedError }
}

describe('useExplorerOperations', () => {
  afterEach(() => {
    copyEntry.mockReset()
    duplicateEntry.mockReset()
    moveEntry.mockReset()
    openPathExternal.mockReset()
    preflightMoveEntries.mockReset()
    preflightRenameEntry.mockReset()
    preflightTrashEntries.mockReset()
    revalidateMoveEntry.mockReset()
    renameEntry.mockReset()
    revealInFileManager.mockReset()
    trashEntry.mockReset()
    emitOpen.mockReset()
  })

  beforeEach(() => {
    installDefaultPreflights()
  })

  it('renames a selected markdown file and updates selection', async () => {
    renameEntry.mockResolvedValue('/vault/renamed.md')
    const { ops, selected } = createOperations()

    ops.startRename('/vault/a.md')
    ops.editingValue.value = 'renamed.md'
    await ops.confirmRename()

    expect(renameEntry).toHaveBeenCalledWith('/vault/a.md', 'renamed.md', 'fail')
    expect(selected.value).toEqual(['/vault/renamed.md'])
  })

  it('edits only the markdown stem and preserves the original extension on confirm', async () => {
    renameEntry.mockResolvedValue('/vault/renamed.markdown')
    const { ops } = createOperations()

    ops.startRename('/vault/long.note.markdown')
    expect(ops.editingValue.value).toBe('long.note')
    expect(ops.editingExtension.value).toBe('.markdown')
    expect(ops.editingSelectionEnd.value).toBe('long.note'.length)

    ops.editingValue.value = 'renamed'
    await ops.confirmRename()
    expect(renameEntry).toHaveBeenCalledWith('/vault/long.note.markdown', 'renamed.markdown', 'fail')
  })

  it('keeps the full name for folders and non-markdown files', async () => {
    renameEntry.mockResolvedValue('/vault/folder2')
    const { ops } = createOperations()

    ops.startRename('/vault/folder')
    expect(ops.editingValue.value).toBe('folder')
    expect(ops.editingExtension.value).toBe('')

    ops.editingValue.value = 'folder2'
    await ops.confirmRename()
    expect(renameEntry).toHaveBeenCalledWith('/vault/folder', 'folder2', 'fail')
  })

  it('rejects empty and invalid rename names without touching the filesystem', async () => {
    const { ops, emittedError } = createOperations()

    ops.startRename('/vault/a.md')
    ops.editingValue.value = '   '
    await ops.confirmRename()
    expect(emittedError).toHaveBeenCalledWith('Name cannot be empty.')
    expect(renameEntry).not.toHaveBeenCalled()

    ops.editingValue.value = 'bad/name'
    await ops.confirmRename()
    expect(emittedError).toHaveBeenCalledWith('Name contains invalid characters.')
    expect(renameEntry).not.toHaveBeenCalled()
    // The row stays in edit mode so the user can correct the name.
    expect(ops.editingPath.value).toBe('/vault/a.md')
  })

  it('blocks a move when the native preflight reports a blocking issue', async () => {
    preflightMoveEntries.mockResolvedValue([
      { sourcePath: '/vault/folder', destinationPath: null, sourceVersion: null, issue: 'descendant' }
    ])
    const { ops, emittedError } = createOperations()

    await ops.executeMove('/vault/folder/child', ['/vault/folder'])

    expect(emittedError).toHaveBeenCalledWith('A folder cannot be moved into itself.')
    expect(moveEntry).not.toHaveBeenCalled()
  })

  it('skips entries whose revalidation turns stale and still moves the rest', async () => {
    moveEntry.mockImplementation(async (sourcePath: string) => `${sourcePath}-moved`)
    preflightMoveEntries.mockResolvedValue([
      { sourcePath: '/vault/a.md', destinationPath: '/vault/dest/a.md', sourceVersion: { size: 3, modifiedMs: 1, isDir: false }, issue: null },
      { sourcePath: '/vault/folder', destinationPath: '/vault/dest/folder', sourceVersion: null, issue: null }
    ])
    revalidateMoveEntry.mockImplementation(async (sourcePath: string) => ({
      sourcePath,
      destinationPath: null,
      sourceVersion: null,
      issue: sourcePath === '/vault/a.md' ? 'stale_source' : null
    }))
    const { ops, emittedError, emittedMoves } = createOperations()

    await ops.executeMove('/vault/dest', ['/vault/a.md', '/vault/folder'])

    expect(emittedError).toHaveBeenCalledWith('The file changed since it was checked. Refresh and try again.')
    expect(moveEntry).toHaveBeenCalledTimes(1)
    expect(moveEntry).toHaveBeenCalledWith('/vault/folder', '/vault/dest', 'fail')
    expect(emittedMoves).toHaveBeenCalledWith([{ from: '/vault/folder', to: '/vault/folder-moved' }])
  })

  it('blocks a rename when the preflight rejects the name and stays in edit mode', async () => {
    preflightRenameEntry.mockResolvedValue({
      sourcePath: '/vault/a.md',
      destinationPath: null,
      sourceVersion: null,
      issue: 'read_only'
    })
    const { ops, emittedError } = createOperations()

    ops.startRename('/vault/a.md')
    ops.editingValue.value = 'renamed'
    await ops.confirmRename()

    expect(emittedError).toHaveBeenCalledWith('The source is read-only.')
    expect(renameEntry).not.toHaveBeenCalled()
    expect(ops.editingPath.value).toBe('/vault/a.md')
  })

  it('trashes only the deletable entries when the trash preflight blocks some', async () => {
    preflightTrashEntries.mockResolvedValue([
      readyPreflight('/vault/a.md'),
      { sourcePath: '/vault/folder', destinationPath: null, sourceVersion: null, issue: 'workspace_root' }
    ])
    trashEntry.mockResolvedValue('/vault/.tomosona-trash/a.md')
    const { ops, emittedError } = createOperations()

    await ops.executeDelete(['/vault/a.md', '/vault/folder'])

    expect(emittedError).toHaveBeenCalledWith('The workspace root cannot be moved.')
    expect(trashEntry).toHaveBeenCalledTimes(1)
    expect(trashEntry).toHaveBeenCalledWith('/vault/a.md')
  })

  it('blocks a cut/paste move when the preflight reports a blocking issue', async () => {
    preflightMoveEntries.mockResolvedValue([
      { sourcePath: '/vault/a.md', destinationPath: null, sourceVersion: null, issue: 'symlink' }
    ])
    const { ops, emittedError } = createOperations()
    ops.setClipboard('cut', ['/vault/a.md'])

    await ops.executePaste('/vault/dest')

    expect(emittedError).toHaveBeenCalledWith('Symbolic links are not supported.')
    expect(moveEntry).not.toHaveBeenCalled()
    expect(ops.clipboard.value).toEqual({ mode: 'cut', paths: ['/vault/a.md'] })
  })

  it('emits moved pairs for a successful cut/paste so references follow', async () => {
    moveEntry.mockResolvedValue('/vault/dest/a.md')
    const { ops, emittedMoves } = createOperations()
    ops.setClipboard('cut', ['/vault/a.md'])

    await ops.executePaste('/vault/dest')

    expect(preflightMoveEntries).toHaveBeenCalledWith(['/vault/a.md'], '/vault/dest')
    expect(moveEntry).toHaveBeenCalledWith('/vault/a.md', '/vault/dest', 'fail')
    expect(emittedMoves).toHaveBeenCalledWith([{ from: '/vault/a.md', to: '/vault/dest/a.md' }])
  })

  it('prompts before moving cut folders during paste', async () => {
    const { ops } = createOperations()
    ops.setClipboard('cut', ['/vault/folder'])

    await ops.runPaste('/vault')

    expect(ops.confirmPrompt.value?.intent).toBe('move_folders')
    expect(moveEntry).not.toHaveBeenCalled()
  })

  it('copies selected entries and clears cut clipboard only after move', async () => {
    copyEntry.mockResolvedValue('/vault/folder/a.md')
    moveEntry.mockResolvedValue('/vault/folder/a.md')
    const { ops } = createOperations()

    ops.setClipboard('copy', ['/vault/a.md'])
    await ops.runPaste('/vault/folder')
    expect(copyEntry).toHaveBeenCalledWith('/vault/a.md', '/vault/folder', 'fail')
    expect(ops.clipboard.value).toEqual({ mode: 'copy', paths: ['/vault/a.md'] })

    ops.setClipboard('cut', ['/vault/a.md'])
    await ops.runPaste('/vault/folder')
    expect(moveEntry).toHaveBeenCalledWith('/vault/a.md', '/vault/folder', 'fail')
    expect(ops.clipboard.value).toBeNull()
  })

  it('moves paths directly and updates selection to moved targets', async () => {
    moveEntry.mockResolvedValueOnce('/vault/folder/a.md')
    const { ops, selected, focusedPath, emittedMoves } = createOperations()

    await ops.movePaths('/vault/folder', ['/vault/a.md'])

    expect(moveEntry).toHaveBeenCalledWith('/vault/a.md', '/vault/folder', 'fail')
    expect(selected.value).toEqual(['/vault/folder/a.md'])
    expect(focusedPath.value).toBe('/vault/folder/a.md')
    expect(emittedMoves).toHaveBeenCalledWith([{ from: '/vault/a.md', to: '/vault/folder/a.md' }])
  })

  it('moves a multi-destination plan and emits one combined move batch', async () => {
    const destinations: Record<string, string> = {
      '/vault/journal/2020-02-09.md': '/vault/journal/2020/02/2020-02-09.md',
      '/vault/journal/archive/2020-02-10.md': '/vault/journal/2020/02/2020-02-10.md'
    }
    moveEntry.mockImplementation(async (sourcePath: string) => destinations[sourcePath])
    const { ops, emittedMoves } = createOperations()

    await ops.executeMovePlan([
      { from: '/vault/journal/2020-02-09.md', to: '/vault/journal/2020/02/2020-02-09.md' },
      { from: '/vault/journal/archive/2020-02-10.md', to: '/vault/journal/2020/02/2020-02-10.md' }
    ])

    // One preflight per destination folder, then one move per entry.
    expect(preflightMoveEntries).toHaveBeenCalledTimes(1)
    expect(preflightMoveEntries).toHaveBeenCalledWith(
      ['/vault/journal/2020-02-09.md', '/vault/journal/archive/2020-02-10.md'],
      '/vault/journal/2020/02'
    )
    expect(moveEntry).toHaveBeenCalledWith('/vault/journal/2020-02-09.md', '/vault/journal/2020/02', 'fail')
    expect(moveEntry).toHaveBeenCalledWith('/vault/journal/archive/2020-02-10.md', '/vault/journal/2020/02', 'fail')
    // A single emission keeps one undo receipt for the whole batch.
    expect(emittedMoves).toHaveBeenCalledTimes(1)
    expect(emittedMoves).toHaveBeenCalledWith([
      { from: '/vault/journal/2020-02-09.md', to: '/vault/journal/2020/02/2020-02-09.md' },
      { from: '/vault/journal/archive/2020-02-10.md', to: '/vault/journal/2020/02/2020-02-10.md' }
    ])
  })

  it('blocks a multi-destination plan when the preflight reports a blocking issue', async () => {
    preflightMoveEntries.mockResolvedValue([
      { sourcePath: '/vault/journal/2020-02-09.md', destinationPath: null, sourceVersion: null, issue: 'read_only' }
    ])
    const { ops, emittedError, emittedMoves } = createOperations()

    await ops.executeMovePlan([{ from: '/vault/journal/2020-02-09.md', to: '/vault/journal/2020/02/2020-02-09.md' }])

    expect(emittedError).toHaveBeenCalledWith('The source is read-only.')
    expect(moveEntry).not.toHaveBeenCalled()
    expect(emittedMoves).not.toHaveBeenCalled()
  })

  it('skips stale entries in a multi-destination plan and moves the rest', async () => {
    moveEntry.mockImplementation(async (sourcePath: string) => `${sourcePath.replace('.md', '')}-moved.md`)
    preflightMoveEntries.mockImplementation(async (sourcePaths: string[]) =>
      sourcePaths.map((sourcePath) => ({
        sourcePath,
        destinationPath: null,
        sourceVersion: { size: 3, modifiedMs: 1, isDir: false },
        issue: null
      }))
    )
    revalidateMoveEntry.mockImplementation(async (sourcePath: string) => ({
      sourcePath,
      destinationPath: null,
      sourceVersion: null,
      issue: sourcePath === '/vault/journal/2020-02-09.md' ? 'stale_source' : null
    }))
    const { ops, emittedError, emittedMoves } = createOperations()

    await ops.executeMovePlan([
      { from: '/vault/journal/2020-02-09.md', to: '/vault/journal/2020/02/2020-02-09.md' },
      { from: '/vault/journal/archive/2020-02-10.md', to: '/vault/journal/2020/02/2020-02-10.md' }
    ])

    expect(emittedError).toHaveBeenCalledWith('The file changed since it was checked. Refresh and try again.')
    expect(moveEntry).toHaveBeenCalledTimes(1)
    expect(emittedMoves).toHaveBeenCalledWith([
      { from: '/vault/journal/archive/2020-02-10.md', to: '/vault/journal/archive/2020-02-10-moved.md' }
    ])
  })

  it('prompts before moving folders directly', async () => {
    const { ops } = createOperations()

    await ops.movePaths('/vault', ['/vault/folder'])

    expect(ops.confirmPrompt.value).toMatchObject({
      intent: 'move_folders',
      payload: ['/vault/folder'],
      targetDir: '/vault'
    })
    expect(moveEntry).not.toHaveBeenCalled()
  })

  it('opens non-markdown files in-app instead of externally', async () => {
    const { ops } = createOperations()

    await ops.openNode('/vault/raw.bin')

    expect(emitOpen).toHaveBeenCalledWith('/vault/raw.bin')
    expect(openPathExternal).not.toHaveBeenCalled()
  })
})
