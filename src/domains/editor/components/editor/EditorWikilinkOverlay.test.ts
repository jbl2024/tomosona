import { createApp, defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./EditorWikilinkMenu.vue', () => ({
  default: defineComponent({
    emits: ['update:index', 'select'],
    setup(_, { emit }) {
      return () => h('button', { class: 'wikilink-overlay-stub', onClick: () => { emit('update:index', 2); emit('select', 'foo.md') } }, 'wikilink')
    }
  })
}))

import EditorWikilinkOverlay from './EditorWikilinkOverlay.vue'

describe('EditorWikilinkOverlay', () => {
  it('forwards wikilink index and select events', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const onIndex = vi.fn()
    const onSelect = vi.fn()

    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorWikilinkOverlay, {
          open: true,
          index: 0,
          left: 10,
          top: 12,
          results: [],
          'onUpdate:index': onIndex,
          onSelect
        })
      }
    }))

    app.mount(root)
    ;(document.body.querySelector('.wikilink-overlay-stub') as HTMLButtonElement).click()

    expect(onIndex).toHaveBeenCalledWith(2)
    expect(onSelect).toHaveBeenCalledWith('foo.md')
    app.unmount()
    document.body.innerHTML = ''
  })
})
