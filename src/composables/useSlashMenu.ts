import { computed, ref, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { SlashCommand } from '../lib/editorSlashCommands'

/**
 * useSlashMenu
 *
 * Purpose:
 * - Encapsulate slash-command menu state and selection-driven placement.
 *
 * Responsibilities:
 * - Track menu visibility, active item index, query, and viewport position.
 * - Parse slash context from current paragraph selection (`/hea` style tokens).
 * - Keep index stable when query did not change.
 *
 * Boundaries:
 * - Does not execute command insertion; host provides `insertBlockFromDescriptor`.
 * - Does not own editor lifecycle.
 */
export type SlashContext = {
  query: string
  from: number
  to: number
}

type TextSelectionContext = {
  from: number
  to: number
  text: string
  offset: number
  nodeType: string
}

export type UseSlashMenuOptions = {
  getEditor: () => Editor | null
  commands: Ref<SlashCommand[]>
  closeCompetingMenus: () => void
}

/**
 * Creates slash-menu state and helper actions for the active editor selection.
 */
export function useSlashMenu(options: UseSlashMenuOptions) {
  const slashOpen = ref(false)
  const slashIndex = ref(0)
  const slashLeft = ref(0)
  const slashTop = ref(0)
  const slashQuery = ref('')
  const slashActivatedByUser = ref(false)

  const visibleSlashCommands = computed(() => {
    const query = slashQuery.value.trim().toLowerCase()
    const all = options.commands.value
    if (!query) return all
    return all.filter((command) => command.label.toLowerCase().includes(query) || command.id.toLowerCase().includes(query))
  })

  function closeSlashMenu() {
    slashOpen.value = false
    slashIndex.value = 0
    slashQuery.value = ''
  }

  function dismissSlashMenu() {
    closeSlashMenu()
    slashActivatedByUser.value = false
  }

  function markSlashActivatedByUser() {
    slashActivatedByUser.value = true
  }

  function currentTextSelectionContext(): TextSelectionContext | null {
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
      nodeType: parent.type.name
    }
  }

  /**
   * Detects slash query patterns, e.g. `/he` at paragraph start.
   */
  function readSlashContext(): SlashContext | null {
    const context = currentTextSelectionContext()
    if (!context || context.nodeType !== 'paragraph') return null
    const before = context.text.slice(0, context.offset)
    const match = before.match(/^\/([a-zA-Z0-9_-]*)$/)
    if (!match) return null
    const token = match[0] ?? '/'
    return {
      query: match[1] ?? '',
      from: context.from,
      to: context.from + token.length
    }
  }

  function setSlashQuery(query: string) {
    slashQuery.value = query
    slashIndex.value = 0
    slashOpen.value = visibleSlashCommands.value.length > 0
  }

  function openSlashAtSelection(query = '', opts?: { preserveIndex?: boolean }) {
    const editor = options.getEditor()
    if (!editor) return
    options.closeCompetingMenus()

    const pos = editor.state.selection.from
    const rect = editor.view.coordsAtPos(pos)
    const estimatedWidth = 240
    const estimatedHeight = 360
    const maxX = Math.max(12, window.innerWidth - estimatedWidth - 12)
    const maxY = Math.max(12, window.innerHeight - estimatedHeight - 12)

    slashLeft.value = Math.max(12, Math.min(rect.left, maxX))
    slashTop.value = Math.max(12, Math.min(rect.bottom + 8, maxY))

    const previousQuery = slashQuery.value
    const previousIndex = slashIndex.value
    slashQuery.value = query

    const canPreserve = Boolean(opts?.preserveIndex) && previousQuery === query
    slashIndex.value = canPreserve ? previousIndex : 0
    slashOpen.value = visibleSlashCommands.value.length > 0

    if (slashOpen.value && canPreserve) {
      slashIndex.value = Math.max(0, Math.min(slashIndex.value, visibleSlashCommands.value.length - 1))
    }
  }

  function syncSlashMenuFromSelection(opts?: { preserveIndex?: boolean }) {
    const slash = readSlashContext()
    if (slash && slashActivatedByUser.value) {
      openSlashAtSelection(slashQuery.value || slash.query, { preserveIndex: opts?.preserveIndex ?? true })
      return
    }
    closeSlashMenu()
    if (!slash) slashActivatedByUser.value = false
  }

  return {
    slashOpen,
    slashIndex,
    slashLeft,
    slashTop,
    slashQuery,
    slashActivatedByUser,
    visibleSlashCommands,
    closeSlashMenu,
    dismissSlashMenu,
    markSlashActivatedByUser,
    setSlashQuery,
    currentTextSelectionContext,
    readSlashContext,
    openSlashAtSelection,
    syncSlashMenuFromSelection
  }
}
