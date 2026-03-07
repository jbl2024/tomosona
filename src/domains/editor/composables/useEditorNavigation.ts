import type { Editor } from '@tiptap/vue-3'

/**
 * useEditorNavigation
 *
 * Purpose:
 * - Own outline extraction and reveal/focus helpers for the TipTap-based editor.
 *
 * Responsibilities:
 * - Parse level 1..3 headings while excluding virtual-title nodes.
 * - Debounce outline emission after document changes.
 * - Reveal outline headings, snippets, and anchors in the active editor document.
 *
 * Boundaries:
 * - Operates on a provided `Editor` getter and emits outline via callback.
 * - Does not mutate host session state or persistence metadata.
 */
export type EditorHeadingNode = { level: 1 | 2 | 3; text: string }

/**
 * Anchor lookup request accepted by `revealAnchor`.
 */
export type RevealAnchorRequest = { heading?: string; blockId?: string }

/**
 * Dependencies required by {@link useEditorNavigation}.
 */
export type UseEditorNavigationOptions = {
  getEditor: () => Editor | null
  emitOutline: (headings: EditorHeadingNode[]) => void
  normalizeHeadingAnchor: (heading: string) => string
  slugifyHeading: (heading: string) => string
  normalizeBlockId: (blockId: string) => string
}

/**
 * Detects block anchors such as "^task-12" inside plain text node content.
 */
function blockAnchorMatcher(blockIdRaw: string): RegExp {
  const escaped = blockIdRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)\\^${escaped}(\\s|$)`, 'i')
}

/**
 * Creates navigation helpers bound to the current TipTap editor instance.
 */
export function useEditorNavigation(options: UseEditorNavigationOptions) {
  let outlineTimer: ReturnType<typeof setTimeout> | null = null

  /** Clears any scheduled outline emission. */
  function clearOutlineTimer() {
    if (!outlineTimer) return
    clearTimeout(outlineTimer)
    outlineTimer = null
  }

  /** Parses current outline from heading nodes in the active document. */
  function parseOutlineFromDoc(): EditorHeadingNode[] {
    const editor = options.getEditor()
    if (!editor) return []

    const out: EditorHeadingNode[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name !== 'heading') return
      if (node.attrs.isVirtualTitle) return
      const text = node.textContent.trim()
      if (!text) return
      const rawLevel = Number(node.attrs.level ?? 2)
      const level = (rawLevel >= 1 && rawLevel <= 3 ? rawLevel : 3) as 1 | 2 | 3
      out.push({ level, text })
    })

    return out
  }

  /** Debounces outline emission to avoid flooding parent listeners during typing. */
  function emitOutlineSoon() {
    clearOutlineTimer()
    outlineTimer = setTimeout(() => {
      options.emitOutline(parseOutlineFromDoc())
    }, 120)
  }

  /** Moves caret/focus to the visible heading at the requested outline index. */
  async function revealOutlineHeading(index: number) {
    const editor = options.getEditor()
    if (!editor) return

    let visibleIndex = 0
    let targetPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'heading') return
      if (node.attrs.isVirtualTitle) return
      if (visibleIndex === index) {
        targetPos = pos + 1
        return false
      }
      visibleIndex += 1
    })

    if (targetPos <= 0) return
    // Keep navigation deterministic from side panes: focus directly at target position,
    // never via implicit "focus at end" fallback.
    editor.chain().focus(targetPos).scrollIntoView().run()
  }

  /** Reveals the first text node containing the normalized snippet text. */
  async function revealSnippet(snippet: string) {
    const editor = options.getEditor()
    if (!editor || !snippet) return

    const normalizedSnippet = snippet
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    if (!normalizedSnippet) return

    let targetPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return
      const value = (node.text ?? '').replace(/\s+/g, ' ').toLowerCase()
      const idx = value.indexOf(normalizedSnippet)
      if (idx >= 0) {
        targetPos = pos + idx
        return false
      }
    })

    if (targetPos <= 0) return
    editor.chain().focus(targetPos + 1).scrollIntoView().run()
  }

  /** Reveals a heading anchor or `^block-id` anchor and returns success. */
  async function revealAnchor(anchor: RevealAnchorRequest): Promise<boolean> {
    const editor = options.getEditor()
    if (!editor || (!anchor.heading && !anchor.blockId)) return false

    let targetPos = -1
    if (anchor.heading) {
      const wanted = options.normalizeHeadingAnchor(anchor.heading)
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'heading' || node.attrs.isVirtualTitle) return
        const text = node.textContent.trim()
        if (!text) return
        if (options.normalizeHeadingAnchor(text) === wanted || options.slugifyHeading(text) === options.slugifyHeading(anchor.heading ?? '')) {
          targetPos = pos + 1
          return false
        }
      })
    } else if (anchor.blockId) {
      const wanted = options.normalizeBlockId(anchor.blockId)
      const matcher = blockAnchorMatcher(wanted)
      editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return
        if (matcher.test(node.text ?? '')) {
          targetPos = pos + 1
          return false
        }
      })
    }

    if (targetPos <= 0) return false
    editor.chain().focus(targetPos).scrollIntoView().run()
    return true
  }

  return {
    parseOutlineFromDoc,
    emitOutlineSoon,
    clearOutlineTimer,
    revealOutlineHeading,
    revealSnippet,
    revealAnchor
  }
}
