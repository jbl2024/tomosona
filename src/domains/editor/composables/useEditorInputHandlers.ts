import type { Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { SlashCommand } from '../lib/editorSlashCommands'
import {
  applyMarkdownShortcut,
  isEditorZoomModifier,
  selectSmartPasteMarkdown,
  isZoomInShortcut,
  isZoomOutShortcut,
  isZoomResetShortcut
} from '../lib/editorInteractions'
import { markdownToEditorData, type EditorBlock } from '../lib/markdownBlocks'
import { toTiptapDoc } from '../lib/tiptap/editorBlocksToTiptapDoc'

/**
 * useEditorInputHandlers
 *
 * Purpose:
 * - Centralize host-level keyboard/paste/contextmenu behavior for EditorView.
 *
 * Responsibilities:
 * - Route zoom shortcuts and slash-menu keyboard navigation.
 * - Trigger markdown shortcuts and code-fence insertion transforms.
 * - Process markdown paste conversion and context-menu guards.
 *
 * Boundaries:
 * - Does not own menu state; host passes callbacks and refs.
 */
export type UseEditorInputHandlersOptions = {
  editingPort: {
    getEditor: () => Editor | null
    currentPath: Ref<string>
    captureCaret: (path: string) => void
    currentTextSelectionContext: () => { text: string; nodeType: string; from: number; to: number } | null
    insertBlockFromDescriptor: (
      type: string,
      data: Record<string, unknown>,
      options?: { replaceRange?: { from: number; to: number } | null }
    ) => boolean
  }
  menusPort: {
    visibleSlashCommands: Ref<SlashCommand[]>
    slashOpen: Ref<boolean>
    slashIndex: Ref<number>
    closeSlashMenu: () => void
    blockMenuOpen: Ref<boolean>
    closeBlockMenu: () => void
    tableToolbarOpen: Ref<boolean>
    hideTableToolbar: () => void
    inlineFormatToolbar: {
      linkPopoverOpen: Ref<boolean>
      cancelLink: () => void
    }
  }
  uiPort: {
    updateFormattingToolbar: () => void
    updateTableToolbar: () => void
    syncSlashMenuFromSelection: (options?: { preserveIndex?: boolean }) => void
  }
  zoomPort: {
    zoomEditorBy: (delta: number) => number
    resetEditorZoom: () => number
  }
}

/**
 * Creates DOM event handlers bound to editor/menu runtime dependencies.
 *
 * Failure behavior:
 * - Handlers no-op when editor/runtime dependencies are unavailable.
 */
export function useEditorInputHandlers(options: UseEditorInputHandlersOptions) {
  function onEditorKeydown(event: KeyboardEvent) {
    if (!options.editingPort.getEditor()) return

    const slashInteractionKey =
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Enter'

    // Keep slash interactions responsive even when reactive open-state lags one tick
    // behind the current cursor token (e.g. fast "/"+ArrowDown key sequences).
    if (!options.menusPort.slashOpen.value && slashInteractionKey) {
      options.uiPort.syncSlashMenuFromSelection({ preserveIndex: true })
    }

    if (isEditorZoomModifier(event)) {
      if (isZoomInShortcut(event)) {
        event.preventDefault()
        options.zoomPort.zoomEditorBy(0.1)
        return
      }
      if (isZoomOutShortcut(event)) {
        event.preventDefault()
        options.zoomPort.zoomEditorBy(-0.1)
        return
      }
      if (isZoomResetShortcut(event)) {
        event.preventDefault()
        options.zoomPort.resetEditorZoom()
        return
      }
    }

    if (options.menusPort.slashOpen.value) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        if (!options.menusPort.visibleSlashCommands.value.length) return
        options.menusPort.slashIndex.value = (options.menusPort.slashIndex.value + 1) % options.menusPort.visibleSlashCommands.value.length
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        if (!options.menusPort.visibleSlashCommands.value.length) return
        options.menusPort.slashIndex.value = (options.menusPort.slashIndex.value - 1 + options.menusPort.visibleSlashCommands.value.length) % options.menusPort.visibleSlashCommands.value.length
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        const command = options.menusPort.visibleSlashCommands.value[options.menusPort.slashIndex.value]
        if (!command) return
        options.menusPort.closeSlashMenu()
        options.editingPort.insertBlockFromDescriptor(command.type, command.data)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        options.menusPort.closeSlashMenu()
        return
      }
    }

    const context = options.editingPort.currentTextSelectionContext()
    if ((event.key === ' ' || event.code === 'Space') && context?.nodeType === 'paragraph') {
      const marker = context.text.trim()
      const transform = applyMarkdownShortcut(marker)
      if (transform) {
        event.preventDefault()
        options.menusPort.closeSlashMenu()
        options.editingPort.insertBlockFromDescriptor(transform.type, transform.data, {
          replaceRange: { from: context.from, to: context.to }
        })
        return
      }
    }

    if (event.key === 'Enter' && context?.nodeType === 'paragraph') {
      const marker = context.text.trim()
      if (marker === '```') {
        event.preventDefault()
        options.editingPort.insertBlockFromDescriptor('code', { code: '' }, {
          replaceRange: { from: context.from, to: context.to }
        })
      }
    }

    if (event.key === 'Escape' && options.menusPort.blockMenuOpen.value) {
      event.preventDefault()
      options.menusPort.closeBlockMenu()
      return
    }

    if (event.key === 'Escape' && options.menusPort.inlineFormatToolbar.linkPopoverOpen.value) {
      event.preventDefault()
      options.menusPort.inlineFormatToolbar.cancelLink()
      return
    }

    if (event.key === 'Escape' && options.menusPort.tableToolbarOpen.value) {
      event.preventDefault()
      options.menusPort.hideTableToolbar()
    }
  }

  function onEditorKeyup() {
    const path = options.editingPort.currentPath.value
    if (path) options.editingPort.captureCaret(path)
    options.uiPort.syncSlashMenuFromSelection({ preserveIndex: true })
    options.uiPort.updateFormattingToolbar()
    options.uiPort.updateTableToolbar()
  }

  function onEditorContextMenu(event: MouseEvent) {
    const target = event.target as HTMLElement | null
    const heading = target?.closest('h1') as HTMLElement | null
    if (!heading) return
    if (heading.closest('[data-virtual-title="true"]') || heading.parentElement?.getAttribute('data-virtual-title') === 'true') {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  function onEditorPaste(event: ClipboardEvent) {
    const editor = options.editingPort.getEditor()
    if (!editor) return

    const plain = event.clipboardData?.getData('text/plain') ?? ''
    const html = event.clipboardData?.getData('text/html') ?? ''
    const selected = selectSmartPasteMarkdown(plain, html)
    if (!selected) return
    const parsed = markdownToEditorData(selected.markdown)
    if (!parsed.blocks.length) return

    event.preventDefault()
    event.stopPropagation()
    const json = toTiptapDoc(parsed.blocks as EditorBlock[])
    const content = Array.isArray(json.content) ? json.content : []
    editor.chain().focus().insertContent(content).run()
  }

  return {
    onEditorKeydown,
    onEditorKeyup,
    onEditorContextMenu,
    onEditorPaste
  }
}
