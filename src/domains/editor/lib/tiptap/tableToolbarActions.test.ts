import { describe, expect, it } from 'vitest'
import { buildTableToolbarActions, type TableCommandCapabilities } from './tableToolbarActions'

const ALL_ENABLED: TableCommandCapabilities = {
  addRowBefore: true,
  addRowAfter: true,
  deleteRow: true,
  addColumnBefore: true,
  addColumnAfter: true,
  deleteColumn: true,
  toggleHeaderRow: true,
  toggleHeaderColumn: true,
  toggleHeaderCell: true,
  alignColumnLeft: true,
  alignColumnCenter: true,
  alignColumnRight: true,
  deleteTable: true
}

describe('buildTableToolbarActions', () => {
  it('maps command capabilities to enabled state', () => {
    const actions = buildTableToolbarActions({
      ...ALL_ENABLED,
      deleteRow: false,
      toggleHeaderColumn: false
    })

    const deleteRow = actions.find((action) => action.id === 'delete_row')
    const toggleHeaderColumn = actions.find((action) => action.id === 'toggle_header_col')
    const deleteTable = actions.find((action) => action.id === 'delete_table')

    expect(deleteRow?.disabled).toBe(true)
    expect(toggleHeaderColumn?.disabled).toBe(true)
    expect(deleteTable?.disabled).toBe(false)
  })

  it('does not include merge/split actions in markdown-safe mode', () => {
    const actions = buildTableToolbarActions(ALL_ENABLED)
    const ids = actions.map((entry) => entry.id)

    expect(ids).not.toContain('merge_cells_disabled')
    expect(ids).not.toContain('split_cell_disabled')
  })

  it('keeps stable sections ordering for rows/columns/header/table', () => {
    const actions = buildTableToolbarActions(ALL_ENABLED)
    const groups = Array.from(new Set(actions.map((entry) => entry.group)))
    expect(groups).toEqual(['rows', 'columns', 'header', 'table'])
    expect(actions.some((entry) => entry.id === 'align_col_left')).toBe(true)
    expect(actions.some((entry) => entry.id === 'align_col_center')).toBe(true)
    expect(actions.some((entry) => entry.id === 'align_col_right')).toBe(true)
  })
})
