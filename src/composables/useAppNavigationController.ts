import { nextTick, ref, type Ref } from 'vue'
import type { DocumentHistoryEntry } from './useDocumentHistory'

/**
 * Module: useAppNavigationController
 *
 * Purpose:
 * - Own app-shell document navigation flows and history orchestration.
 * - Keep `App.vue` focused on wiring UI events instead of coordinating tab
 *   switches, autosave guards, and pane-native history snapshots.
 */

/** Snapshot stored in history for the pane-native Cosmos surface. */
export type CosmosHistorySnapshot = {
  query: string
  selectedNodeId: string
  focusMode: boolean
  focusDepth: number
}

/** Snapshot stored in history for the pane-native Second Brain surface. */
export type SecondBrainHistorySnapshot = {
  surface: 'chat'
}

/** Snapshot stored in history for the pane-native Home surface. */
export type HomeHistorySnapshot = {
  surface: 'hub'
}

/** Navigation options for opening an existing document path. */
export type NavigationOpenOptions = {
  recordHistory?: boolean
  targetPaneId?: string
  revealInTargetPane?: boolean
}

/** Minimal shape required from the document status provider used by the shell. */
export type NavigationDocumentStatus = {
  dirty: boolean
  saveError: string
}

/** Declares the services and shell state used by the app navigation controller. */
export type UseAppNavigationControllerOptions = {
  hasWorkspace: Readonly<Ref<boolean>>
  activeFilePath: Readonly<Ref<string>>
  allWorkspaceFiles: Readonly<Ref<string[]>>
  setErrorMessage: (message: string) => void
  toRelativePath: (path: string) => string
  ensureAllFilesLoaded: () => Promise<void>
  saveActiveDocument: () => Promise<void>
  focusEditor: () => void
  getDocumentStatus: (path: string) => NavigationDocumentStatus
  getActiveTab: () => { type: string } | null
  getActiveDocumentPath: (paneId?: string) => string
  getActivePaneId: () => string
  getPaneOrder: () => string[]
  getDocumentPathsForPane: (paneId: string) => string[]
  openPathInPane: (path: string, paneId?: string) => void
  revealDocumentInPane: (path: string, paneId?: string) => void
  setActivePathInPane: (paneId: string, path: string) => void
  openSurfaceInPane: (type: 'home' | 'cosmos' | 'second-brain-chat', paneId?: string) => void
  findPaneContainingSurface: (type: 'home' | 'cosmos' | 'second-brain-chat') => string | null
  documentHistory: {
    record: (path: string) => void
    recordEntry: (entry: DocumentHistoryEntry) => void
    goBackEntry: () => DocumentHistoryEntry | null
    goForwardEntry: () => DocumentHistoryEntry | null
    jumpToEntry: (index: number) => DocumentHistoryEntry | null
    currentIndex: Ref<number>
  }
  readCosmosHistorySnapshot: (payload: unknown) => CosmosHistorySnapshot | null
  currentCosmosHistorySnapshot: () => CosmosHistorySnapshot
  cosmosSnapshotStateKey: (snapshot: CosmosHistorySnapshot) => string
  cosmosHistoryLabel: (snapshot: CosmosHistorySnapshot) => string
  applyCosmosHistorySnapshot: (snapshot: CosmosHistorySnapshot) => Promise<boolean>
  readSecondBrainHistorySnapshot: (payload: unknown) => SecondBrainHistorySnapshot | null
  currentSecondBrainHistorySnapshot: () => SecondBrainHistorySnapshot
  secondBrainSnapshotStateKey: (snapshot: SecondBrainHistorySnapshot) => string
  secondBrainHistoryLabel: (snapshot: SecondBrainHistorySnapshot) => string
  openSecondBrainHistorySnapshot: (snapshot: SecondBrainHistorySnapshot) => Promise<boolean>
  readHomeHistorySnapshot: (payload: unknown) => HomeHistorySnapshot | null
  currentHomeHistorySnapshot: () => HomeHistorySnapshot
  homeSnapshotStateKey: (snapshot: HomeHistorySnapshot) => string
  homeHistoryLabel: (snapshot: HomeHistorySnapshot) => string
  openHomeHistorySnapshot: (snapshot: HomeHistorySnapshot) => Promise<boolean>
}

/**
 * Owns shell navigation flows, including autosave-before-switch behavior and
 * history playback across notes and pane-native surfaces.
 */
