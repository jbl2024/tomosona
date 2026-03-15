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
  currentHeadings: () => Array<{ level: 1 | 2 | 3; text: string }>
  slugifyHeading: (heading: string) => string
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
  /**
   * Builds a static TOC from the headings currently present in the note.
   * V1 intentionally inserts regular content only; it does not create a live block.
   */
  function createTocAnchorLink(heading: string): JSONContent {
    const slug = options.slugifyHeading(heading)
    return {
      type: 'text',
      text: heading,
      marks: slug
        ? [{ type: 'link', attrs: { href: `#${slug}` } }]
        : []
    }
  }

  function createTocListItem(heading: { level: 1 | 2 | 3; text: string }) {
    return {
      type: 'listItem',
      content: [
        {
          type: 'paragraph',
          content: [createTocAnchorLink(heading.text)]
        }
      ]
    } satisfies JSONContent
  }

  function createTocContent(maxLevel = 3): JSONContent {
    const headings = options.currentHeadings()
      .map((heading) => ({ level: heading.level, text: String(heading.text ?? '').trim() }))
      .filter((heading): heading is { level: 1 | 2 | 3; text: string } =>
        Boolean(heading.text) && heading.level <= maxLevel
      )

    if (!headings.length) {
      return {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }]
      }
    }

    const root: JSONContent[] = []
    const stack: Array<{ level: number; item: JSONContent | null; items: JSONContent[] }> = [{ level: 0, item: null, items: root }]

    for (const heading of headings) {
      while (stack.length > 1 && stack[stack.length - 1]!.level >= heading.level) {
        stack.pop()
      }

      const item = createTocListItem(heading)
      stack[stack.length - 1]!.items.push(item)

      const childItems: JSONContent[] = []
      item.content = [...(item.content ?? []), { type: 'bulletList', content: childItems }]
      stack.push({ level: heading.level, item, items: childItems })
    }

    const pruneNestedLists = (node: JSONContent) => {
      if (!Array.isArray(node.content)) return
      node.content = node.content
        .map((child) => {
          pruneNestedLists(child)
          if (child.type === 'bulletList' && (!Array.isArray(child.content) || child.content.length === 0)) {
            return null
          }
          return child
        })
        .filter((child): child is JSONContent => Boolean(child))
    }

    for (const item of root) {
      pruneNestedLists(item)
    }

    return { type: 'bulletList', content: root }
  }

  function focusInsertedQuote(editor: Editor) {
    if (typeof window === 'undefined') return

    const tryFocus = () => {
      const editorDom = editor.view?.dom
      if (!(editorDom instanceof HTMLElement)) return
      const selected = editorDom.querySelector('.ProseMirror-selectednode .tomosona-quote-source') as HTMLTextAreaElement | null
      const fallbacks = Array.from(editorDom.querySelectorAll('.tomosona-quote-source')) as HTMLTextAreaElement[]
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

  function findHtmlTemplateCaret(value: string): number {
    const match = value.match(/^<([A-Za-z][^\s/>]*)(?:[^>]*)>\n([ \t]*)\n<\/\1>\s*$/)
    if (!match) return value.length
    const lineBreakIndex = value.indexOf('\n')
    if (lineBreakIndex < 0) return value.length
    return lineBreakIndex + 1 + match[2].length
  }

  function focusInsertedHtml(editor: Editor) {
    if (typeof window === 'undefined') return

    const tryFocus = (remainingAttempts: number) => {
      const editorDom = editor.view?.dom
      if (!(editorDom instanceof HTMLElement)) return
      const selected = editorDom.querySelector('.ProseMirror-selectednode .tomosona-html-textarea') as HTMLTextAreaElement | null
      const fallbacks = Array.from(editorDom.querySelectorAll('.tomosona-html-textarea')) as HTMLTextAreaElement[]
      const target = selected ?? fallbacks[fallbacks.length - 1] ?? null
      if (target) {
        const active = document.activeElement
        if (active instanceof HTMLElement && active !== target) {
          active.blur()
        }
        target.focus()
        const caret = findHtmlTemplateCaret(target.value)
        target.setSelectionRange(caret, caret)
        if (document.activeElement === target) return
      }
      if (remainingAttempts <= 0) return
      window.requestAnimationFrame(() => tryFocus(remainingAttempts - 1))
    }

    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => tryFocus(6))
      })
    }, 0)
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
          return { type: 'htmlBlock', attrs: { html: String(data.html ?? ''), autoEdit: true } }
        case 'quote':
          return { type: 'quoteBlock', attrs: { text: String(data.text ?? '') } }
        case 'delimiter':
          return { type: 'horizontalRule' }
        case 'toc':
          return createTocContent(Number(data.maxLevel ?? 3))
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
    if (type === 'html') {
      focusInsertedHtml(editor)
    }
    return true
  }

  return {
    insertBlockFromDescriptor
  }
}
