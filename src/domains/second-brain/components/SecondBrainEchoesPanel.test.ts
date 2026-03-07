import { createApp, defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import SecondBrainEchoesPanel from './SecondBrainEchoesPanel.vue'

describe('SecondBrainEchoesPanel', () => {
  it('renders suggestions and add/open actions', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const onOpen = vi.fn()
    const onAdd = vi.fn()

    const app = createApp(defineComponent({
      setup() {
        return () => h(SecondBrainEchoesPanel, {
          items: [{
            path: '/vault/notes/a.md',
            title: 'Note A',
            reasonLabel: 'Semantically related',
            reasonLabels: ['Semantically related'],
            score: 0.8,
            signalSources: ['semantic']
          }],
          loading: false,
          error: '',
          isInContext: () => false,
          toRelativePath: (path: string) => path.replace('/vault/', ''),
          onOpen,
          onAdd
        })
      }
    }))

    app.mount(root)
    expect(root.textContent).toContain('Suggested by Echoes')
    expect(root.textContent).toContain('1 suggestions')
    ;(root.querySelector('.sb-echoes-open') as HTMLButtonElement).click()
    ;(root.querySelector('.sb-echoes-action') as HTMLButtonElement).click()
    expect(onOpen).toHaveBeenCalledWith('/vault/notes/a.md')
    expect(onAdd).toHaveBeenCalledWith('/vault/notes/a.md')
    app.unmount()
  })

  it('renders a compact summary for recently active suggestions', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(defineComponent({
      setup() {
        return () => h(SecondBrainEchoesPanel, {
          items: [{
            path: '/vault/notes/a.md',
            title: 'Note A',
            reasonLabel: 'Recently active',
            reasonLabels: ['Recently active'],
            score: 0.8,
            signalSources: ['recent']
          }],
          loading: false,
          error: '',
          isInContext: () => false,
          toRelativePath: (path: string) => path.replace('/vault/', '')
        })
      }
    }))

    app.mount(root)
    expect(root.textContent).toContain('Note A')
    expect(root.textContent).toContain('1 suggestions, 1 recently active')
    app.unmount()
  })

  it('marks items already in context', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(defineComponent({
      setup() {
        return () => h(SecondBrainEchoesPanel, {
          items: [{
            path: '/vault/notes/a.md',
            title: 'Note A',
            reasonLabel: 'Backlink',
            reasonLabels: ['Backlink'],
            score: 0.9,
            signalSources: ['backlink']
          }],
          loading: false,
          error: '',
          isInContext: (path: string) => path === '/vault/notes/a.md',
          toRelativePath: (path: string) => path
        })
      }
    }))

    app.mount(root)
    expect(root.textContent).toContain('In context')
    app.unmount()
  })
})
