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
import type { MermaidPreviewPayload } from './useMermaidPreviewDialog'

/**
 * Owns interactive editor behavior that depends on the active Tiptap instance:
 * slash commands, wikilinks, caret capture, outline/navigation, and input routing.
 *
 * This runtime deliberately stays as one module because those flows share the same
 * active editor, selection state, and plugin callbacks. The simplification target is
 * local readability, not splitting that orchestration into more public files.
 */

/** Exposes the active document/session surface required for editor interactions. */
export type EditorInteractionRuntimeDocumentPort = {
  currentPath: Ref<string>
  holder: Ref<HTMLDivElement | null>
  activeEditor: Ref<Editor | null>
  getSession: (path: string) => DocumentSession | null
  saveCurrentFile: (manual?: boolean) => Promise<void>
  onEditorDocChanged: (path: string) => void
}

/** Groups the small slice of chrome state that interaction wiring must keep in sync. */
export type EditorInteractionRuntimeChromePort = {
  menus: {
    blockMenuOpen: Ref<boolean>
    tableToolbarOpen: Ref<boolean>
    isDragMenuOpen: () => boolean
    closeBlockMenu: () => void
    hideTableToolbar: () => void
  }
  blockHandles: {
    syncSelectionTarget: () => void
  }
  toolbars: {
    updateFormattingToolbar: () => void
    updateTableToolbar: () => void
    inlineFormatToolbar: {
      updateFormattingToolbar: () => void
      openLinkPopover: () => void
      linkPopoverOpen: Ref<boolean>
      cancelLink: () => void
    }
  }
  zoom: {
    zoomEditorBy: (delta: number) => number
    resetEditorZoom: () => number
  }
}

/** Editor-side async lookups and side effects used by interaction features. */
export type EditorInteractionRuntimeIoPort = {
  loadLinkTargets: () => Promise<string[]>
  loadLinkHeadings: (target: string) => Promise<string[]>
  openLinkTarget: (target: string) => Promise<boolean>
  openExternalUrl: (value: string) => Promise<void>
}

/** Editor-specific callbacks that interaction owns but does not persist itself. */
export type EditorInteractionRuntimeEditorPort = {
  emitOutline: (payload: EditorHeadingNode[]) => void
  requestMermaidReplaceConfirm: (payload: { templateLabel: string }) => Promise<boolean>
  openMermaidPreview: (payload: MermaidPreviewPayload) => void
}

/**
 * Groups editor behavior wiring so EditorView does not own slash/wikilink/tiptap flow directly.
 */
export type UseEditorInteractionRuntimeOptions = {
  interactionDocumentPort: EditorInteractionRuntimeDocumentPort
  interactionEditorPort: EditorInteractionRuntimeEditorPort
  interactionChromePort: EditorInteractionRuntimeChromePort
  interactionIoPort: EditorInteractionRuntimeIoPort
}

/**
 * Coordinates selection-driven editor behavior while keeping the shell free from Tiptap plumbing.
 */
