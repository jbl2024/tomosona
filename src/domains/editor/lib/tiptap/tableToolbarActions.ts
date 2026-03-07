/**
 * Table toolbar command identifiers exposed by EditorView.
 *
 * Keep ids stable because tests and UI bindings use them as selectors.
 */
export type TableActionId =
  | 'add_row_before'
  | 'add_row_after'
  | 'delete_row'
  | 'add_col_before'
  | 'add_col_after'
  | 'delete_col'
  | 'toggle_header_row'
  | 'toggle_header_col'
  | 'toggle_header_cell'
  | 'align_col_left'
  | 'align_col_center'
  | 'align_col_right'
  | 'delete_table'

export type TableActionGroup = 'rows' | 'columns' | 'header' | 'table'

export type TableToolbarAction = {
  id: TableActionId
  label: string
  group: TableActionGroup
  disabled: boolean
  disabledReason?: string
}

export type TableCommandCapabilities = {
  addRowBefore: boolean
  addRowAfter: boolean
  deleteRow: boolean
  addColumnBefore: boolean
  addColumnAfter: boolean
  deleteColumn: boolean
  toggleHeaderRow: boolean
  toggleHeaderColumn: boolean
  toggleHeaderCell: boolean
  alignColumnLeft: boolean
  alignColumnCenter: boolean
  alignColumnRight: boolean
  deleteTable: boolean
}

export function buildTableToolbarActions(
  capabilities: TableCommandCapabilities
): TableToolbarAction[] {
  return [
    {
      id: 'add_row_before',
      label: 'Add row above',
      group: 'rows',
      disabled: !capabilities.addRowBefore
    },
    {
      id: 'add_row_after',
      label: 'Add row below',
      group: 'rows',
      disabled: !capabilities.addRowAfter
    },
    {
      id: 'delete_row',
      label: 'Delete row',
      group: 'rows',
      disabled: !capabilities.deleteRow
    },
    {
      id: 'add_col_before',
      label: 'Add column left',
      group: 'columns',
      disabled: !capabilities.addColumnBefore
    },
    {
      id: 'add_col_after',
      label: 'Add column right',
      group: 'columns',
      disabled: !capabilities.addColumnAfter
    },
    {
      id: 'delete_col',
      label: 'Delete column',
      group: 'columns',
      disabled: !capabilities.deleteColumn
    },
    {
      id: 'align_col_left',
      label: 'Align left',
      group: 'columns',
      disabled: !capabilities.alignColumnLeft
    },
    {
      id: 'align_col_center',
      label: 'Align center',
      group: 'columns',
      disabled: !capabilities.alignColumnCenter
    },
    {
      id: 'align_col_right',
      label: 'Align right',
      group: 'columns',
      disabled: !capabilities.alignColumnRight
    },
    {
      id: 'toggle_header_row',
      label: 'Toggle header row',
      group: 'header',
      disabled: !capabilities.toggleHeaderRow
    },
    {
      id: 'toggle_header_col',
      label: 'Toggle header column',
      group: 'header',
      disabled: !capabilities.toggleHeaderColumn
    },
    {
      id: 'toggle_header_cell',
      label: 'Toggle header cell',
      group: 'header',
      disabled: !capabilities.toggleHeaderCell
    },
    {
      id: 'delete_table',
      label: 'Delete table',
      group: 'table',
      disabled: !capabilities.deleteTable
    }
  ]
}
