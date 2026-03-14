import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useExplorerOperations } from './useExplorerOperations'
import type { PathMove, TreeNode } from '../../../shared/api/apiTypes'

const copyEntry = vi.fn<(sourcePath: string, targetDirPath: string, strategy: string) => Promise<string>>()
const duplicateEntry = vi.fn<(path: string, strategy: string) => Promise<string>>()
const moveEntry = vi.fn<(sourcePath: string, targetDirPath: string, strategy: string) => Promise<string>>()
const openPathExternal = vi.fn<(path: string) => Promise<void>>()
const renameEntry = vi.fn<(path: string, newName: string, strategy: string) => Promise<string>>()
const revealInFileManager = vi.fn<(path: string) => Promise<void>>()
const trashEntry = vi.fn<(path: string) => Promise<string>>()

vi.mock('../../../shared/api/workspaceApi', () => ({
  copyEntry: (sourcePath: string, targetDirPath: string, strategy: string) =>
    copyEntry(sourcePath, targetDirPath, strategy),
  duplicateEntry: (path: string, strategy: string) => duplicateEntry(path, strategy),
  moveEntry: (sourcePath: string, targetDirPath: string, strategy: string) =>
    moveEntry(sourcePath, targetDirPath, strategy),
  openPathExternal: (path: string) => openPathExternal(path),
  renameEntry: (path: string, newName: string, strategy: string) =>
    renameEntry(path, newName, strategy),
  revealInFileManager: (path: string) => revealInFileManager(path),
  trashEntry: (path: string) => trashEntry(path)
}))

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

  const ops = useExplorerOperations({
    folderPath: ref('/vault'),
    focusedPath,
    nodeByPath: ref<Record<string, TreeNode>>({
      '/vault/a.md': fileNode('/vault/a.md'),
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
    emitError: vi.fn(),
    emitOpen: vi.fn(),
    emitPathRenamed: vi.fn(),
    emitPathsMoved: emittedMoves,
    emitPathsDeleted: vi.fn(),
    emitRequestCreate: vi.fn(),
    loadChildren: vi.fn(async () => {}),
    refreshLoadedDirs: vi.fn(async () => {})
  })

  return { ops, focusedPath, selected, emittedSelection, emittedMoves }
}

describe('useExplorerOperations', () => {
  afterEach(() => {
    copyEntry.mockReset()
    duplicateEntry.mockReset()
    moveEntry.mockReset()
    openPathExternal.mockReset()
    renameEntry.mockReset()
    revealInFileManager.mockReset()
    trashEntry.mockReset()
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
})
