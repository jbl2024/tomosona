<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { DragHandle as DragHandleVue3 } from '@tiptap/extension-drag-handle-vue-3'
import type { Middleware, MiddlewareState } from '@floating-ui/dom'
import {
  sanitizeExternalHref,
  type EditorBlock
} from '../lib/markdownBlocks'
import { EDITOR_SLASH_COMMANDS } from '../lib/editorSlashCommands'
import { openExternalUrl } from '../lib/api'
import EditorPropertiesPanel from './editor/EditorPropertiesPanel.vue'
import EditorSlashOverlay from './editor/EditorSlashOverlay.vue'
import EditorWikilinkOverlay from './editor/EditorWikilinkOverlay.vue'
import EditorContextOverlays from './editor/EditorContextOverlays.vue'
import EditorTableEdgeControls from './editor/EditorTableEdgeControls.vue'
import EditorInlineFormatToolbar from './editor/EditorInlineFormatToolbar.vue'
import EditorLargeDocOverlay from './editor/EditorLargeDocOverlay.vue'
import EditorMermaidReplaceDialog from './editor/EditorMermaidReplaceDialog.vue'
import './editor/EditorViewContent.css'
import { useFrontmatterProperties } from '../composables/useFrontmatterProperties'
import { useEditorZoom } from '../composables/useEditorZoom'
import { useMermaidReplaceDialog } from '../composables/useMermaidReplaceDialog'
import { useInlineFormatToolbar } from '../composables/useInlineFormatToolbar'
import { useEditorInputHandlers } from '../composables/useEditorInputHandlers'
import { useEditorSessionLifecycle } from '../composables/useEditorSessionLifecycle'
import { useBlockMenuControls } from '../composables/useBlockMenuControls'
import { useTableToolbarControls } from '../composables/useTableToolbarControls'
import { useEditorFileLifecycle } from '../composables/useEditorFileLifecycle'
import { useEditorTableGeometry } from '../composables/useEditorTableGeometry'
import { useEditorSlashInsertion } from '../composables/useEditorSlashInsertion'
import { useEditorWikilinkOverlayState } from '../composables/useEditorWikilinkOverlayState'
import { useEditorTiptapSetup } from '../composables/useEditorTiptapSetup'
import { useEditorTableInteractions } from '../composables/useEditorTableInteractions'
import { useEditorPathWatchers } from '../composables/useEditorPathWatchers'
import { useEditorVirtualTitleDocument } from '../composables/useEditorVirtualTitleDocument'
import { useEditorWikilinkDataSource } from '../composables/useEditorWikilinkDataSource'
import { useEditorBlockHandleControls } from '../composables/useEditorBlockHandleControls'
import { useEditorSessionStatus } from '../composables/useEditorSessionStatus'
import { useEditorCaretOutline } from '../composables/useEditorCaretOutline'
import { useEditorLayoutMetrics } from '../composables/useEditorLayoutMetrics'
import { useEditorMountedSessions } from '../composables/useEditorMountedSessions'
import { normalizeBlockId, normalizeHeadingAnchor, slugifyHeading } from '../lib/wikilinks'
import { toTiptapDoc } from '../lib/tiptap/editorBlocksToTiptapDoc'
import { fromTiptapDoc } from '../lib/tiptap/tiptapDocToEditorBlocks'
import { useDocumentEditorSessions, type PaneId } from '../composables/useDocumentEditorSessions'
import { useEditorNavigation, type EditorHeadingNode } from '../composables/useEditorNavigation'
import { useSlashMenu } from '../composables/useSlashMenu'
import { type WikilinkCandidate } from '../lib/tiptap/plugins/wikilinkState'
import { buildWikilinkCandidates } from '../lib/tiptap/wikilinkCandidates'
import { hasPendingHeavyRender, waitForHeavyRenderIdle } from '../lib/tiptap/renderStabilizer'
import type { BlockMenuTarget, TurnIntoType } from '../lib/tiptap/blockMenu/types'
import { computeHandleLock, type DragHandleUiState } from '../lib/tiptap/blockMenu/dragHandleState'

type HeadingNode = EditorHeadingNode
type CorePropertyOption = { key: string; label?: string; description?: string }
const CORE_PROPERTY_OPTIONS: CorePropertyOption[] = [
  { key: 'tags', label: 'tags', description: 'Tag list' },
  { key: 'aliases', label: 'aliases', description: 'Alternative names' },
  { key: 'cssclasses', label: 'cssclasses', description: 'Note CSS classes' },
  { key: 'date', label: 'date', description: 'Primary date (YYYY-MM-DD)' },
  { key: 'deadline', label: 'deadline', description: 'Due date (YYYY-MM-DD)' },
  { key: 'archive', label: 'archive', description: 'Archive flag' },
  { key: 'published', label: 'published', description: 'Publish flag' }
]

