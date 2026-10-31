import type { Editor } from '@tiptap/vue-3'
import { setPassageHighlight } from '../lib/tiptap/extensions/PassageHighlight'
import { snippetRevealTargets } from '../../../shared/lib/searchSnippets'

/**
 * useEditorNavigation
 *
 * Purpose:
 * - Own outline extraction and reveal/focus helpers for the TipTap-based editor.
 *
 * Responsibilities:
 * - Parse level 1..3 headings from the TipTap body.
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Creates navigation helpers bound to the current TipTap editor instance.
 */
export function useEditorNavigation(options: UseEditorNavigationOptions) {
  let outlineTimer: ReturnType<typeof setTimeout> | null = null

  function scrollPosIntoCenter(pos: number) {
    const editor = options.getEditor()
    if (!editor) return

    const holder = editor.view.dom.closest('.editor-holder') as HTMLElement | null
    if (!holder) {
      editor.chain().focus(pos, { scrollIntoView: true }).run()
      return
    }

    editor.commands.setTextSelection(pos)
    try {
      editor.view.dom.focus({ preventScroll: true })
    } catch {
      editor.view.dom.focus()
    }

    const coords = editor.view.coordsAtPos(pos)
    const holderRect = holder.getBoundingClientRect()
    const absoluteTop = holder.scrollTop + (coords.top - holderRect.top)
    const targetTop = clamp(
      absoluteTop - holder.clientHeight / 2,
      0,
      Math.max(0, holder.scrollHeight - holder.clientHeight)
    )

    holder.scrollTo({
      top: targetTop,
      behavior: 'smooth'
    })
  }

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
      if (visibleIndex === index) {
        targetPos = pos + 1
        return false
      }
      visibleIndex += 1
    })

    if (targetPos <= 0) return
    scrollPosIntoCenter(targetPos)
  }

  /** A reveal target range in document coordinates. */
  type RevealMatch = { from: number; to: number }

  /** Splits normalized text into unicode word tokens for context scoring. */
  function wordsOf(text: string): string[] {
    return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  }

  /**
   * Words of the snippet window, used to disambiguate multiple occurrences
   * of a short candidate: the reveal targets the occurrence whose surrounding
   * block shares the most words with the window (FTS snippets wrap the match
   * with its original context).
   */
  function snippetContextWords(snippet: string): Set<string> {
    const plain = snippet
      .replace(/<[^>]*>/g, ' ')
      .replace(/^\s*\.{3}/, '')
      .replace(/\.{3}\s*$/, '')
    return new Set(wordsOf(plain))
  }

  function scoreOccurrenceContext(editor: Editor, from: number, contextWords: Set<string>): number {
    if (!contextWords.size) return 0
    const container = editor.state.doc.resolve(from).parent
    const tokens = wordsOf(container.textContent ?? '')
    let score = 0
    for (const token of tokens) {
      if (contextWords.has(token)) score += 1
    }
    return score
  }

  /**
   * Finds the best location containing `target`: a text node hit, or an atom
   * node whose text-bearing attribute (`message`, e.g. callouts) matches.
   * When several occurrences exist, the one whose surrounding block shares
   * the most snippet context wins; ties keep the first. Atom matches cover
   * the whole node so the highlight can decorate it.
   */
  function findRevealMatch(editor: Editor, target: string, contextWords: Set<string>): RevealMatch | null {
    const needle = target.toLowerCase()
    // Holder object: closure assignments are not tracked by control flow.
    const best: { match: RevealMatch | null; score: number } = { match: null, score: -1 }
    editor.state.doc.descendants((node, pos) => {
      const text = node.isText
        ? node.text ?? ''
        : typeof node.attrs?.message === 'string'
          ? node.attrs.message
          : ''
      if (!text) return
      const value = text.replace(/\s+/g, ' ').toLowerCase()
      let idx = value.indexOf(needle)
      while (idx >= 0) {
        const from = node.isText ? pos + idx : pos
        const to = node.isText ? from + target.length : pos + node.nodeSize
        const score = scoreOccurrenceContext(editor, from, contextWords)
        if (best.match === null || score > best.score) {
          best.match = { from, to }
          best.score = score
        }
        idx = value.indexOf(needle, idx + needle.length)
      }
    })
    return best.match
  }

  /**
   * Reveals the first text node matching the snippet. The index marks matches
   * with `<b>` and truncates windows with `...`, so candidates go from the
   * full window text to each highlighted segment until one matches the
   * rendered document. Returns whether a match was revealed, so callers can
   * retry while a freshly opened document is still loading.
   */
  async function revealSnippet(snippet: string): Promise<boolean> {
    const editor = options.getEditor()
    if (!editor || !snippet) return false

    const targets = snippetRevealTargets(snippet)
    if (!targets.length) return false
    const contextWords = snippetContextWords(snippet)

    for (const target of targets) {
      const match = findRevealMatch(editor, target, contextWords)
      if (!match) continue
      scrollPosIntoCenter(match.from + 1)
      // Flash a transient highlight over the revealed passage (clears on first
      // edit or after a timeout, so the document stays immediately editable).
      setPassageHighlight(editor, match)
      return true
    }
    return false
  }

  /** Reveals a heading anchor or `^block-id` anchor and returns success. */
  async function revealAnchor(anchor: RevealAnchorRequest): Promise<boolean> {
    const editor = options.getEditor()
    if (!editor || (!anchor.heading && !anchor.blockId)) return false

    let targetPos = -1
    if (anchor.heading) {
      const wanted = options.normalizeHeadingAnchor(anchor.heading)
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'heading') return
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
    scrollPosIntoCenter(targetPos)
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
