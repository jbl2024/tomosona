import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EditorPaneTab, { type EditorPaneTabView } from './EditorPaneTab.vue'

type DraggablePayload = () => [number, string[]]

const draggablePayloads: DraggablePayload[] = []

vi.mock('@vue-dnd-kit/core', () => ({
  makeDraggable: vi.fn((_ref: unknown, _options: unknown, payload: DraggablePayload) => {
    draggablePayloads.push(payload)
  })
}))

function tabView(overrides: Partial<EditorPaneTabView> = {}): EditorPaneTabView {
  return {
    id: 'doc:/vault/a.md',
    type: 'document',
    path: '/vault/a.md',
    pinned: false,
    title: 'a',
    tooltip: 'a',
    inaccessible: false,
    protected: false,
    locked: false,
    protectionLabel: '',
    stateMarker: '',
    stateLabel: '',
    ...overrides
  } as EditorPaneTabView
}

function mountTab(tab: EditorPaneTabView, index: number, paneTabIds: string[] = [tab.id]) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(EditorPaneTab, {
          tab,
          active: false,
          index,
          pinnedCount: 0,
          paneTabIds,
          onSelect: () => events.push('select'),
          onClose: () => events.push('close'),
          onLock: () => events.push('lock')
        })
    }
  }))

  app.mount(root)
  return { app, root, events }
}

describe('EditorPaneTab', () => {
  afterEach(() => {
    draggablePayloads.length = 0
    document.body.innerHTML = ''
  })

  it('renders the tab label and its tooltip', async () => {
    const mounted = mountTab(tabView({ title: 'Gestion du temps', tooltip: 'Gestion du temps\nvault / Gestion du temps.md' }), 0)
    await nextTick()

    const item = mounted.root.querySelector('.pane-tab-item')
    expect(item?.querySelector('.pane-tab-name')?.textContent).toBe('Gestion du temps')
    expect(item?.getAttribute('title')).toContain('Gestion du temps.md')

    mounted.app.unmount()
  })

  it('publishes its index and the pane tab ids as the drag payload', async () => {
    const ids = ['doc:/vault/a.md', 'doc:/vault/b.md']
    const mounted = mountTab(tabView({ id: 'doc:/vault/b.md' }), 1, ids)
    await nextTick()

    expect(draggablePayloads[0]?.()).toEqual([1, ids])

    mounted.app.unmount()
  })

  it('locks the note from the open padlock without selecting the tab', async () => {
    const mounted = mountTab(tabView({ protected: true, locked: false, protectionLabel: 'Protected note, unlocked for this session' }), 0)
    await nextTick()

    const lock = mounted.root.querySelector<HTMLButtonElement>('.pane-tab-lock')
    expect(lock?.getAttribute('aria-label')).toBe('Lock a')
    expect(lock?.getAttribute('title')).toContain('Click to lock')
    lock?.click()
    await nextTick()

    expect(mounted.events).toEqual(['lock'])

    mounted.app.unmount()
  })

  it('keeps the closed padlock inert', async () => {
    const mounted = mountTab(tabView({ protected: true, locked: true, protectionLabel: 'Locked protected note' }), 0)
    await nextTick()

    expect(mounted.root.querySelector('.pane-tab-lock')).toBeNull()
    expect(mounted.root.querySelector('.pane-tab-flag')?.getAttribute('title')).toBe('Locked protected note')

    mounted.app.unmount()
  })

  it('keeps the close control disabled for a pinned tab', async () => {
    const mounted = mountTab(tabView({ pinned: true }), 0)
    await nextTick()

    const close = mounted.root.querySelector<HTMLButtonElement>('.pane-tab-close')
    expect(close?.disabled).toBe(true)
    close?.click()
    await nextTick()

    expect(mounted.events).toEqual([])

    mounted.app.unmount()
  })
})
