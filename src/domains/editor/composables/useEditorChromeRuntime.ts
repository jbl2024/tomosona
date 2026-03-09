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

/**
 * Chrome here means the editor UI surrounding document content itself:
 * toolbars, menus, overlays, layout helpers, zoom, Pulse, and DOM listener wiring.
 *
 * This stays as one runtime because those features share transient state and mount/unmount
 * side effects. The simplification goal is internal readability, not splitting more files.
 */

/** Exposes only the host refs and getters chrome needs to render around the editor. */
export type EditorChromeRuntimeHostPort = {
  holder: Ref<HTMLDivElement | null>
  contentShell: Ref<HTMLDivElement | null>
  pulsePanelWrap: Ref<HTMLDivElement | null>
  getCurrentPath: () => string
  getEditor: () => Editor | null
  getSession: (path: string) => DocumentSession | null
}

/** Keeps chrome-facing interaction callbacks grouped by how the chrome consumes them. */
export type EditorChromeRuntimeInteractionPort = {
  menus: {
    closeSlashMenu: () => void
    dismissSlashMenu: () => void
    closeWikilinkMenu: () => void
    openSlashAtSelection: () => void
  }
  editorEvents: {
    onEditorKeydown: (event: KeyboardEvent) => void
    onEditorKeyup: () => void
    onEditorContextMenu: (event: MouseEvent) => void
    onEditorPaste: (event: ClipboardEvent) => void
    markEditorInteraction: () => void
  }
  caches: {
    resetWikilinkDataCache: () => void
  }
}

/** Emits shell-facing chrome actions without leaking internal UI wiring. */
export type EditorChromeRuntimeEmitPort = {
  emitPulseOpenSecondBrain: (payload: { contextPaths: string[]; prompt?: string }) => void
}

/**
 * Owns toolbars, overlays, Pulse UI, and holder/document event wiring around the editor.
 */
export type UseEditorChromeRuntimeOptions = {
  chromeHostPort: EditorChromeRuntimeHostPort
  chromeInteractionPort: EditorChromeRuntimeInteractionPort
  chromeOutputPort: EditorChromeRuntimeEmitPort
}

