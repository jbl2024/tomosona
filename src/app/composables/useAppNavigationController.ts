import { nextTick, ref, type Ref } from 'vue'
import type { DocumentHistoryEntry } from '../../domains/editor/composables/useDocumentHistory'

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

/**
 * Workspace-scoped state and helpers consumed by the navigation controller.
 *
 * Keep this port focused on workspace concerns instead of passing isolated
 * callbacks one by one from `App.vue`.
 */
export type AppNavigationWorkspacePort = {
  hasWorkspace: Readonly<Ref<boolean>>
  allWorkspaceFiles: Readonly<Ref<string[]>>
  setErrorMessage: (message: string) => void
  toRelativePath: (path: string) => string
  ensureAllFilesLoaded: () => Promise<void>
  recordRecentNote: (path: string) => void
}

/** Editor-specific state used to enforce autosave and route focus intents. */
export type AppNavigationEditorPort = {
  activeFilePath: Readonly<Ref<string>>
  saveActiveDocument: () => Promise<void>
  focusEditor: () => void
  getDocumentStatus: (path: string) => NavigationDocumentStatus
  isMarkdownPath: (path: string) => boolean
  isTextFile: (path: string) => Promise<boolean>
}

/** Pane layout and surface routing used by shell navigation flows. */
export type AppNavigationPanePort = {
  getActiveTab: () => { type: string } | null
  getActiveDocumentPath: (paneId?: string) => string
  getActivePaneId: () => string
  getPaneOrder: () => string[]
  getDocumentPathsForPane: (paneId: string) => string[]
  openPathInPane: (path: string, paneId?: string) => void
  openInspectorInPane: (path: string, paneId?: string) => void
  revealDocumentInPane: (path: string, paneId?: string) => void
  setActivePathInPane: (paneId: string, path: string) => void
  openSurfaceInPane: (type: 'home' | 'second-brain-chat' | 'alters', paneId?: string) => void
  findPaneContainingSurface: (type: 'home' | 'second-brain-chat' | 'alters') => string | null
}

/**
 * History state and pane-native snapshot adapters.
 *
 * This grouped contract is the reference pattern for future shell composables:
 * prefer a few cohesive ports over a flat list of callbacks.
 */
export type AppNavigationHistoryPort = {
  documentHistory: {
    record: (path: string) => void
    recordEntry: (entry: DocumentHistoryEntry) => void
    goBackEntry: () => DocumentHistoryEntry | null
    goForwardEntry: () => DocumentHistoryEntry | null
    jumpToEntry: (index: number) => DocumentHistoryEntry | null
    currentIndex: Ref<number>
  }
  secondBrain: {
    read: (payload: unknown) => SecondBrainHistorySnapshot | null
    current: () => SecondBrainHistorySnapshot
    stateKey: (snapshot: SecondBrainHistorySnapshot) => string
    label: (snapshot: SecondBrainHistorySnapshot) => string
    open: (snapshot: SecondBrainHistorySnapshot) => Promise<boolean>
  }
  home: {
    read: (payload: unknown) => HomeHistorySnapshot | null
    current: () => HomeHistorySnapshot
    stateKey: (snapshot: HomeHistorySnapshot) => string
    label: (snapshot: HomeHistorySnapshot) => string
    open: (snapshot: HomeHistorySnapshot) => Promise<boolean>
  }
}

/** Declares the cohesive ports required by the app navigation controller. */
export type UseAppNavigationControllerOptions = {
  workspacePort: AppNavigationWorkspacePort
  editorPort: AppNavigationEditorPort
  panePort: AppNavigationPanePort
  historyPort: AppNavigationHistoryPort
}

/**
 * Owns shell navigation flows, including autosave-before-switch behavior and
 * history playback across notes and pane-native surfaces.
 */