const SLASH_COMMANDS = EDITOR_SLASH_COMMANDS

const props = defineProps<{
  path: string
  openPaths?: string[]
  openFile: (path: string) => Promise<string>
  saveFile: (path: string, text: string, options: { explicit: boolean }) => Promise<{ persisted: boolean }>
  renameFileFromTitle: (path: string, title: string) => Promise<{ path: string; title: string }>
  loadLinkTargets: () => Promise<string[]>
  loadLinkHeadings: (target: string) => Promise<string[]>
  loadPropertyTypeSchema: () => Promise<Record<string, string>>
  savePropertyTypeSchema: (schema: Record<string, string>) => Promise<void>
  openLinkTarget: (target: string) => Promise<boolean>
}>()

const emit = defineEmits<{
  status: [payload: { path: string; dirty: boolean; saving: boolean; saveError: string }]
  'path-renamed': [payload: { from: string; to: string; manual: boolean }]
  outline: [payload: HeadingNode[]]
  properties: [payload: { path: string; items: Array<{ key: string; value: string }>; parseErrorCount: number }]
}>()

const holder = ref<HTMLDivElement | null>(null)
const contentShell = ref<HTMLDivElement | null>(null)
let editor: Editor | null = null
let suppressOnChange = false
const MAIN_PANE_ID: PaneId = 'main'
const isLoadingLargeDocument = ref(false)
const loadStageLabel = ref('')
const loadProgressPercent = ref(0)
const loadProgressIndeterminate = ref(false)
const loadDocumentStats = ref<{ chars: number; lines: number } | null>(null)
const LARGE_DOC_THRESHOLD = 40_000


const lastStableBlockMenuTarget = ref<BlockMenuTarget | null>(null)
const blockMenuFloatingEl = ref<HTMLDivElement | null>(null)
const blockMenuPos = ref({ x: 0, y: 0 })
const tableToolbarFloatingEl = ref<HTMLDivElement | null>(null)
const tableToolbarLeft = ref(0) // menu anchor, holder-relative
const tableToolbarTop = ref(0) // menu anchor, holder-relative
const tableToolbarViewportLeft = ref(0)
const tableToolbarViewportTop = ref(0)
const tableToolbarViewportMaxHeight = ref(420)
const tableMenuBtnLeft = ref(0)
const tableMenuBtnTop = ref(0)
const tableBoxLeft = ref(0)
const tableBoxTop = ref(0)
const tableBoxWidth = ref(0)
const tableBoxHeight = ref(0)
const TABLE_EDGE_SHOW_THRESHOLD = 20
const TABLE_EDGE_STICKY_THRESHOLD = 44
const TABLE_EDGE_STICKY_MS = 280
const TABLE_MARKDOWN_MODE = true
const DRAG_HANDLE_PLUGIN_KEY = 'tomosona-drag-handle'
const DRAG_HANDLE_DEBUG = false
const DRAG_HANDLE_CONTENT_EDGE_GAP_PX = 2
const dragHandleUiState = ref<DragHandleUiState>({
  menuOpen: false,
  gutterHover: false,
  controlsHover: false,
  dragging: false,
  activeTarget: null,
})
const TURN_INTO_TYPES: TurnIntoType[] = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bulletList',
  'orderedList',
  'taskList',
  'codeBlock',
  'quote',
]
const TURN_INTO_LABELS: Record<TurnIntoType, string> = {
  paragraph: 'Paragraph',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  bulletList: 'Bullet list',
  orderedList: 'Ordered list',
  taskList: 'Task list',
  codeBlock: 'Code block',
  quote: 'Quote',
}
const currentPath = computed(() => props.path?.trim() || '')
const lastEditorInteractionAt = ref(0)
const USER_INTERACTION_CAPTURE_WINDOW_MS = 1200
const sessionStore = useDocumentEditorSessions({
  createEditor: (path) => createSessionEditor(path)
})
const slashCommandSource = computed(() => SLASH_COMMANDS)
let closeCompetingBlockMenu = () => {}
const slashMenu = useSlashMenu({
  getEditor: () => editor,
  commands: slashCommandSource,
  closeCompetingMenus: () => closeCompetingBlockMenu()
})
const slashOpen = slashMenu.slashOpen
const slashIndex = slashMenu.slashIndex
const slashLeft = slashMenu.slashLeft
const slashTop = slashMenu.slashTop
const visibleSlashCommands = slashMenu.visibleSlashCommands
const closeSlashMenu = slashMenu.closeSlashMenu
const markSlashActivatedByUser = slashMenu.markSlashActivatedByUser
const currentTextSelectionContext = slashMenu.currentTextSelectionContext
const readSlashContext = slashMenu.readSlashContext
const openSlashAtSelection = slashMenu.openSlashAtSelection
const syncSlashMenuFromSelection = slashMenu.syncSlashMenuFromSelection
let closeWikilinkMenuForBlockControls = () => {}

