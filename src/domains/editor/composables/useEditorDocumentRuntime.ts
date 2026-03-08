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
import type { WaitForHeavyRenderIdle, HasPendingHeavyRender, EditorLoadUiState } from './useEditorFileLifecycle'

const MAIN_PANE_ID: PaneId = 'main'

export type EditorDocumentRuntimePropsPort = {
  path: Ref<string>
  openPaths: Ref<string[]>
  openFile: (path: string) => Promise<string>
  saveFile: (path: string, text: string, options: { explicit: boolean }) => Promise<{ persisted: boolean }>
  renameFileFromTitle: (path: string, title: string) => Promise<{ path: string; title: string }>
  loadPropertyTypeSchema: () => Promise<Record<string, string>>
  savePropertyTypeSchema: (schema: Record<string, string>) => Promise<void>
}

export type EditorDocumentRuntimeEmitPort = {
  emitStatus: (payload: { path: string; dirty: boolean; saving: boolean; saveError: string }) => void
  emitOutline: (payload: Array<{ text: string; level: number; id: string }>) => void
  emitProperties: (payload: { path: string; items: Array<{ key: string; value: string }>; parseErrorCount: number }) => void
  emitPathRenamed: (payload: { from: string; to: string; manual: boolean }) => void
}

export type EditorDocumentRuntimeSessionPort = {
  holder: Ref<HTMLDivElement | null>
  activeEditor: Ref<Editor | null>
  isEditingTitle: () => boolean
  createSessionEditor: (path: string) => Editor
}

export type EditorDocumentRuntimeInteractionPort = {
  captureCaret: (path: string) => void
  restoreCaret: (path: string) => boolean
  clearOutlineTimer: (path: string) => void
  emitOutlineSoon: (path: string) => void
  closeSlashMenu: () => void
  closeWikilinkMenu: () => void
  syncWikilinkUiFromPluginState: () => void
}

export type EditorDocumentRuntimeChromePort = {
  largeDocThreshold: number
  loadUiState: EditorLoadUiState
  resetTransientUiState: () => void
  updateGutterHitboxStyle: () => void
  hideTableToolbarAnchor: () => void
  closeBlockMenu: () => void
  onActiveSessionChanged: () => void
  onDocumentContentChanged: () => void
  onMountInit: () => Promise<void>
  onUnmountCleanup: () => Promise<void>
}

/**
 * Groups document/session lifecycle ownership so EditorView can stay a shell.
 */
export type UseEditorDocumentRuntimeOptions = {
  propsPort: EditorDocumentRuntimePropsPort
  emitPort: EditorDocumentRuntimeEmitPort
  sessionPort: EditorDocumentRuntimeSessionPort
  interactionPort: EditorDocumentRuntimeInteractionPort
  chromePort: EditorDocumentRuntimeChromePort
  waitForHeavyRenderIdle?: WaitForHeavyRenderIdle
  hasPendingHeavyRender?: HasPendingHeavyRender
}

