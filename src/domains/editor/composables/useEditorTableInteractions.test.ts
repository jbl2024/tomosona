import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useEditorTableInteractions } from './useEditorTableInteractions'

function createEditor(activeTable = true) {
  const run = vi.fn(() => true)
  const chain = {
    focus: vi.fn().mockReturnThis(),
    addRowAfter: vi.fn().mockReturnThis(),
    addRowBefore: vi.fn().mockReturnThis(),
    addColumnBefore: vi.fn().mockReturnThis(),
    addColumnAfter: vi.fn().mockReturnThis(),
    run
  }
  const canChain = {
    focus: vi.fn().mockReturnThis(),
    addRowBefore: vi.fn().mockReturnThis(),
    addRowAfter: vi.fn().mockReturnThis(),
    deleteRow: vi.fn().mockReturnThis(),
    addColumnBefore: vi.fn().mockReturnThis(),
    addColumnAfter: vi.fn().mockReturnThis(),
    deleteColumn: vi.fn().mockReturnThis(),
    toggleHeaderRow: vi.fn().mockReturnThis(),
    toggleHeaderColumn: vi.fn().mockReturnThis(),
    toggleHeaderCell: vi.fn().mockReturnThis(),
    setCellAttribute: vi.fn().mockReturnThis(),
    deleteTable: vi.fn().mockReturnThis(),
    run: vi.fn(() => true)
  }

  const table = document.createElement('table')
  const td = document.createElement('td')
  table.appendChild(document.createElement('tr')).appendChild(td)
  document.body.appendChild(table)

  return {
    editor: {
      isActive: vi.fn(() => activeTable),
      chain: vi.fn(() => chain),
      can: vi.fn(() => ({ chain: vi.fn(() => canChain) })),
      state: { selection: { $from: { pos: 1 } } },
      view: {
        domAtPos: vi.fn(() => ({ node: td }))
      }
    } as any,
    chain,
    table,
    td
  }
}

describe('useEditorTableInteractions', () => {
  it('hides toolbar state when editor is not in table', () => {
    const { editor } = createEditor(false)
    const controls = {
      tableToolbarTriggerVisible: ref(true),
      tableAddTopVisible: ref(true),
      tableAddBottomVisible: ref(true),
      tableAddLeftVisible: ref(true),
      tableAddRightVisible: ref(true)
    }
    const interactions = useEditorTableInteractions({
      getEditor: () => editor,
      holder: ref(document.createElement('div')),
      floatingMenuEl: ref(null),
      visibility: controls,
      hideEdgeControls: vi.fn(),
      updateEdgeControlsFromDistances: vi.fn(),
      updateTableToolbarPosition: vi.fn()
    })

    interactions.updateTableToolbar()

    expect(interactions.tableToolbarOpen.value).toBe(false)
    expect(interactions.tableToolbarActions.value).toEqual([])
  })

  it('updates geometry and actions when table is active', () => {
    const { editor } = createEditor(true)
    const controls = {
      tableToolbarTriggerVisible: ref(false),
      tableAddTopVisible: ref(false),
      tableAddBottomVisible: ref(false),
      tableAddLeftVisible: ref(false),
      tableAddRightVisible: ref(false)
    }
    const updateTableToolbarPosition = vi.fn()
    const interactions = useEditorTableInteractions({
      getEditor: () => editor,
      holder: ref(document.createElement('div')),
      floatingMenuEl: ref(null),
      visibility: controls,
      hideEdgeControls: vi.fn(),
      updateEdgeControlsFromDistances: vi.fn(),
      updateTableToolbarPosition
    })

    interactions.updateTableToolbar()

    expect(controls.tableToolbarTriggerVisible.value).toBe(true)
    expect(interactions.tableToolbarActions.value.length).toBeGreaterThan(0)
    expect(updateTableToolbarPosition).toHaveBeenCalled()
  })

  it('runs add-row trigger command and refreshes toolbar', () => {
    const { editor, chain } = createEditor(true)
    const controls = {
      tableToolbarTriggerVisible: ref(true),
      tableAddTopVisible: ref(false),
      tableAddBottomVisible: ref(false),
      tableAddLeftVisible: ref(false),
      tableAddRightVisible: ref(false)
    }
    const interactions = useEditorTableInteractions({
      getEditor: () => editor,
      holder: ref(document.createElement('div')),
      floatingMenuEl: ref(null),
      visibility: controls,
      hideEdgeControls: vi.fn(),
      updateEdgeControlsFromDistances: vi.fn(),
      updateTableToolbarPosition: vi.fn()
    })

    interactions.addRowAfterFromTrigger(new MouseEvent('click'))

    expect(chain.addRowAfter).toHaveBeenCalled()
    expect(chain.run).toHaveBeenCalled()
  })
})