const inlineFormatToolbar = useInlineFormatToolbar({
  holder,
  getEditor: () => editor,
  sanitizeHref: sanitizeExternalHref
})
const wikilinkDataSource = useEditorWikilinkDataSource({
  loadLinkTargets: props.loadLinkTargets,
  loadLinkHeadings: props.loadLinkHeadings
})
const computedDragLock = computed(() => computeHandleLock(dragHandleUiState.value))
const debugTargetPos = computed(() => String(dragHandleUiState.value.activeTarget?.pos ?? ''))
// Keep template binding reactive when active session editor changes.
const renderedEditor = computed(() => sessionStore.getActiveSession(MAIN_PANE_ID)?.editor ?? null)
const blockMenuControls = useBlockMenuControls({
  getEditor: () => renderedEditor.value,
  turnIntoTypes: TURN_INTO_TYPES,
  turnIntoLabels: TURN_INTO_LABELS,
  activeTarget: computed(() => dragHandleUiState.value.activeTarget),
  stableTarget: lastStableBlockMenuTarget
})
const blockMenuOpen = blockMenuControls.blockMenuOpen
const blockMenuIndex = blockMenuControls.blockMenuIndex
const blockMenuTarget = blockMenuControls.blockMenuTarget
const blockMenuActionTarget = blockMenuControls.actionTarget
const blockMenuActions = blockMenuControls.actions
const blockMenuConvertActions = blockMenuControls.convertActions
const blockHandleControls = useEditorBlockHandleControls({
  getEditor: () => editor,
  blockMenuOpen,
  blockMenuIndex,
  blockMenuTarget,
  blockMenuActionTarget,
  dragHandleUiState,
  lastStableBlockMenuTarget,
  setBlockMenuPos: (payload) => {
    blockMenuPos.value = payload
  },
  setDragHandleLockMeta: (locked) => {
    if (!editor) return
    editor.commands.setMeta('lockDragHandle', locked)
  },
  closeSlashMenu,
  closeWikilinkMenu: () => closeWikilinkMenuForBlockControls(),
  openSlashAtSelection,
  copyTextToClipboard: (text) => {
    if (!navigator.clipboard?.writeText) return
    void navigator.clipboard.writeText(text)
  },
  debug: DRAG_HANDLE_DEBUG
    ? (event, detail) => {
      // eslint-disable-next-line no-console
      console.info('[drag-handle]', event, detail ?? '', dragHandleUiState.value)
    }
    : undefined
})

