import type { Editor } from '@tiptap/vue-3'
import { isInTable, selectedRect } from 'prosemirror-tables'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { TableActionId } from './tableToolbarActions'

type TableColumnAlign = 'left' | 'center' | 'right'

/**
 * Applies `textAlign` to the currently selected table column range.
 *
 * Why:
 * - `setCellAttribute` only targets the active cell (or a cell selection), while
 *   table column alignment must be persisted at column level.
 */
function setSelectedColumnsAlign(
  state: EditorState,
  align: TableColumnAlign,
  dispatch?: (tr: Transaction) => void
): boolean {
  if (!isInTable(state)) return false
  const rect = selectedRect(state)
  const positions = rect.map.cellsInRect({
    left: rect.left,
    right: rect.right,
    top: 0,
    bottom: rect.map.height
  })
  const unique = new Set<number>(positions)
  const tr = state.tr
  let changed = false

  for (const relativePos of unique) {
    const cell = rect.table.nodeAt(relativePos)
    if (!cell || cell.attrs.textAlign === align) continue
    tr.setNodeMarkup(rect.tableStart + relativePos, null, {
      ...cell.attrs,
      textAlign: align
    })
    changed = true
  }

  if (!changed) return false
  if (dispatch) dispatch(tr)
  return true
}

function applyColumnAlign(editor: Editor, align: TableColumnAlign): boolean {
  return setSelectedColumnsAlign(editor.state, align, (tr) => editor.view.dispatch(tr))
}

/**
 * Applies a table toolbar action against the current editor selection.
 * Returns false for non-executable pseudo actions (merge/split disabled entries).
 */
export function applyTableAction(editor: Editor, actionId: TableActionId): boolean {
  if (actionId === 'add_row_before') return editor.chain().focus().addRowBefore().run()
  if (actionId === 'add_row_after') return editor.chain().focus().addRowAfter().run()
  if (actionId === 'delete_row') return editor.chain().focus().deleteRow().run()
  if (actionId === 'add_col_before') return editor.chain().focus().addColumnBefore().run()
  if (actionId === 'add_col_after') return editor.chain().focus().addColumnAfter().run()
  if (actionId === 'delete_col') return editor.chain().focus().deleteColumn().run()
  if (actionId === 'align_col_left') return applyColumnAlign(editor, 'left')
  if (actionId === 'align_col_center') return applyColumnAlign(editor, 'center')
  if (actionId === 'align_col_right') return applyColumnAlign(editor, 'right')
  if (actionId === 'toggle_header_row') return editor.chain().focus().toggleHeaderRow().run()
  if (actionId === 'toggle_header_col') return editor.chain().focus().toggleHeaderColumn().run()
  if (actionId === 'toggle_header_cell') return editor.chain().focus().toggleHeaderCell().run()
  if (actionId === 'delete_table') return editor.chain().focus().deleteTable().run()
  return false
}
