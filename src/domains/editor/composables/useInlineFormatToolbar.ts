import { ref, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { NodeSelection } from '@tiptap/pm/state'
import { WIKILINK_STATE_KEY } from '../lib/tiptap/plugins/wikilinkState'
import { unaiText } from '../lib/unaiText'

/**
 * Inline text marks controlled by the floating formatting toolbar.
 */
export type InlineFormatMark = 'bold' | 'italic' | 'strike' | 'underline' | 'code'

/**
 * Supported active-state keys, including `link` for UI highlighting.
 */
export type InlineFormatMarkOrLink = InlineFormatMark | 'link'

type SelectionRange = { from: number; to: number }

/**
 * Runtime dependencies owned by the host view (`EditorView`).
 */
type UseInlineFormatToolbarOptions = {
  holder: Ref<HTMLElement | null>
  getEditor: () => Editor | null
  sanitizeHref: (raw: string) => string | null
}

/**
 * useInlineFormatToolbar
 *
 * Centralizes all floating inline-toolbar behavior (positioning, mark toggles,
 * and link editing) so `EditorView.vue` stays lean.
 *
 * How to use:
 * - Instantiate once in the host component.
 * - Call `updateFormattingToolbar()` from selection/update hooks.
 * - Bind returned refs/actions into the toolbar UI component.
 *
 * Important invariants:
 * - Link operations restore a captured text selection before applying commands.
 *   This keeps link apply/remove stable even after the URL input takes focus.
 * - Empty or node selections always close the toolbar.
 */
export function useInlineFormatToolbar(options: UseInlineFormatToolbarOptions) {
  const formatToolbarOpen = ref(false)
  const formatToolbarLeft = ref(0)
  const formatToolbarTop = ref(0)
  const toolbarHeight = ref(44)
  const toolbarWidth = ref(0)
  const pointerSelectionActive = ref(false)
  const linkPopoverOpen = ref(false)
  const linkValue = ref('')
  const linkError = ref('')
  const selectionSnapshot = ref<SelectionRange | null>(null)

  function clearLinkState() {
    linkPopoverOpen.value = false
    linkValue.value = ''
    linkError.value = ''
  }

  function isInternalAnchorHref(raw: string): boolean {
    const value = String(raw ?? '').trim()
    return value.startsWith('#') && value.length > 1
  }

  /**
   * Fully closes the toolbar and clears link-editor transient state.
   */
  function closeToolbar() {
    formatToolbarOpen.value = false
    clearLinkState()
  }

  /**
   * Tracks whether a mouse-driven text selection is still in progress.
   *
   * While active, the toolbar stays hidden so it only appears once the user
   * releases the mouse button and the selection is finished.
   */
  function setPointerSelectionActive(active: boolean) {
    pointerSelectionActive.value = active
    if (active) {
      closeToolbar()
    }
  }

  /**
   * Captures the current text selection used for later link apply/remove.
   */
  function captureSelectionRange(): SelectionRange | null {
    const editor = options.getEditor()
    if (!editor) return null
    if (editor.state.selection instanceof NodeSelection) return null
    const { from, to, empty } = editor.state.selection
    if (empty || from === to) return null
    const snapshot = { from, to }
    selectionSnapshot.value = snapshot
    return snapshot
  }

  /**
   * Restores the selection captured before opening the link popover.
   */
  function restoreSelectionRange() {
    const editor = options.getEditor()
    const snapshot = selectionSnapshot.value
    if (!editor || !snapshot) return
    editor.chain().focus().setTextSelection(snapshot).run()
  }

  /**
   * Recomputes toolbar position from current selection.
   */
  function updateFormattingToolbar() {
    const editor = options.getEditor()
    const holderEl = options.holder.value
    if (!editor || !holderEl) {
      closeToolbar()
      return
    }

    if (pointerSelectionActive.value) {
      closeToolbar()
      return
    }

    if (editor.state.selection instanceof NodeSelection) {
      closeToolbar()
      return
    }

    const { from, to, empty } = editor.state.selection
    if (empty || from === to) {
      closeToolbar()
      return
    }

    const start = editor.view.coordsAtPos(from)
    const end = editor.view.coordsAtPos(to)
    const holderRect = holderEl.getBoundingClientRect()
    const centerX = (start.left + end.right) / 2
    const measuredToolbarHeight = Math.max(0, toolbarHeight.value || 44)
    const measuredToolbarWidth = Math.max(0, toolbarWidth.value || 0)
    const viewportPadding = 8
    const selectionTop = Math.min(start.top, end.top) - holderRect.top + holderEl.scrollTop
    const selectionBottom = Math.max(start.bottom, end.bottom) - holderRect.top + holderEl.scrollTop
    const viewportTop = holderEl.scrollTop + viewportPadding
    const viewportBottom = holderEl.scrollTop + holderEl.clientHeight - viewportPadding
    const aboveRenderedTop = selectionTop - 10 - measuredToolbarHeight
    const belowRenderedTop = selectionBottom + 10

    let renderedTop = aboveRenderedTop
    if (renderedTop < viewportTop) {
      renderedTop = belowRenderedTop + measuredToolbarHeight <= viewportBottom ? belowRenderedTop : viewportTop
    } else if (renderedTop + measuredToolbarHeight > viewportBottom) {
      renderedTop = belowRenderedTop + measuredToolbarHeight <= viewportBottom
        ? belowRenderedTop
        : Math.max(viewportTop, viewportBottom - measuredToolbarHeight)
    }

    const rawLeft = centerX - holderRect.left + holderEl.scrollLeft - measuredToolbarWidth / 2
    const minLeft = holderEl.scrollLeft + viewportPadding
    const maxLeft = holderEl.scrollLeft + holderEl.clientWidth - measuredToolbarWidth - viewportPadding
    const clampedLeft = maxLeft >= minLeft ? Math.min(Math.max(rawLeft, minLeft), maxLeft) : minLeft

    formatToolbarLeft.value = clampedLeft + measuredToolbarWidth / 2
    formatToolbarTop.value = renderedTop + measuredToolbarHeight
    formatToolbarOpen.value = true
  }

  /**
   * Records the current rendered toolbar height so selection positioning can
   * keep the toolbar inside the visible viewport.
   */
  function setToolbarHeight(height: number) {
    toolbarHeight.value = Math.max(0, height)
  }

  /**
   * Records the current rendered toolbar size so positioning can stay inside
   * the active pane even when the toolbar is wider than the split pane.
   */
  function setToolbarSize(size: { height?: number; width?: number }) {
    if (typeof size.height === 'number') {
      toolbarHeight.value = Math.max(0, size.height)
    }
    if (typeof size.width === 'number') {
      toolbarWidth.value = Math.max(0, size.width)
    }
    if (formatToolbarOpen.value) {
      updateFormattingToolbar()
    }
  }

  /**
   * Checks whether a mark (or link) is active at current selection.
   */
  function isMarkActive(name: InlineFormatMarkOrLink): boolean {
    const editor = options.getEditor()
    if (!editor) return false
    return editor.isActive(name)
  }

  /**
   * Toggles a text mark and then refreshes toolbar visibility/position.
   */
  function toggleMark(name: InlineFormatMark) {
    const editor = options.getEditor()
    if (!editor) return
    const chain = editor.chain().focus()
    if (name === 'bold') chain.toggleBold().run()
    if (name === 'italic') chain.toggleItalic().run()
    if (name === 'strike') chain.toggleStrike().run()
    if (name === 'underline') chain.toggleUnderline().run()
    if (name === 'code') chain.toggleCode().run()
    updateFormattingToolbar()
  }

  /**
   * Opens link popover and seeds URL from active link or `https://`.
   */
  function openLinkPopover() {
    const editor = options.getEditor()
    if (!editor) return
    const snapshot = captureSelectionRange()
    if (!snapshot) return
    const existingHref = editor.getAttributes('link').href as string | undefined
    linkValue.value = (existingHref ?? 'https://').trim() || 'https://'
    linkError.value = ''
    linkPopoverOpen.value = true
  }

  /**
   * Replaces current selection with a wikilink draft and enters wikilink edit mode.
   */
  function wrapSelectionWithWikilink() {
    const editor = options.getEditor()
    if (!editor) return
    if (editor.state.selection instanceof NodeSelection) return
    const { from, to, empty } = editor.state.selection
    if (empty || from === to) return

    const selectedText = editor.state.doc.textBetween(from, to, ' ', ' ')
    const target = selectedText
      .replace(/\r?\n/g, ' ')
      .replace(/[\[\]\|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const token = target ? `[[${target}]]` : '[[]]'
    const caret = target ? from + token.length - 2 : from + 2

    const tr = editor.state.tr.insertText(token, from, to)
    editor.view.dispatch(tr)
    editor.chain().focus().setTextSelection(caret).run()

    const range = { from, to: from + token.length }
    editor.view.dispatch(editor.state.tr.setMeta(WIKILINK_STATE_KEY, { type: 'startEditing', range }))
    closeToolbar()
  }

  /**
   * Converts typographic punctuation in the selection to plain Markdown-safe
   * punctuation without flattening its blocks or inline formatting.
   */
  function unaiSelection() {
    const editor = options.getEditor()
    if (!editor || editor.state.selection instanceof NodeSelection) return false
    const { from, to, empty } = editor.state.selection
    if (empty || from === to) return false

    const replacements: Array<{ from: number; to: number; text: string; marks: unknown }> = []
    editor.state.doc.nodesBetween(from, to, (node, position) => {
      if (!node.isText || !node.text) return
      const start = Math.max(0, from - position)
      const end = Math.min(node.text.length, to - position)
      const original = node.text.slice(start, end)
      const normalized = unaiText(original)
      if (original === normalized) return
      replacements.push({
        from: position + start,
        to: position + end,
        text: normalized,
        marks: node.marks
      })
    })
    if (!replacements.length) return false

    let transaction = editor.state.tr
    for (const replacement of replacements.sort((left, right) => right.from - left.from)) {
      transaction = transaction.replaceWith(
        replacement.from,
        replacement.to,
        editor.state.schema.text(replacement.text, replacement.marks as never)
      )
    }
    editor.view.dispatch(transaction)
    updateFormattingToolbar()
    return true
  }

  /**
   * Applies link edits:
   * - empty URL => remove link
   * - invalid URL => keep popover open with validation error
   * - valid URL => set link with safe external attrs
   */
  function applyLink() {
    const editor = options.getEditor()
    if (!editor) return false
    restoreSelectionRange()
    const href = linkValue.value.trim()
    if (!href) {
      editor.chain().focus().unsetLink().run()
      clearLinkState()
      updateFormattingToolbar()
      return true
    }

    if (isInternalAnchorHref(href)) {
      editor
        .chain()
        .focus()
        .setLink({ href })
        .run()
      clearLinkState()
      updateFormattingToolbar()
      return true
    }

    const safeHref = options.sanitizeHref(href)
    if (!safeHref) {
      linkError.value = 'Enter a valid link (#section, http://, https://, or mailto:).'
      return false
    }

    editor
      .chain()
      .focus()
      .setLink({ href: safeHref, target: '_blank', rel: 'noopener noreferrer' })
      .run()
    clearLinkState()
    updateFormattingToolbar()
    return true
  }

  /**
   * Removes link at captured selection and closes popover state.
   */
  function unlinkLink() {
    const editor = options.getEditor()
    if (!editor) return
    restoreSelectionRange()
    editor.chain().focus().unsetLink().run()
    clearLinkState()
    updateFormattingToolbar()
  }

  /**
   * Closes the link popover without mutating document content.
   */
  function cancelLink() {
    clearLinkState()
    updateFormattingToolbar()
  }

  /**
   * External "hard close" API used by host reset flows.
   */
  function dismissToolbar() {
    closeToolbar()
  }

  return {
    formatToolbarOpen,
    formatToolbarLeft,
    formatToolbarTop,
    linkPopoverOpen,
    linkValue,
    linkError,
    updateFormattingToolbar,
    setPointerSelectionActive,
    isMarkActive,
    toggleMark,
    unaiSelection,
    openLinkPopover,
    wrapSelectionWithWikilink,
    applyLink,
    unlinkLink,
    cancelLink,
    setToolbarHeight,
    setToolbarSize,
    dismissToolbar
  }
}
