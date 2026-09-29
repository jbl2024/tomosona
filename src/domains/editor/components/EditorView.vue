<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch, type Ref } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { Bars3Icon } from '@heroicons/vue/24/outline'
import { createExtractedNote, importAssetFiles, openExternalUrl } from '../../../shared/api/workspaceApi'
import type {
  NoteHistoryEntry,
  ReadNoteSnapshotResult,
  SaveNoteResult,
  WorkspaceFsChange
} from '../../../shared/api/apiTypes'
import {
  listNoteHistory,
  readNoteHistorySnapshot,
  restoreNoteHistorySnapshot
} from '../../../shared/api/noteHistoryApi'
import type { DocumentSession } from '../composables/useDocumentEditorSessions'
import { captureHeavyRenderEpoch, hasPendingHeavyRender, waitForHeavyRenderIdle } from '../lib/tiptap/renderStabilizer'
import { useEditorChromeRuntime } from '../composables/useEditorChromeRuntime'
import { useEditorDocumentRuntime } from '../composables/useEditorDocumentRuntime'
import { useEditorInteractionRuntime } from '../composables/useEditorInteractionRuntime'
import { useEmbeddedNoteActions } from '../composables/useEmbeddedNoteActions'
import { getBlockStructureLabel } from '../lib/tiptap/blockMenu/guards'
import { buildAssetBrowserItems } from '../lib/tiptap/assetBrowser'
import { parseWikilinkTarget } from '../lib/wikilinks'
import EditorContextOverlays from './editor/EditorContextOverlays.vue'
import EditorFindToolbar from './editor/EditorFindToolbar.vue'
import EditorInlineFormatToolbar from './editor/EditorInlineFormatToolbar.vue'
import EditorLargeDocOverlay from './editor/EditorLargeDocOverlay.vue'
import EditorRuler from './editor/EditorRuler.vue'
import EditorAtOverlay from './editor/EditorAtOverlay.vue'
import EditorEmojiPicker from './editor/EditorEmojiPicker.vue'
import EditorMermaidPreviewDialog from './editor/EditorMermaidPreviewDialog.vue'
import EditorAssetPreviewDialog from './editor/EditorAssetPreviewDialog.vue'
import EditorMermaidReplaceDialog from './editor/EditorMermaidReplaceDialog.vue'
import EditorPropertiesPanel from './editor/EditorPropertiesPanel.vue'
import EditorNoteHistoryDialog from './editor/EditorNoteHistoryDialog.vue'
import EditorSpellcheckMenu from './editor/EditorSpellcheckMenu.vue'
import EditorSlashOverlay from './editor/EditorSlashOverlay.vue'
import SourceEditorPane from './editor/SourceEditorPane.vue'
import EditorTableEdgeControls from './editor/EditorTableEdgeControls.vue'
import EditorTitleField from './editor/EditorTitleField.vue'
import EditorWikilinkOverlay from './editor/EditorWikilinkOverlay.vue'
import './editor/EditorViewContent.css'
import { useWorkspaceSpellcheckDictionary } from '../composables/useWorkspaceSpellcheckDictionary'
import { sourceEditorLanguageLabelForPath } from '../../../app/lib/appShellDocuments'
import { isMarkdownPath } from '../../../app/lib/appShellPaths'
import { buildNewNoteTemplateItems } from '../../../app/lib/newNoteTemplates'
import { INLINE_TEXT_COMMAND_HANDLER, type InlineTextCommandInput } from '../lib/inlineTextCommands'
import { useEditorSourceMode } from '../composables/useEditorSourceMode'
import { useSourceEditorRuntime } from '../composables/useSourceEditorRuntime'
import {
  EMPTY_EDITOR_SIGNAL_SUMMARY,
  type EditorSignalDirection,
  type EditorSignalKind,
  type EditorSignalSummary
} from '../lib/editorSignals'

type HeadingNode = { text: string; level: number; id?: string }
type CorePropertyOption = { key: string; label?: string; description?: string }

const CORE_PROPERTY_OPTIONS: CorePropertyOption[] = [
  { key: 'tags', label: 'tags', description: 'Tag list' },
  { key: 'aliases', label: 'aliases', description: 'Alternative names' },
  { key: 'date', label: 'date', description: 'Primary date (YYYY-MM-DD)' },
  { key: 'deadline', label: 'deadline', description: 'Due date (YYYY-MM-DD)' },
  { key: 'status', label: 'status', description: 'Workflow state' },
  { key: 'category', label: 'category', description: 'Content category' },
  { key: 'language', label: 'language', description: 'Preferred note language for spellcheck' },
  { key: 'created', label: 'created', description: 'Creation date (YYYY-MM-DD)' },
  { key: 'updated', label: 'updated', description: 'Last update date (YYYY-MM-DD)' },
  { key: 'priority', label: 'priority', description: 'Priority level' },
  { key: 'version', label: 'version', description: 'Version label' }
]

const props = defineProps<{
  path: string
  workspacePath?: string
  openPaths?: string[]
  allWorkspaceFiles?: string[]
  openFile?: (path: string) => Promise<string>
  saveFile?: (path: string, text: string, options: { explicit: boolean }) => Promise<{ persisted: boolean }>
  readNoteSnapshot?: (path: string) => Promise<ReadNoteSnapshotResult>
  saveNoteBuffer?: (
    path: string,
    text: string,
    options: { explicit: boolean; expectedBaseVersion: DocumentSession['baseVersion']; force?: boolean }
  ) => Promise<SaveNoteResult>
  renameFileFromTitle: (path: string, title: string) => Promise<{ path: string; title: string }>
  loadLinkTargets: () => Promise<string[]>
  loadLinkHeadings: (target: string) => Promise<string[]>
  loadPropertyTypeSchema: () => Promise<Record<string, string>>
  savePropertyTypeSchema: (schema: Record<string, string>) => Promise<void>
  openLinkTarget: (target: string) => Promise<boolean>
  spellcheckEnabled?: boolean
  rulerVisible?: boolean
}>()

const emit = defineEmits([
  'status',
  'path-renamed',
  'outline',
  'properties',
  'signal-summary',
  'external-reload'
])

function emitStatus(payload: { path: string; dirty: boolean; saving: boolean; saveError: string }) {
  emit('status', payload)
}

function emitPathRenamed(payload: { from: string; to: string; manual: boolean }) {
  sourceMode.movePath(payload.from, payload.to)
  emit('path-renamed', payload)
}

function emitOutline(payload: HeadingNode[]) {
  emit('outline', payload)
}

function emitProperties(payload: { path: string; items: Array<{ key: string; value: string }>; parseErrorCount: number }) {
  emit('properties', payload)
}

function emitSignalSummary(payload: EditorSignalSummary) {
  emit('signal-summary', payload)
}

function emitExternalReload(payload: { path: string }) {
  emit('external-reload', payload)
}

const holder = ref<HTMLDivElement | null>(null)
const contentShell = ref<HTMLDivElement | null>(null)
const blockGutterEl = ref<HTMLDivElement | null>(null)
const rulerRef = ref<InstanceType<typeof EditorRuler> | null>(null)
const blockGutterWidth = ref(72)
let blockGutterResizeObserver: ResizeObserver | null = null

function syncBlockGutterWidth() {
  const width = blockGutterEl.value?.getBoundingClientRect().width ?? 0
  if (width > 0) {
    blockGutterWidth.value = width
  }
}

onMounted(() => {
  syncBlockGutterWidth()
})

onBeforeUnmount(() => {
  blockGutterResizeObserver?.disconnect()
  blockGutterResizeObserver = null
})

