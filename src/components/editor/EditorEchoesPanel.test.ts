import { createApp, defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import EditorEchoesPanel from './EditorEchoesPanel.vue'

describe('EditorEchoesPanel', () => {
  it('renders helper and emits open', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const onOpen = vi.fn()

    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorEchoesPanel, {
          items: [{
            path: '/vault/notes/a.md',
            title: 'Note A',
            reasonLabel: 'Direct link',
            reasonLabels: ['Direct link', 'Semantically related'],
            score: 1,
            signalSources: ['direct', 'semantic']
          }],
          loading: false,
          error: '',
          hintVisible: true,
          toRelativePath: (path: string) => path.replace('/vault/', ''),
          onOpen
        })
      }
    }))

    app.mount(root)
    expect(root.textContent).toContain('Echoes')
    expect(root.textContent).toContain("Relevant notes around what you're working on now.")
    expect(root.textContent).toContain('Direct link')
    ;(root.querySelector('.echoes-item') as HTMLButtonElement).click()
    expect(onOpen).toHaveBeenCalledWith('/vault/notes/a.md')
    app.unmount()
  })

  it('renders empty and error states', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorEchoesPanel, {
          items: [],
          loading: false,
          error: 'broken',
          hintVisible: false,
          toRelativePath: (path: string) => path
        })
      }
    }))

    app.mount(root)
    expect(root.textContent).toContain('broken')
    app.unmount()
  })
})
