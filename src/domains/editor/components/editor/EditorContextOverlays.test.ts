import { createApp, defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./EditorBlockMenu.vue', () => ({
  default: defineComponent({
    emits: ['menu-el', 'update:index', 'select', 'close'],
    setup(_, { emit }) {
      return () => h('button', { class: 'context-block-stub', onClick: () => { emit('menu-el', null); emit('update:index', 1); emit('select', { id: 'delete', actionId: 'delete', label: 'Delete' }); emit('close') } }, 'block')
    }
  })
}))

vi.mock('./EditorTableToolbar.vue', () => ({
  default: defineComponent({
    emits: ['menu-el', 'select', 'close'],
    setup(_, { emit }) {
      return () => h('button', { class: 'context-table-stub', onClick: () => { emit('menu-el', null); emit('select', 'add_row_after'); emit('close') } }, 'table')
    }
  })
}))

import EditorContextOverlays from './EditorContextOverlays.vue'

describe('EditorContextOverlays', () => {
  it('forwards block and table events', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const handlers = {
      blockMenuEl: vi.fn(),
      blockUpdateIndex: vi.fn(),
      blockSelect: vi.fn(),
      blockClose: vi.fn(),
      tableMenuEl: vi.fn(),
      tableSelect: vi.fn(),
      tableClose: vi.fn()
    }

    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorContextOverlays, {
          blockMenuOpen: true,
          blockMenuIndex: 0,
          blockMenuX: 1,
          blockMenuY: 2,
          blockMenuActions: [],
          blockMenuConvertActions: [],
          tableToolbarOpen: true,
          tableToolbarViewportLeft: 1,
          tableToolbarViewportTop: 2,
          tableToolbarActions: [],
          tableMarkdownMode: true,
          tableToolbarViewportMaxHeight: 120,
          'onBlock:menuEl': handlers.blockMenuEl,
          'onBlock:updateIndex': handlers.blockUpdateIndex,
          'onBlock:select': handlers.blockSelect,
          'onBlock:close': handlers.blockClose,
          'onTable:menuEl': handlers.tableMenuEl,
          'onTable:select': handlers.tableSelect,
          'onTable:close': handlers.tableClose
        })
      }
    }))

    app.mount(root)
    ;(document.body.querySelector('.context-block-stub') as HTMLButtonElement).click()
    ;(document.body.querySelector('.context-table-stub') as HTMLButtonElement).click()

    expect(handlers.blockUpdateIndex).toHaveBeenCalledWith(1)
    expect(handlers.blockSelect).toHaveBeenCalled()
    expect(handlers.blockClose).toHaveBeenCalledTimes(1)
    expect(handlers.tableSelect).toHaveBeenCalledWith('add_row_after')
    expect(handlers.tableClose).toHaveBeenCalledTimes(1)

    app.unmount()
    document.body.innerHTML = ''
  })
})
