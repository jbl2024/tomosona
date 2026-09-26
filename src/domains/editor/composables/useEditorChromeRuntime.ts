import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { BlockMenuActionItem, BlockMenuTarget, TurnIntoType } from '../lib/tiptap/blockMenu/types'
import {
  deleteNode,
  deleteNodes,
  duplicateNode,
  duplicateNodes,
  insertAbove,
  insertBelow,
  moveNodeDown,
  moveNodeUp,
  moveNodesDown,
  moveNodesUp,
  turnInto,
  turnIntoAll
} from '../lib/tiptap/blockMenu/actions'
import { extractSelectionClipboardPayload, writeSelectionPayloadToClipboard, type CopyAsFormat } from '../lib/editorClipboard'
import { sanitizeExternalHref } from '../lib/markdownBlocks'
import { useInlineFormatToolbar } from './useInlineFormatToolbar'
import { useEditorFindToolbar } from './useEditorFindToolbar'
import { useBlockMenuControls } from './useBlockMenuControls'
import { useEditorBlockGutterController } from './useEditorBlockGutterController'
import { useTableToolbarControls } from './useTableToolbarControls'
import { useEditorTableGeometry } from './useEditorTableGeometry'
import { useEditorTableInteractions } from './useEditorTableInteractions'
import { useEditorLayoutMetrics } from './useEditorLayoutMetrics'
import { useEditorZoom } from './useEditorZoom'
import { useEditorContentFocus } from './useEditorContentFocus'
import { useMermaidPreviewDialog } from './useMermaidPreviewDialog'
import { useAssetPreviewDialog } from './useAssetPreviewDialog'
import { useMermaidReplaceDialog } from './useMermaidReplaceDialog'
import type { DocumentSession } from './useDocumentEditorSessions'
import type { SpellcheckLanguage } from '../lib/spellcheck'
import {
  getSpellcheckSuggestions,
  rankSpellcheckSuggestions,
  resolveSpellcheckSuggestionPresentation,
  getSpellcheckWordHitAtPos,
  normalizeSpellcheckToken
} from '../lib/tiptap/extensions/Spellcheck'

/**
 * Chrome here means the editor UI surrounding document content itself:
 * toolbars, menus, overlays, layout helpers, zoom, and DOM listener wiring.
 *
 * This stays as one runtime because those features share transient state and mount/unmount
 * side effects. The simplification goal is internal readability, not splitting more files.
 */

/** Exposes only the host refs and getters chrome needs to render around the editor. */
export type EditorChromeRuntimeHostPort = {
  holder: Ref<HTMLDivElement | null>
  contentShell: Ref<HTMLDivElement | null>
  currentPath: Ref<string>
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
  spellcheck: {
    addIgnoredWord: (word: string) => void
    refreshForPath: (path: string) => void
  }
}

/**
 * Owns toolbars, overlays, and holder/document event wiring around the editor.
 */
export type UseEditorChromeRuntimeOptions = {
  chromeHostPort: EditorChromeRuntimeHostPort
  chromeInteractionPort: EditorChromeRuntimeInteractionPort
}

/**
 * Coordinates editor-adjacent UI concerns behind a grouped public API so
 * EditorView can consume stable sub-systems instead of a flat callback bag.
 *
 */
