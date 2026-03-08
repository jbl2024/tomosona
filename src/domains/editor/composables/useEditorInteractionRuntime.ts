import { computed, ref, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { useEditorCaretOutline } from './useEditorCaretOutline'
import { useEditorInputHandlers } from './useEditorInputHandlers'
import { useEditorNavigation, type EditorHeadingNode } from './useEditorNavigation'
import { useEditorSlashInsertion } from './useEditorSlashInsertion'
import { useEditorTiptapSetup } from './useEditorTiptapSetup'
import { useEditorWikilinkDataSource } from './useEditorWikilinkDataSource'
import { useEditorWikilinkOverlayState } from './useEditorWikilinkOverlayState'
import { useSlashMenu } from './useSlashMenu'
import type { DocumentSession } from './useDocumentEditorSessions'
import { EDITOR_SLASH_COMMANDS } from '../lib/editorSlashCommands'
import { buildWikilinkCandidates } from '../lib/tiptap/wikilinkCandidates'
import { sanitizeExternalHref } from '../lib/markdownBlocks'
import { normalizeBlockId, normalizeHeadingAnchor, slugifyHeading } from '../lib/wikilinks'
import type { WikilinkCandidate } from '../lib/tiptap/plugins/wikilinkState'

export type EditorInteractionRuntimeDocumentPort = {
  currentPath: Ref<string>
  holder: Ref<HTMLDivElement | null>
  activeEditor: Ref<Editor | null>
  getSession: (path: string) => DocumentSession | null
  saveCurrentFile: (manual?: boolean) => Promise<void>
  onEditorDocChanged: (path: string) => void
}

export type EditorInteractionRuntimeChromePort = {
  blockMenuOpen: Ref<boolean>
  tableToolbarOpen: Ref<boolean>
  isDragMenuOpen: () => boolean
  closeBlockMenu: () => void
  hideTableToolbar: () => void
  updateFormattingToolbar: () => void
  updateTableToolbar: () => void
  zoomEditorBy: (delta: number) => number
  resetEditorZoom: () => number
  inlineFormatToolbar: {
    updateFormattingToolbar: () => void
    openLinkPopover: () => void
    linkPopoverOpen: Ref<boolean>
    cancelLink: () => void
  }
}

export type EditorInteractionRuntimeIoPort = {
  loadLinkTargets: () => Promise<string[]>
  loadLinkHeadings: (target: string) => Promise<string[]>
  openLinkTarget: (target: string) => Promise<boolean>
  openExternalUrl: (value: string) => Promise<void>
}

export type EditorInteractionRuntimeEmitPort = {
  emitOutline: (payload: EditorHeadingNode[]) => void
}

/**
 * Groups editor behavior wiring so EditorView does not own slash/wikilink/tiptap flow directly.
 */
export type UseEditorInteractionRuntimeOptions = {
  documentPort: EditorInteractionRuntimeDocumentPort
  chromePort: EditorInteractionRuntimeChromePort
  ioPort: EditorInteractionRuntimeIoPort
  emitPort: EditorInteractionRuntimeEmitPort
  requestMermaidReplaceConfirm: (payload: { templateLabel: string }) => Promise<boolean>
}

export function useEditorInteractionRuntime(options: UseEditorInteractionRuntimeOptions) {
  const SLASH_COMMANDS = computed(() => EDITOR_SLASH_COMMANDS)
  const lastEditorInteractionAt = ref(0)
  const USER_INTERACTION_CAPTURE_WINDOW_MS = 1200

  const slashMenu = useSlashMenu({
    getEditor: () => options.documentPort.activeEditor.value,
    commands: SLASH_COMMANDS,
    closeCompetingMenus: () => options.chromePort.closeBlockMenu()
  })

  const navigation = useEditorNavigation({
    getEditor: () => options.documentPort.activeEditor.value,
    emitOutline: (headings) => options.emitPort.emitOutline(headings),
    normalizeHeadingAnchor,
    slugifyHeading,
    normalizeBlockId
  })

  const caretOutline = useEditorCaretOutline({
    currentPath: options.documentPort.currentPath,
    getSession: (path) => options.documentPort.getSession(path),
    getEditor: () => options.documentPort.activeEditor.value,
    emitOutline: (payload) => {
      options.emitPort.emitOutline(payload.headings)
    },
    parseOutlineFromDoc: () => navigation.parseOutlineFromDoc()
  })

  const wikilinkDataSource = useEditorWikilinkDataSource({
    loadLinkTargets: options.ioPort.loadLinkTargets,
    loadLinkHeadings: options.ioPort.loadLinkHeadings
  })

  const wikilinkOverlay = useEditorWikilinkOverlayState({
    getEditor: () => options.documentPort.activeEditor.value,
    holder: options.documentPort.holder,
    blockMenuOpen: options.chromePort.blockMenuOpen,
    isDragMenuOpen: () => options.chromePort.isDragMenuOpen(),
    closeBlockMenu: () => options.chromePort.closeBlockMenu()
  })

  const slashInsertion = useEditorSlashInsertion({
    getEditor: () => options.documentPort.activeEditor.value,
    currentTextSelectionContext: slashMenu.currentTextSelectionContext,
    readSlashContext: slashMenu.readSlashContext
  })

  function markEditorInteraction() {
    lastEditorInteractionAt.value = Date.now()
  }

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
    const path = options.documentPort.currentPath.value
    const session = path ? options.documentPort.getSession(path) : null
    if (path && session?.dirty) {
      await options.documentPort.saveCurrentFile(false)
      if (options.documentPort.getSession(path)?.dirty) return
    }
    await options.ioPort.openLinkTarget(target)
  }

  const tiptapSetup = useEditorTiptapSetup({
    currentPath: options.documentPort.currentPath,
    getCurrentEditor: () => options.documentPort.activeEditor.value,
    getSessionEditor: (path) => options.documentPort.getSession(path)?.editor ?? null,
    markSlashActivatedByUser: slashMenu.markSlashActivatedByUser,
    syncSlashMenuFromSelection: slashMenu.syncSlashMenuFromSelection,
    updateTableToolbar: () => options.chromePort.updateTableToolbar(),
    syncWikilinkUiFromPluginState: wikilinkOverlay.syncWikilinkUiFromPluginState,
    captureCaret: caretOutline.captureCaret,
    shouldCaptureCaret: (path) => {
      if (!path || options.documentPort.currentPath.value !== path) return false
      if (!options.documentPort.holder.value) return false
      const active = typeof document !== 'undefined' ? document.activeElement : null
      if (!active || !options.documentPort.holder.value.contains(active)) return false
      return Date.now() - lastEditorInteractionAt.value <= USER_INTERACTION_CAPTURE_WINDOW_MS
    },
    updateFormattingToolbar: () => options.chromePort.updateFormattingToolbar(),
    onEditorDocChanged: (path) => options.documentPort.onEditorDocChanged(path),
    requestMermaidReplaceConfirm: options.requestMermaidReplaceConfirm,
    getWikilinkCandidates,
    openLinkTargetWithAutosave,
    resolveWikilinkTarget: wikilinkDataSource.resolveWikilinkTarget,
    sanitizeExternalHref,
    openExternalUrl: options.ioPort.openExternalUrl,
    inlineFormatToolbar: {
      updateFormattingToolbar: options.chromePort.inlineFormatToolbar.updateFormattingToolbar,
      openLinkPopover: options.chromePort.inlineFormatToolbar.openLinkPopover
    }
  })

  const inputHandlers = useEditorInputHandlers({
    editingPort: {
      getEditor: () => options.documentPort.activeEditor.value,
      currentPath: options.documentPort.currentPath,
      captureCaret: caretOutline.captureCaret,
      currentTextSelectionContext: slashMenu.currentTextSelectionContext,
      insertBlockFromDescriptor: slashInsertion.insertBlockFromDescriptor
    },
    menusPort: {
      visibleSlashCommands: slashMenu.visibleSlashCommands,
      slashOpen: slashMenu.slashOpen,
      slashIndex: slashMenu.slashIndex,
      closeSlashMenu: slashMenu.dismissSlashMenu,
      blockMenuOpen: options.chromePort.blockMenuOpen,
      closeBlockMenu: () => options.chromePort.closeBlockMenu(),
      tableToolbarOpen: options.chromePort.tableToolbarOpen,
      hideTableToolbar: () => options.chromePort.hideTableToolbar(),
      inlineFormatToolbar: {
        linkPopoverOpen: options.chromePort.inlineFormatToolbar.linkPopoverOpen,
        cancelLink: options.chromePort.inlineFormatToolbar.cancelLink
      }
    },
    uiPort: {
      updateFormattingToolbar: () => options.chromePort.updateFormattingToolbar(),
      updateTableToolbar: () => options.chromePort.updateTableToolbar(),
      syncSlashMenuFromSelection: slashMenu.syncSlashMenuFromSelection
    },
    zoomPort: {
      zoomEditorBy: (delta) => options.chromePort.zoomEditorBy(delta),
      resetEditorZoom: () => options.chromePort.resetEditorZoom()
    }
  })

  return {
    createSessionEditor: (path: string) => tiptapSetup.createSessionEditor(path),
    slashOpen: slashMenu.slashOpen,
    slashIndex: slashMenu.slashIndex,
    slashLeft: slashMenu.slashLeft,
    slashTop: slashMenu.slashTop,
    slashQuery: slashMenu.slashQuery,
    visibleSlashCommands: slashMenu.visibleSlashCommands,
    closeSlashMenu: slashMenu.closeSlashMenu,
    dismissSlashMenu: slashMenu.dismissSlashMenu,
    setSlashQuery: slashMenu.setSlashQuery,
    markSlashActivatedByUser: slashMenu.markSlashActivatedByUser,
    currentTextSelectionContext: slashMenu.currentTextSelectionContext,
    readSlashContext: slashMenu.readSlashContext,
    openSlashAtSelection: slashMenu.openSlashAtSelection,
    syncSlashMenuFromSelection: slashMenu.syncSlashMenuFromSelection,
    wikilinkOpen: wikilinkOverlay.wikilinkOpen,
    wikilinkIndex: wikilinkOverlay.wikilinkIndex,
    wikilinkLeft: wikilinkOverlay.wikilinkLeft,
    wikilinkTop: wikilinkOverlay.wikilinkTop,
    wikilinkResults: wikilinkOverlay.wikilinkResults,
    closeWikilinkMenu: wikilinkOverlay.closeWikilinkMenu,
    syncWikilinkUiFromPluginState: wikilinkOverlay.syncWikilinkUiFromPluginState,
    onWikilinkMenuSelect: wikilinkOverlay.onWikilinkMenuSelect,
    onWikilinkMenuIndexUpdate: wikilinkOverlay.onWikilinkMenuIndexUpdate,
    captureCaret: caretOutline.captureCaret,
    restoreCaret: caretOutline.restoreCaret,
    clearOutlineTimer: caretOutline.clearOutlineTimer,
    emitOutlineSoon: caretOutline.emitOutlineSoon,
    insertBlockFromDescriptor: slashInsertion.insertBlockFromDescriptor,
    onEditorKeydown: inputHandlers.onEditorKeydown,
    onEditorKeyup: inputHandlers.onEditorKeyup,
    onEditorContextMenu: inputHandlers.onEditorContextMenu,
    onEditorPaste: inputHandlers.onEditorPaste,
    openLinkTargetWithAutosave,
    getWikilinkCandidates,
    markEditorInteraction,
    resetWikilinkDataCache: wikilinkDataSource.resetCache,
    revealSnippet: navigation.revealSnippet,
    revealOutlineHeading: navigation.revealOutlineHeading,
    revealAnchor: navigation.revealAnchor
  }
}
