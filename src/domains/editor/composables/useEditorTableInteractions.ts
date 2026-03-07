import { ref, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { buildTableToolbarActions, type TableActionId, type TableCommandCapabilities, type TableToolbarAction } from '../lib/tiptap/tableToolbarActions'
import { applyTableAction } from '../lib/tiptap/tableCommands'

/**
 * Visibility refs owned by table edge controls composable.
 */
export type TableEdgeVisibilityState = {
  tableToolbarTriggerVisible: Ref<boolean>
  tableAddTopVisible: Ref<boolean>
  tableAddBottomVisible: Ref<boolean>
  tableAddLeftVisible: Ref<boolean>
  tableAddRightVisible: Ref<boolean>
}

/**
 * Dependencies required by {@link useEditorTableInteractions}.
 */
export type UseEditorTableInteractionsOptions = {
  getEditor: () => Editor | null
  holder: Ref<HTMLElement | null>
  floatingMenuEl: Ref<HTMLDivElement | null>
  visibility: TableEdgeVisibilityState
  hideEdgeControls: () => void
  updateEdgeControlsFromDistances: (distances: { top: number; bottom: number; left: number; right: number }) => void
  updateTableToolbarPosition: (cellEl: HTMLElement, tableEl: HTMLElement) => void
}

/**
 * useEditorTableInteractions
 *
 * Purpose:
 * - Centralize table-toolbar and edge-control interaction behavior.
 *
 * Responsibilities:
 * - Compute action capabilities and open/close toolbar state.
 * - Track pointer hover over table bounds and drive edge visibility updates.
 * - Execute table actions and trigger toolbar position refresh.
 */
export function useEditorTableInteractions(options: UseEditorTableInteractionsOptions) {
  const tableToolbarOpen = ref(false)
  const tableToolbarHovering = ref(false)
  const tableToolbarActions = ref<TableToolbarAction[]>([])
  let tableHoverHideTimer: ReturnType<typeof setTimeout> | null = null

  function activeTableElement(): HTMLElement | null {
    const editor = options.getEditor()
    if (!editor) return null
    const domAt = editor.view.domAtPos(editor.state.selection.$from.pos)
    const baseEl = domAt.node instanceof Element ? domAt.node : domAt.node.parentElement
    return baseEl?.closest('table') as HTMLElement | null
  }

  function activeTableCellElement(): HTMLElement | null {
    const editor = options.getEditor()
    if (!editor) return null
    const domAt = editor.view.domAtPos(editor.state.selection.$from.pos)
    const baseEl = domAt.node instanceof Element ? domAt.node : domAt.node.parentElement
    return baseEl?.closest('td,th') as HTMLElement | null
  }

  function readTableCommandCapabilities(currentEditor: Editor): TableCommandCapabilities {
    const canRun = (command: (chain: ReturnType<ReturnType<Editor['can']>['chain']>) => ReturnType<ReturnType<Editor['can']>['chain']>) =>
      command(currentEditor.can().chain().focus()).run()
    return {
      addRowBefore: canRun((chain) => chain.addRowBefore()),
      addRowAfter: canRun((chain) => chain.addRowAfter()),
      deleteRow: canRun((chain) => chain.deleteRow()),
      addColumnBefore: canRun((chain) => chain.addColumnBefore()),
      addColumnAfter: canRun((chain) => chain.addColumnAfter()),
      deleteColumn: canRun((chain) => chain.deleteColumn()),
      toggleHeaderRow: canRun((chain) => chain.toggleHeaderRow()),
      toggleHeaderColumn: canRun((chain) => chain.toggleHeaderColumn()),
      toggleHeaderCell: canRun((chain) => chain.toggleHeaderCell()),
      alignColumnLeft: canRun((chain) => chain.setCellAttribute('textAlign', 'left')),
      alignColumnCenter: canRun((chain) => chain.setCellAttribute('textAlign', 'center')),
      alignColumnRight: canRun((chain) => chain.setCellAttribute('textAlign', 'right')),
      deleteTable: canRun((chain) => chain.deleteTable())
    }
  }

  function hideTableToolbar() {
    tableToolbarOpen.value = false
  }

  /**
   * Hides toolbar and clears hover/timer/edge transient state.
   */
  function hideTableToolbarAnchor() {
    if (tableHoverHideTimer) {
      clearTimeout(tableHoverHideTimer)
      tableHoverHideTimer = null
    }
    hideTableToolbar()
    tableToolbarHovering.value = false
    options.hideEdgeControls()
    tableToolbarActions.value = []
  }

  /**
   * Recomputes toolbar actions and geometry from current table selection.
   */
  function updateTableToolbar() {
    const editor = options.getEditor()
    if (!editor || !options.holder.value) {
      hideTableToolbarAnchor()
      return
    }
    if (!editor.isActive('table')) {
      hideTableToolbarAnchor()
      return
    }

    tableToolbarActions.value = buildTableToolbarActions(readTableCommandCapabilities(editor))
    const tableEl = activeTableElement()
    const cellEl = activeTableCellElement()
    if (!tableEl || !cellEl) {
      hideTableToolbarAnchor()
      return
    }
    options.visibility.tableToolbarTriggerVisible.value = true
    options.updateTableToolbarPosition(cellEl, tableEl)
  }

  function onTableToolbarSelect(actionId: TableActionId) {
    const editor = options.getEditor()
    if (!editor) return
    applyTableAction(editor, actionId)
    updateTableToolbar()
  }

  function toggleTableToolbar(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (!options.visibility.tableToolbarTriggerVisible.value) return
    const opening = !tableToolbarOpen.value
    if (opening) updateTableToolbar()
    tableToolbarOpen.value = opening
  }

  function addRowAfterFromTrigger(event: MouseEvent) {
    const editor = options.getEditor()
    event.preventDefault()
    event.stopPropagation()
    if (!editor || !options.visibility.tableToolbarTriggerVisible.value) return
    editor.chain().focus().addRowAfter().run()
    updateTableToolbar()
  }

  function addRowBeforeFromTrigger(event: MouseEvent) {
    const editor = options.getEditor()
    event.preventDefault()
    event.stopPropagation()
    if (!editor || !options.visibility.tableToolbarTriggerVisible.value) return
    editor.chain().focus().addRowBefore().run()
    updateTableToolbar()
  }

  function addColumnBeforeFromTrigger(event: MouseEvent) {
    const editor = options.getEditor()
    event.preventDefault()
    event.stopPropagation()
    if (!editor || !options.visibility.tableToolbarTriggerVisible.value) return
    editor.chain().focus().addColumnBefore().run()
    updateTableToolbar()
  }

  function addColumnAfterFromTrigger(event: MouseEvent) {
    const editor = options.getEditor()
    event.preventDefault()
    event.stopPropagation()
    if (!editor || !options.visibility.tableToolbarTriggerVisible.value) return
    editor.chain().focus().addColumnAfter().run()
    updateTableToolbar()
  }

  function onEditorMouseMove(event: MouseEvent) {
    if (tableHoverHideTimer) {
      clearTimeout(tableHoverHideTimer)
      tableHoverHideTimer = null
    }
    const editor = options.getEditor()
    if (!editor?.isActive('table')) {
      tableToolbarHovering.value = false
      options.hideEdgeControls()
      return
    }
    const target = event.target
    if (!(target instanceof Element)) return
    const tableEl = activeTableElement()
    if (!tableEl) return
    const rect = tableEl.getBoundingClientRect()
    const x = event.clientX
    const y = event.clientY
    const inVerticalBand = y >= rect.top - 24 && y <= rect.bottom + 24
    const inHorizontalBand = x >= rect.left - 24 && x <= rect.right + 24
    options.updateEdgeControlsFromDistances({
      left: inVerticalBand ? Math.abs(x - rect.left) : Number.POSITIVE_INFINITY,
      right: inVerticalBand ? Math.abs(x - rect.right) : Number.POSITIVE_INFINITY,
      top: inHorizontalBand ? Math.abs(y - rect.top) : Number.POSITIVE_INFINITY,
      bottom: inHorizontalBand ? Math.abs(y - rect.bottom) : Number.POSITIVE_INFINITY
    })
    const inToolbar = Boolean(options.floatingMenuEl.value?.contains(target))
    const inControls = Boolean(target.closest('.tomosona-table-control'))
    const inTable = Boolean(target.closest('.ProseMirror table'))
    if (inControls || tableToolbarOpen.value) {
      options.visibility.tableAddTopVisible.value = true
      options.visibility.tableAddBottomVisible.value = true
      options.visibility.tableAddLeftVisible.value = true
      options.visibility.tableAddRightVisible.value = true
    }
    tableToolbarHovering.value = inTable || inToolbar || inControls || tableToolbarOpen.value
  }

  function onEditorMouseLeave() {
    if (tableToolbarOpen.value) return
    if (tableHoverHideTimer) clearTimeout(tableHoverHideTimer)
    tableHoverHideTimer = setTimeout(() => {
      tableToolbarHovering.value = false
      options.hideEdgeControls()
      tableHoverHideTimer = null
    }, 120)
  }

  function clearTimers() {
    if (!tableHoverHideTimer) return
    clearTimeout(tableHoverHideTimer)
    tableHoverHideTimer = null
  }

  return {
    tableToolbarOpen,
    tableToolbarHovering,
    tableToolbarActions,
    hideTableToolbar,
    hideTableToolbarAnchor,
    updateTableToolbar,
    onTableToolbarSelect,
    toggleTableToolbar,
    addRowAfterFromTrigger,
    addRowBeforeFromTrigger,
    addColumnBeforeFromTrigger,
    addColumnAfterFromTrigger,
    onEditorMouseMove,
    onEditorMouseLeave,
    clearTimers
  }
}
