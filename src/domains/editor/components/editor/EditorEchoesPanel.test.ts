import { createApp, defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import EditorEchoesPanel from './EditorEchoesPanel.vue'

describe('EditorEchoesPanel', () => {
  it('renders suggestion cards and emits open/add/remove intents', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const onOpen = vi.fn()
    const onAdd = vi.fn()
    const onRemove = vi.fn()

    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorEchoesPanel, {
          items: [
            {
              path: '/vault/notes/a.md',
              title: 'Note A',
              reasonLabel: 'Direct link',
              reasonLabels: ['Direct link'],
              score: 1,
              signalSources: ['direct'],
              isInContext: false
            },
            {
              path: '/vault/notes/b.md',
              title: 'Note B',
              reasonLabel: 'Semantically related',
              reasonLabels: ['Semantically related'],
              score: 0.9,
              signalSources: ['semantic'],
              isInContext: true
            }
          ],
          loading: false,
          error: '',
          hintVisible: true,
          toRelativePath: (path: string) => path.replace('/vault/', ''),
          onOpen,
          onAdd,
          onRemove
        })
      }
    }))

    app.mount(root)
    expect(root.textContent).toContain('Echoes')
    expect(root.textContent).toContain('Suggestions around this note.')
    expect(root.textContent).toContain('direct link')
    expect(root.textContent).toContain('semantic similarity')

    const actionButtons = Array.from(root.querySelectorAll('.echoes-action-btn')) as HTMLButtonElement[]
    actionButtons[0].click()
    actionButtons[1].click()
    actionButtons[2].click()
    actionButtons[3].click()

    expect(onOpen).toHaveBeenCalledWith('/vault/notes/a.md')
    expect(onAdd).toHaveBeenCalledWith('/vault/notes/a.md')
    expect(onOpen).toHaveBeenCalledWith('/vault/notes/b.md')
    expect(onRemove).toHaveBeenCalledWith('/vault/notes/b.md')
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