watch(
  blockGutterEl,
  (element, _previous, onCleanup) => {
    blockGutterResizeObserver?.disconnect()
    blockGutterResizeObserver = null

    if (!element) return

    syncBlockGutterWidth()

    if (typeof ResizeObserver === 'undefined') return

    blockGutterResizeObserver = new ResizeObserver(() => {
      syncBlockGutterWidth()
    })
    blockGutterResizeObserver.observe(element)

    onCleanup(() => {
      blockGutterResizeObserver?.disconnect()
      blockGutterResizeObserver = null
    })
  },
  { flush: 'post' }
)
const activeEditor = ref<Editor | null>(null) as Ref<Editor | null>
const pathRef = computed(() => props.path ?? '')
const workspacePathRef = computed(() => props.workspacePath ?? '')
const openPathsRef = computed(() => props.openPaths ?? [])
const allWorkspaceFilesRef = computed(() => props.allWorkspaceFiles ?? [])
const currentPathSource = computed(() => props.path?.trim() || '')
const sourceMode = useEditorSourceMode(currentPathSource)
const spellcheckEnabledRef = computed(() => Boolean(props.spellcheckEnabled))
const assetBrowserItems = computed(() =>
  buildAssetBrowserItems({
    workspaceRoot: workspacePathRef.value,
    allWorkspaceFiles: allWorkspaceFilesRef.value
  })
)
const atTemplateItems = computed(() =>
  buildNewNoteTemplateItems({
    workspaceRoot: workspacePathRef.value,
    allWorkspaceFiles: allWorkspaceFilesRef.value
  })
    .filter((item) => item.kind === 'template')
    .map((item) => ({
      path: item.path,
      label: item.label,
      relativePath: String(item.id).replace(/^template:/, ''),
      group: String(item.group ?? '')
    }))
)
const workspaceSpellcheck = useWorkspaceSpellcheckDictionary({ workspacePath: workspacePathRef })

let chromeRuntime!: ReturnType<typeof useEditorChromeRuntime>
let interactionRuntime!: ReturnType<typeof useEditorInteractionRuntime>
let documentRuntime!: ReturnType<typeof useEditorDocumentRuntime>
let sourceRuntime!: ReturnType<typeof useSourceEditorRuntime>
const embeddedNoteActions = useEmbeddedNoteActions({
  workspacePath: workspacePathRef,
  readNoteSnapshot: props.readNoteSnapshot,
  openFile: props.openFile,
  saveCurrentFile: (manual?: boolean) => documentRuntime?.saveCurrentFile(manual)
})

chromeRuntime = useEditorChromeRuntime({
  chromeHostPort: {
    holder,
    contentShell,
    currentPath: currentPathSource,
    getCurrentPath: () => currentPathSource.value,
    getEditor: () => activeEditor.value,
    getSession: (path) => getDocumentSession(path)
  },
  chromeInteractionPort: {
    menus: {
      closeSlashMenu: () => interactionRuntime?.closeSlashMenu(),
      dismissSlashMenu: () => interactionRuntime?.dismissSlashMenu(),
      closeWikilinkMenu: () => interactionRuntime?.closeWikilinkMenu(),
      openSlashAtSelection: () => interactionRuntime?.openSlashAtSelection()
    },
    editorEvents: {
      onEditorKeydown: (event) => interactionRuntime?.onEditorKeydown(event),
      onEditorKeyup: () => interactionRuntime?.onEditorKeyup(),
      onEditorContextMenu: (event) => interactionRuntime?.onEditorContextMenu(event),
      onEditorPaste: (event) => interactionRuntime?.onEditorPaste(event),
      markEditorInteraction: () => interactionRuntime?.markEditorInteraction()
    },
    caches: {
      resetWikilinkDataCache: () => interactionRuntime?.resetWikilinkDataCache()
    },
    spellcheck: {
      addIgnoredWord: (word: string) => {
        workspaceSpellcheck.addIgnoredWord(word)
        const path = currentPathSource.value
        if (path) {
          interactionRuntime?.refreshSpellcheckForPath(path)
        }
      },
      refreshForPath: (path: string) => interactionRuntime?.refreshSpellcheckForPath(path)
    }
  },
})

sourceRuntime = useSourceEditorRuntime({
  path: currentPathSource,
  openPaths: openPathsRef,
  openFile: props.openFile,
  readNoteSnapshot: props.readNoteSnapshot,
  saveFile: props.saveFile,
  saveNoteBuffer: props.saveNoteBuffer,
  emitStatus: emitStatus,
  emitOutline,
  isSourceMode: (path) => sourceMode.isSourceMode(path),
  isEditingTitle: () => false
})

interactionRuntime = useEditorInteractionRuntime({
  interactionDocumentPort: {
    currentPath: currentPathSource,
    currentTitle: computed(() => documentRuntime?.currentTitle.value ?? ''),
    holder,
    activeEditor,
    getSession: (path) => getDocumentSession(path),
    getFrontmatter: (path) => documentRuntime?.frontmatterByPath.value[path] ?? null,
    getTemplateMacros: () => atTemplateItems.value,
    readTemplateContent: async (templatePath) => {
      if (props.readNoteSnapshot) {
        return (await props.readNoteSnapshot(templatePath)).content
      }
      if (!props.openFile) return ''
      return await props.openFile!(templatePath)
    },
    getSpellcheckLanguage: (path) => documentRuntime?.getSpellcheckLanguage(path) ?? 'en',
    spellcheckEnabled: spellcheckEnabledRef,
    isSpellcheckWordIgnored: (_path, word) => workspaceSpellcheck.isIgnoredWord(word) || chromeRuntime.spellcheck.isSessionIgnoredWord(word),
    saveCurrentFile: (manual) => documentRuntime?.saveCurrentFile(manual),
    onEditorDocChanged: (path) => documentRuntime?.onEditorDocChanged(path)
  },
  interactionEditorPort: {
    emitOutline,
    requestMermaidReplaceConfirm: chromeRuntime.dialogsAndLifecycle.requestMermaidReplaceConfirm,
    openMermaidPreview: chromeRuntime.dialogsAndLifecycle.openMermaidPreview,
    openAssetPreview: chromeRuntime.dialogsAndLifecycle.openAssetPreview
  },
  interactionChromePort: {
    menus: {
      blockMenuOpen: chromeRuntime.blockAndTable.blockMenuOpen,
      tableToolbarOpen: chromeRuntime.blockAndTable.tableToolbarOpen,
      closeBlockMenu: () => chromeRuntime.blockAndTable.closeBlockMenu(),
      hideTableToolbar: () => chromeRuntime.blockAndTable.hideTableToolbar()
    },
    blockHandles: {
      syncSelectionTarget: () => chromeRuntime.blockAndTable.onBlockHandleSelectionUpdate()
    },
    toolbars: {
      updateFormattingToolbar: () => chromeRuntime.toolbars.updateFormattingToolbar(),
      updateTableToolbar: () => chromeRuntime.blockAndTable.updateTableToolbar(),
      inlineFormatToolbar: {
        updateFormattingToolbar: chromeRuntime.toolbars.inlineFormatToolbar.updateFormattingToolbar,
        openLinkPopover: chromeRuntime.toolbars.inlineFormatToolbar.openLinkPopover,
        linkPopoverOpen: chromeRuntime.toolbars.inlineFormatToolbar.linkPopoverOpen,
        cancelLink: chromeRuntime.toolbars.inlineFormatToolbar.cancelLink
      }
    },
    zoom: {
      zoomEditorBy: (delta) => chromeRuntime.layout.zoomEditorBy(delta),
      resetEditorZoom: () => chromeRuntime.layout.resetEditorZoom()
    },
  },
  interactionIoPort: {
    loadLinkTargets: props.loadLinkTargets,
    loadLinkHeadings: props.loadLinkHeadings,
    openLinkTarget: props.openLinkTarget,
    openExternalUrl,
    createExtractedNote,
    loadEmbeddedNotePreview: embeddedNoteActions.loadEmbeddedNotePreview,
    openEmbeddedNote: async (target: string) => {
      const noteTarget = parseWikilinkTarget(target).notePath.trim()
      if (!noteTarget) return
      await interactionRuntime.openLinkTargetWithAutosave(noteTarget)
    },
    restoreEmbeddedNoteInline: embeddedNoteActions.restoreEmbeddedNoteInline,
    getAssetBrowserItems: () => assetBrowserItems.value,
    importAssetFiles
  }
})

