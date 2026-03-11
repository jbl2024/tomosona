import { watch, type Ref } from 'vue'
import type { WorkspaceFsChange } from '../../shared/api/apiTypes'

/** Groups workspace identity and persistence refs consumed by lifecycle orchestration. */
export type AppShellWorkspaceLifecycleShellPort = {
  storageKey: string
  workingFolderPath: Readonly<Ref<string>>
  hasWorkspace: Readonly<Ref<boolean>>
  activeFilePath: Readonly<Ref<string>>
  normalizePath: (path: string) => string
  clearError: () => void
  notifyError: (message: string) => void
}

/** Groups workspace-controller APIs that already own workspace-specific behavior. */
export type AppShellWorkspaceLifecycleControllerPort = {
  loadWorkingFolderInternal: (path: string) => Promise<string | null>
  closeWorkspaceInternal: () => Promise<void>
  resetWorkspaceState: () => void
  applyWorkspaceFsChanges: (changes: WorkspaceFsChange[]) => void
}

/** Groups shell resets triggered when a workspace opens, closes, or changes. */
export type AppShellWorkspaceLifecycleUiPort = {
  activePaneId: Readonly<Ref<string>>
  resetToSinglePane: () => void
  closeAllTabsInPane: (paneId: string) => void
  findPaneContainingSurface: (type: 'cosmos') => string | null
  resetDocumentHistory: () => void
  resetActiveOutline: () => void
  resetSearchState: () => void
  resetWorkspaceRecentState: () => void
  recordRecentWorkspace: (path: string) => void
  removeRecentWorkspaceEntry: (path: string) => void
  invalidateRecentNotes: () => void
  removeLaunchpadRecentNote: (path: string) => void
  renameLaunchpadRecentNote: (fromPath: string, toPath: string) => void
  resetInspectorPanels: () => void
  closeOverflowMenu: () => void
}

/** Groups favorites-domain integrations required by the shell lifecycle. */
export type AppShellWorkspaceLifecycleFavoritesPort = {
  loadFavorites: () => Promise<void>
  reset: () => void
  applyWorkspaceFsChanges: (changes: WorkspaceFsChange[]) => void
  renameFavorite: (fromPath: string, toPath: string) => Promise<void>
}

/** Groups Cosmos-domain integrations required by the shell lifecycle. */
export type AppShellWorkspaceLifecycleCosmosPort = {
  clearState: () => void
  refreshGraph: () => Promise<void>
}

/** Filesystem entry points used only by the shell lifecycle. */
export type AppShellWorkspaceLifecycleFsPort = {
  selectWorkingFolder: () => Promise<string | null>
  listenWorkspaceFsChanged: (
    handler: (payload: { root: string; changes: WorkspaceFsChange[] }) => void
  ) => Promise<() => void>
}

/** Declares the dependencies required by the shell workspace lifecycle controller. */
export type UseAppShellWorkspaceLifecycleOptions = {
  shellPort: AppShellWorkspaceLifecycleShellPort
  controllerPort: AppShellWorkspaceLifecycleControllerPort
  uiPort: AppShellWorkspaceLifecycleUiPort
  favoritesPort: AppShellWorkspaceLifecycleFavoritesPort
  cosmosPort: AppShellWorkspaceLifecycleCosmosPort
  fsPort: AppShellWorkspaceLifecycleFsPort
}

/**
 * Owns shell-level workspace boot, close, persisted restore, and global
 * workspace filesystem event handling.
 */