const dragHandleLockXMiddleware: Middleware = {
  name: 'tomosonaLockXToContent',
  fn(state: MiddlewareState) {
    const shellEl = contentShell.value
    if (!shellEl) return {}
    const shellRect = shellEl.getBoundingClientRect()
    const shellStyle = window.getComputedStyle(shellEl)
    const shellPaddingLeft = Number.parseFloat(shellStyle.paddingLeft || '0') || 0
    const floatingEl = state.elements.floating
    const offsetParent = floatingEl instanceof HTMLElement && floatingEl.offsetParent instanceof HTMLElement
      ? floatingEl.offsetParent
      : null
    const offsetParentLeft = offsetParent?.getBoundingClientRect().left ?? 0
    const referenceLeft = state.rects.reference.x
    // Keep X fixed by remapping the reference column to the text-content edge.
    const targetReferenceLeft =
      shellRect.left + shellPaddingLeft - offsetParentLeft - DRAG_HANDLE_CONTENT_EDGE_GAP_PX
    const nextX = state.x + (targetReferenceLeft - referenceLeft)
    return { x: nextX }
  }
}
const dragHandleComputePositionConfig = {
  placement: 'left-start' as const,
  middleware: [dragHandleLockXMiddleware]
}
const closeBlockMenu = blockHandleControls.closeBlockMenu
const onBlockHandleNodeChange = blockHandleControls.onBlockHandleNodeChange
const toggleBlockMenu = blockHandleControls.toggleBlockMenu
const onBlockMenuPlus = blockHandleControls.onBlockMenuPlus
const onBlockMenuSelect = blockHandleControls.onBlockMenuSelect
const onHandleControlsEnter = blockHandleControls.onHandleControlsEnter
const onHandleControlsLeave = blockHandleControls.onHandleControlsLeave
const onHandleDragStart = blockHandleControls.onHandleDragStart
const onHandleDragEnd = blockHandleControls.onHandleDragEnd
closeCompetingBlockMenu = () => closeBlockMenu()
const tableControls = useTableToolbarControls({
  showThreshold: TABLE_EDGE_SHOW_THRESHOLD,
  stickyThreshold: TABLE_EDGE_STICKY_THRESHOLD,
  stickyMs: TABLE_EDGE_STICKY_MS
})
const tableToolbarTriggerVisible = tableControls.tableToolbarTriggerVisible
const tableAddTopVisible = tableControls.tableAddTopVisible
const tableAddBottomVisible = tableControls.tableAddBottomVisible
const tableAddLeftVisible = tableControls.tableAddLeftVisible
const tableAddRightVisible = tableControls.tableAddRightVisible
const virtualTitleDoc = useEditorVirtualTitleDocument()
const { editorZoomStyle, initFromStorage: initEditorZoomFromStorage, zoomBy: zoomEditorBy, resetZoom: resetEditorZoom, getZoom } = useEditorZoom()
const { mermaidReplaceDialog, resolveMermaidReplaceDialog, requestMermaidReplaceConfirm } = useMermaidReplaceDialog()
const navigation = useEditorNavigation({
  getEditor: () => editor,
  emitOutline: (headings) => emit('outline', headings),
  normalizeHeadingAnchor,
  slugifyHeading,
  normalizeBlockId
})
const lifecycle = useEditorSessionLifecycle({
  emitStatus: (payload) => emit('status', payload),
  saveCurrentFile: (manual) => saveCurrentFile(manual),
  isEditingVirtualTitle: () => isEditingVirtualTitle(),
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

const tableGeometry = useEditorTableGeometry({
  holder,
  state: {
    tableMenuBtnLeft,
    tableMenuBtnTop,
    tableBoxLeft,
    tableBoxTop,
    tableBoxWidth,
    tableBoxHeight,
    tableToolbarLeft,
    tableToolbarTop,
    tableToolbarViewportLeft,
    tableToolbarViewportTop,
    tableToolbarViewportMaxHeight
  }
})
const tableInteractions = useEditorTableInteractions({
  getEditor: () => editor,
  holder,
  floatingMenuEl: tableToolbarFloatingEl,
  visibility: {
    tableToolbarTriggerVisible,
    tableAddTopVisible,
    tableAddBottomVisible,
    tableAddLeftVisible,
    tableAddRightVisible
  },
  hideEdgeControls: () => tableControls.hideAll(),
  updateEdgeControlsFromDistances: (distances) => tableControls.updateFromDistances(distances),
  updateTableToolbarPosition: (cellEl, tableEl) => tableGeometry.updateTableToolbarPosition(cellEl, tableEl)
})
const tableToolbarOpen = tableInteractions.tableToolbarOpen
const tableToolbarActions = tableInteractions.tableToolbarActions
const hideTableToolbar = tableInteractions.hideTableToolbar
const hideTableToolbarAnchor = tableInteractions.hideTableToolbarAnchor
const updateTableToolbar = tableInteractions.updateTableToolbar
const onTableToolbarSelect = tableInteractions.onTableToolbarSelect
const toggleTableToolbar = tableInteractions.toggleTableToolbar
const addRowAfterFromTrigger = tableInteractions.addRowAfterFromTrigger
const addRowBeforeFromTrigger = tableInteractions.addRowBeforeFromTrigger
const addColumnBeforeFromTrigger = tableInteractions.addColumnBeforeFromTrigger
const addColumnAfterFromTrigger = tableInteractions.addColumnAfterFromTrigger
const onEditorMouseMove = tableInteractions.onEditorMouseMove
const onEditorMouseLeave = tableInteractions.onEditorMouseLeave

function isEditingVirtualTitle(): boolean {
  if (!editor) return false
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'heading' && Boolean(node.attrs?.isVirtualTitle)) {
      return true
    }
  }
  return false
}

function serializeCurrentDocBlocks(): EditorBlock[] {
  if (!editor) return []
  return fromTiptapDoc(editor.getJSON())
}

async function renderBlocks(blocks: EditorBlock[]) {
  if (!editor) return
  const doc = toTiptapDoc(blocks)
  const rememberedScroll = holder.value?.scrollTop ?? 0
  suppressOnChange = true
  editor.commands.setContent(doc, { emitUpdate: false })
  suppressOnChange = false
  await nextTick()
  if (holder.value) holder.value.scrollTop = rememberedScroll
}

const caretOutline = useEditorCaretOutline({
  currentPath,
  getSession,
  getEditor: () => editor,
  emitOutline: (payload) => {
    emit('outline', payload.headings)
  },
  parseOutlineFromDoc: () => navigation.parseOutlineFromDoc()
})
const captureCaret = caretOutline.captureCaret
const restoreCaret = caretOutline.restoreCaret
const clearOutlineTimer = caretOutline.clearOutlineTimer
const emitOutlineSoon = caretOutline.emitOutlineSoon

