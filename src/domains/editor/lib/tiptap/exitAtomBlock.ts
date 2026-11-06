/** Keyboard exit from textarea-backed blocks into the following editor paragraph. */
import type { Editor } from '@tiptap/core'

/** Moves focus after the block, creating a paragraph if necessary. */
export function exitAtomBlock(event: KeyboardEvent, editor: Editor, getPos?: () => number | undefined): boolean {
  if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || !editor.isEditable || !getPos) return false
  const pos = getPos()
  if (typeof pos !== 'number') return false
  const block = editor.state.doc.nodeAt(pos)
  if (!block) return false
  const after = pos + block.nodeSize
  const next = editor.state.doc.nodeAt(after)
  if (next?.type.name !== 'paragraph') {
    if (!editor.commands.insertContentAt(after, { type: 'paragraph' })) return false
  }
  event.preventDefault()
  event.stopPropagation()
  editor.commands.focus(after + 1)
  return true
}
