import { computed, nextTick, ref, watch, type CSSProperties, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { Middleware, MiddlewareState } from '@floating-ui/dom'
import type { BlockMenuTarget, TurnIntoType } from '../lib/tiptap/blockMenu/types'
import { computeHandleLock, type DragHandleUiState } from '../lib/tiptap/blockMenu/dragHandleState'
import { extractSelectionClipboardPayload, writeSelectionPayloadToClipboard, type CopyAsFormat } from '../lib/editorClipboard'
import { sanitizeExternalHref } from '../lib/markdownBlocks'
import { useInlineFormatToolbar } from './useInlineFormatToolbar'
import { useEditorFindToolbar } from './useEditorFindToolbar'
import { useBlockMenuControls } from './useBlockMenuControls'
import { useEditorBlockHandleControls } from './useEditorBlockHandleControls'
import { useTableToolbarControls } from './useTableToolbarControls'
import { useEditorTableGeometry } from './useEditorTableGeometry'
import { useEditorTableInteractions } from './useEditorTableInteractions'
import { useEditorLayoutMetrics } from './useEditorLayoutMetrics'
import { useEditorZoom } from './useEditorZoom'
import { useMermaidReplaceDialog } from './useMermaidReplaceDialog'
import { usePulseTransformation } from '../../pulse/composables/usePulseTransformation'
import { PULSE_ACTIONS_BY_SOURCE } from '../../pulse/lib/pulse'
import type { PulseActionId } from '../../../shared/api/apiTypes'
import type { DocumentSession } from './useDocumentEditorSessions'

export type EditorChromeRuntimeHostPort = {
  holder: Ref<HTMLDivElement | null>
  contentShell: Ref<HTMLDivElement | null>
  pulsePanelWrap: Ref<HTMLDivElement | null>
  currentPath: Ref<string>
  activeEditor: Ref<Editor | null>
  getSession: (path: string) => DocumentSession | null
}

export type EditorChromeRuntimeInteractionPort = {
  closeSlashMenu: () => void
  dismissSlashMenu: () => void
  closeWikilinkMenu: () => void
  openSlashAtSelection: () => void
  currentTextSelectionContext: () => { text: string; nodeType: string; from: number; to: number } | null
  insertBlockFromDescriptor: (
    type: string,
    data: Record<string, unknown>,
    options?: { replaceRange?: { from: number; to: number } | null }
  ) => boolean
  onEditorKeydown: (event: KeyboardEvent) => void
  onEditorKeyup: () => void
  onEditorContextMenu: (event: MouseEvent) => void
  onEditorPaste: (event: ClipboardEvent) => void
  markEditorInteraction: () => void
  resetWikilinkDataCache: () => void
}

export type EditorChromeRuntimeEmitPort = {
  emitPulseOpenSecondBrain: (payload: { contextPaths: string[]; prompt?: string }) => void
}

/**
 * Owns toolbars, overlays, pulse UI, and holder/document event wiring around the editor.
 */
export type UseEditorChromeRuntimeOptions = {
  hostPort: EditorChromeRuntimeHostPort
  interactionPort: EditorChromeRuntimeInteractionPort
  emitPort: EditorChromeRuntimeEmitPort
}

export function useEditorChromeRuntime(options: UseEditorChromeRuntimeOptions) {
  const TABLE_EDGE_SHOW_THRESHOLD = 20
  const TABLE_EDGE_STICKY_THRESHOLD = 44
  const TABLE_EDGE_STICKY_MS = 280
  const TABLE_MARKDOWN_MODE = true
  const LARGE_DOC_THRESHOLD = 40_000
  const DRAG_HANDLE_PLUGIN_KEY = 'tomosona-drag-handle'
  const DRAG_HANDLE_DEBUG = false
  const DRAG_HANDLE_CONTENT_EDGE_GAP_PX = 2
  const TURN_INTO_TYPES: TurnIntoType[] = [
    'paragraph',
    'heading1',
    'heading2',
    'heading3',
    'bulletList',
    'orderedList',
    'taskList',
    'codeBlock',
    'quote'
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
    quote: 'Quote'
  }

  const titleEditorFocused = ref(false)
  const isLoadingLargeDocument = ref(false)
  const loadStageLabel = ref('')
  const loadProgressPercent = ref(0)
  const loadProgressIndeterminate = ref(false)
  const loadDocumentStats = ref<{ chars: number; lines: number } | null>(null)
  const pulse = usePulseTransformation()
  const pulseOpen = ref(false)
  const pulsePanelMeasuredHeight = ref(360)
  const pulseSourceKind = ref<'editor_selection' | 'editor_note'>('editor_selection')
  const pulseActionId = ref<PulseActionId>('rewrite')
  const pulseInstruction = ref('')
  const pulseInstructionDirty = ref(false)
  const pulseSelectionRange = ref<{ from: number; to: number } | null>(null)
  const pulseSourceText = ref('')
  const pulseAnchorNonce = ref(0)
  const lastStableBlockMenuTarget = ref<BlockMenuTarget | null>(null)
  const blockMenuFloatingEl = ref<HTMLDivElement | null>(null)
  const blockMenuPos = ref({ x: 0, y: 0 })
  const tableToolbarFloatingEl = ref<HTMLDivElement | null>(null)
  const tableToolbarLeft = ref(0)
  const tableToolbarTop = ref(0)
  const tableToolbarViewportLeft = ref(0)
  const tableToolbarViewportTop = ref(0)
  const tableToolbarViewportMaxHeight = ref(420)
  const tableMenuBtnLeft = ref(0)
  const tableMenuBtnTop = ref(0)
  const tableBoxLeft = ref(0)
  const tableBoxTop = ref(0)
  const tableBoxWidth = ref(0)
  const tableBoxHeight = ref(0)
  const dragHandleUiState = ref<DragHandleUiState>({
    menuOpen: false,
    gutterHover: false,
    controlsHover: false,
    dragging: false,
    activeTarget: null
  })
  const renderedEditor = computed(() => options.hostPort.activeEditor.value)
  const computedDragLock = computed(() => computeHandleLock(dragHandleUiState.value))
  const debugTargetPos = computed(() => String(dragHandleUiState.value.activeTarget?.pos ?? ''))

  const inlineFormatToolbar = useInlineFormatToolbar({
    holder: options.hostPort.holder,
    getEditor: () => options.hostPort.activeEditor.value,
    sanitizeHref: sanitizeExternalHref
  })
  const findToolbar = useEditorFindToolbar({
    holder: options.hostPort.holder,
    getEditor: () => options.hostPort.activeEditor.value
  })
  const blockMenuControls = useBlockMenuControls({
    getEditor: () => renderedEditor.value,
    turnIntoTypes: TURN_INTO_TYPES,
    turnIntoLabels: TURN_INTO_LABELS,
    activeTarget: computed(() => dragHandleUiState.value.activeTarget),
    stableTarget: lastStableBlockMenuTarget
  })
  const blockHandleControls = useEditorBlockHandleControls({
    getEditor: () => options.hostPort.activeEditor.value,
    blockMenuOpen: blockMenuControls.blockMenuOpen,
    blockMenuIndex: blockMenuControls.blockMenuIndex,
    blockMenuTarget: blockMenuControls.blockMenuTarget,
    blockMenuActionTarget: blockMenuControls.actionTarget,
    dragHandleUiState,
    lastStableBlockMenuTarget,
    setBlockMenuPos: (payload) => {
      blockMenuPos.value = payload
    },
    setDragHandleLockMeta: (locked) => {
      options.hostPort.activeEditor.value?.commands.setMeta('lockDragHandle', locked)
    },
    closeSlashMenu: () => options.interactionPort.closeSlashMenu(),
    closeWikilinkMenu: () => options.interactionPort.closeWikilinkMenu(),
    openSlashAtSelection: () => options.interactionPort.openSlashAtSelection(),
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
  const tableControls = useTableToolbarControls({
    showThreshold: TABLE_EDGE_SHOW_THRESHOLD,
    stickyThreshold: TABLE_EDGE_STICKY_THRESHOLD,
    stickyMs: TABLE_EDGE_STICKY_MS
  })
  const tableGeometry = useEditorTableGeometry({
    holder: options.hostPort.holder,
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
    getEditor: () => options.hostPort.activeEditor.value,
    holder: options.hostPort.holder,
    floatingMenuEl: tableToolbarFloatingEl,
    visibility: {
      tableToolbarTriggerVisible: tableControls.tableToolbarTriggerVisible,
      tableAddTopVisible: tableControls.tableAddTopVisible,
      tableAddBottomVisible: tableControls.tableAddBottomVisible,
      tableAddLeftVisible: tableControls.tableAddLeftVisible,
      tableAddRightVisible: tableControls.tableAddRightVisible
    },
    hideEdgeControls: () => tableControls.hideAll(),
    updateEdgeControlsFromDistances: (distances) => tableControls.updateFromDistances(distances),
    updateTableToolbarPosition: (cellEl, tableEl) => tableGeometry.updateTableToolbarPosition(cellEl, tableEl)
  })
  const layoutMetrics = useEditorLayoutMetrics({
    holder: options.hostPort.holder,
    contentShell: options.hostPort.contentShell,
    onScrollSync: () => tableInteractions.updateTableToolbar()
  })
  const {
    editorZoomStyle,
    initFromStorage: initEditorZoomFromStorage,
    zoomBy: zoomEditorBy,
    resetZoom: resetEditorZoom,
    getZoom
  } = useEditorZoom()
  const { mermaidReplaceDialog, resolveMermaidReplaceDialog, requestMermaidReplaceConfirm } = useMermaidReplaceDialog()

  const dragHandleLockXMiddleware: Middleware = {
    name: 'tomosonaLockXToContent',
    fn(state: MiddlewareState) {
      const shellEl = options.hostPort.contentShell.value
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
      const targetReferenceLeft =
        shellRect.left + shellPaddingLeft - offsetParentLeft - DRAG_HANDLE_CONTENT_EDGE_GAP_PX
      return { x: state.x + (targetReferenceLeft - referenceLeft) }
    }
  }
  const dragHandleComputePositionConfig = {
    placement: 'left-start' as const,
    middleware: [dragHandleLockXMiddleware]
  }

  const pulsePanelStyle = computed<CSSProperties>(() => {
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1440
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900
    const panelWidth = Math.min(420, Math.max(280, viewportWidth - 32))
    const panelHeight = Math.max(220, pulsePanelMeasuredHeight.value)

    if (!pulseOpen.value) {
      return { position: 'fixed', right: '24px', bottom: '24px', width: `${panelWidth}px` }
    }
    if (pulseSourceKind.value !== 'editor_selection' || !options.hostPort.holder.value) {
      return { position: 'fixed', right: '24px', bottom: '24px', width: `${panelWidth}px` }
    }

    void pulseAnchorNonce.value
    const holderRect = options.hostPort.holder.value.getBoundingClientRect()
    const anchorTop = holderRect.top + inlineFormatToolbar.formatToolbarTop.value - options.hostPort.holder.value.scrollTop
    const rightDockLeft = viewportWidth - panelWidth - 24
    const preferredBelow = anchorTop + 54
    const preferredAbove = anchorTop - panelHeight - 20
    const fitsBelow = preferredBelow + panelHeight <= viewportHeight - 16
    const fitsAbove = preferredAbove >= 16
    const targetTop = fitsBelow || !fitsAbove ? preferredBelow : preferredAbove
    const clampedTop = Math.min(Math.max(16, targetTop), viewportHeight - panelHeight - 16)
    return {
      position: 'fixed',
      left: `${Math.max(16, rightDockLeft)}px`,
      top: `${clampedTop}px`,
      width: `${panelWidth}px`
    }
  })

  function updatePulsePanelMetrics() {
    const nextHeight = options.hostPort.pulsePanelWrap.value?.offsetHeight ?? 0
    if (nextHeight > 0) {
      pulsePanelMeasuredHeight.value = nextHeight
    }
  }

  watch(
    [
      pulseOpen,
      options.hostPort.pulsePanelWrap,
      () => pulse.previewMarkdown.value,
      () => pulse.running.value,
      () => pulse.error.value
    ],
    async ([open]) => {
      if (!open) return
      await nextTick()
      updatePulsePanelMetrics()
    },
    { flush: 'post' }
  )

  watch(editorZoomStyle, () => {
    void nextTick().then(() => {
      layoutMetrics.updateGutterHitboxStyle()
    })
  }, { deep: true })

  watch(pulseActionId, (next, previous) => {
    if (next === previous) return
    if (!pulseInstructionDirty.value) {
      setPulseInstruction(pulseDefaultInstruction(next), { markDirty: false })
    }
    if (pulseOpen.value && !pulse.running.value && pulse.previewMarkdown.value.trim()) {
      resetPulseResult()
    }
  })

  watch(pulseSourceText, (next, previous) => {
    if (next === previous) return
    if (pulseOpen.value && !pulse.running.value && pulse.previewMarkdown.value.trim()) {
      resetPulseResult()
    }
  })

  function focusEditor() {
    options.hostPort.activeEditor.value?.commands.focus()
  }

  function updateFormattingToolbar() {
    inlineFormatToolbar.updateFormattingToolbar()
  }

  function pulseDefaultInstruction(actionId: PulseActionId): string {
    return PULSE_ACTIONS_BY_SOURCE[pulseSourceKind.value].find((item) => item.id === actionId)?.description
      ?? 'Transform the provided material into a useful written output.'
  }

  function setPulseInstruction(value: string, pulseOptions?: { markDirty?: boolean }) {
    pulseInstruction.value = value
    if (pulseOptions?.markDirty !== undefined) {
      pulseInstructionDirty.value = pulseOptions.markDirty
    }
  }

  function onPulseActionChange(value: PulseActionId) {
    pulseActionId.value = value
  }

  function onPulseInstructionChange(value: string) {
    pulseInstruction.value = value
    pulseInstructionDirty.value = true
    if (pulseOpen.value && !pulse.running.value && pulse.previewMarkdown.value.trim()) {
      resetPulseResult()
    }
  }

  function resetPulseResult() {
    pulse.reset()
  }

  function closePulsePanel() {
    if (pulse.running.value) {
      void pulse.cancel()
    }
    pulseOpen.value = false
    resetPulseResult()
  }

  function openPulseForSelection() {
    const editor = options.hostPort.activeEditor.value
    if (!editor) return
    const { from, to, empty } = editor.state.selection
    if (empty || from === to) return
    const text = editor.state.doc.textBetween(from, to, '\n', '\n').trim()
    if (!text) return
    pulseSourceKind.value = 'editor_selection'
    pulseActionId.value = 'rewrite'
    setPulseInstruction(pulseDefaultInstruction('rewrite'), { markDirty: false })
    pulseSelectionRange.value = { from, to }
    pulseSourceText.value = text
    resetPulseResult()
    pulseAnchorNonce.value += 1
    pulseOpen.value = true
  }

  async function runPulseFromEditor() {
    if (pulse.running.value) return
    if (!options.hostPort.currentPath.value && pulseSourceKind.value !== 'editor_selection') return
    const sourceText = pulseSourceKind.value === 'editor_selection'
      ? pulseSourceText.value
      : (pulseSourceText.value || (options.hostPort.activeEditor.value?.getText().trim() ?? ''))
    await pulse.run({
      source_kind: pulseSourceKind.value,
      action_id: pulseActionId.value,
      instructions: pulseInstruction.value.trim() || undefined,
      context_paths: pulseSourceKind.value === 'editor_selection' ? [] : [options.hostPort.currentPath.value],
      source_text: sourceText || undefined,
      selection_label: pulseSourceKind.value === 'editor_selection' ? 'Editor selection' : 'Current note'
    })
  }

  function buildSecondBrainPulsePrompt(): string {
    const pulsePrompts: Partial<Record<PulseActionId, string>> = {
      rewrite: 'Rewrite the provided material into a clearer version while preserving the original meaning.',
      condense: 'Condense the provided material into a shorter version that keeps the key information.',
      expand: 'Expand the provided material into a fuller draft with clearer transitions and supporting detail.',
      change_tone: 'Rewrite the provided material in a more appropriate tone while keeping the substance intact.',
      synthesize: 'Synthesize the provided material into a concise, structured summary.',
      outline: 'Turn the provided material into a clear outline with sections and logical progression.',
      brief: 'Draft a working brief from the provided material, including objective, key points, and open questions.'
    }
    const basePrompt = pulsePrompts[pulseActionId.value] ?? 'Transform the provided material into a useful written output.'
    const guidance = pulseInstruction.value.trim()
    const sourceText = (pulseSourceText.value || options.hostPort.activeEditor.value?.getText() || '').trim()
    const quotedSource = sourceText ? `\n\nSource material:\n"""\n${sourceText}\n"""` : ''
    return guidance ? `${basePrompt}\n\nAdditional guidance: ${guidance}${quotedSource}` : `${basePrompt}${quotedSource}`
  }

  function replaceSelectionWithPulseOutput() {
    const editor = options.hostPort.activeEditor.value
    if (!editor || !pulse.previewMarkdown.value.trim() || !pulseSelectionRange.value) return
    editor.chain().focus().setTextSelection(pulseSelectionRange.value).insertContent(pulse.previewMarkdown.value).run()
    closePulsePanel()
  }

  function insertPulseBelow() {
    const editor = options.hostPort.activeEditor.value
    if (!editor || !pulse.previewMarkdown.value.trim()) return
    if (pulseSelectionRange.value) {
      editor
        .chain()
        .focus()
        .setTextSelection({ from: pulseSelectionRange.value.to, to: pulseSelectionRange.value.to })
        .insertContent(`\n\n${pulse.previewMarkdown.value}`)
        .run()
    } else {
      editor.chain().focus('end').insertContent(`\n\n${pulse.previewMarkdown.value}`).run()
    }
    closePulsePanel()
  }

  function sendPulseContextToSecondBrain() {
    if (!options.hostPort.currentPath.value && pulseSourceKind.value !== 'editor_selection') return
    options.emitPort.emitPulseOpenSecondBrain({
      contextPaths: pulseSourceKind.value === 'editor_selection' ? [] : [options.hostPort.currentPath.value],
      prompt: buildSecondBrainPulsePrompt()
    })
    closePulsePanel()
  }

  function resetTransientUiState() {
    options.interactionPort.dismissSlashMenu()
    options.interactionPort.closeWikilinkMenu()
    blockHandleControls.closeBlockMenu()
    blockMenuControls.blockMenuTarget.value = null
    lastStableBlockMenuTarget.value = null
    dragHandleUiState.value = { ...dragHandleUiState.value, activeTarget: null }
    inlineFormatToolbar.dismissToolbar()
    findToolbar.closeToolbar()
    tableInteractions.hideTableToolbarAnchor()
    options.interactionPort.resetWikilinkDataCache()
  }

  function onDocumentMouseDown(event: MouseEvent) {
    const target = event.target
    if (!(target instanceof Node)) return
    const handleRoot = target instanceof Element ? target.closest('.tomosona-block-controls') : null

    if (blockMenuControls.blockMenuOpen.value) {
      if (blockMenuFloatingEl.value?.contains(target)) return
      if (handleRoot) return
      blockHandleControls.closeBlockMenu()
    }

    if (tableInteractions.tableToolbarOpen.value) {
      if (tableToolbarFloatingEl.value?.contains(target)) return
      if (target instanceof Element && target.closest('.tomosona-table-control')) return
      tableInteractions.hideTableToolbar()
    }

    if (pulseOpen.value) {
      if (options.hostPort.pulsePanelWrap.value?.contains(target)) return
      if (target instanceof Element && target.closest('.inline-format-toolbar')) return
      if (target instanceof Element && target.closest('.editor-find-toolbar')) return
      if (target instanceof Element && target.closest('.ui-filterable-dropdown-menu')) return
      closePulsePanel()
    }
  }

  function onDocumentKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && findToolbar.open.value) {
      event.preventDefault()
      event.stopPropagation()
      findToolbar.closeToolbar({ focusEditor: true })
      return
    }
    if (event.key === 'Escape' && pulseOpen.value) {
      closePulsePanel()
    }
  }

  function onHolderPointerDownMarkInteraction() {
    options.interactionPort.markEditorInteraction()
  }

  function onHolderKeydown(event: KeyboardEvent) {
    options.interactionPort.markEditorInteraction()
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      event.stopPropagation()
      findToolbar.openToolbar()
      return
    }
    options.interactionPort.onEditorKeydown(event)
  }

  function onHolderContextMenu(event: MouseEvent) {
    options.interactionPort.markEditorInteraction()
    options.interactionPort.onEditorContextMenu(event)
  }

  function onHolderPaste(event: ClipboardEvent) {
    options.interactionPort.markEditorInteraction()
    options.interactionPort.onEditorPaste(event)
  }

  function onHolderCopy(event: ClipboardEvent) {
    options.interactionPort.markEditorInteraction()
    const root = options.hostPort.holder.value
    if (!root || !event.clipboardData) return
    const payload = extractSelectionClipboardPayload(root)
    if (!payload) return
    event.preventDefault()
    event.stopPropagation()
    event.clipboardData.setData('text/plain', payload.plain)
    event.clipboardData.setData('text/html', payload.html)
    event.clipboardData.setData('text/markdown', payload.markdown)
  }

  async function onInlineToolbarCopyAs(format: CopyAsFormat) {
    const root = options.hostPort.holder.value
    if (!root) return
    const payload = extractSelectionClipboardPayload(root)
    if (!payload) return
    try {
      await writeSelectionPayloadToClipboard(payload, format)
    } catch {
      // Keep UX silent; selection remains available for native copy fallback.
    }
  }

  async function onMountInit() {
    initEditorZoomFromStorage()
    options.hostPort.holder.value?.addEventListener('pointerdown', onHolderPointerDownMarkInteraction, true)
    options.hostPort.holder.value?.addEventListener('keydown', onHolderKeydown, true)
    options.hostPort.holder.value?.addEventListener('keyup', options.interactionPort.onEditorKeyup, true)
    options.hostPort.holder.value?.addEventListener('contextmenu', onHolderContextMenu, true)
    options.hostPort.holder.value?.addEventListener('paste', onHolderPaste, true)
    options.hostPort.holder.value?.addEventListener('copy', onHolderCopy, true)
    options.hostPort.holder.value?.addEventListener('scroll', layoutMetrics.onHolderScroll, true)
    window.addEventListener('resize', layoutMetrics.updateGutterHitboxStyle)
    document.addEventListener('keydown', onDocumentKeydown, true)
    await nextTick()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    layoutMetrics.updateGutterHitboxStyle()
    document.addEventListener('mousedown', onDocumentMouseDown, true)
  }

  async function onUnmountCleanup() {
    tableInteractions.clearTimers()
    if (mermaidReplaceDialog.value.resolve) {
      mermaidReplaceDialog.value.resolve(false)
    }
    options.hostPort.holder.value?.removeEventListener('pointerdown', onHolderPointerDownMarkInteraction, true)
    options.hostPort.holder.value?.removeEventListener('keydown', onHolderKeydown, true)
    options.hostPort.holder.value?.removeEventListener('keyup', options.interactionPort.onEditorKeyup, true)
    options.hostPort.holder.value?.removeEventListener('contextmenu', onHolderContextMenu, true)
    options.hostPort.holder.value?.removeEventListener('paste', onHolderPaste, true)
    options.hostPort.holder.value?.removeEventListener('copy', onHolderCopy, true)
    options.hostPort.holder.value?.removeEventListener('scroll', layoutMetrics.onHolderScroll, true)
    window.removeEventListener('resize', layoutMetrics.updateGutterHitboxStyle)
    document.removeEventListener('mousedown', onDocumentMouseDown, true)
    document.removeEventListener('keydown', onDocumentKeydown, true)
  }

  function onActiveSessionChanged() {
    blockHandleControls.resetLockState()
    findToolbar.syncFromEditor()
  }

  function onDocumentContentChanged() {
    findToolbar.syncFromEditor()
  }

  return {
    titleEditorFocused,
    isLoadingLargeDocument,
    loadStageLabel,
    loadProgressPercent,
    loadProgressIndeterminate,
    loadDocumentStats,
    loadUiState: {
      isLoadingLargeDocument,
      loadStageLabel,
      loadProgressPercent,
      loadProgressIndeterminate,
      loadDocumentStats
    },
    largeDocThreshold: LARGE_DOC_THRESHOLD,
    pulse,
    pulseOpen,
    pulseSourceKind,
    pulseActionId,
    pulseInstruction,
    pulseSourceText,
    pulseSelectionRange,
    mermaidReplaceDialog,
    resolveMermaidReplaceDialog,
    requestMermaidReplaceConfirm,
    pulsePanelStyle,
    renderedEditor,
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
    dragHandleUiState,
    computedDragLock,
    debugTargetPos,
    DRAG_HANDLE_PLUGIN_KEY,
    DRAG_HANDLE_DEBUG,
    TABLE_MARKDOWN_MODE,
    dragHandleComputePositionConfig,
    inlineFormatToolbar,
    findToolbar,
    blockMenuOpen: blockMenuControls.blockMenuOpen,
    blockMenuIndex: blockMenuControls.blockMenuIndex,
    blockMenuTarget: blockMenuControls.blockMenuTarget,
    blockMenuActions: blockMenuControls.actions,
    blockMenuConvertActions: blockMenuControls.convertActions,
    closeBlockMenu: blockHandleControls.closeBlockMenu,
    toggleBlockMenu: blockHandleControls.toggleBlockMenu,
    onBlockMenuPlus: blockHandleControls.onBlockMenuPlus,
    onBlockMenuSelect: blockHandleControls.onBlockMenuSelect,
    onBlockHandleNodeChange: blockHandleControls.onBlockHandleNodeChange,
    onHandleControlsEnter: blockHandleControls.onHandleControlsEnter,
    onHandleControlsLeave: blockHandleControls.onHandleControlsLeave,
    onHandleDragStart: blockHandleControls.onHandleDragStart,
    onHandleDragEnd: blockHandleControls.onHandleDragEnd,
    tableToolbarTriggerVisible: tableControls.tableToolbarTriggerVisible,
    tableAddTopVisible: tableControls.tableAddTopVisible,
    tableAddBottomVisible: tableControls.tableAddBottomVisible,
    tableAddLeftVisible: tableControls.tableAddLeftVisible,
    tableAddRightVisible: tableControls.tableAddRightVisible,
    tableToolbarOpen: tableInteractions.tableToolbarOpen,
    tableToolbarActions: tableInteractions.tableToolbarActions,
    hideTableToolbar: tableInteractions.hideTableToolbar,
    hideTableToolbarAnchor: tableInteractions.hideTableToolbarAnchor,
    updateTableToolbar: tableInteractions.updateTableToolbar,
    onTableToolbarSelect: tableInteractions.onTableToolbarSelect,
    toggleTableToolbar: tableInteractions.toggleTableToolbar,
    addRowAfterFromTrigger: tableInteractions.addRowAfterFromTrigger,
    addRowBeforeFromTrigger: tableInteractions.addRowBeforeFromTrigger,
    addColumnBeforeFromTrigger: tableInteractions.addColumnBeforeFromTrigger,
    addColumnAfterFromTrigger: tableInteractions.addColumnAfterFromTrigger,
    onEditorMouseMove: tableInteractions.onEditorMouseMove,
    onEditorMouseLeave: tableInteractions.onEditorMouseLeave,
    editorZoomStyle,
    initEditorZoomFromStorage,
    zoomEditorBy,
    resetEditorZoom,
    getZoom,
    gutterHitboxStyle: layoutMetrics.gutterHitboxStyle,
    onHolderScroll: layoutMetrics.onHolderScroll,
    updateGutterHitboxStyle: layoutMetrics.updateGutterHitboxStyle,
    resetTransientUiState,
    updateFormattingToolbar,
    focusEditor,
    onActiveSessionChanged,
    onDocumentContentChanged,
    onMountInit,
    onUnmountCleanup,
    openPulseForSelection,
    onInlineToolbarCopyAs,
    onPulseActionChange,
    onPulseInstructionChange,
    setPulseInstruction,
    runPulseFromEditor,
    closePulsePanel,
    replaceSelectionWithPulseOutput,
    insertPulseBelow,
    sendPulseContextToSecondBrain
  }
}
