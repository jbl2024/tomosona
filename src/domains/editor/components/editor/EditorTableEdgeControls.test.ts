import { createApp, defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import EditorTableEdgeControls from './EditorTableEdgeControls.vue'

describe('EditorTableEdgeControls', () => {
  it('renders controls and emits trigger actions', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const onToggle = vi.fn()
    const onAddRowBefore = vi.fn()
    const onAddRowAfter = vi.fn()
    const onAddColumnBefore = vi.fn()
    const onAddColumnAfter = vi.fn()

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorTableEdgeControls, {
            triggerVisible: true,
            triggerLeft: 10,
            triggerTop: 20,
            addTopVisible: true,
            addBottomVisible: true,
            addLeftVisible: true,
            addRightVisible: true,
            tableBoxLeft: 30,
            tableBoxTop: 40,
            tableBoxWidth: 200,
            tableBoxHeight: 120,
            onToggle,
            onAddRowBefore,
            onAddRowAfter,
            onAddColumnBefore,
            onAddColumnAfter
          })
      }
    }))

    app.mount(root)

    const buttons = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[]
    expect(buttons).toHaveLength(5)

    buttons[0]?.click()
    buttons[1]?.click()
    buttons[2]?.click()
    buttons[3]?.click()
    buttons[4]?.click()

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onAddRowBefore).toHaveBeenCalledTimes(1)
    expect(onAddRowAfter).toHaveBeenCalledTimes(1)
    expect(onAddColumnBefore).toHaveBeenCalledTimes(1)
    expect(onAddColumnAfter).toHaveBeenCalledTimes(1)

    app.unmount()
    document.body.innerHTML = ''
  })
})