export function useEditorDocumentRuntime(options: UseEditorDocumentRuntimeOptions) {
  const currentPath = computed(() => options.propsPort.path.value?.trim() || '')

  const sessionStore = useDocumentEditorSessions({
    createEditor: (path) => options.sessionPort.createSessionEditor(path)
  })
  const lifecycle = useEditorSessionLifecycle({
    emitStatus: (payload) => options.emitPort.emitStatus(payload),
    saveCurrentFile: (manual) => saveCurrentFile(manual),
    isEditingTitle: () => options.sessionPort.isEditingTitle(),
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

  function serializeCurrentDocBlocks(): EditorBlock[] {
    const editor = options.sessionPort.activeEditor.value
    if (!editor) return []
    return fromTiptapDoc(editor.getJSON())
  }

  async function renderBlocks(blocks: EditorBlock[]) {
    const editor = options.sessionPort.activeEditor.value
    if (!editor) return
    const doc = toTiptapDoc(blocks)
    const rememberedScroll = options.sessionPort.holder.value?.scrollTop ?? 0
    setSuppressOnChange(true)
    editor.commands.setContent(doc, { emitUpdate: false })
    setSuppressOnChange(false)
    await nextTick()
    options.chromePort.onDocumentContentChanged()
    if (options.sessionPort.holder.value) {
      options.sessionPort.holder.value.scrollTop = rememberedScroll
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
    loadPropertyTypeSchema: options.propsPort.loadPropertyTypeSchema,
    savePropertyTypeSchema: options.propsPort.savePropertyTypeSchema,
    onDirty: (path) => {
      setDirty(path, true)
      setSaveError(path, '')
      scheduleAutosave(path)
    },
    emitProperties: (payload) => options.emitPort.emitProperties(payload)
  })

  function onTitleInput(value: string) {
    const path = currentPath.value
    if (!path) return
    titleState.setCurrentTitle(path, value)
    setDirty(path, true)
    setSaveError(path, '')
    scheduleAutosave(path)
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
    setDirty(path, true)
    setSaveError(path, '')
    scheduleAutosave(path)
    options.interactionPort.emitOutlineSoon(path)
    options.chromePort.onDocumentContentChanged()
  }

  function setActiveSession(path: string) {
    sessionStore.setActivePath(MAIN_PANE_ID, path)
    options.sessionPort.activeEditor.value = getSession(path)?.editor ?? null
    options.chromePort.onActiveSessionChanged()
  }

  const mountedSessions = useEditorMountedSessions({
    openPaths: computed(() => options.propsPort.openPaths.value ?? []),
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
      holder: options.sessionPort.holder,
      getEditor: () => options.sessionPort.activeEditor.value,
      getSession,
      ensureSession,
      renameSessionPath: (from, to) => {
        sessionStore.renamePath(from, to)
      },
      moveLifecyclePathState: (from, to) => lifecycle.movePathState(from, to),
      setSuppressOnChange,
      restoreCaret: (path) => options.interactionPort.restoreCaret(path),
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
      clearOutlineTimer: (path) => options.interactionPort.clearOutlineTimer(path),
      emitOutlineSoon: (path) => options.interactionPort.emitOutlineSoon(path),
      emitPathRenamed: (payload) => options.emitPort.emitPathRenamed(payload),
      resetTransientUiState: () => options.chromePort.resetTransientUiState(),
      updateGutterHitboxStyle: () => options.chromePort.updateGutterHitboxStyle(),
      syncWikilinkUiFromPluginState: () => options.interactionPort.syncWikilinkUiFromPluginState(),
      largeDocThreshold: options.chromePort.largeDocThreshold,
      ui: options.chromePort.loadUiState
    },
    ioPort: {
      openFile: options.propsPort.openFile,
      saveFile: options.propsPort.saveFile,
      renameFileFromTitle: options.propsPort.renameFileFromTitle
    },
    requestPort: {
      isCurrentRequest: (requestId) => lifecycle.isCurrentRequest(requestId)
    },
    waitForHeavyRenderIdle: options.waitForHeavyRenderIdle,
    hasPendingHeavyRender: options.hasPendingHeavyRender
  })

  async function loadCurrentFile(path: string, loadOptions?: { forceReload?: boolean; requestId?: number }) {
    await fileLifecycle.loadCurrentFile(path, loadOptions)
  }

  async function saveCurrentFile(manual = true) {
    await fileLifecycle.saveCurrentFile(manual)
  }

  useEditorPathWatchers({
    path: computed(() => options.propsPort.path.value ?? ''),
    openPaths: computed(() => options.propsPort.openPaths.value ?? []),
    holder: options.sessionPort.holder,
    currentPath,
    nextRequestId: () => lifecycle.nextRequestId(),
    ensureSession,
    setActiveSession,
    loadCurrentFile,
    captureCaret: (path) => options.interactionPort.captureCaret(path),
    getSession,
    getActivePath: () => sessionStore.getActivePath(MAIN_PANE_ID),
    setActivePath: (path) => sessionStore.setActivePath(MAIN_PANE_ID, path),
    clearActiveEditor: () => {
      options.sessionPort.activeEditor.value = null
      options.chromePort.onActiveSessionChanged()
    },
    listPaths: () => sessionStore.listPaths(),
    closePath: (path) => sessionStore.closePath(path),
    resetPropertySchemaState,
    emitEmptyProperties: () => {
      options.emitPort.emitProperties({ path: '', items: [], parseErrorCount: 0 })
    },
    closeSlashMenu: () => options.interactionPort.closeSlashMenu(),
    closeWikilinkMenu: () => options.interactionPort.closeWikilinkMenu(),
    closeBlockMenu: () => options.chromePort.closeBlockMenu(),
    hideTableToolbarAnchor: () => options.chromePort.hideTableToolbarAnchor(),
    emitEmptyOutline: () => {
      options.emitPort.emitOutline([])
    },
    onMountInit: async () => {
      const chromeInitPromise = options.chromePort.onMountInit()
      if (currentPath.value) {
        const requestId = lifecycle.nextRequestId()
        ensureSession(currentPath.value)
        setActiveSession(currentPath.value)
        await loadCurrentFile(currentPath.value, { requestId })
      }
      await chromeInitPromise
    },
    onUnmountCleanup: async () => {
      await options.chromePort.onUnmountCleanup()
      sessionStore.closeAll()
      options.sessionPort.activeEditor.value = null
    }
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
    nextRequestId: lifecycle.nextRequestId,
    isCurrentRequest: lifecycle.isCurrentRequest,
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
    isLoadingLargeDocument: options.chromePort.loadUiState.isLoadingLargeDocument,
    loadStageLabel: options.chromePort.loadUiState.loadStageLabel,
    loadProgressPercent: options.chromePort.loadUiState.loadProgressPercent,
    loadProgressIndeterminate: options.chromePort.loadUiState.loadProgressIndeterminate,
    loadDocumentStats: options.chromePort.loadUiState.loadDocumentStats,
    resetTransientDocumentUiState: options.chromePort.resetTransientUiState
  }
}
