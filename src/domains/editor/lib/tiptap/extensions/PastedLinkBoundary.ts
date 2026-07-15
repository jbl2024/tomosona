import { Extension } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { Plugin } from '@tiptap/pm/state'

/**
 * Ends a link mark created by paste at the new caret position.
 *
 * Tiptap keeps auto-linked marks inclusive so URLs typed character by character
 * continue to grow. After a paste, that behavior would incorrectly absorb the
 * text typed next. Existing link marks remain active when pasting inside them.
 */
export const PastedLinkBoundary = Extension.create({
  name: 'pastedLinkBoundary',

  addProseMirrorPlugins() {
    function hasActiveLink(state: EditorState): boolean {
      const link = state.schema.marks.link
      if (!link || !state.selection.empty) return false
      const marks = state.storedMarks ?? state.selection.$from.marks()
      return marks.some((mark) => mark.type === link)
    }

    return [
      new Plugin({
        appendTransaction(transactions, oldState, newState) {
          const isPaste = transactions.some((transaction) => (
            transaction.getMeta('uiEvent') === 'paste' || transaction.getMeta('applyPasteRules')
          ))
          if (!isPaste || hasActiveLink(oldState) || !hasActiveLink(newState)) return null

          return newState.tr.removeStoredMark(newState.schema.marks.link)
        }
      })
    ]
  }
})
