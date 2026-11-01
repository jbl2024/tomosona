import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import EditorPaneTabList from './EditorPaneTabList.vue'
import type { PaneState } from '../../composables/useMultiPaneWorkspaceState'

function documentTab(id: string, path: string, pinned = false) {
  return { id, type: 'document' as const, path, pinned }
}

function mountList(pane: PaneState) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(EditorPaneTabList, {
          pane,
          onTabClick: (payload: { tabId: string }) => events.push(`click:${payload.tabId}`),
          onTabClose: (payload: { tabId: string }) => events.push(`close:${payload.tabId}`),
          onCloseOthers: (payload: { tabId: string }) => events.push(`close-others:${payload.tabId}`),
          onCloseRight: (payload: { tabId: string }) => events.push(`close-right:${payload.tabId}`),
          onCloseUnpinned: () => events.push('close-unpinned'),
          onDismiss: () => events.push('dismiss')
        })
    }
  }))

  app.mount(root)
  return { app, root, events }
}

function rows(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.pane-tab-list-item'))
}

function search(root: HTMLElement): HTMLInputElement {
  return root.querySelector<HTMLInputElement>('.pane-tab-list-search')!
}

async function type(root: HTMLElement, value: string) {
  const input = search(root)
  input.value = value
  input.dispatchEvent(new Event('input'))
  await nextTick()
}

describe('EditorPaneTabList', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('lists every open tab with its full title in visual order', async () => {
    const longName = 'Créer des notes atomiques pour un jardin de connaissances durable'
    const mounted = mountList({
      id: 'pane-1', activeTabId: 'doc-2', activePath: '/vault/b.md',
      recentTabIds: [],
      openTabs: [
        documentTab('doc-1', '/vault/Gestion du temps.md'),
        documentTab('doc-2', `/vault/${longName}.md`),
        documentTab('doc-3', '/vault/Roadmap.md')
      ]
    })
    await nextTick()

    const labels = rows(mounted.root).map((row) => row.querySelector('.pane-tab-list-label')?.textContent)
    expect(labels).toEqual(['Gestion du temps', longName, 'Roadmap'])

    mounted.app.unmount()
  })

  it('marks the active tab', async () => {
    const mounted = mountList({
      id: 'pane-1', activeTabId: 'doc-2', activePath: '/vault/b.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')]
    })
    await nextTick()

    const items = rows(mounted.root)
    expect(items[0]?.getAttribute('aria-selected')).toBe('false')
    expect(items[1]?.getAttribute('aria-selected')).toBe('true')
    expect(items[1]?.classList.contains('active')).toBe(true)

    mounted.app.unmount()
  })

  it('shows the folder for homonym tabs only', async () => {
    const mounted = mountList({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/projets/Note.md',
      recentTabIds: [],
      openTabs: [
        documentTab('doc-1', '/vault/projets/Note.md'),
        documentTab('doc-2', '/vault/archives/Note.md'),
        documentTab('doc-3', '/vault/Roadmap.md')
      ]
    })
    await nextTick()

    const items = rows(mounted.root)
    expect(items[0]?.querySelector('.pane-tab-list-folder')?.textContent).toBe('projets')
    expect(items[1]?.querySelector('.pane-tab-list-folder')?.textContent).toBe('archives')
    expect(items[2]?.querySelector('.pane-tab-list-folder')).toBeNull()

    mounted.app.unmount()
  })

  it('filters the list from the keyboard', async () => {
    const mounted = mountList({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      recentTabIds: [],
      openTabs: [
        documentTab('doc-1', '/vault/Gestion du temps.md'),
        documentTab('doc-2', '/vault/Roadmap.md'),
        documentTab('doc-3', '/vault/Note quotidienne.md')
      ]
    })
    await nextTick()

    await type(mounted.root, 'road')
    expect(rows(mounted.root).map((row) => row.querySelector('.pane-tab-list-label')?.textContent)).toEqual(['Roadmap'])

    await type(mounted.root, 'zzz')
    expect(rows(mounted.root)).toHaveLength(0)
    expect(mounted.root.querySelector('.pane-tab-list-empty')).not.toBeNull()

    mounted.app.unmount()
  })

  it('activates the highlighted tab with Enter', async () => {
    const mounted = mountList({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')]
    })
    await nextTick()

    const input = search(mounted.root)
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
    await nextTick()
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    await nextTick()

    expect(mounted.events).toEqual(['click:doc-2'])

    mounted.app.unmount()
  })

  it('activates a tab on click', async () => {
    const mounted = mountList({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')]
    })
    await nextTick()

    rows(mounted.root)[1]?.click()
    await nextTick()

    expect(mounted.events).toEqual(['click:doc-2'])

    mounted.app.unmount()
  })

  it('closes the other tabs from the bulk action', async () => {
    const mounted = mountList({
      id: 'pane-1', activeTabId: 'doc-2', activePath: '/vault/b.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')]
    })
    await nextTick()

    const button = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.pane-tab-list-action'))
      .find((item) => item.textContent?.includes('Close other tabs'))
    expect(button?.disabled).toBe(false)
    button?.click()
    await nextTick()

    expect(mounted.events).toEqual(['close-others:doc-2'])

    mounted.app.unmount()
  })

  it('disables the bulk actions that do not apply', async () => {
    const mounted = mountList({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/a.md', true)]
    })
    await nextTick()

    const actions = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.pane-tab-list-action'))
    const byLabel = (label: string) => actions.find((item) => item.textContent?.includes(label))

    expect(byLabel('Close other tabs')?.disabled).toBe(true)
    expect(byLabel('Close tabs to the right')?.disabled).toBe(true)
    expect(byLabel('Close all unpinned tabs')?.disabled).toBe(true)

    mounted.app.unmount()
  })

  it('keeps the pinned name visible instead of reducing the tab to an icon', async () => {
    const mounted = mountList({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/Journal.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/Journal.md', true)]
    })
    await nextTick()

    const row = rows(mounted.root)[0]
    expect(row?.querySelector('[aria-label="Pinned"]')).not.toBeNull()
    expect(row?.querySelector('.pane-tab-list-label')?.textContent).toBe('Journal')

    mounted.app.unmount()
  })

  it('dismisses on Escape', async () => {
    const mounted = mountList({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/a.md')]
    })
    await nextTick()

    search(mounted.root).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    await nextTick()

    expect(mounted.events).toEqual(['dismiss'])

    mounted.app.unmount()
  })
})
