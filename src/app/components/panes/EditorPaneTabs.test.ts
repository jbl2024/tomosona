import { createApp, defineComponent, h, nextTick, reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EditorPaneTabs from './EditorPaneTabs.vue'
import type { PaneState } from '../../composables/useMultiPaneWorkspaceState'

function mountTabs(pane: PaneState) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(EditorPaneTabs, {
          pane,
          isActivePane: true,
          getStatus: () => ({ dirty: false, saving: false, saveError: '' }),
          onPaneFocus: (payload: { paneId: string }) => events.push(`focus:${payload.paneId}`),
          onTabClick: (payload: { paneId: string; tabId: string }) => events.push(`click:${payload.tabId}`),
          onTabClose: (payload: { paneId: string; tabId: string }) => events.push(`close:${payload.tabId}`),
          onTabCloseOthers: (payload: { paneId: string; tabId: string }) => events.push(`close-others:${payload.tabId}`),
          onTabCloseLeft: (payload: { paneId: string; tabId: string }) => events.push(`close-left:${payload.tabId}`),
          onTabCloseRight: (payload: { paneId: string; tabId: string }) => events.push(`close-right:${payload.tabId}`),
          onTabCloseAll: (payload: { paneId: string }) => events.push(`close-all:${payload.paneId}`),
          onRequestMoveTab: (payload: { paneId: string; direction: 'next' | 'previous' }) =>
            events.push(`move:${payload.direction}`)
        })
    }
  }))

  app.mount(root)
  return { app, root, events }
}

describe('EditorPaneTabs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('scrolls the active tab into view when document navigation changes it', async () => {
    const scrollIntoView = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => {})
    const pane = reactive<PaneState>({
      id: 'pane-1',
      activeTabId: 'doc-1',
      openTabs: [
        { id: 'doc-1', type: 'document', path: '/vault/a.md', pinned: false },
        { id: 'doc-2', type: 'document', path: '/vault/b.md', pinned: false },
        { id: 'doc-3', type: 'document', path: '/vault/c.md', pinned: false }
      ],
      activePath: '/vault/a.md'
    })
    const mounted = mountTabs(pane)
    await nextTick()
    await nextTick()
    scrollIntoView.mockClear()

    pane.activeTabId = 'doc-3'
    pane.activePath = '/vault/c.md'
    await nextTick()
    await nextTick()

    const activeTab = mounted.root.querySelectorAll<HTMLElement>('.pane-tab-item')[2]
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(activeTab)
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto'
    })

    mounted.app.unmount()
  })

  it('opens a context menu for common close actions', async () => {
    const mounted = mountTabs({
      id: 'pane-1',
      activeTabId: 'doc-2',
      openTabs: [
        { id: 'doc-1', type: 'document', path: '/vault/a.md', pinned: false },
        { id: 'doc-2', type: 'document', path: '/vault/b.md', pinned: false },
        { id: 'doc-3', type: 'document', path: '/vault/c.md', pinned: false }
      ],
      activePath: '/vault/b.md'
    })

    const tabs = mounted.root.querySelectorAll<HTMLElement>('.pane-tab-item')
    tabs[1]?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 180, clientY: 72 })
    )
    await nextTick()

    const menu = mounted.root.querySelector<HTMLElement>('.pane-tab-menu')
    expect(menu).toBeTruthy()

    const clickMenuItem = (label: string) => {
      const button = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.pane-tab-menu .ui-menu-item'))
        .find((item) => item.textContent?.includes(label))
      expect(button).toBeTruthy()
      button?.click()
    }

    clickMenuItem('Close')
    tabs[1]?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 180, clientY: 72 })
    )
    await nextTick()
    clickMenuItem('Close Others')
    tabs[1]?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 180, clientY: 72 })
    )
    await nextTick()
    clickMenuItem('Close Tabs to the Left')
    tabs[1]?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 180, clientY: 72 })
    )
    await nextTick()
    clickMenuItem('Close Tabs to the Right')

    expect(mounted.events).toEqual([
      'focus:pane-1',
      'close:doc-2',
      'focus:pane-1',
      'close-others:doc-2',
      'focus:pane-1',
      'close-left:doc-2',
      'focus:pane-1',
      'close-right:doc-2'
    ])

    mounted.app.unmount()
  })

  it('closes the tab on middle click', async () => {
    const mounted = mountTabs({
      id: 'pane-1',
      activeTabId: 'doc-2',
      openTabs: [
        { id: 'doc-1', type: 'document', path: '/vault/a.md', pinned: false },
        { id: 'doc-2', type: 'document', path: '/vault/b.md', pinned: false }
      ],
      activePath: '/vault/b.md'
    })

    const tab = mounted.root.querySelectorAll<HTMLElement>('.pane-tab-item')[1]
    tab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 }))
    tab?.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
    await nextTick()

    expect(mounted.events).toEqual(['focus:pane-1', 'close:doc-2'])
    expect(mounted.root.querySelector('.pane-tab-menu')).toBeNull()

    mounted.app.unmount()
  })

  it('supports keyboard navigation in the tab context menu', async () => {
    const mounted = mountTabs({
      id: 'pane-1',
      activeTabId: 'doc-2',
      openTabs: [
        { id: 'doc-1', type: 'document', path: '/vault/a.md', pinned: false },
        { id: 'doc-2', type: 'document', path: '/vault/b.md', pinned: false },
        { id: 'doc-3', type: 'document', path: '/vault/c.md', pinned: false }
      ],
      activePath: '/vault/b.md'
    })

    const tab = mounted.root.querySelectorAll<HTMLElement>('.pane-tab-item')[1]
    tab?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 180, clientY: 72 })
    )
    await nextTick()

    const menuItems = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.pane-tab-menu .ui-menu-item'))
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
    await nextTick()
    expect(document.activeElement).toBe(menuItems[0])

    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
    await nextTick()
    expect(document.activeElement).toBe(menuItems[1])

    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    await nextTick()

    expect(mounted.events).toContain('close-others:doc-2')
    expect(mounted.root.querySelector('.pane-tab-menu')).toBeNull()

    mounted.app.unmount()
  })

  it('focuses the last enabled item on ArrowUp when the context menu has no focused item', async () => {
    const mounted = mountTabs({
      id: 'pane-1',
      activeTabId: 'doc-1',
      openTabs: [
        { id: 'doc-1', type: 'document', path: '/vault/a.md', pinned: false },
        { id: 'doc-2', type: 'document', path: '/vault/b.md', pinned: false }
      ],
      activePath: '/vault/a.md'
    })

    const tab = mounted.root.querySelectorAll<HTMLElement>('.pane-tab-item')[0]
    tab?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 180, clientY: 72 })
    )
    await nextTick()

    const menuItems = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.pane-tab-menu .ui-menu-item'))
    const enabledItems = menuItems.filter((item) => !item.disabled)
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }))
    await nextTick()

    expect(document.activeElement).toBe(enabledItems[enabledItems.length - 1])

    mounted.app.unmount()
  })
})