/**
 * Coordinates editor-adjacent UI concerns while preserving a compact public API for EditorView.
 */
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
  const host = options.chromeHostPort
  const interaction = options.chromeInteractionPort
  const output = options.chromeOutputPort

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

  const renderedEditor = computed(() => host.getEditor())
  const computedDragLock = computed(() => computeHandleLock(dragHandleUiState.value))
  const debugTargetPos = computed(() => String(dragHandleUiState.value.activeTarget?.pos ?? ''))

  const inlineFormatToolbar = useInlineFormatToolbar({
    holder: host.holder,
    getEditor: () => host.getEditor(),
    sanitizeHref: sanitizeExternalHref
  })
  const findToolbar = useEditorFindToolbar({
    holder: host.holder,
    getEditor: () => host.getEditor()
  })

  const blockMenuControls = useBlockMenuControls({
    getEditor: () => renderedEditor.value,
    turnIntoTypes: TURN_INTO_TYPES,
    turnIntoLabels: TURN_INTO_LABELS,
    activeTarget: computed(() => dragHandleUiState.value.activeTarget),
    stableTarget: lastStableBlockMenuTarget
  })
  const blockHandleControls = useEditorBlockHandleControls({
    getEditor: () => host.getEditor(),
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
      host.getEditor()?.commands.setMeta('lockDragHandle', locked)
    },
    closeSlashMenu: () => interaction.menus.closeSlashMenu(),
    closeWikilinkMenu: () => interaction.menus.closeWikilinkMenu(),
    openSlashAtSelection: () => interaction.menus.openSlashAtSelection(),
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
    holder: host.holder,
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
    getEditor: () => host.getEditor(),
    holder: host.holder,
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
    holder: host.holder,
    contentShell: host.contentShell,
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
      const shellEl = host.contentShell.value
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
      const targetReferenceLeft = shellRect.left + shellPaddingLeft - offsetParentLeft - DRAG_HANDLE_CONTENT_EDGE_GAP_PX
      return { x: state.x + (targetReferenceLeft - referenceLeft) }
    }
  }
  const dragHandleComputePositionConfig = {
    placement: 'left-start' as const,
    middleware: [dragHandleLockXMiddleware]
  }

  function focusEditor() {
    host.getEditor()?.commands.focus()
  }

  function updateFormattingToolbar() {
    inlineFormatToolbar.updateFormattingToolbar()
  }

  /**
   * Re-measures the floating Pulse panel after async content settles.
   */
  function updatePulsePanelMetrics() {
    const nextHeight = host.pulsePanelWrap.value?.offsetHeight ?? 0
    if (nextHeight > 0) {
      pulsePanelMeasuredHeight.value = nextHeight
    }
  }

  const pulsePanelStyle = computed<CSSProperties>(() => {
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1440
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900
    const panelWidth = Math.min(420, Math.max(280, viewportWidth - 32))
    const panelHeight = Math.max(220, pulsePanelMeasuredHeight.value)

    if (!pulseOpen.value) {
      return { position: 'fixed', right: '24px', bottom: '24px', width: `${panelWidth}px` }
    }
    if (pulseSourceKind.value !== 'editor_selection' || !host.holder.value) {
      return { position: 'fixed', right: '24px', bottom: '24px', width: `${panelWidth}px` }
    }

    void pulseAnchorNonce.value
    const holderRect = host.holder.value.getBoundingClientRect()
    const anchorTop = holderRect.top + inlineFormatToolbar.formatToolbarTop.value - host.holder.value.scrollTop
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

  watch(
    [
      pulseOpen,
      host.pulsePanelWrap,
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

  /**
   * Opens Pulse only from a real text selection so actions stay anchored to user intent.
   */
  function openPulseForSelection() {
    const editor = host.getEditor()
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

  /**
   * Runs the current Pulse request from the active note or explicit text selection.
   */
  async function runPulseFromEditor() {
    if (pulse.running.value) return
    if (!host.getCurrentPath() && pulseSourceKind.value !== 'editor_selection') return
    const sourceText = pulseSourceKind.value === 'editor_selection'
      ? pulseSourceText.value
      : (pulseSourceText.value || (host.getEditor()?.getText().trim() ?? ''))
    await pulse.run({
      source_kind: pulseSourceKind.value,
      action_id: pulseActionId.value,
      instructions: pulseInstruction.value.trim() || undefined,
      context_paths: pulseSourceKind.value === 'editor_selection' ? [] : [host.getCurrentPath()],
      source_text: sourceText || undefined,
      selection_label: pulseSourceKind.value === 'editor_selection' ? 'Editor selection' : 'Current note'
    })
  }

  /**
   * Builds a Second Brain prompt from the current Pulse action, guidance, and source text.
   */
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
    const sourceText = (pulseSourceText.value || host.getEditor()?.getText() || '').trim()
    const quotedSource = sourceText ? `\n\nSource material:\n"""\n${sourceText}\n"""` : ''
    return guidance ? `${basePrompt}\n\nAdditional guidance: ${guidance}${quotedSource}` : `${basePrompt}${quotedSource}`
  }

  function replaceSelectionWithPulseOutput() {
    const editor = host.getEditor()
    if (!editor || !pulse.previewMarkdown.value.trim() || !pulseSelectionRange.value) return
    editor.chain().focus().setTextSelection(pulseSelectionRange.value).insertContent(pulse.previewMarkdown.value).run()
    closePulsePanel()
  }

  function insertPulseBelow() {
    const editor = host.getEditor()
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
    if (!host.getCurrentPath() && pulseSourceKind.value !== 'editor_selection') return
    output.emitPulseOpenSecondBrain({
      contextPaths: pulseSourceKind.value === 'editor_selection' ? [] : [host.getCurrentPath()],
      prompt: buildSecondBrainPulsePrompt()
    })
    closePulsePanel()
  }

  function closeTransientMenus() {
    interaction.menus.dismissSlashMenu()
    interaction.menus.closeWikilinkMenu()
    blockHandleControls.closeBlockMenu()
    blockMenuControls.blockMenuTarget.value = null
    inlineFormatToolbar.dismissToolbar()
    findToolbar.closeToolbar()
    tableInteractions.hideTableToolbarAnchor()
  }

  function resetDragHandleState() {
    lastStableBlockMenuTarget.value = null
    dragHandleUiState.value = { ...dragHandleUiState.value, activeTarget: null }
  }

  function resetTransientCaches() {
    interaction.caches.resetWikilinkDataCache()
  }

  /**
   * Closes transient editor chrome that should not survive document or selection changes.
   */
  function resetTransientUiState() {
    closeTransientMenus()
    resetDragHandleState()
    resetTransientCaches()
  }

  const documentEvents = {
    onDocumentMouseDown(event: MouseEvent) {
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
        if (host.pulsePanelWrap.value?.contains(target)) return
        if (target instanceof Element && target.closest('.inline-format-toolbar')) return
        if (target instanceof Element && target.closest('.editor-find-toolbar')) return
        if (target instanceof Element && target.closest('.ui-filterable-dropdown-menu')) return
        closePulsePanel()
      }
    },

    onDocumentKeydown(event: KeyboardEvent) {
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
  }

  const holderEvents = {
    onHolderPointerDownMarkInteraction() {
      interaction.editorEvents.markEditorInteraction()
    },

    onHolderKeydown(event: KeyboardEvent) {
      interaction.editorEvents.markEditorInteraction()
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        event.stopPropagation()
        findToolbar.openToolbar()
        return
      }
      interaction.editorEvents.onEditorKeydown(event)
    },

    onHolderContextMenu(event: MouseEvent) {
      interaction.editorEvents.markEditorInteraction()
      interaction.editorEvents.onEditorContextMenu(event)
    },

    onHolderPaste(event: ClipboardEvent) {
      interaction.editorEvents.markEditorInteraction()
      interaction.editorEvents.onEditorPaste(event)
    },

    onHolderCopy(event: ClipboardEvent) {
      interaction.editorEvents.markEditorInteraction()
      const root = host.holder.value
      if (!root || !event.clipboardData) return
      const payload = extractSelectionClipboardPayload(root)
      if (!payload) return
      event.preventDefault()
      event.stopPropagation()
      event.clipboardData.setData('text/plain', payload.plain)
      event.clipboardData.setData('text/html', payload.html)
      event.clipboardData.setData('text/markdown', payload.markdown)
    }
  }

  async function onInlineToolbarCopyAs(format: CopyAsFormat) {
    const root = host.holder.value
    if (!root) return
    const payload = extractSelectionClipboardPayload(root)
    if (!payload) return
    try {
      await writeSelectionPayloadToClipboard(payload, format)
    } catch {
      // Keep UX silent; selection remains available for native copy fallback.
    }
  }

  /**
   * Binds holder/window/document listeners owned by editor chrome.
   */
  function bindChromeEventListeners() {
    host.holder.value?.addEventListener('pointerdown', holderEvents.onHolderPointerDownMarkInteraction, true)
    host.holder.value?.addEventListener('keydown', holderEvents.onHolderKeydown, true)
    host.holder.value?.addEventListener('keyup', interaction.editorEvents.onEditorKeyup, true)
    host.holder.value?.addEventListener('contextmenu', holderEvents.onHolderContextMenu, true)
    host.holder.value?.addEventListener('paste', holderEvents.onHolderPaste, true)
    host.holder.value?.addEventListener('copy', holderEvents.onHolderCopy, true)
    host.holder.value?.addEventListener('scroll', layoutMetrics.onHolderScroll, true)
    window.addEventListener('resize', layoutMetrics.updateGutterHitboxStyle)
    document.addEventListener('keydown', documentEvents.onDocumentKeydown, true)
  }

  /**
   * Removes holder/window/document listeners to avoid stale chrome side effects across mounts.
   */
  function unbindChromeEventListeners() {
    host.holder.value?.removeEventListener('pointerdown', holderEvents.onHolderPointerDownMarkInteraction, true)
    host.holder.value?.removeEventListener('keydown', holderEvents.onHolderKeydown, true)
    host.holder.value?.removeEventListener('keyup', interaction.editorEvents.onEditorKeyup, true)
    host.holder.value?.removeEventListener('contextmenu', holderEvents.onHolderContextMenu, true)
    host.holder.value?.removeEventListener('paste', holderEvents.onHolderPaste, true)
    host.holder.value?.removeEventListener('copy', holderEvents.onHolderCopy, true)
    host.holder.value?.removeEventListener('scroll', layoutMetrics.onHolderScroll, true)
    window.removeEventListener('resize', layoutMetrics.updateGutterHitboxStyle)
    document.removeEventListener('mousedown', documentEvents.onDocumentMouseDown, true)
    document.removeEventListener('keydown', documentEvents.onDocumentKeydown, true)
  }

  async function onMountInit() {
    initEditorZoomFromStorage()
    bindChromeEventListeners()
    await nextTick()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    layoutMetrics.updateGutterHitboxStyle()
    document.addEventListener('mousedown', documentEvents.onDocumentMouseDown, true)
  }

  async function onUnmountCleanup() {
    tableInteractions.clearTimers()
    if (mermaidReplaceDialog.value.resolve) {
      mermaidReplaceDialog.value.resolve(false)
    }
    unbindChromeEventListeners()
  }

  function onActiveSessionChanged() {
    blockHandleControls.resetLockState()
    findToolbar.syncFromEditor()
  }

  function onDocumentContentChanged() {
    findToolbar.syncFromEditor()
  }

  const toolbars = {
    inlineFormatToolbar,
    findToolbar,
    updateFormattingToolbar,
    onInlineToolbarCopyAs,
    onActiveSessionChanged,
    onDocumentContentChanged
  }
  const blockAndTableControls = {
    blockMenuControls,
    blockHandleControls,
    tableControls,
    tableGeometry,
    tableInteractions,
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
    closeBlockMenu: blockHandleControls.closeBlockMenu,
    hideTableToolbar: tableInteractions.hideTableToolbar,
    toggleTableToolbar: tableInteractions.toggleTableToolbar,
    onEditorMouseMove: tableInteractions.onEditorMouseMove,
    onEditorMouseLeave: tableInteractions.onEditorMouseLeave
  }
  const layoutAndZoom = {
    layoutMetrics,
    editorZoomStyle,
    zoomEditorBy,
    resetEditorZoom,
    getZoom,
    focusEditor,
    updateGutterHitboxStyle: layoutMetrics.updateGutterHitboxStyle
  }
  const pulseAndDialogs = {
    pulse,
    pulseOpen,
    pulseSourceKind,
    pulseActionId,
    pulseInstruction,
    pulseSourceText,
    pulseSelectionRange,
    mermaidReplaceDialog,
    requestMermaidReplaceConfirm,
    pulsePanelStyle,
    updatePulsePanelMetrics,
    openPulseForSelection,
    runPulseFromEditor,
    replaceSelectionWithPulseOutput,
    insertPulseBelow,
    sendPulseContextToSecondBrain,
    closePulsePanel,
    onPulseActionChange,
    onPulseInstructionChange,
    setPulseInstruction
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
    pulse: pulseAndDialogs.pulse,
    pulseOpen: pulseAndDialogs.pulseOpen,
    pulseSourceKind: pulseAndDialogs.pulseSourceKind,
    pulseActionId: pulseAndDialogs.pulseActionId,
    pulseInstruction: pulseAndDialogs.pulseInstruction,
    pulseSourceText: pulseAndDialogs.pulseSourceText,
    pulseSelectionRange: pulseAndDialogs.pulseSelectionRange,
    mermaidReplaceDialog: pulseAndDialogs.mermaidReplaceDialog,
    resolveMermaidReplaceDialog,
    requestMermaidReplaceConfirm: pulseAndDialogs.requestMermaidReplaceConfirm,
    pulsePanelStyle: pulseAndDialogs.pulsePanelStyle,
    renderedEditor,
    blockMenuFloatingEl: blockAndTableControls.blockMenuFloatingEl,
    tableToolbarFloatingEl: blockAndTableControls.tableToolbarFloatingEl,
    blockMenuPos: blockAndTableControls.blockMenuPos,
    tableMenuBtnLeft: blockAndTableControls.tableMenuBtnLeft,
    tableMenuBtnTop: blockAndTableControls.tableMenuBtnTop,
    tableBoxLeft: blockAndTableControls.tableBoxLeft,
    tableBoxTop: blockAndTableControls.tableBoxTop,
    tableBoxWidth: blockAndTableControls.tableBoxWidth,
    tableBoxHeight: blockAndTableControls.tableBoxHeight,
    tableToolbarViewportLeft: blockAndTableControls.tableToolbarViewportLeft,
    tableToolbarViewportTop: blockAndTableControls.tableToolbarViewportTop,
    tableToolbarViewportMaxHeight: blockAndTableControls.tableToolbarViewportMaxHeight,
    dragHandleUiState: blockAndTableControls.dragHandleUiState,
    computedDragLock: blockAndTableControls.computedDragLock,
    debugTargetPos: blockAndTableControls.debugTargetPos,
    DRAG_HANDLE_PLUGIN_KEY,
    DRAG_HANDLE_DEBUG,
    TABLE_MARKDOWN_MODE,
    dragHandleComputePositionConfig,
    inlineFormatToolbar: toolbars.inlineFormatToolbar,
    findToolbar: toolbars.findToolbar,
    blockMenuOpen: blockAndTableControls.blockMenuControls.blockMenuOpen,
    blockMenuIndex: blockAndTableControls.blockMenuControls.blockMenuIndex,
    blockMenuTarget: blockAndTableControls.blockMenuControls.blockMenuTarget,
    blockMenuActions: blockAndTableControls.blockMenuControls.actions,
    blockMenuConvertActions: blockAndTableControls.blockMenuControls.convertActions,
    closeBlockMenu: blockAndTableControls.blockHandleControls.closeBlockMenu,
    toggleBlockMenu: blockAndTableControls.blockHandleControls.toggleBlockMenu,
    onBlockMenuPlus: blockAndTableControls.blockHandleControls.onBlockMenuPlus,
    onBlockMenuSelect: blockAndTableControls.blockHandleControls.onBlockMenuSelect,
    onBlockHandleNodeChange: blockAndTableControls.blockHandleControls.onBlockHandleNodeChange,
    onHandleControlsEnter: blockAndTableControls.blockHandleControls.onHandleControlsEnter,
    onHandleControlsLeave: blockAndTableControls.blockHandleControls.onHandleControlsLeave,
    onHandleDragStart: blockAndTableControls.blockHandleControls.onHandleDragStart,
    onHandleDragEnd: blockAndTableControls.blockHandleControls.onHandleDragEnd,
    tableToolbarTriggerVisible: blockAndTableControls.tableControls.tableToolbarTriggerVisible,
    tableAddTopVisible: blockAndTableControls.tableControls.tableAddTopVisible,
    tableAddBottomVisible: blockAndTableControls.tableControls.tableAddBottomVisible,
    tableAddLeftVisible: blockAndTableControls.tableControls.tableAddLeftVisible,
    tableAddRightVisible: blockAndTableControls.tableControls.tableAddRightVisible,
    tableToolbarOpen: blockAndTableControls.tableInteractions.tableToolbarOpen,
    tableToolbarActions: blockAndTableControls.tableInteractions.tableToolbarActions,
    hideTableToolbar: blockAndTableControls.tableInteractions.hideTableToolbar,
    hideTableToolbarAnchor: blockAndTableControls.tableInteractions.hideTableToolbarAnchor,
    updateTableToolbar: blockAndTableControls.tableInteractions.updateTableToolbar,
    onTableToolbarSelect: blockAndTableControls.tableInteractions.onTableToolbarSelect,
    toggleTableToolbar: blockAndTableControls.tableInteractions.toggleTableToolbar,
    addRowAfterFromTrigger: blockAndTableControls.tableInteractions.addRowAfterFromTrigger,
    addRowBeforeFromTrigger: blockAndTableControls.tableInteractions.addRowBeforeFromTrigger,
    addColumnBeforeFromTrigger: blockAndTableControls.tableInteractions.addColumnBeforeFromTrigger,
    addColumnAfterFromTrigger: blockAndTableControls.tableInteractions.addColumnAfterFromTrigger,
    onEditorMouseMove: blockAndTableControls.onEditorMouseMove,
    onEditorMouseLeave: blockAndTableControls.onEditorMouseLeave,
    editorZoomStyle: layoutAndZoom.editorZoomStyle,
    initEditorZoomFromStorage,
    zoomEditorBy: layoutAndZoom.zoomEditorBy,
    resetEditorZoom: layoutAndZoom.resetEditorZoom,
    getZoom: layoutAndZoom.getZoom,
    gutterHitboxStyle: layoutAndZoom.layoutMetrics.gutterHitboxStyle,
    onHolderScroll: layoutAndZoom.layoutMetrics.onHolderScroll,
    updateGutterHitboxStyle: layoutAndZoom.updateGutterHitboxStyle,
    resetTransientUiState,
    updateFormattingToolbar: toolbars.updateFormattingToolbar,
    focusEditor: layoutAndZoom.focusEditor,
    onActiveSessionChanged: toolbars.onActiveSessionChanged,
    onDocumentContentChanged: toolbars.onDocumentContentChanged,
    onMountInit,
    onUnmountCleanup,
    openPulseForSelection: pulseAndDialogs.openPulseForSelection,
    onInlineToolbarCopyAs: toolbars.onInlineToolbarCopyAs,
    onPulseActionChange: pulseAndDialogs.onPulseActionChange,
    onPulseInstructionChange: pulseAndDialogs.onPulseInstructionChange,
    setPulseInstruction: pulseAndDialogs.setPulseInstruction,
    runPulseFromEditor: pulseAndDialogs.runPulseFromEditor,
    closePulsePanel: pulseAndDialogs.closePulsePanel,
    replaceSelectionWithPulseOutput: pulseAndDialogs.replaceSelectionWithPulseOutput,
    insertPulseBelow: pulseAndDialogs.insertPulseBelow,
    sendPulseContextToSecondBrain: pulseAndDialogs.sendPulseContextToSecondBrain
  }
}
