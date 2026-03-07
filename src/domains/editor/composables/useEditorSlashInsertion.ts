import type { Editor, JSONContent } from '@tiptap/vue-3'

/**
 * Read-only slash context describing the trigger token range.
 */
export type SlashInsertionContext = {
  from: number
  to: number
}

export type BlockInsertOptions = {
  replaceRange?: { from: number; to: number } | null
}

/**
 * Runtime dependencies required by {@link useEditorSlashInsertion}.
 *
 * Responsibilities:
 * - The host owns editor lifetime and selection context retrieval.
 * - This composable maps slash command descriptors into Tiptap insert/toggle commands.
 */
export type UseEditorSlashInsertionOptions = {
  getEditor: () => Editor | null
  currentTextSelectionContext: () => { text: string; nodeType: string; from: number; to: number } | null
  readSlashContext: () => SlashInsertionContext | null
}

/**
 * useEditorSlashInsertion
 *
 * Purpose:
 * - Convert slash command descriptors into deterministic editor mutations.
 *
 * Boundaries:
 * - Does not own slash menu open/index state.
 * - Returns only insertion behavior; keyboard routing stays in input handlers.
 */
export function useEditorSlashInsertion(options: UseEditorSlashInsertionOptions) {
  function focusInsertedQuote(editor: Editor) {
    if (typeof window === 'undefined') return

    const tryFocus = () => {
      const selected = editor.view.dom.querySelector('.ProseMirror-selectednode .tomosona-quote-source') as HTMLTextAreaElement | null
      const fallbacks = Array.from(editor.view.dom.querySelectorAll('.tomosona-quote-source')) as HTMLTextAreaElement[]
      const target = selected ?? fallbacks[fallbacks.length - 1] ?? null
      if (!target) return
      target.focus()
      const size = target.value.length
      target.setSelectionRange(size, size)
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(tryFocus)
    })
  }

  /**
   * Inserts/toggles content based on command descriptor.
   *
   * Failure behavior:
   * - Returns `false` when editor or selection context is unavailable.
   */
  function insertBlockFromDescriptor(type: string, data: Record<string, unknown>, insertOptions?: BlockInsertOptions) {
    const editor = options.getEditor()
    if (!editor) return false
    const context = options.currentTextSelectionContext()
    if (!context) return false
    const slashContext = options.readSlashContext()
    const replaceRange = insertOptions?.replaceRange ?? null

    if (type === 'list') {
      const style = data.style === 'ordered' ? 'ordered' : data.style === 'checklist' ? 'checklist' : 'unordered'
      const chain = editor.chain().focus()
      if (slashContext) {
        chain.deleteRange({ from: slashContext.from, to: slashContext.to })
      } else if (replaceRange) {
        chain.deleteRange(replaceRange)
      }
      if (style === 'ordered') {
        chain.toggleOrderedList().run()
        return true
      }
      if (style === 'checklist') {
        chain.toggleTaskList().run()
        return true
      }
      chain.toggleBulletList().run()
      return true
    }

    const content: JSONContent | null = (() => {
      switch (type) {
        case 'header':
          return {
            type: 'heading',
            attrs: { level: Number(data.level ?? 2) },
            content: String(data.text ?? '').trim()
              ? [{ type: 'text', text: String(data.text ?? '').trim() }]
              : []
          }
        case 'table':
          return {
            type: 'table',
            content: [
              { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph' }] }, { type: 'tableHeader', content: [{ type: 'paragraph' }] }] },
              { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }, { type: 'tableCell', content: [{ type: 'paragraph' }] }] }
            ]
          }
        case 'callout':
          return { type: 'calloutBlock', attrs: { kind: String(data.kind ?? 'NOTE'), message: '' } }
        case 'mermaid':
          return { type: 'mermaidBlock', attrs: { code: String(data.code ?? '') } }
        case 'code':
          return { type: 'codeBlock', attrs: { language: '' }, content: [] }
        case 'html':
          return { type: 'htmlBlock', attrs: { html: String(data.html ?? '') } }
        case 'quote':
          return { type: 'quoteBlock', attrs: { text: String(data.text ?? '') } }
        case 'delimiter':
          return { type: 'horizontalRule' }
        default:
          return { type: 'paragraph', content: [] }
      }
    })()

    if (!content) return false
    if (slashContext) {
      editor.chain().focus().deleteRange({ from: slashContext.from, to: slashContext.to }).insertContent(content).run()
    } else if (replaceRange) {
      editor.chain().focus().deleteRange(replaceRange).insertContent(content).run()
    } else {
      editor.chain().focus().insertContent(content).run()
    }
    if (type === 'quote') {
      focusInsertedQuote(editor)
    }
    return true
  }

  return {
    insertBlockFromDescriptor
  }
}