documentRuntime = useEditorDocumentRuntime({
  documentInputPort: {
    path: pathRef,
    openPaths: openPathsRef,
    readNoteSnapshot: props.readNoteSnapshot ?? (async (path: string) => ({
      path,
      content: await props.openFile!(path),
      version: null
    })),
    saveNoteBuffer: props.saveNoteBuffer ?? (async (_path: string, text: string, options) => {
      await props.saveFile!(_path, text, { explicit: options.explicit })
      return {
        ok: true,
        version: options.expectedBaseVersion ?? { mtimeMs: Date.now(), size: text.length }
      } satisfies SaveNoteResult
    }),
    renameFileFromTitle: props.renameFileFromTitle,
    loadPropertyTypeSchema: props.loadPropertyTypeSchema,
    savePropertyTypeSchema: props.savePropertyTypeSchema
  },
  documentOutputPort: {
    emitStatus,
    emitOutline,
    emitProperties,
    emitPathRenamed,
    emitExternalReload
  },
  documentSessionPort: {
    holder,
    activeEditor,
    isEditingTitle: () => chromeRuntime.loading.titleEditorFocused.value,
    createSessionEditor: interactionRuntime.createSessionEditor
  },
  documentUiPort: {
    loading: chromeRuntime.loading.loadUiState,
    largeDocThreshold: chromeRuntime.loading.largeDocThreshold,
    resetTransientUi: chromeRuntime.dialogsAndLifecycle.resetTransientUiState,
    syncLayout: chromeRuntime.layout.updateGutterHitboxStyle,
    hideTableToolbarAnchor: chromeRuntime.blockAndTable.hideTableToolbarAnchor,
    closeCompetingMenus: chromeRuntime.blockAndTable.closeBlockMenu,
    syncAfterSessionChange: chromeRuntime.toolbars.onActiveSessionChanged,
    syncAfterDocumentChange: chromeRuntime.toolbars.onDocumentContentChanged,
    initializeUi: chromeRuntime.dialogsAndLifecycle.onMountInit,
    disposeUi: chromeRuntime.dialogsAndLifecycle.onUnmountCleanup,
    interaction: {
      captureCaret: interactionRuntime.captureCaret,
      clearOutlineTimer: interactionRuntime.clearOutlineTimer,
      emitOutlineSoon: interactionRuntime.emitOutlineSoon,
      closeSlashMenu: interactionRuntime.closeSlashMenu,
      closeAtMenu: interactionRuntime.closeAtMenu,
      closeWikilinkMenu: interactionRuntime.closeWikilinkMenu,
      syncWikilinkUiFromPluginState: interactionRuntime.syncWikilinkUiFromPluginState
    }
  },
  isSourceMode: (path: string) => sourceMode.isSourceMode(path),
  waitForHeavyRenderIdle,
  hasPendingHeavyRender,
  captureHeavyRenderEpoch
})

void EditorMermaidPreviewDialog
void EditorAssetPreviewDialog
void EditorMermaidReplaceDialog
void EditorNoteHistoryDialog

const currentPath = documentRuntime.currentPath
const currentTitle = documentRuntime.currentTitle
const renderPaths = documentRuntime.renderPaths
const renderedEditorsByPath = documentRuntime.renderedEditorsByPath
const activeRichTextEditor = computed(() => renderedEditorsByPath.value[currentPath.value] ?? null)
const isActiveMountedPath = documentRuntime.isActiveMountedPath
const isSourceSurface = computed(() => Boolean(currentPath.value && sourceMode.isSourceMode(currentPath.value)))
const isMarkdownNote = computed(() => Boolean(currentPath.value && isMarkdownPath(currentPath.value)))
const { loading, toolbars, blockAndTable, layout, dialogsAndLifecycle } = chromeRuntime
const getZoom = layout.getZoom
const onTitleInput = documentRuntime.onTitleInput
const onTitleCommit = documentRuntime.onTitleCommit
const {
  propertyEditorMode,
  activeParseErrors,
  activeRawYaml,
  activeSpellcheckLanguage,
  canUseStructuredProperties,
  structuredPropertyFields,
  structuredPropertyKeys,
  propertyKeySuggestions,
  propertySuggestionsForField,
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
  isLoadingLargeDocument,
  loadStageLabel,
  loadProgressPercent,
  loadProgressIndeterminate,
  loadDocumentStats
} = documentRuntime
const {
  open: spellcheckOpen,
  floatingEl: spellcheckFloatingEl,
  left: spellcheckLeft,
  top: spellcheckTop,
  mode: spellcheckMode,
  word: spellcheckWord,
  primarySuggestion: spellcheckPrimarySuggestion,
  suggestions: spellcheckSuggestions,
  loading: spellcheckLoading,
  close: closeSpellcheckMenu,
  selectSuggestion: selectSpellcheckSuggestion,
  ignoreWord: ignoreSpellcheckWord,
  addToWorkspaceDictionary: addSpellcheckWordToWorkspaceDictionary
} = chromeRuntime.spellcheck
watch(
  () => props.spellcheckEnabled,
  () => {
    const path = currentPathSource.value
    if (!path) return
    interactionRuntime?.refreshSpellcheckForPath(path)
  }
)

watch(
  () => workspaceSpellcheck.revision.value,
  () => {
    const path = currentPathSource.value
    if (!path) return
    interactionRuntime?.refreshSpellcheckForPath(path)
  }
)

watch([currentPath, isSourceSurface], async ([path, next]) => {
  if (!path) return
  const requestId = next ? sourceRuntime.nextRequestId() : documentRuntime.nextRequestId()
  await loadVisibleDocument(path, requestId)
}, { immediate: true })

watch([currentPath, isSourceSurface], ([path, sourceSurface]) => {
  if (!sourceSurface) return
  emitSignalSummary({ ...EMPTY_EDITOR_SIGNAL_SUMMARY, path })
})

function onSpellcheckMenuEl(element: HTMLDivElement | null) {
  spellcheckFloatingEl.value = element
}