export function useAppNavigationController(options: UseAppNavigationControllerOptions) {
  const isApplyingHistoryNavigation = ref(false)
  let cosmosHistoryDebounceTimer: ReturnType<typeof setTimeout> | null = null

  /** Formats a history entry label for the back/forward menus. */
  function historyTargetLabel(entry: DocumentHistoryEntry): string {
    if (entry.kind === 'cosmos') return entry.label
    if (entry.kind === 'second-brain') return entry.label || 'Second Brain'
    if (entry.kind === 'home') return entry.label || 'Home'
    return options.toRelativePath(entry.path)
  }

  /** Records the current Home surface into linear document history. */
  function recordHomeHistorySnapshot() {
    if (isApplyingHistoryNavigation.value) return
    const active = options.getActiveTab()
    if (!active || active.type !== 'home') return
    const snapshot = options.currentHomeHistorySnapshot()
    options.documentHistory.recordEntry({
      kind: 'home',
      path: '__tomosona_home_view__',
      label: options.homeHistoryLabel(snapshot),
      stateKey: options.homeSnapshotStateKey(snapshot),
      payload: snapshot
    })
  }

  /** Records the current Second Brain surface into linear document history. */
  function recordSecondBrainHistorySnapshot() {
    if (isApplyingHistoryNavigation.value) return
    const active = options.getActiveTab()
    if (!active || active.type !== 'second-brain-chat') return
    const snapshot = options.currentSecondBrainHistorySnapshot()
    options.documentHistory.recordEntry({
      kind: 'second-brain',
      path: '__tomosona_second_brain_view__',
      label: options.secondBrainHistoryLabel(snapshot),
      stateKey: options.secondBrainSnapshotStateKey(snapshot),
      payload: snapshot
    })
  }

  /** Records the current Cosmos surface state into linear document history. */
  function recordCosmosHistorySnapshot() {
    if (isApplyingHistoryNavigation.value) return
    const active = options.getActiveTab()
    if (!active || active.type !== 'cosmos') return
    const snapshot = options.currentCosmosHistorySnapshot()
    options.documentHistory.recordEntry({
      kind: 'cosmos',
      path: 'cosmos',
      label: options.cosmosHistoryLabel(snapshot),
      stateKey: options.cosmosSnapshotStateKey(snapshot),
      payload: snapshot
    })
  }

  /**
   * Debounces Cosmos history snapshots so search and graph interactions do not
   * flood the linear history timeline.
   */
  function scheduleCosmosHistorySnapshot() {
    if (cosmosHistoryDebounceTimer) {
      clearTimeout(cosmosHistoryDebounceTimer)
      cosmosHistoryDebounceTimer = null
    }
    cosmosHistoryDebounceTimer = setTimeout(() => {
      recordCosmosHistorySnapshot()
    }, 260)
  }

  /** Saves the active document before a tab switch when it still has unsaved changes. */
  async function ensureActiveTabSavedBeforeSwitch(targetPath: string): Promise<boolean> {
    const target = targetPath.trim()
    const current = options.activeFilePath.value
    if (!target || !current || current === target) return true

    const status = options.getDocumentStatus(current)
    if (!status.dirty) return true

    await options.saveActiveDocument()

    const activeAfterSave = options.activeFilePath.value || current
    const statusAfterSave = options.getDocumentStatus(activeAfterSave)
    if (statusAfterSave.dirty) {
      options.setErrorMessage(statusAfterSave.saveError || 'Could not save current note before switching tabs.')
      return false
    }

    return true
  }

  /** Opens or reveals a document in a pane after the autosave guard passes. */
  async function openTabWithAutosave(path: string, navigation: NavigationOpenOptions = {}): Promise<boolean> {
    const target = path.trim()
    if (!target) return false
    const canSwitch = await ensureActiveTabSavedBeforeSwitch(target)
    if (!canSwitch) return false
    if (navigation.revealInTargetPane) {
      options.revealDocumentInPane(target, navigation.targetPaneId)
    } else {
      options.openPathInPane(target, navigation.targetPaneId)
    }
    if (navigation.recordHistory !== false) {
      options.documentHistory.record(target)
    }
    return true
  }

  /** Activates an already opened tab in the current pane after the autosave guard passes. */
  async function setActiveTabWithAutosave(path: string, navigation: NavigationOpenOptions = {}): Promise<boolean> {
    const target = path.trim()
    if (!target) return false
    const canSwitch = await ensureActiveTabSavedBeforeSwitch(target)
    if (!canSwitch) return false
    options.setActivePathInPane(options.getActivePaneId(), target)
    if (navigation.recordHistory !== false) {
      options.documentHistory.record(target)
    }
    return true
  }

  /** Opens a note from the Second Brain surface into another pane when available. */
  async function openNoteFromSecondBrain(path: string): Promise<void> {
    const sourcePaneId = options.findPaneContainingSurface('second-brain-chat')
    const paneOrder = options.getPaneOrder()
    const targetPaneId = sourcePaneId
      ? paneOrder.find((paneId) => paneId !== sourcePaneId) ?? sourcePaneId
      : options.getActivePaneId()

    await openTabWithAutosave(path, {
      targetPaneId,
      revealInTargetPane: Boolean(targetPaneId),
      recordHistory: true
    })
  }

  /** Replays a history entry regardless of whether it targets a note or a pane-native surface. */
  async function openHistoryEntry(entry: DocumentHistoryEntry): Promise<boolean> {
    if (entry.kind === 'cosmos') {
      const snapshot = options.readCosmosHistorySnapshot(entry.payload)
      if (!snapshot) return false
      return await options.applyCosmosHistorySnapshot(snapshot)
    }
    if (entry.kind === 'second-brain') {
      const snapshot = options.readSecondBrainHistorySnapshot(entry.payload)
      if (!snapshot) return false
      if (!options.allWorkspaceFiles.value.length) {
        await options.ensureAllFilesLoaded()
      }
      return await options.openSecondBrainHistorySnapshot(snapshot)
    }
    if (entry.kind === 'home') {
      const snapshot = options.readHomeHistorySnapshot(entry.payload)
      if (!snapshot) return false
      return await options.openHomeHistorySnapshot(snapshot)
    }

    const opened = await openTabWithAutosave(entry.path, { recordHistory: false })
    if (!opened) return false
    await nextTick()
    options.focusEditor()
    return true
  }

  /** Moves backward in linear history and reverts the pointer if opening fails. */
  async function goBackInHistory() {
    const target = options.documentHistory.goBackEntry()
    if (!target) return false
    isApplyingHistoryNavigation.value = true
    let opened = false
    try {
      opened = await openHistoryEntry(target)
    } finally {
      isApplyingHistoryNavigation.value = false
    }
    if (opened) return true
    options.documentHistory.goForwardEntry()
    return false
  }

  /** Moves forward in linear history and reverts the pointer if opening fails. */
  async function goForwardInHistory() {
    const target = options.documentHistory.goForwardEntry()
    if (!target) return false
    isApplyingHistoryNavigation.value = true
    let opened = false
    try {
      opened = await openHistoryEntry(target)
    } finally {
      isApplyingHistoryNavigation.value = false
    }
    if (opened) return true
    options.documentHistory.goBackEntry()
    return false
  }

  /** Advances to the next document tab inside the active pane. */
  async function openNextTabWithAutosave() {
    const paneId = options.getActivePaneId()
    const tabs = options.getDocumentPathsForPane(paneId)
    if (!tabs.length) return false
    const currentPath = options.getActiveDocumentPath(paneId)
    const currentIndex = tabs.findIndex((path) => path === currentPath)
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % tabs.length
    const nextPath = tabs[nextIndex] ?? ''
    if (!nextPath) return false
    return await setActiveTabWithAutosave(nextPath)
  }

  /** Clears timers owned by the navigation controller. */
  function dispose() {
    if (cosmosHistoryDebounceTimer) {
      clearTimeout(cosmosHistoryDebounceTimer)
      cosmosHistoryDebounceTimer = null
    }
  }

  return {
    isApplyingHistoryNavigation,
    historyTargetLabel,
    recordHomeHistorySnapshot,
    recordSecondBrainHistorySnapshot,
    recordCosmosHistorySnapshot,
    scheduleCosmosHistorySnapshot,
    ensureActiveTabSavedBeforeSwitch,
    openTabWithAutosave,
    setActiveTabWithAutosave,
    openNoteFromSecondBrain,
    openHistoryEntry,
    goBackInHistory,
    goForwardInHistory,
    openNextTabWithAutosave,
    dispose
  }
}
