import { Extension, type Editor } from '@tiptap/vue-3'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Transient passage highlight for search results.
 *
 * When a palette or search result opens a passage, the editor reveals the
 * matching text and flashes a highlight over it. The highlight is derived
 * state: it clears itself after a short timeout so the document stays
 * immediately editable with no residue. It deliberately does not clear on
 * document changes: automatic append transactions (e.g. the trailing
 * paragraph added after a table) would otherwise swallow a highlight set
 * in the same dispatch.
 */

type PassageHighlightRange = { from: number; to: number }

type PassageHighlightState = {
  range: PassageHighlightRange | null
  decorations: DecorationSet
}

const PASSAGE_HIGHLIGHT_KEY = new PluginKey<PassageHighlightState>('tomosona-passage-highlight')

/** Highlight class styled in EditorViewContent.css. */
export const PASSAGE_HIGHLIGHT_CLASS = 'tomosona-passage-highlight'

/** How long the reveal highlight stays before clearing itself. */
export const PASSAGE_HIGHLIGHT_CLEAR_MS = 2000

function buildDecorations(state: EditorState, range: PassageHighlightRange): DecorationSet {
  const node = state.doc.nodeAt(range.from)
  // A range exactly covering a whole text node is not painted inside table
  // cells (the prosemirror-tables cell view drops it); two adjacent strict
  // subranges paint identically everywhere.
  if (node?.isText && node.nodeSize >= 2 && range.to === range.from + node.nodeSize) {
    const mid = range.from + Math.floor(node.nodeSize / 2)
    return DecorationSet.create(state.doc, [
      Decoration.inline(range.from, mid, { class: PASSAGE_HIGHLIGHT_CLASS }),
      Decoration.inline(mid, range.to, { class: PASSAGE_HIGHLIGHT_CLASS })
    ])
  }
  // Atom block nodes (callouts keep their text in attributes) cannot carry
  // inline decorations; a range covering a whole atom decorates the node.
  // Text nodes report isAtom too, so this check must come after the text case.
  if (node && !node.isText && node.isAtom && range.to === range.from + node.nodeSize) {
    return DecorationSet.create(state.doc, [
      Decoration.node(range.from, range.to, { class: PASSAGE_HIGHLIGHT_CLASS })
    ])
  }
  return DecorationSet.create(state.doc, [
    Decoration.inline(range.from, range.to, { class: PASSAGE_HIGHLIGHT_CLASS })
  ])
}

function buildState(state: EditorState, range: PassageHighlightRange | null): PassageHighlightState {
  return {
    range,
    decorations: range ? buildDecorations(state, range) : DecorationSet.empty
  }
}

/** Flashes the highlight over a document range, replacing any previous one. */
export function setPassageHighlight(editor: Editor, range: PassageHighlightRange) {
  const docSize = editor.state?.doc?.content?.size ?? 0
  if (docSize <= 0 || range.from < 0 || range.to > docSize || range.from >= range.to) return
  editor.view.dispatch(editor.state.tr.setMeta(PASSAGE_HIGHLIGHT_KEY, { range }))
}

/** Clears the highlight immediately. */
export function clearPassageHighlight(editor: Editor) {
  if (!PASSAGE_HIGHLIGHT_KEY.getState(editor.state)?.range) return
  editor.view.dispatch(editor.state.tr.setMeta(PASSAGE_HIGHLIGHT_KEY, { range: null }))
}

export const PassageHighlightExtension = Extension.create({
  name: 'tomosonaPassageHighlight',

  addProseMirrorPlugins() {
    let clearTimer: ReturnType<typeof setTimeout> | null = null

    return [
      new Plugin<PassageHighlightState>({
        key: PASSAGE_HIGHLIGHT_KEY,
        state: {
          init: () => buildState(this.editor.state, null),
          apply: (transaction: Transaction, value: PassageHighlightState, _oldState, newState) => {
            const meta = transaction.getMeta(PASSAGE_HIGHLIGHT_KEY) as { range: PassageHighlightRange | null } | undefined
            if (meta) return buildState(newState, meta.range)
            // Without meta the state is returned as-is so ProseMirror maps the
            // decorations through the transaction.
            return value
          }
        },
        props: {
          decorations(state: EditorState) {
            return PASSAGE_HIGHLIGHT_KEY.getState(state)?.decorations ?? DecorationSet.empty
          }
        },
        view: () => ({
          update(view, prevState) {
            const current = PASSAGE_HIGHLIGHT_KEY.getState(view.state)?.range ?? null
            const previous = PASSAGE_HIGHLIGHT_KEY.getState(prevState)?.range ?? null
            if (!current) {
              if (clearTimer) {
                clearTimeout(clearTimer)
                clearTimer = null
              }
              return
            }
            if (current === previous && clearTimer) return
            if (clearTimer) clearTimeout(clearTimer)
            clearTimer = setTimeout(() => {
              clearTimer = null
              view.dispatch(view.state.tr.setMeta(PASSAGE_HIGHLIGHT_KEY, { range: null }))
            }, PASSAGE_HIGHLIGHT_CLEAR_MS)
          },
          destroy() {
            if (clearTimer) clearTimeout(clearTimer)
            clearTimer = null
          }
        })
      })
    ]
  }
})
