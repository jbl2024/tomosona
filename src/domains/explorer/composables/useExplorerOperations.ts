import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  copyEntry,
  duplicateEntry,
  moveEntry,
  openPathExternal,
  renameEntry,
  revealInFileManager,
  trashEntry
} from '../../../shared/api/workspaceApi'
import type { ConflictStrategy, EntryKind, TreeNode } from '../../../shared/api/apiTypes'
import {
  errorMessage,
  getParentPath,
  isConflictError
} from '../lib/explorerTreeUtils'
import type { PathMove } from '../../../shared/api/apiTypes'

/** Explorer clipboard state shared across menu, keyboard, and row actions. */
export type ExplorerClipboard = {
  mode: 'copy' | 'cut'
  paths: string[]
}

/** Conflict resolution prompt shown for copy/move/rename/duplicate collisions. */
export type ExplorerConflictPrompt = {
  title: string
  detail: string
  pending: ((strategy: ConflictStrategy) => Promise<void>) | null
}

/** Simple confirmation prompt used by delete and folder move flows. */
export type ExplorerConfirmPrompt = {
  title: string
  detail: string
  intent: 'delete' | 'move_folders'
  payload: string[]
  targetDir?: string
}

/** Declares dependencies required by explorer entry operations. */
export type UseExplorerOperationsOptions = {
  folderPath: Readonly<Ref<string>>
  focusedPath: Ref<string>
  nodeByPath: Readonly<Ref<Record<string, TreeNode>>>
  selectionPaths: Readonly<ComputedRef<string[]>>
  clearSelection: () => void
  isSelected: (path: string) => boolean
  setSelection: (paths: string[]) => void
  emitSelection: (paths: string[]) => void
  emitError: (message: string) => void
  emitOpen: (path: string) => void
  emitPathRenamed: (payload: { from: string; to: string }) => void
  emitPathsMoved: (moves: PathMove[]) => void
  emitPathsDeleted: (paths: string[]) => void
  emitRequestCreate: (payload: { parentPath: string; entryKind: EntryKind }) => void
  loadChildren: (dirPath: string) => Promise<void>
  refreshLoadedDirs: () => Promise<void>
}

/**
 * Owns explorer entry actions, clipboard workflows, rename/delete prompts,
 * and the shared open action used by mouse, keyboard, and context menu flows.
 */
