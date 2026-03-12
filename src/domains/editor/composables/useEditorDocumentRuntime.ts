import { computed, nextTick, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { useFrontmatterProperties } from './useFrontmatterProperties'
import { useEditorSessionLifecycle } from './useEditorSessionLifecycle'
import { useEditorSessionStatus } from './useEditorSessionStatus'
import { useEditorFileLifecycle } from './useEditorFileLifecycle'
import { useEditorPathWatchers } from './useEditorPathWatchers'
import { useEditorTitleState } from './useEditorTitleState'
import { useEditorMountedSessions } from './useEditorMountedSessions'
import { useDocumentEditorSessions, type PaneId } from './useDocumentEditorSessions'
import { toTiptapDoc } from '../lib/tiptap/editorBlocksToTiptapDoc'
import { fromTiptapDoc } from '../lib/tiptap/tiptapDocToEditorBlocks'
import type { EditorBlock } from '../lib/markdownBlocks'
import type { FrontmatterEnvelope } from '../lib/frontmatter'
import type {
  WaitForHeavyRenderIdle,
  HasPendingHeavyRender,
  CaptureHeavyRenderEpoch,
  EditorLoadUiState
} from './useEditorFileLifecycle'

const MAIN_PANE_ID: PaneId = 'main'

/** Groups editor props and persistence I/O consumed by the document runtime. */
export type EditorDocumentRuntimePropsPort = {
  path: Ref<string>
  openPaths: Ref<string[]>
  openFile: (path: string) => Promise<string>
  saveFile: (path: string, text: string, options: { explicit: boolean }) => Promise<{ persisted: boolean }>
  renameFileFromTitle: (path: string, title: string) => Promise<{ path: string; title: string }>
  loadPropertyTypeSchema: () => Promise<Record<string, string>>
  savePropertyTypeSchema: (schema: Record<string, string>) => Promise<void>
}

/** Emits document-facing updates back to the shell. */
export type EditorDocumentRuntimeEmitPort = {
  emitStatus: (payload: { path: string; dirty: boolean; saving: boolean; saveError: string }) => void
  emitOutline: (payload: Array<{ text: string; level: number; id: string }>) => void
  emitProperties: (payload: { path: string; items: Array<{ key: string; value: string }>; parseErrorCount: number }) => void
  emitPathRenamed: (payload: { from: string; to: string; manual: boolean }) => void
}

/** Owns active editor/session access for document lifecycle orchestration. */
export type EditorDocumentRuntimeSessionPort = {
  holder: Ref<HTMLDivElement | null>
  activeEditor: Ref<Editor | null>
  isEditingTitle: () => boolean
  createSessionEditor: (path: string) => Editor
}

/** Keeps only the UI hooks the document runtime truly needs to coordinate with. */
export type EditorDocumentRuntimeUiPort = {
  loading: EditorLoadUiState
  largeDocThreshold: number
  resetTransientUi: () => void
  syncLayout: () => void
  hideTableToolbarAnchor: () => void
  closeCompetingMenus: () => void
  syncAfterSessionChange: () => void
  syncAfterDocumentChange: () => void
  initializeUi: () => Promise<void>
  disposeUi: () => Promise<void>
  interaction: {
    captureCaret: (path: string) => void
    restoreCaret: (path: string) => boolean
    clearOutlineTimer: (path: string) => void
    emitOutlineSoon: (path: string) => void
    closeSlashMenu: () => void
    closeWikilinkMenu: () => void
    syncWikilinkUiFromPluginState: () => void
  }
}

/**
 * Groups document/session lifecycle ownership so EditorView can stay a shell.
 */
export type UseEditorDocumentRuntimeOptions = {
  documentInputPort: EditorDocumentRuntimePropsPort
  documentOutputPort: EditorDocumentRuntimeEmitPort
  documentSessionPort: EditorDocumentRuntimeSessionPort
  documentUiPort: EditorDocumentRuntimeUiPort
  waitForHeavyRenderIdle?: WaitForHeavyRenderIdle
  hasPendingHeavyRender?: HasPendingHeavyRender
  captureHeavyRenderEpoch?: CaptureHeavyRenderEpoch
}

/**
 * Owns document-facing editor lifecycle: session activation, load/save, title,
 * and frontmatter properties. It deliberately stops short of Tiptap interaction
 * wiring and chrome concerns, which stay in their dedicated runtimes.
 */
export function useEditorDocumentRuntime(options: UseEditorDocumentRuntimeOptions) {
  const input = options.documentInputPort
  const output = options.documentOutputPort
  const session = options.documentSessionPort
  const ui = options.documentUiPort
  const uiInteraction = ui.interaction

  const currentPath = computed(() => input.path.value?.trim() || '')

  const sessionStore = useDocumentEditorSessions({
    createEditor: (path) => session.createSessionEditor(path)
  })
  const lifecycle = useEditorSessionLifecycle({
    emitStatus: (payload) => output.emitStatus(payload),
    saveCurrentFile: (manual) => saveCurrentFile(manual),
    isEditingTitle: () => session.isEditingTitle(),
    autosaveIdleMs: 1800
  })
  const sessionStatus = useEditorSessionStatus({
    getSession: (path) => sessionStore.getSession(path),
    ensureSession: (path) => sessionStore.ensureSession(path),
    patchStatus: (path, patch) => lifecycle.patchStatus(path, patch),
    clearAutosaveTimer: () => lifecycle.clearAutosaveTimer(),
    scheduleAutosave: () => lifecycle.scheduleAutosave()
  })
  const getSession = sessionStatus.getSession
  const ensureSession = sessionStatus.ensureSession
  const setDirty = sessionStatus.setDirty
  const setSaving = sessionStatus.setSaving
  const setSaveError = sessionStatus.setSaveError
  const clearAutosaveTimer = sessionStatus.clearAutosaveTimer
  const scheduleAutosave = sessionStatus.scheduleAutosave

  const sessionState = {
    sessionStore,
    lifecycle,
    sessionStatus,
    getSession,
    ensureSession,
    setDirty,
    setSaving,
    setSaveError,
    clearAutosaveTimer,
    scheduleAutosave,
    nextRequestId: lifecycle.nextRequestId,
    isCurrentRequest: lifecycle.isCurrentRequest
  }

  /**
   * Keeps title edits, property edits, and document edits on the same dirty/save
   * semantics so autosave behavior does not diverge across entry points.
   */
  function markPathDirtyAndQueueAutosave(path: string) {
    if (!path) return
    setDirty(path, true)
    setSaveError(path, '')
    scheduleAutosave(path)
  }

  function serializeCurrentDocBlocks(): EditorBlock[] {
    const editor = session.activeEditor.value
    if (!editor) return []
    return fromTiptapDoc(editor.getJSON())
  }

  /**
   * Replaces editor body content without feeding the normal change pipeline back
   * into autosave/outline updates. This keeps programmatic loads idempotent.
   */
  async function renderBlocks(blocks: EditorBlock[]) {
    const editor = session.activeEditor.value
    if (!editor) return
    const doc = toTiptapDoc(blocks)
    const rememberedScroll = session.holder.value?.scrollTop ?? 0
    setSuppressOnChange(true)
    editor.commands.setContent(doc, { emitUpdate: false })
    setSuppressOnChange(false)
    await nextTick()
    ui.syncAfterDocumentChange()
    if (session.holder.value) {
      session.holder.value.scrollTop = rememberedScroll
    }
  }

  const titleState = useEditorTitleState(currentPath)
  const currentTitle = titleState.currentTitle

  const {
    propertyEditorMode,
    frontmatterByPath,
    rawYamlByPath,
    activeParseErrors,
    activeRawYaml,
    canUseStructuredProperties,
    structuredPropertyFields,
    structuredPropertyKeys,
    ensurePropertySchemaLoaded,
    resetPropertySchemaState,
    parseAndStoreFrontmatter,
    serializableFrontmatterFields,
    addPropertyField,
    removePropertyField,
    onPropertyTypeChange,
    onPropertyKeyInput,
    onPropertyValueInput,
    onPropertyCheckboxInput,
    onPropertyTokensChange,
    effectiveTypeForField,
    isPropertyTypeLocked,
    propertiesExpanded,
    togglePropertiesVisibility,
    onRawYamlInput,
    movePathState: moveFrontmatterPathState
  } = useFrontmatterProperties({
    currentPath,
    loadPropertyTypeSchema: input.loadPropertyTypeSchema,
    savePropertyTypeSchema: input.savePropertyTypeSchema,
    onDirty: (path) => markPathDirtyAndQueueAutosave(path),
    emitProperties: (payload) => output.emitProperties(payload)
  })

  const titleAndProperties = {
    titleState,
    currentTitle,
    propertyEditorMode,
    frontmatterByPath,
    rawYamlByPath,
    activeParseErrors,
    activeRawYaml,
    canUseStructuredProperties,
    structuredPropertyFields,
    structuredPropertyKeys,
    ensurePropertySchemaLoaded,
    resetPropertySchemaState,
    parseAndStoreFrontmatter,
    serializableFrontmatterFields,
    addPropertyField,
    removePropertyField,
    onPropertyTypeChange,
    onPropertyKeyInput,
    onPropertyValueInput,
    onPropertyCheckboxInput,
    onPropertyTokensChange,
    effectiveTypeForField,
    isPropertyTypeLocked,
    propertiesExpanded,
    togglePropertiesVisibility,
    onRawYamlInput,
    moveFrontmatterPathState,
    markDocumentDirtyFromMetadataChange: markPathDirtyAndQueueAutosave
  }

  function onTitleInput(value: string) {
    const path = currentPath.value
    if (!path) return
    titleState.setCurrentTitle(path, value)
    markPathDirtyAndQueueAutosave(path)
  }

  function onTitleCommit() {
    const path = currentPath.value
    if (!path) return
    titleState.commitTitle(path)
  }

  let suppressOnChange = false

  function setSuppressOnChange(value: boolean) {
    suppressOnChange = value
  }

  function onEditorDocChanged(path: string) {
    if (suppressOnChange || !path) return
    markPathDirtyAndQueueAutosave(path)
    uiInteraction.emitOutlineSoon(path)
    ui.syncAfterDocumentChange()
  }

  function setActiveSession(path: string) {
    sessionStore.setActivePath(MAIN_PANE_ID, path)
    session.activeEditor.value = getSession(path)?.editor ?? null
    ui.syncAfterSessionChange()
  }

  const mountedSessions = useEditorMountedSessions({
    openPaths: computed(() => options.documentInputPort.openPaths.value ?? []),
    currentPath,
    ensureSession
  })
  const renderPaths = mountedSessions.renderPaths
  const isActiveMountedPath = mountedSessions.isActivePath
  const renderedEditorsByPath = computed<Record<string, Editor | null>>(() => {
    const byPath: Record<string, Editor | null> = {}
    for (const path of renderPaths.value) {
      byPath[path] = getSession(path)?.editor ?? null
    }
    return byPath
  })

  const fileLifecycle = useEditorFileLifecycle({
    sessionPort: {
      currentPath,
      holder: session.holder,
      getEditor: () => session.activeEditor.value,
      getSession,
      ensureSession,
      renameSessionPath: (from, to) => {
        sessionStore.renamePath(from, to)
      },
      moveLifecyclePathState: (from, to) => lifecycle.movePathState(from, to),
      setSuppressOnChange,
      restoreCaret: (path) => uiInteraction.restoreCaret(path),
      setDirty,
      setSaving,
      setSaveError
    },
    documentPort: {
      ensurePropertySchemaLoaded,
      parseAndStoreFrontmatter,
      frontmatterByPath,
      propertyEditorMode,
      rawYamlByPath,
      serializableFrontmatterFields: serializableFrontmatterFields as (
        fields: FrontmatterEnvelope['fields']
      ) => FrontmatterEnvelope['fields'],
      moveFrontmatterPathState,
      countLines: (input) => input.split('\n').length,
      noteTitleFromPath: titleState.noteTitleFromPath,
      getCurrentTitle: titleState.getTitle,
      syncLoadedTitle: titleState.syncLoadedTitle,
      commitTitle: titleState.commitTitle,
      moveTitlePathState: titleState.movePathState,
      serializeCurrentDocBlocks,
      renderBlocks
    },
    uiPort: {
      clearAutosaveTimer,
      clearOutlineTimer: (path) => uiInteraction.clearOutlineTimer(path),
      emitOutlineSoon: (path) => uiInteraction.emitOutlineSoon(path),
      emitPathRenamed: (payload) => output.emitPathRenamed(payload),
      resetTransientUiState: () => ui.resetTransientUi(),
      updateGutterHitboxStyle: () => ui.syncLayout(),
      syncWikilinkUiFromPluginState: () => uiInteraction.syncWikilinkUiFromPluginState(),
      largeDocThreshold: ui.largeDocThreshold,
      ui: ui.loading
    },
    ioPort: {
      openFile: input.openFile,
      saveFile: input.saveFile,
      renameFileFromTitle: input.renameFileFromTitle
    },
    requestPort: {
      isCurrentRequest: (requestId) => lifecycle.isCurrentRequest(requestId)
    },
    waitForHeavyRenderIdle: options.waitForHeavyRenderIdle,
    hasPendingHeavyRender: options.hasPendingHeavyRender,
    captureHeavyRenderEpoch: options.captureHeavyRenderEpoch
  })

  const documentPersistence = {
    serializeCurrentDocBlocks,
    renderBlocks,
    loadCurrentFile,
    saveCurrentFile,
    onEditorDocChanged,
    setSuppressOnChange
  }
  void documentPersistence

  /**
   * Clears document-facing shell state when no active note remains. The watcher
   * owns when this happens; the runtime owns what "empty" means.
   */
  function resetEmptyDocumentState() {
    output.emitProperties({ path: '', items: [], parseErrorCount: 0 })
    output.emitOutline([])
    titleAndProperties.resetPropertySchemaState()
  }

  /**
   * Bootstraps UI listeners first, then rehydrates the active document under the
   * current request token so stale async loads can be discarded downstream.
   */
  async function initializeDocumentRuntime() {
    const chromeInitPromise = ui.initializeUi()
    if (currentPath.value) {
      const requestId = sessionState.nextRequestId()
      ensureSession(currentPath.value)
      setActiveSession(currentPath.value)
      await loadCurrentFile(currentPath.value, { requestId })
    }
    await chromeInitPromise
  }

  /**
   * Tears down UI listeners and in-memory sessions together so the shell never
   * points at an editor instance after unmount.
   */
  async function disposeDocumentRuntime() {
    // Invalidate any in-flight load/save completions owned by this runtime
    // instance before tearing down the editor surface.
    sessionState.nextRequestId()
    await ui.disposeUi()
    sessionStore.closeAll()
    session.activeEditor.value = null
  }

  async function loadCurrentFile(path: string, loadOptions?: { forceReload?: boolean; requestId?: number }) {
    await fileLifecycle.loadCurrentFile(path, loadOptions)
  }

  async function saveCurrentFile(manual = true) {
    await fileLifecycle.saveCurrentFile(manual)
  }

  useEditorPathWatchers({
    path: computed(() => input.path.value ?? ''),
    openPaths: computed(() => input.openPaths.value ?? []),
    holder: session.holder,
    currentPath,
    nextRequestId: () => sessionState.nextRequestId(),
    ensureSession,
    setActiveSession,
    loadCurrentFile,
    captureCaret: (path) => uiInteraction.captureCaret(path),
    getSession,
    getActivePath: () => sessionStore.getActivePath(MAIN_PANE_ID),
    setActivePath: (path) => sessionStore.setActivePath(MAIN_PANE_ID, path),
    clearActiveEditor: () => {
      session.activeEditor.value = null
      ui.syncAfterSessionChange()
    },
    listPaths: () => sessionStore.listPaths(),
    closePath: (path) => sessionStore.closePath(path),
    resetPropertySchemaState,
    emitEmptyProperties: () => resetEmptyDocumentState(),
    closeSlashMenu: () => uiInteraction.closeSlashMenu(),
    closeWikilinkMenu: () => uiInteraction.closeWikilinkMenu(),
    closeBlockMenu: () => ui.closeCompetingMenus(),
    hideTableToolbarAnchor: () => ui.hideTableToolbarAnchor(),
    emitEmptyOutline: () => undefined,
    onMountInit: initializeDocumentRuntime,
    onUnmountCleanup: disposeDocumentRuntime
  })

  return {
    currentPath,
    sessionStore,
    getSession,
    ensureSession,
    renderPaths,
    renderedEditorsByPath,
    isActiveMountedPath,
    setActiveSession,
    loadCurrentFile,
    saveCurrentFile,
    clearAutosaveTimer,
    scheduleAutosave,
    nextRequestId: sessionState.nextRequestId,
    isCurrentRequest: sessionState.isCurrentRequest,
    setDirty,
    setSaveError,
    currentTitle,
    onTitleInput,
    onTitleCommit,
    onEditorDocChanged,
    serializeCurrentDocBlocks,
    renderBlocks,
    propertyEditorMode,
    frontmatterByPath,
    rawYamlByPath,
    activeParseErrors,
    activeRawYaml,
    canUseStructuredProperties,
    structuredPropertyFields,
    structuredPropertyKeys,
    ensurePropertySchemaLoaded,
    resetPropertySchemaState,
    parseAndStoreFrontmatter,
    serializableFrontmatterFields,
    addPropertyField,
    removePropertyField,
    onPropertyTypeChange,
    onPropertyKeyInput,
    onPropertyValueInput,
    onPropertyCheckboxInput,
    onPropertyTokensChange,
    effectiveTypeForField,
    isPropertyTypeLocked,
    propertiesExpanded,
    togglePropertiesVisibility,
    onRawYamlInput,
    moveFrontmatterPathState,
    isLoadingLargeDocument: ui.loading.isLoadingLargeDocument,
    loadStageLabel: ui.loading.loadStageLabel,
    loadProgressPercent: ui.loading.loadProgressPercent,
    loadProgressIndeterminate: ui.loading.loadProgressIndeterminate,
    loadDocumentStats: ui.loading.loadDocumentStats,
    resetTransientDocumentUiState: ui.resetTransientUi
  }
}
