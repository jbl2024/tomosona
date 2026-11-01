import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  copyEntry,
  duplicateEntry,
  moveEntry,
  openPathExternal,
  preflightMoveEntries,
  preflightRenameEntry,
  preflightTrashEntries,
  revalidateMoveEntry,
  renameEntry,
  revealInFileManager,
  trashEntry
} from '../../../shared/api/workspaceApi'
import type { ConflictStrategy, EntryKind, MovePreflightEntry, TreeNode } from '../../../shared/api/apiTypes'
import {
  errorMessage,
  getParentPath,
  isConflictError
} from '../lib/explorerTreeUtils'
import { preflightIssueMessage, summarizePreflight } from '../lib/mutationPreflight'
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
  const editingExtension = ref('')
  const editingSelectionEnd = ref(0)
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
    // Markdown files edit only the stem: the extension stays out of the
    // initial selection and is re-applied on confirm, e.g. "Topic.md" -> "Topic".
    const extension = node.is_markdown ? node.name.match(/(\.(?:md|markdown))$/i)?.[1] ?? '' : ''
    editingExtension.value = extension
    editingValue.value = extension ? node.name.slice(0, -extension.length) : node.name
    editingSelectionEnd.value = editingValue.value.length
  }

  function cancelRename() {
    editingPath.value = ''
    editingValue.value = ''
    editingExtension.value = ''
    editingSelectionEnd.value = 0
  }

  async function confirmRename() {
    const path = editingPath.value
    if (!path || !options.folderPath.value) return

    const wasMarkdown = /\.(md|markdown)$/i.test(path)
    let newName = editingValue.value.trim()
    if (!newName) {
      options.emitError('Name cannot be empty.')
      return
    }
    if (/[\\/<>:"|?*\x00-\x1f]/.test(newName)) {
      options.emitError('Name contains invalid characters.')
      return
    }
    if (editingExtension.value && !/\.(md|markdown)$/i.test(newName)) {
      newName = `${newName}${editingExtension.value}`
    }

    const preflight = await preflightRenameEntry(path, newName)
    if (preflight.issue && preflight.issue !== 'collision') {
      // Stay in edit mode so the user can correct or cancel the rename.
      options.emitError(preflightIssueMessage(preflight.issue))
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
    const preflight = summarizePreflight(await preflightTrashEntries(paths))
    const blockedSources = new Set(preflight.blocked.map((entry) => entry.sourcePath))
    for (const blocked of preflight.blocked) {
      options.emitError(blocked.message)
    }
    const deletable = paths.filter((path) => !blockedSources.has(path))
    if (!deletable.length) return

    const deletedPaths: string[] = []

    for (const path of deletable) {
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
    // Cut/paste moves go through the same preflight and revalidation boundary
    // as direct moves and drag-and-drop.
    const plannedBySource = mode === 'cut' ? await planMoveBatch(targetDir, sources) : null
    if (mode === 'cut' && !plannedBySource) return

    await runWithConflictModal(
      async (strategy) => {
        const movedPairs: PathMove[] = []
        for (const source of sources) {
          if (mode === 'copy') {
            await copyEntry(source, targetDir, strategy)
          } else {
            const { movedPairs: batchPairs } = await moveEntriesWithRevalidation(targetDir, [source], plannedBySource ?? new Map(), strategy)
            movedPairs.push(...batchPairs)
          }
        }

        if (mode === 'cut') {
          clipboard.value = null
          if (movedPairs.length) {
            options.emitPathsMoved(movedPairs)
          }
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
  /**
   * Runs the advisory native preflight for a move batch. Returns the planned
   * entries keyed by source, or null after reporting why the batch must stop.
   */
  async function planMoveBatch(targetDir: string, sourcePaths: string[]): Promise<Map<string, MovePreflightEntry> | null> {
    const preflight = summarizePreflight(await preflightMoveEntries(sourcePaths, targetDir))
    if (preflight.hasBlockingIssues) {
      options.emitError(preflight.blocked[0].message)
      return null
    }
    const plannedBySource = new Map<string, MovePreflightEntry>()
    for (const entry of [...preflight.ready, ...preflight.collisions]) {
      plannedBySource.set(entry.sourcePath, entry)
    }
    return plannedBySource
  }

  /**
   * Moves entries one by one, rechecking each advisory preflight version so a
   * source that changed on disk since planning fails safely instead of moving
   * stale content. Collisions fall through to the caller's conflict strategy.
   */
  async function moveEntriesWithRevalidation(
    targetDir: string,
    sourcePaths: string[],
    plannedBySource: Map<string, MovePreflightEntry>,
    strategy: ConflictStrategy
  ): Promise<{ movedPaths: string[]; movedPairs: PathMove[] }> {
    const movedPaths: string[] = []
    const movedPairs: PathMove[] = []

    for (const source of sourcePaths) {
      const planned = plannedBySource.get(source)
      if (planned?.sourceVersion) {
        const recheck = await revalidateMoveEntry(source, targetDir, planned.sourceVersion)
        if (recheck.issue && recheck.issue !== 'collision') {
          options.emitError(preflightIssueMessage(recheck.issue))
          continue
        }
      }
      const moved = await moveEntry(source, targetDir, strategy)
      movedPaths.push(moved)
      if (moved && moved !== source) {
        movedPairs.push({ from: source, to: moved })
      }
    }

    return { movedPaths, movedPairs }
  }

  async function executeMove(targetDir: string, sourcePaths: string[]) {
    if (!options.folderPath.value || !targetDir || !sourcePaths.length) return

    const plannedBySource = await planMoveBatch(targetDir, sourcePaths)
    if (!plannedBySource) return

    await runWithConflictModal(
      async (strategy) => {
        const { movedPaths, movedPairs } = await moveEntriesWithRevalidation(targetDir, sourcePaths, plannedBySource, strategy)

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
   * Executes an explicit multi-destination move plan through the same safe
   * boundary as every other move: per-target preflight, per-entry revalidation,
   * the shared conflict prompt, and one `paths-moved` emission so the shell
   * records a single undo receipt for the whole batch.
   *
   * Used by journal organization, where each note has its own destination
   * folder instead of one shared target directory.
   */
  async function executeMovePlan(entries: PathMove[]) {
    if (!options.folderPath.value || !entries.length) return

    const sourcesByTarget = new Map<string, string[]>()
    for (const entry of entries) {
      const targetDir = getParentPath(entry.to)
      sourcesByTarget.set(targetDir, [...(sourcesByTarget.get(targetDir) ?? []), entry.from])
    }

    const plannedBySource = new Map<string, MovePreflightEntry>()
    for (const [targetDir, sources] of sourcesByTarget) {
      const planned = await planMoveBatch(targetDir, sources)
      if (!planned) return
      for (const [source, plannedEntry] of planned) plannedBySource.set(source, plannedEntry)
    }

    await runWithConflictModal(
      async (strategy) => {
        const movedPairs: PathMove[] = []
        for (const entry of entries) {
          const { movedPairs: batchPairs } = await moveEntriesWithRevalidation(
            getParentPath(entry.to),
            [entry.from],
            plannedBySource,
            strategy
          )
          movedPairs.push(...batchPairs)
        }

        await options.refreshLoadedDirs()
        if (movedPairs.length) {
          options.emitPathsMoved(movedPairs)
        }
      },
      'Name conflict while organizing',
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
    options.emitOpen(path)
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
    editingExtension,
    editingSelectionEnd,
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
    executeMove,
    executeMovePlan,
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