function onDocumentMouseDown(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Node)) return
  const handleRoot = target instanceof Element ? target.closest('.tomosona-block-controls') : null

  if (blockMenuOpen.value) {
    if (blockMenuFloatingEl.value?.contains(target)) return
    if (handleRoot) return
    closeBlockMenu()
  }

  if (tableToolbarOpen.value) {
    if (tableToolbarFloatingEl.value?.contains(target)) return
    if (target instanceof Element && target.closest('.tomosona-table-control')) return
    hideTableToolbar()
  }
}

const layoutMetrics = useEditorLayoutMetrics({
  holder,
  contentShell,
  onScrollSync: () => updateTableToolbar()
})
const gutterHitboxStyle = layoutMetrics.gutterHitboxStyle
const countLines = layoutMetrics.countLines
const updateGutterHitboxStyle = layoutMetrics.updateGutterHitboxStyle
const onHolderScroll = layoutMetrics.onHolderScroll

function updateFormattingToolbar() {
  inlineFormatToolbar.updateFormattingToolbar()
}

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
  loadPropertyTypeSchema: props.loadPropertyTypeSchema,
  savePropertyTypeSchema: props.savePropertyTypeSchema,
  onDirty: (path) => {
    setDirty(path, true)
    setSaveError(path, '')
    scheduleAutosave(path)
  },
  emitProperties: (payload) => emit('properties', payload)
})

watch(editorZoomStyle, () => {
  void nextTick().then(() => updateGutterHitboxStyle())
}, { deep: true })

function onEditorDocChanged(path: string) {
  if (suppressOnChange || !path) return
  setDirty(path, true)
  setSaveError(path, '')
  scheduleAutosave(path)
  emitOutlineSoon(path)
}

function resetTransientUiState() {
  slashMenu.slashActivatedByUser.value = false
  closeSlashMenu()
  closeWikilinkMenu()
  closeBlockMenu()
  blockMenuTarget.value = null
  lastStableBlockMenuTarget.value = null
  dragHandleUiState.value = { ...dragHandleUiState.value, activeTarget: null }
  inlineFormatToolbar.dismissToolbar()
  hideTableToolbarAnchor()
  wikilinkDataSource.resetCache()
}

function setActiveSession(path: string) {
  sessionStore.setActivePath(MAIN_PANE_ID, path)
  const session = getSession(path)
  editor = session?.editor ?? null
  blockHandleControls.resetLockState()
}

const wikilinkOverlay = useEditorWikilinkOverlayState({
  getEditor: () => editor,
  holder,
  blockMenuOpen,
  isDragMenuOpen: () => dragHandleUiState.value.menuOpen,
  closeBlockMenu: () => closeBlockMenu()
})
const wikilinkOpen = wikilinkOverlay.wikilinkOpen
const wikilinkIndex = wikilinkOverlay.wikilinkIndex
const wikilinkLeft = wikilinkOverlay.wikilinkLeft
const wikilinkTop = wikilinkOverlay.wikilinkTop
const wikilinkResults = wikilinkOverlay.wikilinkResults
const closeWikilinkMenu = wikilinkOverlay.closeWikilinkMenu
const syncWikilinkUiFromPluginState = wikilinkOverlay.syncWikilinkUiFromPluginState
const onWikilinkMenuSelect = wikilinkOverlay.onWikilinkMenuSelect
const onWikilinkMenuIndexUpdate = wikilinkOverlay.onWikilinkMenuIndexUpdate
closeWikilinkMenuForBlockControls = closeWikilinkMenu

// Invariant: wikilink overlay must be initialized before tiptap callbacks are bound.
const tiptapSetup = useEditorTiptapSetup({
  currentPath,
  getCurrentEditor: () => editor,
  getSessionEditor: (path) => getSession(path)?.editor ?? null,
  markSlashActivatedByUser,
  syncSlashMenuFromSelection,
  updateTableToolbar,
  syncWikilinkUiFromPluginState,
  captureCaret,
  shouldCaptureCaret: (path) => {
    if (!path || currentPath.value !== path) return false
    if (suppressOnChange) return false
    if (!holder.value) return false
    const active = typeof document !== 'undefined' ? document.activeElement : null
    if (!active || !holder.value.contains(active)) return false
    const hasRecentUserInteraction = Date.now() - lastEditorInteractionAt.value <= USER_INTERACTION_CAPTURE_WINDOW_MS
    return hasRecentUserInteraction
  },
  updateFormattingToolbar,
  onEditorDocChanged,
  requestMermaidReplaceConfirm,
  getWikilinkCandidates,
  openLinkTargetWithAutosave,
  resolveWikilinkTarget: wikilinkDataSource.resolveWikilinkTarget,
  sanitizeExternalHref,
  openExternalUrl,
  inlineFormatToolbar: {
    updateFormattingToolbar: inlineFormatToolbar.updateFormattingToolbar,
    openLinkPopover: inlineFormatToolbar.openLinkPopover
  }
})