export function useEditorChromeRuntime(options: UseEditorChromeRuntimeOptions) {
  const TABLE_EDGE_SHOW_THRESHOLD = 20
  const TABLE_EDGE_STICKY_THRESHOLD = 44
  const TABLE_EDGE_STICKY_MS = 280
  const TABLE_MARKDOWN_MODE = true
  const LARGE_DOC_THRESHOLD = 40_000
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
  let mountSequence = 0
  let pendingDocumentMouseDownRaf: number | null = null

  const titleEditorFocused = ref(false)
  const isLoadingLargeDocument = ref(false)
  const loadStageLabel = ref('')
  const loadProgressPercent = ref(0)
  const loadProgressIndeterminate = ref(false)
  const loadDocumentStats = ref<{ chars: number; lines: number } | null>(null)
  const blockMenuFloatingEl = ref<HTMLDivElement | null>(null)
  const blockMenuPos = ref({ x: 0, y: 0 })
  const tableToolbarFloatingEl = ref<HTMLDivElement | null>(null)
  const tableToolbarLeft = ref(0)
  const tableToolbarTop = ref(0)
  const tableToolbarViewportLeft = ref(0)
  const tableToolbarViewportTop = ref(0)
  const tableToolbarViewportMaxHeight = ref(420)
  const spellcheckMenuOpen = ref(false)
  const spellcheckMenuFloatingEl = ref<HTMLDivElement | null>(null)
  const spellcheckMenuLeft = ref(0)
  const spellcheckMenuTop = ref(0)
  const spellcheckMenuMode = ref<'single' | 'list'>('list')
  const spellcheckMenuWord = ref('')
  const spellcheckMenuLanguage = ref<SpellcheckLanguage>('en')
  const spellcheckMenuRange = ref<{ from: number; to: number } | null>(null)
  const spellcheckMenuPrimarySuggestion = ref('')
  const spellcheckMenuSuggestions = ref<string[]>([])
  const spellcheckMenuLoading = ref(false)
  let spellcheckMenuRequestNonce = 0
  const spellcheckSessionIgnoredWords = ref(new Set<string>())
  const spellcheckMenuAnchorLeft = ref(0)
  const spellcheckMenuAnchorTop = ref(0)
  const spellcheckMenuAnchorBottom = ref(0)
  const spellcheckMenuAnchorReady = ref(false)
  const tableMenuBtnLeft = ref(0)
  const tableMenuBtnTop = ref(0)
  const tableBoxLeft = ref(0)
  const tableBoxTop = ref(0)
  const tableBoxWidth = ref(0)
  const tableBoxHeight = ref(0)
  let layoutResizeObserver: ResizeObserver | null = null

  const renderedEditor = computed(() => host.getEditor())

  const blockGutter = useEditorBlockGutterController({
    getEditor: () => renderedEditor.value,
    holder: host.holder,
    titleEditorFocused
  })

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
    target: computed(() => blockGutter.activeTarget.value)
  })

  function closeBlockMenu() {
    if (!blockGutter.menuOpen.value && blockMenuControls.blockMenuIndex.value === 0) {
      return
    }
    blockMenuControls.blockMenuIndex.value = 0
    blockGutter.closeMenu()
  }

  function positionBlockMenuFromTrigger(trigger: HTMLElement) {
    const rect = trigger.getBoundingClientRect()
    const estimatedWidth = 260
    const estimatedHeight = 360
    const maxX = Math.max(12, window.innerWidth - estimatedWidth - 12)
    const maxY = Math.max(12, window.innerHeight - estimatedHeight - 12)
    blockMenuPos.value = {
      x: Math.max(12, Math.min(rect.right + 8, maxX)),
      y: Math.max(12, Math.min(rect.top, maxY)),
    }
  }

  function toggleBlockMenu(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (!blockGutter.target.value) return

    if (blockGutter.menuOpen.value) {
      closeBlockMenu()
      return
    }

    if (event.currentTarget instanceof HTMLElement) {
      positionBlockMenuFromTrigger(event.currentTarget)
    }

    interaction.menus.closeSlashMenu()
    interaction.menus.closeWikilinkMenu()
    blockMenuControls.blockMenuIndex.value = 0
    blockGutter.openMenu()
  }

  function onBlockMenuPlus(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    const editor = host.getEditor()
    const target = blockGutter.target.value
    if (!editor || !target) return
    interaction.menus.closeSlashMenu()
    interaction.menus.closeWikilinkMenu()
    insertBelow(editor, target)
    interaction.menus.openSlashAtSelection()
    blockGutter.syncSelectionTarget()
  }

  function copyTextToClipboard(text: string) {
    if (!navigator.clipboard?.writeText) return
    void navigator.clipboard.writeText(text)
  }

  function copyAnchorTarget(target: BlockMenuTarget) {
    if (!target.text.trim()) return
    copyTextToClipboard(`[[#${target.text.trim()}]]`)
  }

  function onBlockMenuSelect(item: BlockMenuActionItem) {
    const editor = host.getEditor()
    const target = blockMenuControls.actionTarget.value
    if (!editor || !target || item.disabled) return
    const selectionTargets = blockGutter.selectionTargets.value.filter((entry) => entry.pos >= 0)
    const multiTargets = selectionTargets.length > 1 ? selectionTargets : []

    if (item.actionId === 'insert_above') insertAbove(editor, target)
    if (item.actionId === 'insert_below') insertBelow(editor, target)
    if (item.actionId === 'move_up') {
      if (multiTargets.length > 0) {
        moveNodesUp(editor, multiTargets)
      } else {
        moveNodeUp(editor, target)
      }
    }
    if (item.actionId === 'move_down') {
      if (multiTargets.length > 0) {
        moveNodesDown(editor, multiTargets)
      } else {
        moveNodeDown(editor, target)
      }
    }
    if (item.actionId === 'duplicate') {
      if (multiTargets.length > 0) {
        duplicateNodes(editor, multiTargets)
      } else {
        duplicateNode(editor, target)
      }
    }
    if (item.actionId === 'delete') {
      if (multiTargets.length > 0) {
        deleteNodes(editor, multiTargets)
      } else {
        deleteNode(editor, target)
      }
    }
    if (item.actionId === 'copy_anchor') copyAnchorTarget(target)
    if (item.actionId === 'turn_into' && item.turnIntoType) {
      const allTargets = multiTargets.length > 0 ? multiTargets : blockGutter.menuTargets.value
      if (allTargets.length > 1) {
        turnIntoAll(editor, allTargets, item.turnIntoType)
      } else {
        turnInto(editor, target, item.turnIntoType)
      }
    }

    closeBlockMenu()
    blockGutter.syncSelectionTarget()
  }

  watch(titleEditorFocused, (focused) => {
    if (focused) {
      closeBlockMenu()
      blockGutter.syncContentFocus()
      return
    }
    blockGutter.syncSelectionTarget()
  })

  function closeSpellcheckMenu() {
    spellcheckMenuOpen.value = false
    spellcheckMenuLeft.value = 0
    spellcheckMenuTop.value = 0
    spellcheckMenuMode.value = 'list'
    spellcheckMenuWord.value = ''
    spellcheckMenuLanguage.value = 'en'
    spellcheckMenuRange.value = null
    spellcheckMenuPrimarySuggestion.value = ''
    spellcheckMenuSuggestions.value = []
    spellcheckMenuLoading.value = false
    spellcheckMenuAnchorLeft.value = 0
    spellcheckMenuAnchorTop.value = 0
    spellcheckMenuAnchorBottom.value = 0
    spellcheckMenuAnchorReady.value = false
    spellcheckMenuRequestNonce += 1
  }

  function getSpellcheckMenuAnchor(editor: Editor, from: number, to: number) {
    try {
      const fromCoords = editor.view.coordsAtPos(from)
      const toCoords = editor.view.coordsAtPos(to)
      return {
        left: fromCoords.left,
        top: fromCoords.top,
        bottom: toCoords.bottom
      }
    } catch {
      return null
    }
  }

  function estimateSpellcheckMenuSize(mode: 'single' | 'list', suggestionCount: number) {
    if (mode === 'single') {
      return { width: 320, height: 136 }
    }

    const rows = Math.max(1, suggestionCount) + 1
    return {
      width: 540,
      height: Math.min(420, 96 + rows * 40)
    }
  }

  function positionSpellcheckMenu() {
    if (!spellcheckMenuOpen.value) return
    if (!spellcheckMenuAnchorReady.value) return
    const anchorLeft = spellcheckMenuAnchorLeft.value
    const anchorTop = spellcheckMenuAnchorTop.value
    const anchorBottom = spellcheckMenuAnchorBottom.value

    const bounds = spellcheckMenuFloatingEl.value?.getBoundingClientRect()
    const estimate = estimateSpellcheckMenuSize(spellcheckMenuMode.value, spellcheckMenuSuggestions.value.length)
    const width = bounds?.width ?? estimate.width
    const height = bounds?.height ?? estimate.height
    const viewportPadding = 8
    const left = Math.min(
      Math.max(viewportPadding, anchorLeft),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
    )
    const belowTop = anchorBottom + 8
    const aboveTop = anchorTop - height - 8
    const fitsBelow = belowTop + height <= window.innerHeight - viewportPadding
    const top = fitsBelow ? belowTop : Math.max(viewportPadding, aboveTop)

    spellcheckMenuLeft.value = left
    spellcheckMenuTop.value = top
  }

  function onSpellcheckMenuLoaded() {
    requestAnimationFrame(() => {
      positionSpellcheckMenu()
      const focusTarget = spellcheckMenuFloatingEl.value?.querySelector<HTMLButtonElement>('button:not([disabled])')
      focusTarget?.focus()
    })
  }

  async function openSpellcheckMenuFromContextMenu(_event: MouseEvent, hit: { from: number; to: number; word: string; language: SpellcheckLanguage }) {
    const editor = host.getEditor()
    closeTransientMenus()
    spellcheckMenuRequestNonce += 1
    const requestNonce = spellcheckMenuRequestNonce
    spellcheckMenuLoading.value = true
    const suggestions = await getSpellcheckSuggestions(hit.language, hit.word)
    if (spellcheckMenuRequestNonce !== requestNonce) return

    const presentation = resolveSpellcheckSuggestionPresentation(hit.word, suggestions)
    const normalizedWord = normalizeSpellcheckToken(hit.word)
    const displaySuggestions = presentation.mode === 'list'
      ? rankSpellcheckSuggestions(hit.word, suggestions)
          .map((entry) => entry.suggestion)
          .filter((suggestion) => normalizeSpellcheckToken(suggestion) !== normalizedWord)
      : []

    spellcheckMenuMode.value = presentation.mode
    spellcheckMenuPrimarySuggestion.value = presentation.primarySuggestion ?? ''
    spellcheckMenuSuggestions.value = displaySuggestions
    spellcheckMenuWord.value = hit.word
    spellcheckMenuLanguage.value = hit.language
    spellcheckMenuRange.value = { from: hit.from, to: hit.to }
    spellcheckMenuAnchorLeft.value = 0
    spellcheckMenuAnchorTop.value = 0
    spellcheckMenuAnchorBottom.value = 0

    const anchor = editor ? getSpellcheckMenuAnchor(editor, hit.from, hit.to) : null
    if (anchor) {
      spellcheckMenuAnchorLeft.value = anchor.left
      spellcheckMenuAnchorTop.value = anchor.top
      spellcheckMenuAnchorBottom.value = anchor.bottom
      spellcheckMenuAnchorReady.value = true
      positionSpellcheckMenu()
    }

    spellcheckMenuOpen.value = true
    spellcheckMenuLoading.value = false
    onSpellcheckMenuLoaded()
  }

  function replaceSpellcheckWord(suggestion: string) {
    const editor = host.getEditor()
    const range = spellcheckMenuRange.value
    if (!editor || !range) return
    editor.commands.insertContentAt(range, suggestion)
    closeSpellcheckMenu()
  }

  function ignoreSpellcheckWord() {
    const word = spellcheckMenuWord.value
    if (!word) return
    spellcheckSessionIgnoredWords.value = new Set([...spellcheckSessionIgnoredWords.value, normalizeSpellcheckToken(word)])
    interaction.spellcheck.refreshForPath(host.getCurrentPath())
    closeSpellcheckMenu()
  }

  function addSpellcheckWordToWorkspaceDictionary() {
    const word = spellcheckMenuWord.value
    if (!word) return
    interaction.spellcheck.addIgnoredWord(word)
    closeSpellcheckMenu()
  }

  function isSessionIgnoredWord(word: string) {
    return spellcheckSessionIgnoredWords.value.has(normalizeSpellcheckToken(word))
  }

  watch(
    () => host.currentPath.value,
    () => {
      spellcheckSessionIgnoredWords.value = new Set()
      closeSpellcheckMenu()
    }
  )

  watch([spellcheckMenuOpen, spellcheckMenuFloatingEl, spellcheckMenuMode, spellcheckMenuSuggestions], async ([open]) => {
    if (!open) return
    await nextTick()
    positionSpellcheckMenu()
  }, { flush: 'post' })

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
    onScrollSync: () => {
      updateFormattingToolbar()
      tableInteractions.updateTableToolbar()
      blockGutter.syncAnchor()
    }
  })
  const {
    editorZoomStyle,
    initFromStorage: initEditorZoomFromStorage,
    zoomBy: zoomEditorBy,
    resetZoom: resetEditorZoom,
    getZoom
  } = useEditorZoom()
  const contentFocus = useEditorContentFocus({
    holder: host.holder,
    getEditor: () => host.getEditor()
  })

  const { mermaidReplaceDialog, resolveMermaidReplaceDialog, requestMermaidReplaceConfirm } = useMermaidReplaceDialog()
  const {
    mermaidPreviewDialog,
    openMermaidPreview,
    closeMermaidPreview,
    exportMermaidSvg,
    exportMermaidPng
  } = useMermaidPreviewDialog()
  const {
    assetPreviewDialog,
    openAssetPreview,
    closeAssetPreview
  } = useAssetPreviewDialog()

  function updateFormattingToolbar() {
    inlineFormatToolbar.updateFormattingToolbar()
  }

  function setPointerSelectionActive(active: boolean) {
    inlineFormatToolbar.setPointerSelectionActive(active)
  }

  function syncLayoutGeometry() {
    layoutMetrics.updateGutterHitboxStyle()
    updateFormattingToolbar()
  }

  watch(editorZoomStyle, () => {
    void nextTick().then(() => {
      layoutMetrics.updateGutterHitboxStyle()
    })
  }, { deep: true })

  function observeLayoutResize() {
    layoutResizeObserver?.disconnect()
    layoutResizeObserver = null
    if (typeof ResizeObserver === 'undefined') return
    const targets: HTMLElement[] = []
    if (host.holder.value) targets.push(host.holder.value)
    if (host.contentShell.value) targets.push(host.contentShell.value)
    if (!targets.length) return
    layoutResizeObserver = new ResizeObserver(() => {
      syncLayoutGeometry()
    })
    for (const target of targets) {
      layoutResizeObserver.observe(target)
    }
  }

  onMounted(() => {
    observeLayoutResize()
  })

  onBeforeUnmount(() => {
    layoutResizeObserver?.disconnect()
    layoutResizeObserver = null
  })

  function closeTransientMenus() {
    interaction.menus.dismissSlashMenu()
    interaction.menus.closeWikilinkMenu()
    closeSpellcheckMenu()
    closeBlockMenu()
    inlineFormatToolbar.dismissToolbar()
    findToolbar.closeToolbar()
    tableInteractions.hideTableToolbarAnchor()
  }

  function resetDragHandleState() {
    blockGutter.clear()
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
    closeMermaidPreview()
    closeAssetPreview()
  }

  const documentEvents = {
    onDocumentMouseDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      const handleRoot = target instanceof Element ? target.closest('.tomosona-block-controls') : null

      if (blockGutter.menuOpen.value) {
        if (blockMenuFloatingEl.value?.contains(target)) return
        if (handleRoot) return
        closeBlockMenu()
      }

      if (spellcheckMenuOpen.value) {
        if (spellcheckMenuFloatingEl.value?.contains(target)) return
        closeSpellcheckMenu()
      }

      if (tableInteractions.tableToolbarOpen.value) {
        if (tableToolbarFloatingEl.value?.contains(target)) return
        if (target instanceof Element && target.closest('.tomosona-table-control')) return
        tableInteractions.hideTableToolbar()
      }
    },

    onDocumentPointerUp(event: PointerEvent) {
      if (event.button !== 0) return
      setPointerSelectionActive(false)
      updateFormattingToolbar()
    },

    onDocumentPointerCancel() {
      setPointerSelectionActive(false)
    },

    onDocumentKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && findToolbar.open.value) {
        event.preventDefault()
        event.stopPropagation()
        findToolbar.closeToolbar({ focusEditor: true })
        return
      }
      if (event.key === 'Escape' && mermaidPreviewDialog.value.visible) {
        closeMermaidPreview()
        return
      }
      if (event.key === 'Escape' && assetPreviewDialog.value.visible) {
        closeAssetPreview()
        return
      }
    }
  }

  const holderEvents = {
    isTitleFieldEventTarget(target: EventTarget | null) {
      const element = target instanceof Element
        ? target
        : target instanceof Node
          ? target.parentElement
          : null
      return Boolean(element?.closest('.editor-title-field'))
    },

    onHolderPointerDownMarkInteraction(event: PointerEvent) {
      interaction.editorEvents.markEditorInteraction()
      if (event.button !== 0) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.inline-format-toolbar')) return
      if (target.closest('.editor-find-toolbar')) return
      if (target.closest('.ProseMirror')) {
        setPointerSelectionActive(true)
      }
    },

    onHolderFocusIn() {
      blockGutter.syncSelectionTarget()
    },

    onHolderFocusOut() {
      window.setTimeout(() => {
        blockGutter.syncContentFocus()
      }, 0)
    },

    onHolderKeydown(event: KeyboardEvent) {
      if (holderEvents.isTitleFieldEventTarget(event.target)) return
      interaction.editorEvents.markEditorInteraction()
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        event.stopPropagation()
        findToolbar.openToolbar()
        return
      }
      interaction.editorEvents.onEditorKeydown(event)
    },

    onHolderKeyup(event: KeyboardEvent) {
      if (holderEvents.isTitleFieldEventTarget(event.target)) return
      interaction.editorEvents.onEditorKeyup()
    },

    onHolderContextMenu(event: MouseEvent) {
      interaction.editorEvents.markEditorInteraction()
      const editor = host.getEditor()
      if (editor) {
        const position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (position) {
          const hit = getSpellcheckWordHitAtPos(editor.state, position.pos)
          if (hit) {
            event.preventDefault()
            event.stopPropagation()
            void openSpellcheckMenuFromContextMenu(event, hit)
            return
          }
        }
      }
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
    host.holder.value?.addEventListener('focusin', holderEvents.onHolderFocusIn, true)
    host.holder.value?.addEventListener('focusout', holderEvents.onHolderFocusOut, true)
    host.holder.value?.addEventListener('keydown', holderEvents.onHolderKeydown, true)
    host.holder.value?.addEventListener('keyup', holderEvents.onHolderKeyup, true)
    host.holder.value?.addEventListener('contextmenu', holderEvents.onHolderContextMenu, true)
    host.holder.value?.addEventListener('paste', holderEvents.onHolderPaste, true)
    host.holder.value?.addEventListener('copy', holderEvents.onHolderCopy, true)
    host.holder.value?.addEventListener('scroll', layoutMetrics.onHolderScroll, true)
    window.addEventListener('resize', layoutMetrics.updateGutterHitboxStyle)
    window.addEventListener('resize', blockGutter.syncAnchor)
    document.addEventListener('pointerup', documentEvents.onDocumentPointerUp, true)
    document.addEventListener('pointercancel', documentEvents.onDocumentPointerCancel, true)
    document.addEventListener('keydown', documentEvents.onDocumentKeydown, true)
  }

  /**
   * Removes holder/window/document listeners to avoid stale chrome side effects across mounts.
   */
  function unbindChromeEventListeners() {
    host.holder.value?.removeEventListener('pointerdown', holderEvents.onHolderPointerDownMarkInteraction, true)
    host.holder.value?.removeEventListener('focusin', holderEvents.onHolderFocusIn, true)
    host.holder.value?.removeEventListener('focusout', holderEvents.onHolderFocusOut, true)
    host.holder.value?.removeEventListener('keydown', holderEvents.onHolderKeydown, true)
    host.holder.value?.removeEventListener('keyup', holderEvents.onHolderKeyup, true)
    host.holder.value?.removeEventListener('contextmenu', holderEvents.onHolderContextMenu, true)
    host.holder.value?.removeEventListener('paste', holderEvents.onHolderPaste, true)
    host.holder.value?.removeEventListener('copy', holderEvents.onHolderCopy, true)
    host.holder.value?.removeEventListener('scroll', layoutMetrics.onHolderScroll, true)
    window.removeEventListener('resize', layoutMetrics.updateGutterHitboxStyle)
    window.removeEventListener('resize', blockGutter.syncAnchor)
    document.removeEventListener('pointerup', documentEvents.onDocumentPointerUp, true)
    document.removeEventListener('pointercancel', documentEvents.onDocumentPointerCancel, true)
    document.removeEventListener('mousedown', documentEvents.onDocumentMouseDown, true)
    document.removeEventListener('keydown', documentEvents.onDocumentKeydown, true)
  }

  function cancelPendingDocumentMouseDownBind() {
    if (pendingDocumentMouseDownRaf === null) return
    const cancelRaf = typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame
      : (id: number) => window.clearTimeout(id)
    cancelRaf(pendingDocumentMouseDownRaf)
    pendingDocumentMouseDownRaf = null
  }

  /**
   * Defers document-level click dismissal until the first paint so floating UI
   * anchors exist, while still allowing teardown to cancel the pending bind.
   */
  function waitForDocumentMouseDownBindFrame(sequence: number) {
    return new Promise<void>((resolve) => {
      const requestRaf = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16)
      pendingDocumentMouseDownRaf = requestRaf(() => {
        pendingDocumentMouseDownRaf = null
        if (sequence !== mountSequence) {
          resolve()
          return
        }
        layoutMetrics.updateGutterHitboxStyle()
        document.addEventListener('mousedown', documentEvents.onDocumentMouseDown, true)
        resolve()
      })
    })
  }

  async function onMountInit() {
    const sequence = ++mountSequence
    initEditorZoomFromStorage()
    bindChromeEventListeners()
    await nextTick()
    blockGutter.syncSelectionTarget()
    await waitForDocumentMouseDownBindFrame(sequence)
  }

  async function onUnmountCleanup() {
    mountSequence += 1
    cancelPendingDocumentMouseDownBind()
    blockGutter.clear()
    tableInteractions.clearTimers()
    if (mermaidReplaceDialog.value.resolve) {
      mermaidReplaceDialog.value.resolve(false)
    }
    unbindChromeEventListeners()
  }

  function onActiveSessionChanged() {
    blockGutter.clear()
    blockGutter.syncSelectionTarget()
    findToolbar.syncFromEditor()
  }

  function onDocumentContentChanged() {
    findToolbar.syncFromEditor()
    blockGutter.syncAnchor()
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
    blockGutter,
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
    closeBlockMenu,
    toggleBlockMenu,
    onBlockMenuPlus,
    onBlockMenuSelect,
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
    focusEditor: contentFocus.focusEditor,
    focusFirstEditableBlock: contentFocus.focusFirstEditableBlock,
    updateGutterHitboxStyle: layoutMetrics.updateGutterHitboxStyle
  }
  const dialogs = {
    mermaidReplaceDialog,
    mermaidPreviewDialog,
    assetPreviewDialog,
    requestMermaidReplaceConfirm,
    openMermaidPreview,
    closeMermaidPreview,
    openAssetPreview,
    closeAssetPreview,
    exportMermaidSvg,
    exportMermaidPng,
  }

  const loading = {
    titleEditorFocused,
    loadUiState: {
      isLoadingLargeDocument,
      loadStageLabel,
      loadProgressPercent,
      loadProgressIndeterminate,
      loadDocumentStats
    },
    largeDocThreshold: LARGE_DOC_THRESHOLD
  }
  const blockAndTable = {
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
    blockGutterTarget: blockAndTableControls.blockGutter.target,
    blockGutterActiveTarget: blockAndTableControls.blockGutter.activeTarget,
    blockMenuTarget: blockAndTableControls.blockGutter.menuTarget,
    blockGutterAnchorRect: blockAndTableControls.blockGutter.anchorRect,
    blockGutterVisible: blockAndTableControls.blockGutter.visible,
    blockGutterMenuOpen: blockAndTableControls.blockGutter.menuOpen,
    blockGutterContentFocused: blockAndTableControls.blockGutter.contentFocused,
    blockMenuOpen: blockAndTableControls.blockGutter.menuOpen,
    blockMenuIndex: blockAndTableControls.blockMenuControls.blockMenuIndex,
    blockMenuActions: blockAndTableControls.blockMenuControls.actions,
    blockMenuConvertActions: blockAndTableControls.blockMenuControls.convertActions,
    closeBlockMenu: blockAndTableControls.closeBlockMenu,
    toggleBlockMenu: blockAndTableControls.toggleBlockMenu,
    onBlockMenuPlus: blockAndTableControls.onBlockMenuPlus,
    onBlockMenuSelect: blockAndTableControls.onBlockMenuSelect,
    onBlockHandleSelectionUpdate: blockAndTableControls.blockGutter.syncSelectionTarget,
    syncBlockGutterAnchor: blockAndTableControls.blockGutter.syncAnchor,
    resolveBlockGutterToolbarPlacement: blockAndTableControls.blockGutter.resolveToolbarPlacement,
    shouldShowBlockGutterLabel: blockAndTableControls.blockGutter.shouldShowToolbarLabel,
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
    onEditorMouseLeave: blockAndTableControls.onEditorMouseLeave
  }
  const spellcheck = {
    open: spellcheckMenuOpen,
    floatingEl: spellcheckMenuFloatingEl,
    left: spellcheckMenuLeft,
    top: spellcheckMenuTop,
    mode: spellcheckMenuMode,
    word: spellcheckMenuWord,
    language: spellcheckMenuLanguage,
    range: spellcheckMenuRange,
    primarySuggestion: spellcheckMenuPrimarySuggestion,
    suggestions: spellcheckMenuSuggestions,
    loading: spellcheckMenuLoading,
    close: closeSpellcheckMenu,
    selectSuggestion: replaceSpellcheckWord,
    ignoreWord: ignoreSpellcheckWord,
    addToWorkspaceDictionary: addSpellcheckWordToWorkspaceDictionary,
    isSessionIgnoredWord
  }
  const layout = {
    renderedEditor,
    editorZoomStyle: layoutAndZoom.editorZoomStyle,
    getZoom: layoutAndZoom.getZoom,
    zoomEditorBy: layoutAndZoom.zoomEditorBy,
    resetEditorZoom: layoutAndZoom.resetEditorZoom,
    focusEditor: layoutAndZoom.focusEditor,
    focusFirstEditableBlock: layoutAndZoom.focusFirstEditableBlock,
    gutterHitboxStyle: layoutAndZoom.layoutMetrics.gutterHitboxStyle,
    onHolderScroll: layoutAndZoom.layoutMetrics.onHolderScroll,
    updateGutterHitboxStyle: layoutAndZoom.updateGutterHitboxStyle
  }
  const dialogsAndLifecycle = {
    mermaidReplaceDialog: dialogs.mermaidReplaceDialog,
    mermaidPreviewDialog: dialogs.mermaidPreviewDialog,
    assetPreviewDialog: dialogs.assetPreviewDialog,
    resolveMermaidReplaceDialog,
    requestMermaidReplaceConfirm: dialogs.requestMermaidReplaceConfirm,
    openMermaidPreview: dialogs.openMermaidPreview,
    closeMermaidPreview: dialogs.closeMermaidPreview,
    openAssetPreview: dialogs.openAssetPreview,
    closeAssetPreview: dialogs.closeAssetPreview,
    exportMermaidSvg: dialogs.exportMermaidSvg,
    exportMermaidPng: dialogs.exportMermaidPng,
    resetTransientUiState,
    onMountInit,
    onUnmountCleanup
  }

  return {
    TABLE_MARKDOWN_MODE,
    loading,
    toolbars: {
      inlineFormatToolbar: toolbars.inlineFormatToolbar,
      findToolbar: toolbars.findToolbar,
      updateFormattingToolbar: toolbars.updateFormattingToolbar,
      onInlineToolbarCopyAs: toolbars.onInlineToolbarCopyAs,
      onActiveSessionChanged: toolbars.onActiveSessionChanged,
      onDocumentContentChanged: toolbars.onDocumentContentChanged
    },
    blockAndTable,
    spellcheck,
    layout,
    dialogsAndLifecycle
  }
}