export function useExplorerOperations(options: UseExplorerOperationsOptions) {
  const editingPath = ref('')
  const editingValue = ref('')
  const clipboard = ref<ExplorerClipboard | null>(null)
  const conflictPrompt = ref<ExplorerConflictPrompt | null>(null)
  const confirmPrompt = ref<ExplorerConfirmPrompt | null>(null)

  const canPaste = computed(() => Boolean(clipboard.value?.paths.length && options.folderPath.value))

  function currentSelection(): string[] {
    return options.selectionPaths.value
  }

  function effectiveSelection(targetPath?: string | null): string[] {
    const selected = currentSelection()
    if (targetPath && selected.includes(targetPath)) {
      return selected
    }
    if (targetPath) {
      return [targetPath]
    }
    return selected
  }

  function requestCreate(parentPath: string, entryKind: EntryKind) {
    options.emitRequestCreate({ parentPath, entryKind })
  }

  async function resolveConflictAndRetry(
    title: string,
    detail: string,
    action: (strategy: ConflictStrategy) => Promise<void>
  ) {
    conflictPrompt.value = {
      title,
      detail,
      pending: action
    }
  }

  async function runWithConflictModal(
    action: (strategy: ConflictStrategy) => Promise<void>,
    title: string,
    detail: string
  ) {
    try {
      await action('fail')
    } catch (err) {
      if (isConflictError(err)) {
        await resolveConflictAndRetry(title, detail, action)
        return
      }
      options.emitError(errorMessage(err) ?? 'Operation failed.')
    }
  }

  function startRename(path: string) {
    const node = options.nodeByPath.value[path]
    if (!node) return
    editingPath.value = path
    editingValue.value = node.name
  }

  function cancelRename() {
    editingPath.value = ''
    editingValue.value = ''
  }

  async function confirmRename() {
    const path = editingPath.value
    if (!path || !options.folderPath.value) return

    const wasMarkdown = /\.(md|markdown)$/i.test(path)
    const newName = editingValue.value.trim()
    if (!newName) {
      options.emitError('Name cannot be empty.')
      return
    }

    await runWithConflictModal(
      async (strategy) => {
        const renamedPath = await renameEntry(path, newName, strategy)
        const parent = getParentPath(path)
        cancelRename()
        await options.loadChildren(parent)

        if (options.isSelected(path)) {
          options.setSelection([renamedPath])
        }
        if (options.focusedPath.value === path) {
          options.focusedPath.value = renamedPath
        }
        options.emitSelection(currentSelection())
        if (wasMarkdown && /\.(md|markdown)$/i.test(renamedPath) && path !== renamedPath) {
          options.emitPathRenamed({ from: path, to: renamedPath })
        }
      },
      'File or folder already exists',
      'Choose how to proceed.'
    )
  }

  function requestDelete(paths: string[]) {
    if (!paths.length) return

    const folderCount = paths.filter((path) => options.nodeByPath.value[path]?.is_dir).length
    const base = paths.length === 1 ? `Delete "${options.nodeByPath.value[paths[0]]?.name || 'item'}"?` : `Delete ${paths.length} items?`
    const detail =
      folderCount > 0
        ? 'Some selected items are folders. Deletion moves them to trash recursively.'
        : 'Selected items will be moved to trash.'

    confirmPrompt.value = {
      title: base,
      detail,
      intent: 'delete',
      payload: paths
    }
  }

  async function executeDelete(paths: string[]) {
    if (!options.folderPath.value || !paths.length) return
    const deletedPaths: string[] = []

    for (const path of paths) {
      try {
        await trashEntry(path)
        deletedPaths.push(path)
      } catch (err) {
        options.emitError(errorMessage(err) ?? 'Delete failed.')
      }
    }

    options.clearSelection()
    options.focusedPath.value = ''
    options.emitSelection([])
    if (deletedPaths.length) {
      options.emitPathsDeleted(deletedPaths)
    }
    await options.refreshLoadedDirs()
  }

  async function runDuplicate(paths: string[]) {
    if (!options.folderPath.value || !paths.length) return

    await runWithConflictModal(
      async (strategy) => {
        for (const path of paths) {
          await duplicateEntry(path, strategy)
        }
        await options.refreshLoadedDirs()
      },
      'Name conflict while duplicating',
      'Choose how to handle conflicts.'
    )
  }

  function setClipboard(mode: 'copy' | 'cut', paths: string[]) {
    if (!paths.length) return
    clipboard.value = { mode, paths }
  }

  async function executePaste(targetDir: string, pathsOverride?: string[]) {
    if (!options.folderPath.value || !clipboard.value) return

    const sources = pathsOverride ?? clipboard.value.paths
    const mode = clipboard.value.mode

    await runWithConflictModal(
      async (strategy) => {
        for (const source of sources) {
          if (mode === 'copy') {
            await copyEntry(source, targetDir, strategy)
          } else {
            await moveEntry(source, targetDir, strategy)
          }
        }

        if (mode === 'cut') {
          clipboard.value = null
        }
        await options.refreshLoadedDirs()
      },
      'Name conflict while pasting',
      'Choose how to handle conflicts.'
    )
  }

  /**
   * Runs a direct move operation without going through clipboard state.
   * Drag and drop reuses this path so folder confirmations, conflict handling,
   * refresh behavior, and selection updates stay aligned with paste.
   */
  async function executeMove(targetDir: string, sourcePaths: string[]) {
    if (!options.folderPath.value || !targetDir || !sourcePaths.length) return

    const movedPaths: string[] = []
    const movedPairs: PathMove[] = []

    await runWithConflictModal(
      async (strategy) => {
        for (const source of sourcePaths) {
          const moved = await moveEntry(source, targetDir, strategy)
          movedPaths.push(moved)
          if (moved && moved !== source) {
            movedPairs.push({ from: source, to: moved })
          }
        }

        await options.refreshLoadedDirs()
        options.setSelection(movedPaths)
        options.focusedPath.value = movedPaths[0] ?? ''
        options.emitSelection(movedPaths)
        if (movedPairs.length) {
          options.emitPathsMoved(movedPairs)
        }
      },
      'Name conflict while moving',
      'Choose how to handle conflicts.'
    )
  }

  /**
   * Runs a direct move operation without going through clipboard state.
   * Drag and drop reuses this path so folder confirmations, conflict handling,
   * refresh behavior, and selection updates stay aligned with paste.
   */
  async function movePaths(targetDir: string, sourcePaths: string[]) {
    if (!options.folderPath.value || !targetDir || !sourcePaths.length) return

    const hasFolderMove = sourcePaths.some((path) => options.nodeByPath.value[path]?.is_dir)
    if (hasFolderMove) {
      confirmPrompt.value = {
        title: 'Move selected folders?',
        detail: 'Moving folders can affect many files. Confirm this operation.',
        intent: 'move_folders',
        payload: sourcePaths,
        targetDir
      }
      return
    }

    await executeMove(targetDir, sourcePaths)
  }

  async function runPaste(targetPath?: string | null) {
    if (!options.folderPath.value || !clipboard.value) return

    const target = targetPath || options.focusedPath.value || options.folderPath.value
    const targetNode = options.nodeByPath.value[target]
    const targetDir = targetNode?.is_dir ? target : getParentPath(target)

    const sourcePaths = clipboard.value.paths
    if (!sourcePaths.length) return

    const hasFolderMove = clipboard.value.mode === 'cut' && sourcePaths.some((path) => options.nodeByPath.value[path]?.is_dir)
    if (hasFolderMove) {
      confirmPrompt.value = {
        title: 'Move selected folders?',
        detail: 'Moving folders can affect many files. Confirm this operation.',
        intent: 'move_folders',
        payload: sourcePaths,
        targetDir
      }
      return
    }

    await executePaste(targetDir, sourcePaths)
  }

  async function openNode(path: string, mode: 'default' | 'context-toggle' = 'default') {
    const node = options.nodeByPath.value[path]
    if (!node || node.is_dir) return
    if (node.is_markdown) {
      options.emitOpen(path)
      return
    }
    if (mode === 'context-toggle') {
      return
    }
    await openPathExternal(path)
  }

  async function openSelected(paths: string[]) {
    if (!paths.length) return
    await openNode(paths[0])
  }

  async function openExternal(path: string) {
    await openPathExternal(path)
  }

  async function revealInManager(path: string) {
    await revealInFileManager(path)
  }

  function closeConflictPrompt() {
    conflictPrompt.value = null
  }

  async function resolveConflict(strategy: ConflictStrategy) {
    if (!conflictPrompt.value?.pending) {
      closeConflictPrompt()
      return
    }

    const pending = conflictPrompt.value.pending
    closeConflictPrompt()

    try {
      await pending(strategy)
    } catch (err) {
      options.emitError(errorMessage(err) ?? 'Operation failed.')
    }
  }

  function cancelConfirmPrompt() {
    confirmPrompt.value = null
  }

  async function confirmPromptAction(targetPath?: string | null) {
    if (!confirmPrompt.value) return
    const prompt = confirmPrompt.value
    confirmPrompt.value = null

    if (prompt.intent === 'delete') {
      await executeDelete(prompt.payload)
      return
    }

    if (prompt.intent === 'move_folders') {
      if (prompt.targetDir) {
        await executeMove(prompt.targetDir, prompt.payload)
        return
      }

      const target = targetPath || options.focusedPath.value || options.folderPath.value
      const targetNode = options.nodeByPath.value[target]
      const targetDir = targetNode?.is_dir ? target : getParentPath(target)
      await executePaste(targetDir, prompt.payload)
    }
  }

  return {
    editingPath,
    editingValue,
    clipboard,
    conflictPrompt,
    confirmPrompt,
    canPaste,
    effectiveSelection,
    requestCreate,
    startRename,
    cancelRename,
    confirmRename,
    requestDelete,
    executeDelete,
    runDuplicate,
    setClipboard,
    movePaths,
    runPaste,
    executePaste,
    openNode,
    openSelected,
    openExternal,
    revealInManager,
    closeConflictPrompt,
    resolveConflict,
    cancelConfirmPrompt,
    confirmPromptAction
  }
}