const TABLE_MARKDOWN_MODE = chromeRuntime.TABLE_MARKDOWN_MODE
const { titleEditorFocused } = loading
const {
  inlineFormatToolbar,
  findToolbar,
  onInlineToolbarCopyAs
} = toolbars
const {
  blockMenuFloatingEl,
  tableToolbarFloatingEl,
  blockMenuPos,
  tableMenuBtnLeft,
  tableMenuBtnTop,
  tableBoxLeft,
  tableBoxTop,
  tableBoxWidth,
  tableBoxHeight,
  tableToolbarViewportLeft,
  tableToolbarViewportTop,
  tableToolbarViewportMaxHeight,
  blockGutterActiveTarget,
  blockGutterVisible,
  blockGutterMenuOpen,
  blockMenuOpen,
  blockMenuIndex,
  blockMenuActions,
  blockMenuConvertActions,
  closeBlockMenu,
  toggleBlockMenu,
  onBlockMenuPlus,
  onBlockMenuSelect,
  syncBlockGutterAnchor,
  tableToolbarTriggerVisible,
  tableAddTopVisible,
  tableAddBottomVisible,
  tableAddLeftVisible,
  tableAddRightVisible,
  tableToolbarOpen,
  tableToolbarActions,
  hideTableToolbar,
  onTableToolbarSelect,
  toggleTableToolbar,
  addRowAfterFromTrigger,
  addRowBeforeFromTrigger,
  addColumnBeforeFromTrigger,
  addColumnAfterFromTrigger,
  onEditorMouseMove,
  onEditorMouseLeave
} = blockAndTable
const activeBlockStructureLabel = computed(() => getBlockStructureLabel(blockGutterActiveTarget.value))
const blockGutterToolbarStyle = computed(() => {
  const placement = chromeRuntime.blockAndTable.resolveBlockGutterToolbarPlacement(blockGutterWidth.value)
  if (!placement) return {}
  return {
    left: `${placement.left}px`,
    top: `${placement.top}px`,
    transform: 'translateY(-50%)'
  }
})

const {
  renderedEditor,
  editorZoomStyle,
  zoomEditorBy,
  resetEditorZoom,
  gutterHitboxStyle
} = layout
const availableGutterWidth = computed(() => Number.parseFloat(gutterHitboxStyle.value.width || '0') || 0)
const showBlockStructureLabel = computed(() => chromeRuntime.blockAndTable.shouldShowBlockGutterLabel(availableGutterWidth.value))
watch(
  [renderedEditor, blockGutterActiveTarget],
  () => {
    syncBlockGutterAnchor()
  },
  { immediate: true, flush: 'post' }
)
watch(
  renderedEditor,
  () => {
    syncBlockGutterAnchor()
  },
  { immediate: true, flush: 'post' }
)
watch(
  [currentPath, activeSpellcheckLanguage, workspacePathRef],
  ([path]) => {
    if (!path) return
    interactionRuntime?.refreshSpellcheckForPath(path)
  },
  { immediate: true, flush: 'post' }
)
const {
  mermaidReplaceDialog,
  resolveMermaidReplaceDialog,
  mermaidPreviewDialog,
  closeMermaidPreview,
  exportMermaidSvg
} = dialogsAndLifecycle
void mermaidReplaceDialog
void resolveMermaidReplaceDialog
void mermaidPreviewDialog
void closeMermaidPreview
void exportMermaidSvg
const {
  assetPreviewDialog,
  closeAssetPreview
} = dialogsAndLifecycle
void assetPreviewDialog
void closeAssetPreview
const {
  slashOpen,
  slashIndex,
  slashLeft,
  slashTop,
  slashQuery,
  visibleSlashCommands,
  closeWikilinkMenu,
  dismissSlashMenu,
  setSlashQuery,
  atOpen,
  atIndex,
  atLeft,
  atTop,
  atQuery,
  emojiPickerOpen,
  visibleAtMacros,
  dismissAtMenu,
  setAtQuery,
  insertBlockFromDescriptor,
  insertEmoji,
  wikilinkOpen,
  wikilinkIndex,
  wikilinkLeft,
  wikilinkTop,
  wikilinkResults,
  onWikilinkMenuSelect,
  onWikilinkMenuIndexUpdate,
  revealSnippet,
  revealOutlineHeading,
  revealAnchor
} = interactionRuntime

type InlineCompletionKind = 'slash' | 'at' | 'wikilink'
type InlineCompletion = { kind: InlineCompletionKind; input: InlineTextCommandInput; start: number; end: number }
const inlineCompletion = ref<InlineCompletion | null>(null)
const inlineWikilinkRequest = ref(0)

function placeInlineMenu(input: InlineTextCommandInput, left: Ref<number>, top: Ref<number>) {
  const rect = input.element.getBoundingClientRect()
  left.value = Math.max(12, Math.min(rect.left, window.innerWidth - 332))
  top.value = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 292))
}

function closeInlineCompletion() {
  inlineCompletion.value = null
}

function replaceInlineCompletion(replacement: string, selectionOffset = replacement.length) {
  const completion = inlineCompletion.value
  if (!completion) return false
  const { input, start, end } = completion
  const next = `${input.value.slice(0, start)}${replacement}${input.value.slice(end)}`
  input.element.value = next
  input.setValue(next)
  const caret = start + selectionOffset
  void nextTick().then(() => {
    input.element.focus()
    input.element.setSelectionRange(caret, caret)
  })
  closeInlineCompletion()
  dismissSlashMenu()
  dismissAtMenu()
  closeWikilinkMenu()
  return true
}

