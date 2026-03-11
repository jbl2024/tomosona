import { nextTick, type Ref } from 'vue'
import type { SidebarMode } from './useWorkspaceState'

type PaneAxis = 'row' | 'column'
type PaneDirection = 'next' | 'previous'
type SurfaceType = 'home' | 'cosmos' | 'second-brain-chat'

/** Groups shell workspace state and shell-owned UI persistence used by commands. */
export type AppShellCommandsWorkspacePort = {
  hasWorkspace: Readonly<Ref<boolean>>
  activeFilePath: Readonly<Ref<string>>
  allWorkspaceFiles: Readonly<Ref<string[]>>
  previousNonCosmosMode: Ref<SidebarMode>
  setSidebarMode: (mode: SidebarMode) => void
  persistSidebarMode: () => void
  persistPreviousNonCosmosMode: () => void
  notifyError: (message: string) => void
  notifySuccess: (message: string) => void
}

/** Groups document/path helpers used by shell command workflows. */
export type AppShellCommandsDocumentPort = {
  isMarkdownPath: (path: string) => boolean
  normalizePathKey: (path: string) => string
  toRelativePath: (path: string) => string
  clearEditorStatusForPaths: (paths: string[]) => void
  resetActiveOutline: () => void
}

/** Groups pane and surface operations consumed by shell commands. */
export type AppShellCommandsPanePort = {
  activePaneId: Readonly<Ref<string>>
  panesById: Readonly<Ref<Record<string, {
    activeTabId: string
    openTabs: Array<{ id: string; type: 'document'; path: string } | { id: string; type: SurfaceType; pinned: boolean }>
  }>>>
  openSurfaceInPane: (type: SurfaceType) => void
  splitPane: (paneId: string, axis: PaneAxis) => string | null
  setActivePane: (paneId: string) => void
  focusPaneByIndex: (index: number) => boolean
  focusAdjacentPane: (direction: PaneDirection) => boolean
  moveActiveTabToAdjacentPane: (direction: PaneDirection) => boolean
  closePane: (paneId: string) => boolean
  joinAllPanes: () => void
  resetToSinglePane: () => void
  closeAllTabsAndResetLayout: () => void
  closeAllTabsInPane: (paneId: string) => void
  closeOtherTabsInPane: (paneId: string, tabId: string) => void
}

/** Groups shell navigation and history actions reused across palette and launchpad. */
export type AppShellCommandsNavigationPort = {
  openTabWithAutosave: (path: string) => Promise<boolean>
  recordHomeHistorySnapshot: () => void
  recordSecondBrainHistorySnapshot: () => void
  recordCosmosHistorySnapshot: () => void
}

/** Groups favorites-domain APIs consumed by shell commands. */
export type AppShellCommandsFavoritesPort = {
  isFavorite: (path: string) => boolean
  addFavorite: (path: string) => Promise<unknown>
  removeFavorite: (path: string) => Promise<void>
}

/** Groups Cosmos-domain APIs needed for shell orchestration. */
export type AppShellCommandsCosmosPort = {
  graph: Readonly<Ref<{ nodes: Array<{ id: string; path: string }> }>>
  error: Readonly<Ref<string>>
  refreshGraph: () => Promise<void>
  selectNode: (nodeId: string) => void
}

/** Groups cross-domain actions already implemented elsewhere and reused by commands. */
export type AppShellCommandsActionPort = {
  loadAllFiles: () => Promise<void>
  addActiveNoteToSecondBrain: () => Promise<boolean>
  openSettingsModal: () => Promise<void>
  openQuickOpen: (initialQuery?: string) => Promise<void>
  openTodayNote: () => Promise<boolean>
  openWorkspacePicker: () => Promise<boolean>
  closeWorkspace: () => Promise<void>
  revealInFileManager: (path: string) => Promise<void>
  closeOverflowMenu: () => void
  focusSearchInput: () => void
  scheduleCosmosNodeFocus: (nodeId: string) => void
}

/** Declares the dependencies required by the shell command controller. */
export type UseAppShellCommandsOptions = {
  workspacePort: AppShellCommandsWorkspacePort
  documentPort: AppShellCommandsDocumentPort
  panePort: AppShellCommandsPanePort
  navigationPort: AppShellCommandsNavigationPort
  favoritesPort: AppShellCommandsFavoritesPort
  cosmosPort: AppShellCommandsCosmosPort
  actionPort: AppShellCommandsActionPort
}

function documentPathsForPane(
  panesById: Record<string, { openTabs: Array<{ id: string; type: 'document'; path: string } | { id: string; type: SurfaceType; pinned: boolean }> }>,
  paneId: string
) {
  const pane = panesById[paneId]
  if (!pane) return []
  return pane.openTabs
    .filter((tab): tab is Extract<typeof tab, { type: 'document' }> => tab.type === 'document')
    .map((tab) => tab.path)
}

