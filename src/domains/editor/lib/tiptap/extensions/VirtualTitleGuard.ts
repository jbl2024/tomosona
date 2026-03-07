import { Extension } from '@tiptap/core'

function isFirstVirtualHeading(state: { doc: { firstChild?: { type: { name: string }; attrs?: Record<string, unknown>; textContent?: string } }; selection: { $from: { pos: number; parentOffset: number }; empty: boolean } }) {
  const first = state.doc.firstChild
  if (!first || first.type.name !== 'heading') return false
  if (!first.attrs?.isVirtualTitle) return false
  const text = (first.textContent ?? '').trim()
  const atStart = state.selection.$from.pos <= 2 || state.selection.$from.parentOffset === 0
  return state.selection.empty && atStart && text.length === 0
}

export const VirtualTitleGuard = Extension.create({
  name: 'virtualTitleGuard',

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        return isFirstVirtualHeading(editor.state as never)
      }
    }
  }
})