function syncInlineTextCommands(input: InlineTextCommandInput) {
  const before = input.value.slice(0, input.selectionStart)
  const wikiStart = before.lastIndexOf('[[')
  if (wikiStart >= 0 && !before.slice(wikiStart + 2).includes(']]')) {
    const query = before.slice(wikiStart + 2)
    inlineCompletion.value = { kind: 'wikilink', input, start: wikiStart, end: input.selectionStart }
    placeInlineMenu(input, wikilinkLeft, wikilinkTop)
    wikilinkOpen.value = true
    const request = ++inlineWikilinkRequest.value
    void props.loadLinkTargets().then((targets) => {
      if (request !== inlineWikilinkRequest.value || inlineCompletion.value?.kind !== 'wikilink') return
      const normalized = query.trim().toLowerCase()
      const matches = targets.filter((target) => !normalized || target.toLowerCase().includes(normalized)).slice(0, 12)
      wikilinkResults.value = matches.map((target) => ({ id: `existing:${target}`, label: target, target, isCreate: false }))
      if (normalized && !matches.some((target) => target.toLowerCase() === normalized)) {
        wikilinkResults.value.unshift({ id: `create:${query.trim()}`, label: `Create "${query.trim()}"`, target: query.trim(), isCreate: true })
      }
    }).catch(() => { wikilinkResults.value = [] })
    return
  }
  const atMatch = before.match(/(?:^|[\s([\{\n])@([a-zA-Z0-9_.+\- ]*)$/)
  if (atMatch) {
    const query = atMatch[1] ?? ''
    inlineCompletion.value = { kind: 'at', input, start: input.selectionStart - query.length - 1, end: input.selectionStart }
    placeInlineMenu(input, atLeft, atTop)
    atQuery.value = query
    atIndex.value = 0
    atOpen.value = true
    return
  }
  const slashMatch = before.match(/(?:^|\n)\/([a-zA-Z0-9_-]*)$/)
  if (slashMatch) {
    const query = slashMatch[1] ?? ''
    inlineCompletion.value = { kind: 'slash', input, start: input.selectionStart - query.length - 1, end: input.selectionStart }
    placeInlineMenu(input, slashLeft, slashTop)
    slashQuery.value = query
    slashIndex.value = 0
    slashOpen.value = visibleSlashCommands.value.length > 0
    return
  }
  closeInlineCompletion()
}

function handleInlineTextKeydown(event: KeyboardEvent, input: InlineTextCommandInput) {
  const completion = inlineCompletion.value
  if (!completion || completion.input.element !== input.element) return
  const items = completion.kind === 'slash' ? visibleSlashCommands.value : completion.kind === 'at' ? visibleAtMacros.value : wikilinkResults.value
  const index = completion.kind === 'slash' ? slashIndex : completion.kind === 'at' ? atIndex : wikilinkIndex
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (items.length) index.value = (index.value + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeInlineCompletion()
    dismissSlashMenu(); dismissAtMenu(); closeWikilinkMenu()
  } else if (event.key === 'Enter' && items.length) {
    event.preventDefault()
    if (completion.kind === 'at') replaceInlineCompletion(visibleAtMacros.value[atIndex.value]?.replacement ?? '')
    if (completion.kind === 'wikilink') replaceInlineCompletion(`[[${wikilinkResults.value[wikilinkIndex.value]?.target ?? ''}]]`)
    if (completion.kind === 'slash') selectInlineSlashCommand(visibleSlashCommands.value[slashIndex.value])
  }
}

function selectInlineAtMacro(item: typeof visibleAtMacros.value[number]) {
  if (inlineCompletion.value?.kind === 'at') {
    replaceInlineCompletion(item.replacement)
    return
  }
  void interactionRuntime.insertAtMacro(item)
}

function selectInlineWikilink(target: string) {
  if (inlineCompletion.value?.kind === 'wikilink') {
    replaceInlineCompletion(`[[${target}]]`)
    return
  }
  onWikilinkMenuSelect(target)
}

function selectInlineSlashCommand(command: typeof visibleSlashCommands.value[number] | undefined) {
  const completion = inlineCompletion.value
  if (!command || completion?.kind !== 'slash') {
    if (command) insertBlockFromDescriptor(command.type, command.data)
    return
  }
  const editor = activeEditor.value
  const node = editor?.state.doc.nodeAt(completion.input.getPos())
  if (!editor || !node) return
  replaceInlineCompletion('')
  const content = (() => {
    switch (command.type) {
      case 'header': return { type: 'heading', attrs: { level: Number(command.data.level ?? 2) } }
      case 'list': return { type: command.data.style === 'checklist' ? 'taskList' : command.data.style === 'ordered' ? 'orderedList' : 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }
      case 'callout': return { type: 'calloutBlock', attrs: { kind: String(command.data.kind ?? 'NOTE'), message: '' } }
      case 'quote': return { type: 'quoteBlock', attrs: { text: '' } }
      case 'code': return { type: 'codeBlock', attrs: { language: '' } }
      case 'delimiter': return { type: 'horizontalRule' }
      case 'table': return { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph' }] }, { type: 'tableHeader', content: [{ type: 'paragraph' }] }] }] }
      default: return { type: 'paragraph' }
    }
  })()
  editor.chain().insertContentAt(completion.input.getPos() + node.nodeSize, content).run()
}

provide(INLINE_TEXT_COMMAND_HANDLER, {
  onInput: syncInlineTextCommands,
  onKeydown: handleInlineTextKeydown,
  onBlur: () => { window.setTimeout(closeInlineCompletion, 120) }
})

function getSession(path: string) {
  if (sourceMode.isSourceMode(path)) {
    return sourceRuntime?.getSession(path) ?? null
  }
  return documentRuntime?.getSession(path) ?? null
}

function getDocumentSession(path: string) {
  return documentRuntime?.getSession(path) ?? null
}

function focusEditor() {
  if (isSourceSurface.value) {
    const sourceEditor = holder.value?.querySelector('.editor-session-pane[data-active="true"] .tomosona-source-editor .cm-content') as HTMLElement | null
    sourceEditor?.focus()
    return
  }
  layout.focusEditor()
}

function onSourceEditorViewState(path: string, state: { scrollTop?: number; scrollLeft?: number; wordWrap?: boolean }) {
  sourceRuntime.setViewState(path, state)
}

async function loadVisibleDocument(path: string, requestId: number) {
  if (sourceMode.isSourceMode(path)) {
    sourceRuntime.ensureSession(path)
    sourceRuntime.setActiveSession(path)
    await sourceRuntime.loadCurrentFile(path, { forceReload: true, requestId })
    return
  }

  documentRuntime.ensureSession(path)
  documentRuntime.setActiveSession(path)
  await documentRuntime.loadCurrentFile(path, { forceReload: true, requestId })
}

const activeSession = computed(() => currentPath.value ? getSession(currentPath.value) : null)
const activeConflict = computed(() => activeSession.value?.conflict ?? null)
const noteHistoryRestoreDisabledReason = computed(() =>
  activeSession.value?.dirty ? 'Save or discard current edits before restoring a snapshot.' : ''
)

const noteHistoryOpen = ref(false)
const noteHistoryLoading = ref(false)
const noteHistorySnapshotLoading = ref(false)
const noteHistoryRestorePending = ref(false)
const noteHistoryError = ref('')
const noteHistoryCurrentUnavailableMessage = ref('')
const noteHistoryEntries = ref<NoteHistoryEntry[]>([])
const noteHistorySelectedSnapshotId = ref('')
const noteHistoryCurrentContent = ref('')
const noteHistorySnapshotContent = ref('')
let noteHistoryRequestToken = 0

function resetNoteHistoryState() {
  noteHistoryLoading.value = false
  noteHistorySnapshotLoading.value = false
  noteHistoryRestorePending.value = false
  noteHistoryError.value = ''
  noteHistoryCurrentUnavailableMessage.value = ''
  noteHistoryEntries.value = []
  noteHistorySelectedSnapshotId.value = ''
  noteHistoryCurrentContent.value = ''
  noteHistorySnapshotContent.value = ''
}

function beginNoteHistoryRequest(): number {
  noteHistoryRequestToken += 1
  return noteHistoryRequestToken
}

function isCurrentNoteHistoryRequest(token: number): boolean {
  return token === noteHistoryRequestToken
}

async function loadNoteHistoryCurrentContent(path: string, requestToken: number): Promise<void> {
  if (!isCurrentNoteHistoryRequest(requestToken)) return
  noteHistoryCurrentUnavailableMessage.value = ''
  if (props.readNoteSnapshot) {
    try {
      const snapshot = await props.readNoteSnapshot(path)
      if (!isCurrentNoteHistoryRequest(requestToken)) return
      noteHistoryCurrentContent.value = snapshot.content
      return
    } catch {
      if (!isCurrentNoteHistoryRequest(requestToken)) return
      noteHistoryCurrentUnavailableMessage.value = 'Current disk content is unavailable.'
      noteHistoryCurrentContent.value = ''
      return
    }
  }

  if (props.openFile) {
    try {
      if (!isCurrentNoteHistoryRequest(requestToken)) return
      noteHistoryCurrentContent.value = await props.openFile(path)
      return
    } catch {
      if (!isCurrentNoteHistoryRequest(requestToken)) return
      noteHistoryCurrentUnavailableMessage.value = 'Current disk content is unavailable.'
      noteHistoryCurrentContent.value = ''
      return
    }
  }

  if (!isCurrentNoteHistoryRequest(requestToken)) return
  noteHistoryCurrentUnavailableMessage.value = 'Current disk content is unavailable.'
  noteHistoryCurrentContent.value = ''
}

async function loadNoteHistorySnapshot(path: string, snapshotId: string, requestToken: number): Promise<void> {
  if (!isCurrentNoteHistoryRequest(requestToken)) return
  noteHistorySnapshotLoading.value = true
  noteHistorySnapshotContent.value = ''
  try {
    const snapshot = await readNoteHistorySnapshot(path, snapshotId)
    if (!isCurrentNoteHistoryRequest(requestToken)) return
    noteHistorySnapshotContent.value = snapshot.content
  } catch (error) {
    if (!isCurrentNoteHistoryRequest(requestToken)) return
    noteHistoryError.value = error instanceof Error ? error.message : 'Could not load the selected snapshot.'
    noteHistorySnapshotContent.value = ''
  } finally {
    if (!isCurrentNoteHistoryRequest(requestToken)) return
    noteHistorySnapshotLoading.value = false
  }
}

async function openNoteHistory() {
  const path = currentPath.value
  if (!path || isSourceSurface.value) return

  const requestToken = beginNoteHistoryRequest()
  resetNoteHistoryState()
  noteHistoryOpen.value = true
  noteHistoryLoading.value = true
  noteHistoryError.value = ''

  try {
    const [entries] = await Promise.all([
      listNoteHistory(path),
      loadNoteHistoryCurrentContent(path, requestToken)
    ])
    if (!isCurrentNoteHistoryRequest(requestToken)) return
    noteHistoryEntries.value = entries
    const selected = entries[0]?.snapshotId ?? ''
    noteHistorySelectedSnapshotId.value = selected
    if (selected) {
      await loadNoteHistorySnapshot(path, selected, requestToken)
    }
  } catch (error) {
    if (!isCurrentNoteHistoryRequest(requestToken)) return
    noteHistoryError.value = error instanceof Error ? error.message : 'Could not load note history.'
  } finally {
    if (!isCurrentNoteHistoryRequest(requestToken)) return
    noteHistoryLoading.value = false
  }
}

async function selectNoteHistorySnapshot(snapshotId: string) {
  const path = currentPath.value
  if (!path) return
  const requestToken = noteHistoryRequestToken
  noteHistorySelectedSnapshotId.value = snapshotId
  noteHistoryError.value = ''
  await loadNoteHistorySnapshot(path, snapshotId, requestToken)
}

async function restoreSelectedNoteHistorySnapshot() {
  const path = currentPath.value
  const snapshotId = noteHistorySelectedSnapshotId.value
  if (!path || !snapshotId || noteHistoryRestoreDisabledReason.value) return

  noteHistoryRestorePending.value = true
  noteHistoryError.value = ''
  try {
    const result = await restoreNoteHistorySnapshot(path, snapshotId)
    if (!result.ok) {
      noteHistoryError.value = result.reason === 'NOT_FOUND'
        ? 'The selected snapshot is no longer available.'
        : 'The note could not be restored.'
      return
    }

    beginNoteHistoryRequest()
    noteHistoryOpen.value = false
    resetNoteHistoryState()
    await onLoadDiskVersion()
  } catch (error) {
    noteHistoryError.value = error instanceof Error ? error.message : 'The note could not be restored.'
  } finally {
    noteHistoryRestorePending.value = false
  }
}

void noteHistoryOpen
void selectNoteHistorySnapshot
void restoreSelectedNoteHistorySnapshot

function closeNoteHistory() {
  beginNoteHistoryRequest()
  noteHistoryOpen.value = false
  resetNoteHistoryState()
}

watch(currentPath, () => {
  closeNoteHistory()
})

async function onLoadDiskVersion() {
  if (!currentPath.value) return
  const requestId = isSourceSurface.value ? sourceRuntime.nextRequestId() : documentRuntime.nextRequestId()
  await loadVisibleDocument(currentPath.value, requestId)
}

async function onOverwriteWithMyVersion() {
  if (isSourceSurface.value) {
    await sourceRuntime.saveCurrentFile(true, { force: true })
    return
  }
  await documentRuntime.saveCurrentFile(true, { force: true })
}

function applySourceModePathMoves(changes: WorkspaceFsChange[]) {
  for (const change of changes) {
    if (change.kind !== 'renamed') continue
    const from = change.old_path?.trim() ?? ''
    const to = change.new_path?.trim() ?? ''
    if (!from || !to) continue
    sourceMode.movePath(from, to)
  }
}

async function setMarkdownSourceSurfaceEnabled(enabled: boolean) {
  const path = currentPath.value
  if (!path || !isMarkdownNote.value || enabled === isSourceSurface.value) return

  if (isSourceSurface.value) {
    await sourceRuntime.saveCurrentFile(true)
  } else {
    await documentRuntime.saveCurrentFile(true)
  }

  sourceMode.setMarkdownSourceMode(currentPath.value || path, enabled)
}

function navigateSignal(kind: EditorSignalKind, direction: EditorSignalDirection) {
  rulerRef.value?.navigateSignal(kind, direction)
}

defineExpose({
  saveNow: async () => {
    if (isSourceSurface.value) {
      await sourceRuntime.saveCurrentFile(true)
      return
    }
    await documentRuntime.saveCurrentFile(true)
  },
  reloadCurrent: async () => {
    if (!currentPath.value) return
    const requestId = isSourceSurface.value ? sourceRuntime.nextRequestId() : documentRuntime.nextRequestId()
    await loadVisibleDocument(currentPath.value, requestId)
  },
  applyWorkspaceFsChanges: async (changes: WorkspaceFsChange[]) => {
    applySourceModePathMoves(changes)
    await Promise.all([
      documentRuntime.applyWorkspaceFsChanges(changes),
      sourceRuntime.applyWorkspaceFsChanges(changes)
    ])
  },
  focusEditor,
  openNoteHistory: () => openNoteHistory(),
  revealSnippet,
  revealOutlineHeading,
  revealAnchor,
  navigateSignal,
  zoomIn: () => zoomEditorBy(0.1),
  zoomOut: () => zoomEditorBy(-0.1),
  resetZoom: () => resetEditorZoom(),
  getZoom,
  setMarkdownSourceSurfaceEnabled,
  isSourceSurface: () => isSourceSurface.value
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div
      v-if="!path"
      class="editor-empty-state flex min-h-0 flex-1 items-center justify-center px-8 py-6 text-sm"
    >
      Open a file to start editing
    </div>

    <div v-else class="editor-shell flex min-h-0 flex-1 flex-col overflow-hidden border-x">
      <div
        v-if="activeConflict"
        class="border-b border-[var(--border-strong)] bg-[var(--surface-muted)] px-4 py-2 text-sm"
      >
        <div class="flex flex-wrap items-center gap-3">
          <span>
            {{ activeConflict.kind === 'deleted' ? 'This file was deleted on disk.' : 'A newer disk version was detected.' }}
          </span>
          <button
            v-if="activeConflict.kind === 'modified'"
            type="button"
            class="rounded border px-2 py-1"
            @click="onLoadDiskVersion"
          >
            Load disk version
          </button>
          <button
            type="button"
            class="rounded border px-2 py-1"
            @click="onOverwriteWithMyVersion"
          >
            {{ activeConflict.kind === 'deleted' ? 'Recreate file' : 'Overwrite with my version' }}
          </button>
        </div>
      </div>
      <div
        class="relative min-h-0 flex-1 overflow-hidden"
        :data-menu-open="blockGutterMenuOpen ? 'true' : 'false'"
      >
        <div
          class="editor-gutter-hitbox"
          :style="gutterHitboxStyle"
        />
        <div
        ref="holder"
        class="editor-holder relative h-full min-h-0 overflow-y-auto px-8 py-6"
        :class="{ 'editor-holder--source': isSourceSurface }"
        :style="editorZoomStyle"
        @mousemove="onEditorMouseMove"
        @mouseleave="onEditorMouseLeave"
        @click="dismissSlashMenu(); dismissAtMenu(); closeWikilinkMenu(); closeBlockMenu()"
      >
          <div ref="contentShell" class="editor-content-shell">
            <div class="editor-header-shell">
              <template v-if="!isSourceSurface">
                <EditorTitleField
                  :key="currentPath"
                  :model-value="currentTitle"
                  :saving="Boolean(currentPath && getSession(currentPath)?.saving)"
                  @update:model-value="onTitleInput"
                  @commit="onTitleCommit"
                  @focus="titleEditorFocused = true"
                  @blur="titleEditorFocused = false"
                  @focus-body-request="void layout.focusFirstEditableBlock()"
                />
                <EditorPropertiesPanel
                  :expanded="propertiesExpanded(path)"
                  :has-properties="structuredPropertyKeys.length > 0 || activeParseErrors.length > 0"
                  :mode="propertyEditorMode"
                  :can-use-structured-properties="canUseStructuredProperties"
                  :structured-property-fields="structuredPropertyFields"
                  :structured-property-keys="structuredPropertyKeys"
                  :active-raw-yaml="activeRawYaml"
                  :active-parse-errors="activeParseErrors"
                  :core-property-options="CORE_PROPERTY_OPTIONS"
                  :property-key-suggestions="propertyKeySuggestions"
                  :property-suggestions-for-field="propertySuggestionsForField"
                  :effective-type-for-field="effectiveTypeForField"
                  :is-property-type-locked="isPropertyTypeLocked"
                  @toggle-visibility="togglePropertiesVisibility"
                  @set-mode="propertyEditorMode = $event"
                  @property-key-input="void onPropertyKeyInput($event.index, $event.value)"
                  @property-type-change="void onPropertyTypeChange($event.index, $event.value)"
                  @property-value-input="onPropertyValueInput($event.index, $event.value)"
                  @property-checkbox-input="onPropertyCheckboxInput($event.index, $event.checked)"
                  @property-tokens-change="onPropertyTokensChange($event.index, $event.tokens)"
                  @remove-property="removePropertyField($event)"
                  @add-property="addPropertyField($event)"
                  @raw-yaml-input="onRawYamlInput($event)"
                />
              </template>
            </div>
            <div
              v-for="sessionPath in renderPaths"
              :key="`editor-pane:${sessionPath}`"
              class="editor-session-pane"
              :data-session-path="sessionPath"
              :data-active="isActiveMountedPath(sessionPath) ? 'true' : 'false'"
              :aria-hidden="isActiveMountedPath(sessionPath) ? undefined : 'true'"
              :tabindex="isActiveMountedPath(sessionPath) ? undefined : -1"
              :inert="isActiveMountedPath(sessionPath) ? undefined : true"
              v-show="isActiveMountedPath(sessionPath)"
            >
              <template v-if="isSourceSurface">
                <SourceEditorPane
                  v-if="sourceRuntime.getSession(sessionPath)"
                  :key="`source-editor-content:${sessionPath}`"
                  :model-value="sourceRuntime.getSession(sessionPath)?.text ?? ''"
                  :language-label="sourceEditorLanguageLabelForPath(sessionPath)"
                  :word-wrap="sourceRuntime.getSession(sessionPath)?.wordWrap"
                  :scroll-top="sourceRuntime.getSession(sessionPath)?.scrollTop"
                  :scroll-left="sourceRuntime.getSession(sessionPath)?.scrollLeft"
                  @update:model-value="sourceRuntime.setText(sessionPath, $event)"
                  @scroll="onSourceEditorViewState(sessionPath, { scrollTop: $event.top, scrollLeft: $event.left })"
                  @toggle-word-wrap="onSourceEditorViewState(sessionPath, { wordWrap: !(sourceRuntime.getSession(sessionPath)?.wordWrap ?? true) })"
                />
              </template>
              <template v-else>
                <EditorContent
                  v-if="renderedEditorsByPath[sessionPath]"
                  :key="`editor-content:${sessionPath}`"
                  :editor="renderedEditorsByPath[sessionPath]!"
                />
              </template>
            </div>
          </div>
          <div v-if="!isSourceSurface" class="editor-rich-chrome">
          <div
          v-if="blockGutterVisible"
          ref="blockGutterEl"
          class="tomosona-block-gutter"
          :data-menu-open="blockGutterMenuOpen ? 'true' : 'false'"
          :style="blockGutterToolbarStyle"
          >
            <div class="tomosona-block-controls">
              <span
                v-if="showBlockStructureLabel && activeBlockStructureLabel"
                class="tomosona-block-structure-label"
                :title="blockGutterActiveTarget?.nodeType ?? ''"
                aria-hidden="true"
              >
                {{ activeBlockStructureLabel }}
              </span>
              <button
                type="button"
                class="tomosona-block-control-btn"
                aria-label="Insert below"
                @mousedown.prevent.stop
                @click.stop.prevent="onBlockMenuPlus"
              >
                +
              </button>
              <button
                type="button"
                class="tomosona-block-control-btn"
                aria-label="Open block menu"
                title="Open block menu"
                @mousedown.prevent.stop
                @click.stop.prevent="toggleBlockMenu"
              >
                <Bars3Icon class="tomosona-block-menu-icon" aria-hidden="true" />
              </button>
            </div>
          </div>

          <EditorInlineFormatToolbar
            :open="inlineFormatToolbar.formatToolbarOpen.value"
            :left="inlineFormatToolbar.formatToolbarLeft.value"
            :top="inlineFormatToolbar.formatToolbarTop.value"
            :active-marks="{
              bold: inlineFormatToolbar.isMarkActive('bold'),
              italic: inlineFormatToolbar.isMarkActive('italic'),
              strike: inlineFormatToolbar.isMarkActive('strike'),
              underline: inlineFormatToolbar.isMarkActive('underline'),
              code: inlineFormatToolbar.isMarkActive('code'),
              link: inlineFormatToolbar.isMarkActive('link')
            }"
            :block-menu-actions="blockAndTable.blockMenuActions.value"
            :block-menu-convert-actions="blockAndTable.blockMenuConvertActions.value"
            :link-popover-open="inlineFormatToolbar.linkPopoverOpen.value"
            :link-value="inlineFormatToolbar.linkValue.value"
            :link-error="inlineFormatToolbar.linkError.value"
            @toggle-mark="inlineFormatToolbar.toggleMark"
            @unai="inlineFormatToolbar.unaiSelection"
            @open-link="inlineFormatToolbar.openLinkPopover"
            @wrap-wikilink="inlineFormatToolbar.wrapSelectionWithWikilink"
            @extract-note="void interactionRuntime.extractSelectionToEmbeddedNote()"
            @select-block-action="onBlockMenuSelect($event)"
            @copy-as="void onInlineToolbarCopyAs($event)"
            @measure="inlineFormatToolbar.setToolbarSize($event)"
            @apply-link="inlineFormatToolbar.applyLink"
            @unlink="inlineFormatToolbar.unlinkLink"
            @cancel-link="inlineFormatToolbar.cancelLink"
            @update:linkValue="(value) => { inlineFormatToolbar.linkValue.value = value }"
          />

          <EditorTableEdgeControls
            :trigger-visible="tableToolbarTriggerVisible"
            :trigger-left="tableMenuBtnLeft"
            :trigger-top="tableMenuBtnTop"
            :add-top-visible="tableAddTopVisible"
            :add-bottom-visible="tableAddBottomVisible"
            :add-left-visible="tableAddLeftVisible"
            :add-right-visible="tableAddRightVisible"
            :table-box-left="tableBoxLeft"
            :table-box-top="tableBoxTop"
            :table-box-width="tableBoxWidth"
            :table-box-height="tableBoxHeight"
            @toggle="toggleTableToolbar"
            @add-row-before="addRowBeforeFromTrigger"
            @add-row-after="addRowAfterFromTrigger"
            @add-column-before="addColumnBeforeFromTrigger"
            @add-column-after="addColumnAfterFromTrigger"
          />

          <EditorSlashOverlay
            :open="slashOpen"
            :index="slashIndex"
            :left="slashLeft"
            :top="slashTop"
            :query="slashQuery"
            :commands="visibleSlashCommands"
            @update:index="slashIndex = $event"
            @update:query="setSlashQuery($event)"
            @select="dismissSlashMenu(); selectInlineSlashCommand($event)"
            @close="dismissSlashMenu(); focusEditor()"
          />

          <EditorAtOverlay
            :open="atOpen"
            :index="atIndex"
            :left="atLeft"
            :top="atTop"
            :query="atQuery"
            :items="visibleAtMacros"
            @update:index="atIndex = $event"
            @update:query="setAtQuery($event)"
            @select="selectInlineAtMacro($event)"
            @close="dismissAtMenu(); focusEditor()"
          />

          <EditorEmojiPicker
            :open="emojiPickerOpen"
            :left="atLeft"
            :top="atTop"
            @select="insertEmoji($event)"
            @close="dismissAtMenu(); focusEditor()"
          />

          <EditorWikilinkOverlay
            :open="wikilinkOpen"
            :index="wikilinkIndex"
            :left="wikilinkLeft"
            :top="wikilinkTop"
            :results="wikilinkResults"
            @update:index="onWikilinkMenuIndexUpdate($event)"
            @select="selectInlineWikilink($event)"
          />

          <EditorContextOverlays
            :block-menu-open="blockMenuOpen"
            :block-menu-index="blockMenuIndex"
            :block-menu-x="blockMenuPos.x"
            :block-menu-y="blockMenuPos.y"
            :block-menu-actions="blockMenuActions"
            :block-menu-convert-actions="blockMenuConvertActions"
            :table-toolbar-open="tableToolbarOpen"
            :table-toolbar-viewport-left="tableToolbarViewportLeft"
            :table-toolbar-viewport-top="tableToolbarViewportTop"
            :table-toolbar-actions="tableToolbarActions"
            :table-markdown-mode="TABLE_MARKDOWN_MODE"
            :table-toolbar-viewport-max-height="tableToolbarViewportMaxHeight"
            @block:menu-el="blockMenuFloatingEl = $event"
            @block:update-index="blockMenuIndex = $event"
            @block:select="onBlockMenuSelect($event)"
            @block:close="closeBlockMenu()"
            @table:menu-el="tableToolbarFloatingEl = $event"
            @table:select="onTableToolbarSelect($event)"
            @table:close="hideTableToolbar()"
          />

          <EditorSpellcheckMenu
            :open="spellcheckOpen"
            :left="spellcheckLeft"
            :top="spellcheckTop"
            :mode="spellcheckMode"
            :word="spellcheckWord"
            :primary-suggestion="spellcheckPrimarySuggestion"
            :suggestions="spellcheckSuggestions"
            :loading="spellcheckLoading"
            @menu-el="onSpellcheckMenuEl"
            @select="selectSpellcheckSuggestion($event)"
            @ignore="ignoreSpellcheckWord()"
            @add-to-dictionary="addSpellcheckWordToWorkspaceDictionary()"
            @close="closeSpellcheckMenu()"
          />

        </div>

        <EditorLargeDocOverlay
          :visible="isLoadingLargeDocument"
          :stage-label="loadStageLabel"
          :progress-percent="loadProgressPercent"
          :progress-indeterminate="loadProgressIndeterminate"
          :stats="loadDocumentStats"
        />

        <EditorFindToolbar
          :open="findToolbar.open.value"
          :query="findToolbar.query.value"
          :case-sensitive="findToolbar.caseSensitive.value"
          :whole-word="findToolbar.wholeWord.value"
          :active-match="findToolbar.activeMatch.value"
          :match-count="findToolbar.matchCount.value"
          @input-ready="findToolbar.inputEl.value = $event"
          @update:query="findToolbar.onQueryInput($event)"
          @toggle-case-sensitive="findToolbar.onCaseSensitiveToggle()"
          @toggle-whole-word="findToolbar.onWholeWordToggle()"
          @prev="findToolbar.prevMatch()"
          @next="findToolbar.nextMatch()"
          @close="findToolbar.closeToolbar({ focusEditor: true })"
        />
          </div>
        <EditorRuler
          v-if="!isSourceSurface"
          ref="rulerRef"
          :key="`editor-ruler:${currentPath}`"
          :editor="activeRichTextEditor"
          :path="currentPath"
          :scroll-element="holder"
          :visible="rulerVisible !== false"
          :spellcheck-enabled="Boolean(spellcheckEnabled)"
          @signal-summary="emitSignalSummary($event)"
        />
      </div>
    </div>

    <EditorNoteHistoryDialog
      :open="noteHistoryOpen"
      :path-label="currentPath"
      :loading="noteHistoryLoading"
      :error="noteHistoryError"
      :entries="noteHistoryEntries"
      :selected-snapshot-id="noteHistorySelectedSnapshotId"
      :current-content="noteHistoryCurrentContent"
      :snapshot-content="noteHistorySnapshotContent"
      :current-unavailable-message="noteHistoryCurrentUnavailableMessage"
      :snapshot-loading="noteHistorySnapshotLoading"
      :restore-pending="noteHistoryRestorePending"
      :restore-disabled-reason="noteHistoryRestoreDisabledReason"
      :current-is-dirty="Boolean(activeSession?.dirty)"
      @close="closeNoteHistory()"
      @select-snapshot="void selectNoteHistorySnapshot($event)"
      @restore-selected="void restoreSelectedNoteHistorySnapshot()"
    />

    <EditorMermaidReplaceDialog
      :visible="mermaidReplaceDialog.visible"
      :template-label="mermaidReplaceDialog.templateLabel"
      @cancel="resolveMermaidReplaceDialog(false)"
      @confirm="resolveMermaidReplaceDialog(true)"
    />
    <EditorMermaidPreviewDialog
      :visible="mermaidPreviewDialog.visible"
      :svg="mermaidPreviewDialog.svg"
      :export-error="mermaidPreviewDialog.exportError"
      @close="closeMermaidPreview()"
      @export-svg="exportMermaidSvg($event)"
    />
    <EditorAssetPreviewDialog
      :visible="assetPreviewDialog.visible"
      :src="assetPreviewDialog.src"
      :alt="assetPreviewDialog.alt"
      :title="assetPreviewDialog.title"
      :preview-src="assetPreviewDialog.previewSrc"
      @close="closeAssetPreview()"
    />
  </div>
</template>

<style scoped>
.editor-empty-state {
  background: var(--app-bg);
  color: var(--text-dim);
}

.editor-shell {
  border-color: var(--border-subtle);
  background: var(--surface-bg);
}

.editor-holder {
  background: var(--surface-bg);
  overscroll-behavior: contain;
}

.editor-holder--source {
  padding: 0 !important;
  overflow: hidden;
}

.editor-holder--source .editor-content-shell {
  max-width: none;
  height: 100%;
  margin: 0;
  padding: 0;
}

.editor-holder--source .editor-session-pane {
  min-height: 100%;
  height: 100%;
}

.editor-holder--source .tomosona-source-editor {
  height: 100%;
}

.editor-header-shell {
  margin: 0;
}

.editor-session-pane {
  min-height: 100%;
}

</style>
