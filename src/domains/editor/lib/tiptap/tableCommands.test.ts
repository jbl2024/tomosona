import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/vue-3'
import { applyTableAction } from './tableCommands'

const tablePmMocks = vi.hoisted(() => ({
  isInTable: vi.fn(),
  selectedRect: vi.fn()
}))

vi.mock('prosemirror-tables', () => ({
  isInTable: tablePmMocks.isInTable,
  selectedRect: tablePmMocks.selectedRect
}))

type ChainStub = {
  focus: ReturnType<typeof vi.fn>
  addRowBefore: ReturnType<typeof vi.fn>
  addRowAfter: ReturnType<typeof vi.fn>
  deleteRow: ReturnType<typeof vi.fn>
  addColumnBefore: ReturnType<typeof vi.fn>
  addColumnAfter: ReturnType<typeof vi.fn>
  deleteColumn: ReturnType<typeof vi.fn>
  toggleHeaderRow: ReturnType<typeof vi.fn>
  toggleHeaderColumn: ReturnType<typeof vi.fn>
  toggleHeaderCell: ReturnType<typeof vi.fn>
  deleteTable: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
}

function createEditorStub() {
  const chain: ChainStub = {
    focus: vi.fn(() => chain),
    addRowBefore: vi.fn(() => chain),
    addRowAfter: vi.fn(() => chain),
    deleteRow: vi.fn(() => chain),
    addColumnBefore: vi.fn(() => chain),
    addColumnAfter: vi.fn(() => chain),
    deleteColumn: vi.fn(() => chain),
    toggleHeaderRow: vi.fn(() => chain),
    toggleHeaderColumn: vi.fn(() => chain),
    toggleHeaderCell: vi.fn(() => chain),
    deleteTable: vi.fn(() => chain),
    run: vi.fn(() => true)
  }

  const tr = {
    setNodeMarkup: vi.fn(() => tr)
  }
  const dispatch = vi.fn()
  const editor = {
    chain: vi.fn(() => chain),
    state: { tr } as any,
    view: { dispatch } as any
  } as unknown as Editor

  return { editor, chain, tr, dispatch }
}

describe('applyTableAction', () => {
  it('routes row/column/header/table commands through chain focus run', () => {
    const { editor, chain } = createEditorStub()

    tablePmMocks.isInTable.mockReturnValue(false)
    applyTableAction(editor, 'add_row_before')
    applyTableAction(editor, 'add_row_after')
    applyTableAction(editor, 'delete_row')
    applyTableAction(editor, 'add_col_before')
    applyTableAction(editor, 'add_col_after')
    applyTableAction(editor, 'delete_col')
    applyTableAction(editor, 'toggle_header_row')
    applyTableAction(editor, 'toggle_header_col')
    applyTableAction(editor, 'toggle_header_cell')
    applyTableAction(editor, 'delete_table')

    expect(chain.focus).toHaveBeenCalledTimes(10)
    expect(chain.addRowBefore).toHaveBeenCalledTimes(1)
    expect(chain.addRowAfter).toHaveBeenCalledTimes(1)
    expect(chain.deleteRow).toHaveBeenCalledTimes(1)
    expect(chain.addColumnBefore).toHaveBeenCalledTimes(1)
    expect(chain.addColumnAfter).toHaveBeenCalledTimes(1)
    expect(chain.deleteColumn).toHaveBeenCalledTimes(1)
    expect(chain.toggleHeaderRow).toHaveBeenCalledTimes(1)
    expect(chain.toggleHeaderColumn).toHaveBeenCalledTimes(1)
    expect(chain.toggleHeaderCell).toHaveBeenCalledTimes(1)
    expect(chain.deleteTable).toHaveBeenCalledTimes(1)
    expect(chain.run).toHaveBeenCalledTimes(10)
  })

  it('aligns the full selected column range and dispatches a single transaction', () => {
    const { editor, tr, dispatch } = createEditorStub()
    tablePmMocks.isInTable.mockReturnValue(true)
    const map = {
      height: 3,
      cellsInRect: vi.fn(() => [2, 2, 6, 10])
    }
    const table = {
      nodeAt: vi.fn((pos: number) => ({ attrs: { textAlign: pos === 6 ? 'center' : null } }))
    }
    tablePmMocks.selectedRect.mockReturnValue({
      left: 1,
      right: 2,
      map,
      table,
      tableStart: 20
    })

    const handled = applyTableAction(editor, 'align_col_center')

    expect(handled).toBe(true)
    expect(map.cellsInRect).toHaveBeenCalledWith({ left: 1, right: 2, top: 0, bottom: 3 })
    expect(tr.setNodeMarkup).toHaveBeenCalledTimes(2)
    expect(tr.setNodeMarkup).toHaveBeenNthCalledWith(1, 22, null, { textAlign: 'center' })
    expect(tr.setNodeMarkup).toHaveBeenNthCalledWith(2, 30, null, { textAlign: 'center' })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('returns false for align when nothing changes', () => {
    const { editor, tr, dispatch } = createEditorStub()
    tablePmMocks.isInTable.mockReturnValue(true)
    tablePmMocks.selectedRect.mockReturnValue({
      left: 0,
      right: 1,
      map: {
        height: 2,
        cellsInRect: vi.fn(() => [1, 4])
      },
      table: {
        nodeAt: vi.fn(() => ({ attrs: { textAlign: 'left' } }))
      },
      tableStart: 9
    })

    const handled = applyTableAction(editor, 'align_col_left')
    expect(handled).toBe(false)
    expect(tr.setNodeMarkup).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('returns false for unknown action id', () => {
    const { editor, chain } = createEditorStub()

    expect(applyTableAction(editor, 'unknown_action' as never)).toBe(false)
    expect(chain.focus).not.toHaveBeenCalled()
    expect(chain.run).not.toHaveBeenCalled()
  })
})