/**
 * Owns shell command workflows reused by palette, launchpad, overflow, and pane chrome.
 *
 * Boundaries:
 * - Commands may coordinate multiple domains and shell UI state.
 * - Commands must call domain public APIs through injected ports.
 * - Modal-local DOM details stay outside this controller.
 */
export function useAppShellCommands(options: UseAppShellCommandsOptions) {
  function persistSidebarModeSelection(mode: SidebarMode) {
    options.workspacePort.previousNonCosmosMode.value = mode
    options.workspacePort.persistPreviousNonCosmosMode()
    options.workspacePort.setSidebarMode(mode)
    options.workspacePort.persistSidebarMode()
  }

  async function openCosmosViewFromPalette() {
    if (!options.workspacePort.hasWorkspace.value) {
      options.workspacePort.notifyError('Open a workspace first.')
      return false
    }

    options.panePort.openSurfaceInPane('cosmos')
    if (!options.cosmosPort.graph.value.nodes.length) {
      await options.cosmosPort.refreshGraph()
    }
    options.navigationPort.recordCosmosHistorySnapshot()
    return true
  }

  async function openSecondBrainViewFromPalette() {
    if (!options.workspacePort.hasWorkspace.value) {
      options.workspacePort.notifyError('Open a workspace first.')
      return false
    }

    options.panePort.openSurfaceInPane('second-brain-chat')
    options.navigationPort.recordSecondBrainHistorySnapshot()
    if (!options.workspacePort.allWorkspaceFiles.value.length) {
      await options.actionPort.loadAllFiles()
    }
    return true
  }

  async function openHomeViewFromPalette() {
    options.panePort.openSurfaceInPane('home')
    options.navigationPort.recordHomeHistorySnapshot()
    if (options.workspacePort.hasWorkspace.value && !options.workspacePort.allWorkspaceFiles.value.length) {
      await options.actionPort.loadAllFiles()
    }
    return true
  }

  function openFavoritesPanelFromPalette() {
    options.actionPort.closeOverflowMenu()
    persistSidebarModeSelection('favorites')
    return true
  }

  async function addActiveNoteToSecondBrainFromPalette() {
    return await options.actionPort.addActiveNoteToSecondBrain()
  }

  async function addActiveNoteToFavoritesFromPalette() {
    const path = options.workspacePort.activeFilePath.value
    if (!path || !options.documentPort.isMarkdownPath(path)) return false
    try {
      await options.favoritesPort.addFavorite(path)
      options.workspacePort.notifySuccess(`Added ${options.documentPort.toRelativePath(path)} to favorites.`)
      return true
    } catch (err) {
      options.workspacePort.notifyError(err instanceof Error ? err.message : 'Could not add favorite.')
      return false
    }
  }

  async function removeActiveNoteFromFavoritesFromPalette() {
    const path = options.workspacePort.activeFilePath.value
    if (!path || !options.favoritesPort.isFavorite(path)) return false
    try {
      await options.favoritesPort.removeFavorite(path)
      options.workspacePort.notifySuccess(`Removed ${options.documentPort.toRelativePath(path)} from favorites.`)
      return true
    } catch (err) {
      options.workspacePort.notifyError(err instanceof Error ? err.message : 'Could not remove favorite.')
      return false
    }
  }

  async function removeFavoriteFromList(path: string) {
    try {
      await options.favoritesPort.removeFavorite(path)
      options.workspacePort.notifySuccess(`Removed ${options.documentPort.toRelativePath(path)} from favorites.`)
    } catch (err) {
      options.workspacePort.notifyError(err instanceof Error ? err.message : 'Could not remove favorite.')
    }
  }

  async function toggleActiveNoteFavoriteFromRightPane() {
    const path = options.workspacePort.activeFilePath.value
    if (!path || !options.documentPort.isMarkdownPath(path)) return
    if (options.favoritesPort.isFavorite(path)) {
      await removeActiveNoteFromFavoritesFromPalette()
      return
    }
    await addActiveNoteToFavoritesFromPalette()
  }

  async function openSettingsFromPalette() {
    await options.actionPort.openSettingsModal()
    return true
  }

  async function openNoteInCosmosFromPalette() {
    const activePath = options.workspacePort.activeFilePath.value
    if (!activePath) {
      options.workspacePort.notifyError('No active note to open in Cosmos.')
      return false
    }

    const opened = await openCosmosViewFromPalette()
    if (!opened) return false

    const targetKey = options.documentPort.normalizePathKey(activePath.trim())
    let match = options.cosmosPort.graph.value.nodes.find((node) =>
      options.documentPort.normalizePathKey(node.path) === targetKey ||
      options.documentPort.normalizePathKey(node.id) === targetKey
    )
    if (!match) {
      await options.cosmosPort.refreshGraph()
      match = options.cosmosPort.graph.value.nodes.find((node) =>
        options.documentPort.normalizePathKey(node.path) === targetKey ||
        options.documentPort.normalizePathKey(node.id) === targetKey
      )
    }
    if (!match) {
      if (options.cosmosPort.error.value) {
        options.workspacePort.notifyError(options.cosmosPort.error.value)
        return false
      }
      options.workspacePort.notifyError('Active note is not available in the current graph index.')
      return true
    }

    options.cosmosPort.selectNode(match.id)
    options.actionPort.scheduleCosmosNodeFocus(match.id)
    options.navigationPort.recordCosmosHistorySnapshot()
    return true
  }

  function openSearchPanel() {
    options.actionPort.closeOverflowMenu()
    persistSidebarModeSelection('search')
    nextTick(() => {
      options.actionPort.focusSearchInput()
    })
  }

  async function openFavoriteFromSidebar(path: string) {
    await options.navigationPort.openTabWithAutosave(path)
  }

  async function revealActiveInExplorer() {
    const activePath = options.workspacePort.activeFilePath.value
    if (!activePath) return false
    try {
      await options.actionPort.revealInFileManager(activePath)
      return true
    } catch (err) {
      options.workspacePort.notifyError(err instanceof Error ? err.message : 'Could not reveal file.')
      return false
    }
  }

  async function openCommandPalette() {
    options.actionPort.closeOverflowMenu()
    await options.actionPort.openQuickOpen('>')
  }

  async function runLaunchpadQuickStart(kind: 'today' | 'second-brain' | 'cosmos' | 'command-palette') {
    if (kind === 'today') {
      await options.actionPort.openTodayNote()
      return
    }
    if (kind === 'second-brain') {
      await openSecondBrainViewFromPalette()
      return
    }
    if (kind === 'cosmos') {
      await openCosmosViewFromPalette()
      return
    }
    await openCommandPalette()
  }

  function closeAllTabsFromPalette() {
    const allDocumentPaths = Object.keys(options.panePort.panesById.value)
      .flatMap((paneId) => documentPathsForPane(options.panePort.panesById.value, paneId))
    options.panePort.closeAllTabsAndResetLayout()
    options.documentPort.clearEditorStatusForPaths(allDocumentPaths)
    options.documentPort.resetActiveOutline()
    return true
  }

  function closeAllTabsOnCurrentPaneFromPalette() {
    const paneId = options.panePort.activePaneId.value
    const panePaths = documentPathsForPane(options.panePort.panesById.value, paneId)
    options.panePort.closeAllTabsInPane(paneId)
    options.documentPort.clearEditorStatusForPaths(panePaths)
    options.documentPort.resetActiveOutline()
    return true
  }

  async function openWorkspaceFromPalette() {
    return await options.actionPort.openWorkspacePicker()
  }

  function closeWorkspaceFromPalette() {
    if (!options.workspacePort.hasWorkspace.value) return false
    void options.actionPort.closeWorkspace()
    return true
  }

  function closeOtherTabsFromPalette() {
    const paneId = options.panePort.activePaneId.value
    const active = options.panePort.panesById.value[paneId]?.activeTabId ?? ''
    if (!active) return false
    options.panePort.closeOtherTabsInPane(paneId, active)
    return true
  }

  async function splitPaneFromPalette(axis: PaneAxis) {
    const createdPaneId = options.panePort.splitPane(options.panePort.activePaneId.value, axis)
    if (!createdPaneId) return false
    await nextTick()
    options.panePort.setActivePane(createdPaneId)
    return true
  }

  function focusPaneFromPalette(index: number) {
    return options.panePort.focusPaneByIndex(index)
  }

  function focusNextPaneFromPalette() {
    return options.panePort.focusAdjacentPane('next')
  }

  function moveTabToNextPaneFromPalette() {
    return options.panePort.moveActiveTabToAdjacentPane('next')
  }

  function closeActivePaneFromPalette() {
    return options.panePort.closePane(options.panePort.activePaneId.value)
  }

  function joinPanesFromPalette() {
    options.panePort.joinAllPanes()
    return true
  }

  function resetPaneLayoutFromPalette() {
    options.panePort.resetToSinglePane()
    return true
  }

  return {
    openCosmosViewFromPalette,
    openSecondBrainViewFromPalette,
    openHomeViewFromPalette,
    openFavoritesPanelFromPalette,
    addActiveNoteToSecondBrainFromPalette,
    addActiveNoteToFavoritesFromPalette,
    removeActiveNoteFromFavoritesFromPalette,
    removeFavoriteFromList,
    toggleActiveNoteFavoriteFromRightPane,
    openSettingsFromPalette,
    openNoteInCosmosFromPalette,
    openSearchPanel,
    openFavoriteFromSidebar,
    revealActiveInExplorer,
    openCommandPalette,
    runLaunchpadQuickStart,
    closeAllTabsFromPalette,
    closeAllTabsOnCurrentPaneFromPalette,
    openWorkspaceFromPalette,
    closeWorkspaceFromPalette,
    closeOtherTabsFromPalette,
    splitPaneFromPalette,
    focusPaneFromPalette,
    focusNextPaneFromPalette,
    moveTabToNextPaneFromPalette,
    closeActivePaneFromPalette,
    joinPanesFromPalette,
    resetPaneLayoutFromPalette
  }
}