function createSessionEditor(path: string): Editor {
  return tiptapSetup.createSessionEditor(path)
}

const mountedSessions = useEditorMountedSessions({
  openPaths: computed(() => props.openPaths ?? []),
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
    holder,
    getEditor: () => editor,
    getSession,
    ensureSession,
    renameSessionPath: (from, to) => {
      sessionStore.renamePath(from, to)
    },
    moveLifecyclePathState: (from, to) => lifecycle.movePathState(from, to),
    setSuppressOnChange: (value) => {
      suppressOnChange = value
    },
    restoreCaret,
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
    serializableFrontmatterFields,
    moveFrontmatterPathState,
    countLines,
    noteTitleFromPath: virtualTitleDoc.noteTitleFromPath,
    readVirtualTitle: virtualTitleDoc.readVirtualTitle,
    blockTextCandidate: virtualTitleDoc.blockTextCandidate,
    withVirtualTitle: virtualTitleDoc.withVirtualTitle,
    stripVirtualTitle: virtualTitleDoc.stripVirtualTitle,
    serializeCurrentDocBlocks,
    renderBlocks
  },
  uiPort: {
    clearAutosaveTimer,
    clearOutlineTimer,
    emitOutlineSoon,
    emitPathRenamed: (payload) => emit('path-renamed', payload),
    resetTransientUiState,
    updateGutterHitboxStyle,
    syncWikilinkUiFromPluginState,
    largeDocThreshold: LARGE_DOC_THRESHOLD,
    ui: {
      isLoadingLargeDocument,
      loadStageLabel,
      loadProgressPercent,
      loadProgressIndeterminate,
      loadDocumentStats
    }
  },
  ioPort: {
    openFile: props.openFile,
    saveFile: props.saveFile,
    renameFileFromTitle: props.renameFileFromTitle
  },
  requestPort: {
    isCurrentRequest: (requestId) => lifecycle.isCurrentRequest(requestId)
  },
  waitForHeavyRenderIdle,
  hasPendingHeavyRender
})

async function loadCurrentFile(path: string, options?: { forceReload?: boolean; requestId?: number }) {
  await fileLifecycle.loadCurrentFile(path, options)
}

async function saveCurrentFile(manual = true) {
  await fileLifecycle.saveCurrentFile(manual)
}

const slashInsertion = useEditorSlashInsertion({
  getEditor: () => editor,
  currentTextSelectionContext,
  readSlashContext
})
const insertBlockFromDescriptor = slashInsertion.insertBlockFromDescriptor

async function getWikilinkCandidates(query: string): Promise<WikilinkCandidate[]> {
  return buildWikilinkCandidates({
    query,
    loadTargets: () => wikilinkDataSource.loadWikilinkTargets(),
    loadHeadings: (target) => wikilinkDataSource.loadWikilinkHeadings(target),
    currentHeadings: () => navigation.parseOutlineFromDoc().map((item) => item.text),
    resolve: (target) => wikilinkDataSource.resolveWikilinkTarget(target)
  })
}

async function openLinkTargetWithAutosave(target: string) {
  const path = currentPath.value
  const session = path ? getSession(path) : null
  if (path && session?.dirty) {
    clearAutosaveTimer()
    await saveCurrentFile(false)
    if (getSession(path)?.dirty) return
  }
  await props.openLinkTarget(target)
}

const inputHandlers = useEditorInputHandlers({
  editingPort: {
    getEditor: () => editor,
    currentPath,
    captureCaret,
    currentTextSelectionContext,
    insertBlockFromDescriptor
  },
  menusPort: {
    visibleSlashCommands,
    slashOpen,
    slashIndex,
    closeSlashMenu,
    blockMenuOpen,
    closeBlockMenu: () => closeBlockMenu(),
    tableToolbarOpen,
    hideTableToolbar,
    inlineFormatToolbar: {
      linkPopoverOpen: inlineFormatToolbar.linkPopoverOpen,
      cancelLink: inlineFormatToolbar.cancelLink
    }
  },
  uiPort: {
    updateFormattingToolbar,
    updateTableToolbar,
    syncSlashMenuFromSelection
  },
  zoomPort: {
    zoomEditorBy,
    resetEditorZoom
  }
})
const onEditorKeydown = inputHandlers.onEditorKeydown
const onEditorKeyup = inputHandlers.onEditorKeyup
const onEditorContextMenu = inputHandlers.onEditorContextMenu
const onEditorPaste = inputHandlers.onEditorPaste

function markEditorInteraction() {
  lastEditorInteractionAt.value = Date.now()
}

function onHolderPointerDownMarkInteraction() {
  markEditorInteraction()
}

function onHolderKeydown(event: KeyboardEvent) {
  markEditorInteraction()
  onEditorKeydown(event)
}