export function useAppShellWorkspaceLifecycle(options: UseAppShellWorkspaceLifecycleOptions) {
  let unlistenWorkspaceFsChanged: (() => void) | null = null
  let started = false

  function resetWorkspaceShellState() {
    options.uiPort.resetDocumentHistory()
    options.controllerPort.resetWorkspaceState()
    options.uiPort.resetInspectorPanels()
    options.uiPort.resetWorkspaceRecentState()
  }

  watch(
    () => options.shellPort.workingFolderPath.value,
    () => {
      resetWorkspaceShellState()
    }
  )

  async function closeWorkspace() {
    if (!options.shellPort.hasWorkspace.value) return
    options.uiPort.resetToSinglePane()
    options.uiPort.closeAllTabsInPane(options.uiPort.activePaneId.value)
    options.uiPort.resetDocumentHistory()
    options.uiPort.resetActiveOutline()
    options.uiPort.resetSearchState()
    options.uiPort.resetInspectorPanels()
    options.favoritesPort.reset()
    options.cosmosPort.clearState()
    options.uiPort.resetWorkspaceRecentState()
    await options.controllerPort.closeWorkspaceInternal()
    options.uiPort.closeOverflowMenu()
  }

  async function loadWorkingFolder(path: string) {
    const canonical = await options.controllerPort.loadWorkingFolderInternal(path)
    if (!canonical) {
      options.uiPort.resetToSinglePane()
      options.uiPort.closeAllTabsInPane(options.uiPort.activePaneId.value)
      options.uiPort.resetSearchState()
      options.favoritesPort.reset()
      return ''
    }

    options.uiPort.recordRecentWorkspace(canonical)
    options.uiPort.resetSearchState()
    options.uiPort.invalidateRecentNotes()
    try {
      await options.favoritesPort.loadFavorites()
    } catch (err) {
      options.shellPort.notifyError(err instanceof Error ? err.message : 'Could not load favorites.')
    }
    if (options.uiPort.findPaneContainingSurface('cosmos') !== null) {
      await options.cosmosPort.refreshGraph()
    }

    if (options.shellPort.activeFilePath.value && !options.shellPort.activeFilePath.value.startsWith(canonical)) {
      options.uiPort.resetToSinglePane()
      options.uiPort.closeAllTabsInPane(options.uiPort.activePaneId.value)
      options.uiPort.resetActiveOutline()
    }

    return canonical
  }

  async function onSelectWorkingFolder() {
    options.shellPort.clearError()
    try {
      const path = await options.fsPort.selectWorkingFolder()
      if (!path) return false
      await loadWorkingFolder(path)
      return true
    } catch (err) {
      options.shellPort.notifyError(
        err instanceof Error ? err.message : 'Could not open workspace. Protected folders are not allowed.'
      )
      return false
    }
  }

  async function openRecentWorkspace(path: string) {
    options.shellPort.clearError()
    await loadWorkingFolder(path)
    if (!options.shellPort.hasWorkspace.value) {
      options.uiPort.removeRecentWorkspaceEntry(path)
      options.shellPort.notifyError('Could not reopen that workspace.')
    }
  }

  function syncFavoritesForWorkspaceChanges(changes: WorkspaceFsChange[]) {
    for (const change of changes) {
      if (change.kind !== 'renamed' || !change.old_path || !change.new_path) continue
      void options.favoritesPort.renameFavorite(change.old_path, change.new_path).catch((err) => {
        options.shellPort.notifyError(err instanceof Error ? err.message : 'Could not update favorite.')
      })
    }
  }

  function syncViewedNotesForWorkspaceChanges(changes: WorkspaceFsChange[]) {
    for (const change of changes) {
      if (change.kind === 'removed' && change.path) {
        options.uiPort.removeLaunchpadRecentNote(change.path)
        continue
      }
      if (change.kind === 'renamed' && change.old_path && change.new_path) {
        options.uiPort.renameLaunchpadRecentNote(change.old_path, change.new_path)
      }
    }
  }

  async function start() {
    if (started) return
    started = true
    try {
      unlistenWorkspaceFsChanged = await options.fsPort.listenWorkspaceFsChanged((payload) => {
        const root = options.shellPort.workingFolderPath.value
        if (!root) return
        if (options.shellPort.normalizePath(payload.root).toLowerCase() !== options.shellPort.normalizePath(root).toLowerCase()) {
          return
        }
        options.controllerPort.applyWorkspaceFsChanges(payload.changes)
        options.favoritesPort.applyWorkspaceFsChanges(payload.changes)
        syncFavoritesForWorkspaceChanges(payload.changes)
        syncViewedNotesForWorkspaceChanges(payload.changes)
        if (payload.changes.some((change) =>
          change.kind === 'modified' || change.kind === 'created' || change.kind === 'removed' || change.kind === 'renamed'
        )) {
          options.uiPort.invalidateRecentNotes()
        }
      })
    } catch {
      unlistenWorkspaceFsChanged = null
    }

    if (typeof window === 'undefined') return
    const savedFolder = window.localStorage.getItem(options.shellPort.storageKey)
    if (savedFolder) {
      await loadWorkingFolder(savedFolder)
    }
  }

  function dispose() {
    started = false
    if (unlistenWorkspaceFsChanged) {
      unlistenWorkspaceFsChanged()
      unlistenWorkspaceFsChanged = null
    }
  }

  return {
    closeWorkspace,
    loadWorkingFolder,
    onSelectWorkingFolder,
    openRecentWorkspace,
    start,
    dispose
  }
}