export function useAppNavigationController(options: UseAppNavigationControllerOptions) {
  const isApplyingHistoryNavigation = ref(false)
  const { workspacePort, editorPort, panePort, historyPort } = options

  async function openSurfaceHistoryEntry<T>(
    payload: unknown,
    handlers: {
      read: (payload: unknown) => T | null
      open: (snapshot: T) => Promise<boolean>
      ensureWorkspaceFiles?: boolean
    }
  ): Promise<boolean> {
    const snapshot = handlers.read(payload)
    if (!snapshot) return false
    if (handlers.ensureWorkspaceFiles && !workspacePort.allWorkspaceFiles.value.length) {
      await workspacePort.ensureAllFilesLoaded()
    }
    return await handlers.open(snapshot)
  }

  /** Formats a history entry label for the back/forward menus. */
  function historyTargetLabel(entry: DocumentHistoryEntry): string {
    if (entry.kind === 'second-brain') return entry.label || 'Second Brain'
    if (entry.kind === 'home') return entry.label || 'Home'
    return workspacePort.toRelativePath(entry.path)
  }

  /** Records the current Home surface into linear document history. */
  function recordHomeHistorySnapshot() {
    if (isApplyingHistoryNavigation.value) return
    const active = panePort.getActiveTab()
    if (!active || active.type !== 'home') return
    const snapshot = historyPort.home.current()
    historyPort.documentHistory.recordEntry({
      kind: 'home',
      path: '__tomosona_home_view__',
      label: historyPort.home.label(snapshot),
      stateKey: historyPort.home.stateKey(snapshot),
      payload: snapshot
    })
  }

  /** Records the current Second Brain surface into linear document history. */
  function recordSecondBrainHistorySnapshot() {
    if (isApplyingHistoryNavigation.value) return
    const active = panePort.getActiveTab()
    if (!active || active.type !== 'second-brain-chat') return
    const snapshot = historyPort.secondBrain.current()
    historyPort.documentHistory.recordEntry({
      kind: 'second-brain',
      path: '__tomosona_second_brain_view__',
      label: historyPort.secondBrain.label(snapshot),
      stateKey: historyPort.secondBrain.stateKey(snapshot),
      payload: snapshot
    })
  }

  /** Saves the active document before a tab switch when it still has unsaved changes. */
  async function ensureActiveTabSavedBeforeSwitch(targetPath: string): Promise<boolean> {
    const target = targetPath.trim()
    const current = editorPort.activeFilePath.value
    if (!target || !current || current === target) return true

    const status = editorPort.getDocumentStatus(current)
    if (!status.dirty) return true

    await editorPort.saveActiveDocument()

    const activeAfterSave = editorPort.activeFilePath.value || current
    const statusAfterSave = editorPort.getDocumentStatus(activeAfterSave)
    if (statusAfterSave.dirty) {
      workspacePort.setErrorMessage(statusAfterSave.saveError || 'Could not save current note before switching tabs.')
      return false
    }

    return true
  }

  /** Opens or reveals a document in a pane after the autosave guard passes. */
  async function openTabWithAutosave(path: string, navigation: NavigationOpenOptions = {}): Promise<boolean> {
    const target = path.trim()
    if (!target) return false
    const activeTab = panePort.getActiveTab()
    const activeIsDocument = activeTab?.type === 'document'
    if (
      !navigation.targetPaneId &&
      activeIsDocument &&
      editorPort.activeFilePath.value === target &&
      !navigation.revealInTargetPane
    ) {
      await nextTick()
      editorPort.focusEditor()
      return true
    }
    const canSwitch = await ensureActiveTabSavedBeforeSwitch(target)
    if (!canSwitch) {
      return false
    }
    const sourcePath = options.editorPort.isMarkdownPath(target) || await options.editorPort.isTextFile(target)
    if (sourcePath) {
      if (navigation.revealInTargetPane) {
        panePort.revealDocumentInPane(target, navigation.targetPaneId)
      } else {
        panePort.openPathInPane(target, navigation.targetPaneId)
      }
    } else {
      panePort.openInspectorInPane(target, navigation.targetPaneId)
    }
    if (navigation.recordHistory !== false) {
      historyPort.documentHistory.record(target)
    }
    workspacePort.recordRecentNote(target)
    await nextTick()
    editorPort.focusEditor()
    return true
  }

  /** Activates an already opened tab in the current pane after the autosave guard passes. */
  async function setActiveTabWithAutosave(path: string, navigation: NavigationOpenOptions = {}): Promise<boolean> {
    const target = path.trim()
    if (!target) return false
    if (editorPort.activeFilePath.value === target) return true
    const canSwitch = await ensureActiveTabSavedBeforeSwitch(target)
    if (!canSwitch) {
      return false
    }
    panePort.setActivePathInPane(panePort.getActivePaneId(), target)
    if (navigation.recordHistory !== false) {
      historyPort.documentHistory.record(target)
    }
    workspacePort.recordRecentNote(target)
    await nextTick()
    editorPort.focusEditor()
    return true
  }

  /** Opens a note from the Second Brain surface into another pane when available. */
  async function openNoteFromSecondBrain(path: string): Promise<void> {
    const sourcePaneId = panePort.findPaneContainingSurface('second-brain-chat')
    const paneOrder = panePort.getPaneOrder()
    const targetPaneId = sourcePaneId
      ? paneOrder.find((paneId) => paneId !== sourcePaneId) ?? sourcePaneId
      : panePort.getActivePaneId()

    await openTabWithAutosave(path, {
      targetPaneId,
      revealInTargetPane: Boolean(targetPaneId),
      recordHistory: true
    })
  }

  /** Replays a history entry regardless of whether it targets a note or a pane-native surface. */
  async function openHistoryEntry(entry: DocumentHistoryEntry): Promise<boolean> {
    if (entry.kind === 'second-brain') {
      return await openSurfaceHistoryEntry(entry.payload, {
        read: historyPort.secondBrain.read,
        open: historyPort.secondBrain.open,
        ensureWorkspaceFiles: true
      })
    }
    if (entry.kind === 'home') {
      return await openSurfaceHistoryEntry(entry.payload, {
        read: historyPort.home.read,
        open: historyPort.home.open
      })
    }

    const opened = await openTabWithAutosave(entry.path, { recordHistory: false })
    if (!opened) return false
    return true
  }

  /** Moves backward in linear history and reverts the pointer if opening fails. */
  async function goBackInHistory() {
    const target = historyPort.documentHistory.goBackEntry()
    if (!target) return false
    isApplyingHistoryNavigation.value = true
    let opened = false
    try {
      opened = await openHistoryEntry(target)
    } finally {
      isApplyingHistoryNavigation.value = false
    }
    if (opened) return true
    historyPort.documentHistory.goForwardEntry()
    return false
  }

  /** Moves forward in linear history and reverts the pointer if opening fails. */
  async function goForwardInHistory() {
    const target = historyPort.documentHistory.goForwardEntry()
    if (!target) return false
    isApplyingHistoryNavigation.value = true
    let opened = false
    try {
      opened = await openHistoryEntry(target)
    } finally {
      isApplyingHistoryNavigation.value = false
    }
    if (opened) return true
    historyPort.documentHistory.goBackEntry()
    return false
  }

  /** Advances to the next document tab inside the active pane. */
  async function openNextTabWithAutosave() {
    const paneId = panePort.getActivePaneId()
    const tabs = panePort.getDocumentPathsForPane(paneId)
    if (!tabs.length) return false
    const currentPath = panePort.getActiveDocumentPath(paneId)
    const currentIndex = tabs.findIndex((path) => path === currentPath)
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % tabs.length
    const nextPath = tabs[nextIndex] ?? ''
    if (!nextPath) return false
    return await setActiveTabWithAutosave(nextPath)
  }

  return {
    isApplyingHistoryNavigation,
    historyTargetLabel,
    recordHomeHistorySnapshot,
    recordSecondBrainHistorySnapshot,
    ensureActiveTabSavedBeforeSwitch,
    openTabWithAutosave,
    setActiveTabWithAutosave,
    openNoteFromSecondBrain,
    openHistoryEntry,
    goBackInHistory,
    goForwardInHistory,
    openNextTabWithAutosave
  }
}