function onHolderContextMenu(event: MouseEvent) {
  markEditorInteraction()
  onEditorContextMenu(event)
}

function onHolderPaste(event: ClipboardEvent) {
  markEditorInteraction()
  onEditorPaste(event)
}

useEditorPathWatchers({
  path: computed(() => props.path ?? ''),
  openPaths: computed(() => props.openPaths ?? []),
  holder,
  currentPath,
  nextRequestId: () => lifecycle.nextRequestId(),
  ensureSession,
  setActiveSession,
  loadCurrentFile,
  captureCaret,
  getSession,
  getActivePath: () => sessionStore.getActivePath(MAIN_PANE_ID),
  setActivePath: (path) => sessionStore.setActivePath(MAIN_PANE_ID, path),
  clearActiveEditor: () => {
    editor = null
  },
  listPaths: () => sessionStore.listPaths(),
  closePath: (path) => sessionStore.closePath(path),
  resetPropertySchemaState,
  emitEmptyProperties: () => {
    emit('properties', { path: '', items: [], parseErrorCount: 0 })
  },
  closeSlashMenu,
  closeWikilinkMenu,
  closeBlockMenu: () => closeBlockMenu(),
  hideTableToolbarAnchor,
  emitEmptyOutline: () => {
    emit('outline', [])
  },
  onMountInit: async () => {
    initEditorZoomFromStorage()

    if (currentPath.value) {
      const requestId = lifecycle.nextRequestId()
      ensureSession(currentPath.value)
      setActiveSession(currentPath.value)
      await loadCurrentFile(currentPath.value, { requestId })
    }

    holder.value?.addEventListener('pointerdown', onHolderPointerDownMarkInteraction, true)
    holder.value?.addEventListener('keydown', onHolderKeydown, true)
    holder.value?.addEventListener('keyup', onEditorKeyup, true)
    holder.value?.addEventListener('contextmenu', onHolderContextMenu, true)
    holder.value?.addEventListener('paste', onHolderPaste, true)
    holder.value?.addEventListener('scroll', onHolderScroll, true)
    window.addEventListener('resize', updateGutterHitboxStyle)
    await nextTick()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    updateGutterHitboxStyle()
    document.addEventListener('mousedown', onDocumentMouseDown, true)
  },
  onUnmountCleanup: async () => {
    tableInteractions.clearTimers()
    if (mermaidReplaceDialog.value.resolve) {
      mermaidReplaceDialog.value.resolve(false)
    }
    holder.value?.removeEventListener('pointerdown', onHolderPointerDownMarkInteraction, true)
    holder.value?.removeEventListener('keydown', onHolderKeydown, true)
    holder.value?.removeEventListener('keyup', onEditorKeyup, true)
    holder.value?.removeEventListener('contextmenu', onHolderContextMenu, true)
    holder.value?.removeEventListener('paste', onHolderPaste, true)
    holder.value?.removeEventListener('scroll', onHolderScroll, true)
    window.removeEventListener('resize', updateGutterHitboxStyle)
    document.removeEventListener('mousedown', onDocumentMouseDown, true)
    sessionStore.closeAll()
    editor = null
  }
})

function focusEditor() {
  editor?.commands.focus()
}

async function focusFirstContentBlock() {
  if (!editor) return
  let targetPos = 1
  let firstSeen = false
  editor.state.doc.descendants((node, pos) => {
    if (!firstSeen && node.type.name === 'heading' && node.attrs.isVirtualTitle) {
      firstSeen = true
      return
    }
    if (!firstSeen) return
    if (node.isTextblock) {
      targetPos = pos + 1
      return false
    }
  })
  editor.chain().focus().setTextSelection(targetPos).run()
}

