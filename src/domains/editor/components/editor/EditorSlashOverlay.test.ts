import { createApp, defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./EditorSlashMenu.vue', () => ({
  default: defineComponent({
    emits: ['update:index', 'select', 'close'],
    setup(_, { emit }) {
      return () => h('button', { class: 'slash-overlay-stub', onClick: () => { emit('update:index', 3); emit('select', { id: 'quote', label: 'Quote', type: 'quote', data: {} }); emit('close') } }, 'slash')
    }
  })
}))

import EditorSlashOverlay from './EditorSlashOverlay.vue'

describe('EditorSlashOverlay', () => {
  it('forwards slash index/select/close events', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const onIndex = vi.fn()
    const onSelect = vi.fn()
    const onClose = vi.fn()

    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorSlashOverlay, {
          open: true,
          index: 0,
          left: 10,
          top: 12,
          query: '',
          commands: [],
          'onUpdate:index': onIndex,
          onSelect,
          onClose
        })
      }
    }))

    app.mount(root)
    ;(document.body.querySelector('.slash-overlay-stub') as HTMLButtonElement).click()

    expect(onIndex).toHaveBeenCalledWith(3)
    expect(onSelect).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
    app.unmount()
    document.body.innerHTML = ''
  })
})
