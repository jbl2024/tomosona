import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EditorTableToolbar from './EditorTableToolbar.vue'
import type { TableToolbarAction } from '../../lib/tiptap/tableToolbarActions'

async function flush() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function mountHarness(options?: {
  open?: boolean
  actions?: TableToolbarAction[]
  markdownMode?: boolean
}) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const open = ref(options?.open ?? true)
  const onSelect = vi.fn<(id: string) => void>()
  const onClose = vi.fn()

  const defaultActions: TableToolbarAction[] = options?.actions ?? [
    { id: 'add_row_after', label: 'Add row below', group: 'rows', disabled: false },
    { id: 'align_col_center', label: 'Align center', group: 'columns', disabled: false },
    { id: 'delete_row', label: 'Delete row', group: 'rows', disabled: true, disabledReason: 'No row' },
    { id: 'delete_table', label: 'Delete table', group: 'table', disabled: false }
  ]

  const Harness = defineComponent({
    setup() {
      return () => h(EditorTableToolbar, {
        open: open.value,
        actions: defaultActions,
        markdownMode: options?.markdownMode ?? true,
        onSelect,
        onClose,
        onMenuEl: () => {}
      })
    }
  })

  const app = createApp(Harness)
  app.mount(root)

  return { app, root, open, onSelect, onClose }
}

describe('EditorTableToolbar', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('emits select for enabled action and not for disabled action', async () => {
    const harness = mountHarness()
    await flush()

    const addRow = harness.root.querySelector('[data-action="add_row_after"]') as HTMLButtonElement
    const deleteRow = harness.root.querySelector('[data-action="delete_row"]') as HTMLButtonElement

    addRow.click()
    ;(harness.root.querySelector('[data-action="align_col_center"]') as HTMLButtonElement).click()
    deleteRow.click()
    await flush()

    expect(harness.onSelect).toHaveBeenCalledWith('add_row_after')
    expect(harness.onSelect).toHaveBeenCalledWith('align_col_center')
    expect(harness.onSelect).not.toHaveBeenCalledWith('delete_row')
    harness.app.unmount()
  })

  it('shows disabled reason as tooltip title', async () => {
    const harness = mountHarness()
    await flush()

    const deleteRow = harness.root.querySelector('[data-action="delete_row"]') as HTMLButtonElement
    expect(deleteRow.title).toContain('No row')

    harness.app.unmount()
  })

  it('emits close on Escape key', async () => {
    const harness = mountHarness()
    await flush()

    const toolbar = harness.root.querySelector('.tomosona-table-toolbar') as HTMLDivElement
    toolbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()

    expect(harness.onClose).toHaveBeenCalledTimes(1)

    harness.app.unmount()
  })
})