defineExpose({
  saveNow: async () => {
    await saveCurrentFile(true)
  },
  reloadCurrent: async () => {
    if (!currentPath.value) return
    const requestId = lifecycle.nextRequestId()
    ensureSession(currentPath.value)
    setActiveSession(currentPath.value)
    await loadCurrentFile(currentPath.value, { forceReload: true, requestId })
  },
  focusEditor,
  focusFirstContentBlock,
  revealSnippet: navigation.revealSnippet,
  revealOutlineHeading: navigation.revealOutlineHeading,
  revealAnchor: navigation.revealAnchor,
  zoomIn: () => {
    return zoomEditorBy(0.1)
  },
  zoomOut: () => {
    return zoomEditorBy(-0.1)
  },
  resetZoom: () => {
    return resetEditorZoom()
  },
  getZoom
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div
      v-if="!path"
      class="flex min-h-0 flex-1 items-center justify-center bg-[#f9f9fb] px-8 py-6 text-sm text-[#737a87] dark:bg-slate-950 dark:text-slate-400"
    >
      Open a file to start editing
    </div>

    <div v-else class="editor-shell flex min-h-0 flex-1 flex-col overflow-hidden border-x border-[#e5e7eb] bg-white dark:border-slate-800 dark:bg-[#282c34]">
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

      <div
        class="relative min-h-0 flex-1 overflow-hidden"
        :data-drag-lock="computedDragLock ? 'true' : 'false'"
        :data-menu-open="dragHandleUiState.menuOpen ? 'true' : 'false'"
        :data-gutter-hover="dragHandleUiState.gutterHover ? 'true' : 'false'"
        :data-controls-hover="dragHandleUiState.controlsHover ? 'true' : 'false'"
        :data-target-pos="debugTargetPos"
      >
        <div
          v-if="DRAG_HANDLE_DEBUG"
          class="pointer-events-none absolute right-2 top-2 z-50 rounded bg-slate-900/80 px-2 py-1 text-[11px] text-white"
        >
          lock={{ computedDragLock }} menu={{ dragHandleUiState.menuOpen }} gutter={{ dragHandleUiState.gutterHover }} controls={{ dragHandleUiState.controlsHover }} drag={{ dragHandleUiState.dragging }} target={{ debugTargetPos }}
        </div>
        <div
          class="editor-gutter-hitbox"
          :style="gutterHitboxStyle"
        />
        <div
          ref="holder"
          class="editor-holder relative h-full min-h-0 overflow-y-auto bg-white px-8 py-6 dark:bg-[#282c34]"
          :style="editorZoomStyle"
          @mousemove="onEditorMouseMove"
          @mouseleave="onEditorMouseLeave"
          @click="closeSlashMenu(); closeWikilinkMenu(); closeBlockMenu()"
        >
          <div ref="contentShell" class="editor-content-shell">
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
              <EditorContent
                v-if="renderedEditorsByPath[sessionPath]"
                :key="`editor-content:${sessionPath}`"
                :editor="renderedEditorsByPath[sessionPath]!"
              />
            </div>
          </div>
          <!-- Invariant: interactive overlays/drag-handle stay bound to active editor only. -->
          <DragHandleVue3
            v-if="renderedEditor"
            :key="`drag-handle:${currentPath || 'none'}`"
            :editor="renderedEditor"
            :plugin-key="DRAG_HANDLE_PLUGIN_KEY"
            :compute-position-config="dragHandleComputePositionConfig"
            class="tomosona-drag-handle"
            :nested="true"
            :on-node-change="onBlockHandleNodeChange"
            :on-element-drag-start="onHandleDragStart"
            :on-element-drag-end="onHandleDragEnd"
          >
            <div class="tomosona-block-controls" @mouseenter="onHandleControlsEnter" @mouseleave="onHandleControlsLeave">
              <button
                type="button"
                class="tomosona-block-control-btn"
                aria-label="Insert below"
                @mousedown.stop
                @click.stop.prevent="onBlockMenuPlus"
              >
                +
              </button>
              <button
                type="button"
                class="tomosona-block-control-btn tomosona-block-grip-btn"
                aria-label="Open block menu"
                @mousedown.stop
                @click.stop.prevent="toggleBlockMenu"
              >
                ⋮⋮
              </button>
            </div>
          </DragHandleVue3>

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
            :link-popover-open="inlineFormatToolbar.linkPopoverOpen.value"
            :link-value="inlineFormatToolbar.linkValue.value"
            :link-error="inlineFormatToolbar.linkError.value"
            @toggle-mark="inlineFormatToolbar.toggleMark"
            @open-link="inlineFormatToolbar.openLinkPopover"
            @wrap-wikilink="inlineFormatToolbar.wrapSelectionWithWikilink"
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
            :commands="visibleSlashCommands"
            @update:index="slashIndex = $event"
            @select="closeSlashMenu(); insertBlockFromDescriptor($event.type, $event.data)"
            @close="closeSlashMenu(); focusEditor()"
          />

          <EditorWikilinkOverlay
            :open="wikilinkOpen"
            :index="wikilinkIndex"
            :left="wikilinkLeft"
            :top="wikilinkTop"
            :results="wikilinkResults"
            @update:index="onWikilinkMenuIndexUpdate($event)"
            @select="onWikilinkMenuSelect($event)"
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
        </div>

        <EditorLargeDocOverlay
          :visible="isLoadingLargeDocument"
          :stage-label="loadStageLabel"
          :progress-percent="loadProgressPercent"
          :progress-indeterminate="loadProgressIndeterminate"
          :stats="loadDocumentStats"
        />
      </div>
    </div>

    <EditorMermaidReplaceDialog
      :visible="mermaidReplaceDialog.visible"
      :template-label="mermaidReplaceDialog.templateLabel"
      @cancel="resolveMermaidReplaceDialog(false)"
      @confirm="resolveMermaidReplaceDialog(true)"
    />
  </div>
</template>
