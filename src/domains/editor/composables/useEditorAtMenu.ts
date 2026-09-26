import { computed, ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import {
  buildEditorAtMacroEntries,
  canContinueEditorAtMacroArgument,
  editorAtMacroMatchesQuery,
  type EditorAtMacroEntry,
  type EditorAtPulseAction
} from '../lib/editorAtMacros'
import { markdownToEditorData, type EditorBlock } from '../lib/markdownBlocks'
import { toTiptapDoc } from '../lib/tiptap/editorBlocksToTiptapDoc'

/**
 * `@` macro trigger and suggestion state for the editor surface.
 *
 * The composable stays focused on trigger detection, anchored placement, and
 * insertion. The menu UI and document metadata stay outside this module.
 */
export type AtMenuTrigger = {
  start: number
  end: number
  query: string
}

type TextSelectionContext = {
  from: number
  to: number
  text: string
  offset: number
  nodeType: string
  marks?: string[]
}

export type UseEditorAtMenuOptions = {
  getEditor: () => Editor | null
  currentTextSelectionContext: () => TextSelectionContext | null
  closeCompetingMenus: () => void
  getDocumentMetadata: () => {
    title: string
    path: string
    bodyText?: string
    tags?: string[]
    backlinks?: string[]
    createdAt?: Date | null
    updatedAt?: Date | null
    userName?: string
    templates?: Array<{ path: string; label: string; relativePath: string; group: string }>
  }
  openPulseMacro?: (action: EditorAtPulseAction) => void
  readTemplateContent?: (path: string) => Promise<string>
  now?: () => Date
}

function isTriggerBoundary(previousChar: string): boolean {
  return !previousChar || /[\s([{\n]/.test(previousChar)
}

function extractAtTrigger(text: string, caret: number, marks?: string[]): AtMenuTrigger | null {
  const beforeCaret = text.slice(0, caret)
  const atIndex = beforeCaret.lastIndexOf('@')
  if (atIndex < 0) return null
  if (!isTriggerBoundary(atIndex > 0 ? beforeCaret[atIndex - 1] ?? '' : '')) return null
  if (marks?.includes('code')) return null

  const query = beforeCaret.slice(atIndex + 1)
  if (/\s/.test(query) && !canContinueEditorAtMacroArgument(query)) return null
  if (!query || /^[a-zA-Z0-9_.+-]*(?:\s+[a-zA-Z0-9_.+-]+)?$/.test(query)) {
    return {
      start: atIndex,
      end: caret,
      query
    }
  }
  return null
}

function toDocumentTrigger(context: TextSelectionContext, trigger: AtMenuTrigger): AtMenuTrigger {
  return {
    start: context.from + trigger.start,
    end: context.from + trigger.end,
    query: trigger.query
  }
}

/**
 * Owns `@` macro menu state for the active editor selection.
 */
export function useEditorAtMenu(options: UseEditorAtMenuOptions) {
  const atOpen = ref(false)
  const atIndex = ref(0)
  const atLeft = ref(0)
  const atTop = ref(0)
  const atQuery = ref('')
  const atActivatedByUser = ref(false)

  const atEntries = computed(() =>
    buildEditorAtMacroEntries({
      ...options.getDocumentMetadata(),
      now: options.now?.() ?? new Date()
    }, atQuery.value)
  )

  const visibleAtMacros = computed(() => {
    const query = atQuery.value.trim()
    return atEntries.value.filter((entry) => editorAtMacroMatchesQuery(entry, query))
  })

  function closeAtMenu() {
    atOpen.value = false
    atIndex.value = 0
    atQuery.value = ''
  }

  function dismissAtMenu() {
    closeAtMenu()
    atActivatedByUser.value = false
  }

  function markAtActivatedByUser() {
    atActivatedByUser.value = true
  }

  function currentEditorSelectionContext(): TextSelectionContext | null {
    const editor = options.getEditor()
    if (!editor) return null
    const { selection } = editor.state
    if (!selection.empty) return null
    const { $from } = selection
    const parent = $from.parent
    if (!parent.isTextblock) return null
    return {
      from: $from.start(),
      to: $from.end(),
      text: parent.textContent,
      offset: $from.parentOffset,
      nodeType: parent.type.name,
      marks: $from.marks().map((mark) => mark.type.name)
    }
  }

  function readAtContext(): AtMenuTrigger | null {
    const context = options.currentTextSelectionContext() ?? currentEditorSelectionContext()
    // Headings are text blocks too: `@` macros should be available there just
    // as they are in regular paragraphs.
    if (!context || !['paragraph', 'heading'].includes(context.nodeType)) return null
    if (context.marks?.includes('code')) return null
    const trigger = extractAtTrigger(context.text, context.offset, context.marks)
    return trigger ? toDocumentTrigger(context, trigger) : null
  }

  function setAtQuery(query: string) {
    atQuery.value = query
    atIndex.value = 0
    atOpen.value = true
  }

  function openAtSelection(query = '', opts?: { preserveIndex?: boolean }) {
    const editor = options.getEditor()
    if (!editor) return
    options.closeCompetingMenus()

    const pos = editor.state.selection.from
    const rect = (() => {
      try {
        return editor.view.coordsAtPos(pos)
      } catch {
        return { left: 12, bottom: 12 }
      }
    })()
    const estimatedWidth = 304
    const estimatedHeight = 284
    const maxX = Math.max(12, window.innerWidth - estimatedWidth - 12)
    const maxY = Math.max(12, window.innerHeight - estimatedHeight - 12)

    atLeft.value = Math.max(12, Math.min(rect.left, maxX))
    atTop.value = Math.max(12, Math.min(rect.bottom + 8, maxY))

    const previousQuery = atQuery.value
    const previousIndex = atIndex.value
    atQuery.value = query

    const canPreserve = Boolean(opts?.preserveIndex) && previousQuery === query
    atIndex.value = canPreserve ? previousIndex : 0
    atOpen.value = true

    if (visibleAtMacros.value.length && canPreserve) {
      atIndex.value = Math.max(0, Math.min(atIndex.value, visibleAtMacros.value.length - 1))
    }
  }

  function syncAtMenuFromSelection(opts?: { preserveIndex?: boolean }) {
    const at = readAtContext()
    if (at && atActivatedByUser.value) {
      openAtSelection(atQuery.value || at.query, { preserveIndex: opts?.preserveIndex ?? true })
      return
    }
    closeAtMenu()
    if (!at) atActivatedByUser.value = false
  }

  async function insertAtMacro(entry: EditorAtMacroEntry): Promise<boolean> {
    const editor = options.getEditor()
    const trigger = readAtContext()
    if (!editor || !trigger) return false

    if (entry.templatePath) {
      let templateContent = ''
      try {
        templateContent = await options.readTemplateContent?.(entry.templatePath) ?? ''
      } catch {
        return false
      }
      if (!templateContent) return false
      const parsed = markdownToEditorData(templateContent)
      const doc = toTiptapDoc(parsed.blocks as EditorBlock[])
      const content = Array.isArray(doc.content) && doc.content.length ? doc.content : templateContent
      editor.chain().focus().deleteRange({ from: trigger.start, to: trigger.end }).insertContent(content).run()
      closeAtMenu()
      return true
    }

    if (entry.kind === 'open_pulse' && entry.pulse) {
      editor.chain().focus().deleteRange({ from: trigger.start, to: trigger.end }).run()
      options.openPulseMacro?.(entry.pulse)
      closeAtMenu()
      return true
    }

    if (entry.kind === 'insert_markdown' || entry.kind === 'dynamic_pick') {
      const parsed = markdownToEditorData(entry.replacement)
      const doc = toTiptapDoc(parsed.blocks as EditorBlock[])
      const content = Array.isArray(doc.content) && doc.content.length ? doc.content : entry.replacement
      editor.chain().focus().deleteRange({ from: trigger.start, to: trigger.end }).insertContent(content).run()
      closeAtMenu()
      return true
    }

    editor.chain().focus().deleteRange({ from: trigger.start, to: trigger.end }).insertContent(entry.replacement).run()
    closeAtMenu()
    return true
  }

  return {
    atOpen,
    atIndex,
    atLeft,
    atTop,
    atQuery,
    atActivatedByUser,
    atEntries,
    visibleAtMacros,
    closeAtMenu,
    dismissAtMenu,
    markAtActivatedByUser,
    currentTextSelectionContext: options.currentTextSelectionContext,
    readAtContext,
    openAtSelection,
    setAtQuery,
    syncAtMenuFromSelection,
    insertAtMacro
  }
}