export function useEditorInteractionRuntime(options: UseEditorInteractionRuntimeOptions) {
  const documentPort = options.interactionDocumentPort
  const editorPort = options.interactionEditorPort
  const chromePort = options.interactionChromePort
  const ioPort = options.interactionIoPort

  const SLASH_COMMANDS = computed(() => EDITOR_SLASH_COMMANDS)
  const lastEditorInteractionAt = ref(0)
  const USER_INTERACTION_CAPTURE_WINDOW_MS = 1200

  const slashMenu = useSlashMenu({
    getEditor: () => documentPort.activeEditor.value,
    commands: SLASH_COMMANDS,
    closeCompetingMenus: () => chromePort.menus.closeBlockMenu()
  })

  const navigation = useEditorNavigation({
    getEditor: () => documentPort.activeEditor.value,
    emitOutline: (headings) => editorPort.emitOutline(headings),
    normalizeHeadingAnchor,
    slugifyHeading,
    normalizeBlockId
  })

  const caretOutline = useEditorCaretOutline({
    currentPath: documentPort.currentPath,
    getSession: (path) => documentPort.getSession(path),
    getEditor: () => documentPort.activeEditor.value,
    emitOutline: (payload) => {
      editorPort.emitOutline(payload.headings)
    },
    parseOutlineFromDoc: () => navigation.parseOutlineFromDoc()
  })

  const wikilinkDataSource = useEditorWikilinkDataSource({
    loadLinkTargets: ioPort.loadLinkTargets,
    loadLinkHeadings: ioPort.loadLinkHeadings
  })

  // Invariant: the overlay must exist before Tiptap callbacks can try to sync it.
  const wikilinkOverlay = useEditorWikilinkOverlayState({
    getEditor: () => documentPort.activeEditor.value,
    holder: documentPort.holder,
    blockMenuOpen: chromePort.menus.blockMenuOpen,
    isDragMenuOpen: () => chromePort.menus.isDragMenuOpen(),
    closeBlockMenu: () => chromePort.menus.closeBlockMenu()
  })

  const slashInsertion = useEditorSlashInsertion({
    getEditor: () => documentPort.activeEditor.value,
    currentTextSelectionContext: slashMenu.currentTextSelectionContext,
    readSlashContext: slashMenu.readSlashContext,
    currentHeadings: () => navigation.parseOutlineFromDoc(),
    slugifyHeading
  })

  /**
   * Records a recent explicit user interaction so caret snapshots only happen after real editor input.
   */
  function markEditorInteraction() {
    lastEditorInteractionAt.value = Date.now()
  }

  /**
   * Captures caret state only for the focused active editor, shortly after user interaction.
   */
  function shouldCaptureCaretForActiveEditor(path: string) {
    if (!path || documentPort.currentPath.value !== path) return false
    if (!documentPort.holder.value) return false
    const active = typeof document !== 'undefined' ? document.activeElement : null
    if (!active || !documentPort.holder.value.contains(active)) return false
    return Date.now() - lastEditorInteractionAt.value <= USER_INTERACTION_CAPTURE_WINDOW_MS
  }

  /**
   * Saves the dirty active document before navigation. If the document is still dirty afterwards,
   * navigation is canceled to avoid losing edits on a failed or skipped persist.
   */
  async function saveDirtyDocumentBeforeNavigation() {
    const path = documentPort.currentPath.value
    const session = path ? documentPort.getSession(path) : null
    if (!path || !session?.dirty) return true
    await documentPort.saveCurrentFile(false)
    return !documentPort.getSession(path)?.dirty
  }

  /**
   * Builds wikilink candidates from workspace targets, target headings, current-document headings,
   * and the existing target resolver.
   */
  async function getWikilinkCandidates(query: string): Promise<WikilinkCandidate[]> {
    return buildWikilinkCandidates({
      query,
      loadTargets: () => wikilinkDataSource.loadWikilinkTargets(),
      loadHeadings: (target) => wikilinkDataSource.loadWikilinkHeadings(target),
      currentHeadings: () => navigation.parseOutlineFromDoc().map((item) => item.text),
      resolve: (target) => wikilinkDataSource.resolveWikilinkTarget(target)
    })
  }

  /**
   * Opens a link target only after the current dirty note has been safely persisted.
   */
  async function openLinkTargetWithAutosave(target: string) {
    const canNavigate = await saveDirtyDocumentBeforeNavigation()
    if (!canNavigate) return
    await ioPort.openLinkTarget(target)
  }

  const tiptapSetup = useEditorTiptapSetup({
    currentPath: documentPort.currentPath,
    getCurrentEditor: () => documentPort.activeEditor.value,
    getSessionEditor: (path) => documentPort.getSession(path)?.editor ?? null,
    markSlashActivatedByUser: slashMenu.markSlashActivatedByUser,
    syncSlashMenuFromSelection: slashMenu.syncSlashMenuFromSelection,
    syncBlockHandleFromSelection: () => chromePort.blockHandles.syncSelectionTarget(),
    updateTableToolbar: () => chromePort.toolbars.updateTableToolbar(),
    syncWikilinkUiFromPluginState: wikilinkOverlay.syncWikilinkUiFromPluginState,
    captureCaret: caretOutline.captureCaret,
    shouldCaptureCaret: shouldCaptureCaretForActiveEditor,
    updateFormattingToolbar: () => chromePort.toolbars.updateFormattingToolbar(),
    onEditorDocChanged: (path) => documentPort.onEditorDocChanged(path),
    requestMermaidReplaceConfirm: editorPort.requestMermaidReplaceConfirm,
    openMermaidPreview: editorPort.openMermaidPreview,
    getWikilinkCandidates,
    openLinkTargetWithAutosave,
    revealAnchor: navigation.revealAnchor,
    resolveWikilinkTarget: wikilinkDataSource.resolveWikilinkTarget,
    sanitizeExternalHref,
    openExternalUrl: ioPort.openExternalUrl,
    inlineFormatToolbar: {
      updateFormattingToolbar: chromePort.toolbars.inlineFormatToolbar.updateFormattingToolbar,
      openLinkPopover: chromePort.toolbars.inlineFormatToolbar.openLinkPopover
    }
  })

  const inputHandlers = useEditorInputHandlers({
    editingPort: {
      getEditor: () => documentPort.activeEditor.value,
      currentPath: documentPort.currentPath,
      captureCaret: caretOutline.captureCaret,
      currentTextSelectionContext: slashMenu.currentTextSelectionContext,
      insertBlockFromDescriptor: slashInsertion.insertBlockFromDescriptor
    },
    menusPort: {
      visibleSlashCommands: slashMenu.visibleSlashCommands,
      slashOpen: slashMenu.slashOpen,
      slashIndex: slashMenu.slashIndex,
      closeSlashMenu: slashMenu.dismissSlashMenu,
      blockMenuOpen: chromePort.menus.blockMenuOpen,
      closeBlockMenu: () => chromePort.menus.closeBlockMenu(),
      tableToolbarOpen: chromePort.menus.tableToolbarOpen,
      hideTableToolbar: () => chromePort.menus.hideTableToolbar(),
      inlineFormatToolbar: {
        linkPopoverOpen: chromePort.toolbars.inlineFormatToolbar.linkPopoverOpen,
        cancelLink: chromePort.toolbars.inlineFormatToolbar.cancelLink
      }
    },
    uiPort: {
      updateFormattingToolbar: () => chromePort.toolbars.updateFormattingToolbar(),
      updateTableToolbar: () => chromePort.toolbars.updateTableToolbar(),
      syncSlashMenuFromSelection: slashMenu.syncSlashMenuFromSelection
    },
    zoomPort: {
      zoomEditorBy: (delta) => chromePort.zoom.zoomEditorBy(delta),
      resetEditorZoom: () => chromePort.zoom.resetEditorZoom()
    }
  })

  const slashAndInsertion = {
    slashMenu,
    slashInsertion,
    markEditorInteraction,
    markSlashActivatedByUser: slashMenu.markSlashActivatedByUser,
    openSlashAtSelection: slashMenu.openSlashAtSelection,
    setSlashQuery: slashMenu.setSlashQuery
  }
  const wikilinkFlow = {
    wikilinkDataSource,
    wikilinkOverlay,
    getWikilinkCandidates,
    syncWikilinkUiFromPluginState: wikilinkOverlay.syncWikilinkUiFromPluginState,
    closeWikilinkMenu: wikilinkOverlay.closeWikilinkMenu,
    onWikilinkMenuSelect: wikilinkOverlay.onWikilinkMenuSelect,
    onWikilinkMenuIndexUpdate: wikilinkOverlay.onWikilinkMenuIndexUpdate,
    resetWikilinkDataCache: wikilinkDataSource.resetCache
  }
  const caretAndOutline = {
    navigation,
    caretOutline,
    captureCaret: caretOutline.captureCaret,
    restoreCaret: caretOutline.restoreCaret,
    clearOutlineTimer: caretOutline.clearOutlineTimer,
    emitOutlineSoon: caretOutline.emitOutlineSoon,
    revealSnippet: navigation.revealSnippet,
    revealOutlineHeading: navigation.revealOutlineHeading,
    revealAnchor: navigation.revealAnchor
  }
  const editorInputAndNavigation = {
    tiptapSetup,
    inputHandlers,
    openLinkTargetWithAutosave,
    onEditorKeydown: inputHandlers.onEditorKeydown,
    onEditorKeyup: inputHandlers.onEditorKeyup,
    onEditorContextMenu: inputHandlers.onEditorContextMenu,
    onEditorPaste: inputHandlers.onEditorPaste
  }

  return {
    createSessionEditor: (path: string) => editorInputAndNavigation.tiptapSetup.createSessionEditor(path),
    slashOpen: slashAndInsertion.slashMenu.slashOpen,
    slashIndex: slashAndInsertion.slashMenu.slashIndex,
    slashLeft: slashAndInsertion.slashMenu.slashLeft,
    slashTop: slashAndInsertion.slashMenu.slashTop,
    slashQuery: slashAndInsertion.slashMenu.slashQuery,
    visibleSlashCommands: slashAndInsertion.slashMenu.visibleSlashCommands,
    closeSlashMenu: slashAndInsertion.slashMenu.closeSlashMenu,
    dismissSlashMenu: slashAndInsertion.slashMenu.dismissSlashMenu,
    setSlashQuery: slashAndInsertion.setSlashQuery,
    markSlashActivatedByUser: slashAndInsertion.markSlashActivatedByUser,
    currentTextSelectionContext: slashAndInsertion.slashMenu.currentTextSelectionContext,
    readSlashContext: slashAndInsertion.slashMenu.readSlashContext,
    openSlashAtSelection: slashAndInsertion.openSlashAtSelection,
    syncSlashMenuFromSelection: slashAndInsertion.slashMenu.syncSlashMenuFromSelection,
    wikilinkOpen: wikilinkFlow.wikilinkOverlay.wikilinkOpen,
    wikilinkIndex: wikilinkFlow.wikilinkOverlay.wikilinkIndex,
    wikilinkLeft: wikilinkFlow.wikilinkOverlay.wikilinkLeft,
    wikilinkTop: wikilinkFlow.wikilinkOverlay.wikilinkTop,
    wikilinkResults: wikilinkFlow.wikilinkOverlay.wikilinkResults,
    closeWikilinkMenu: wikilinkFlow.closeWikilinkMenu,
    syncWikilinkUiFromPluginState: wikilinkFlow.syncWikilinkUiFromPluginState,
    onWikilinkMenuSelect: wikilinkFlow.onWikilinkMenuSelect,
    onWikilinkMenuIndexUpdate: wikilinkFlow.onWikilinkMenuIndexUpdate,
    captureCaret: caretAndOutline.captureCaret,
    restoreCaret: caretAndOutline.restoreCaret,
    clearOutlineTimer: caretAndOutline.clearOutlineTimer,
    emitOutlineSoon: caretAndOutline.emitOutlineSoon,
    insertBlockFromDescriptor: slashAndInsertion.slashInsertion.insertBlockFromDescriptor,
    onEditorKeydown: editorInputAndNavigation.onEditorKeydown,
    onEditorKeyup: editorInputAndNavigation.onEditorKeyup,
    onEditorContextMenu: editorInputAndNavigation.onEditorContextMenu,
    onEditorPaste: editorInputAndNavigation.onEditorPaste,
    openLinkTargetWithAutosave: editorInputAndNavigation.openLinkTargetWithAutosave,
    getWikilinkCandidates: wikilinkFlow.getWikilinkCandidates,
    markEditorInteraction: slashAndInsertion.markEditorInteraction,
    resetWikilinkDataCache: wikilinkFlow.resetWikilinkDataCache,
    revealSnippet: caretAndOutline.revealSnippet,
    revealOutlineHeading: caretAndOutline.revealOutlineHeading,
    revealAnchor: caretAndOutline.revealAnchor
  }
}
