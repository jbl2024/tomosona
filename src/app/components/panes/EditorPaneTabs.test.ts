import { createApp, defineComponent, h, nextTick, reactive, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EditorPaneTabs, { type FileEditorStatus } from './EditorPaneTabs.vue'
import type { PaneState } from '../../composables/useMultiPaneWorkspaceState'

type DropEvent = {
  draggedItems?: Array<{ item?: unknown }>
  hoveredDraggable?: { index: number; placement?: { right: boolean } }
}

type StripDropOptions = {
  events: { onDrop: (event: DropEvent) => void }
}

/** Captures the strip's drop handler so a test can drive a drop directly. */
const stripDropOptions: StripDropOptions[] = []

vi.mock('@vue-dnd-kit/core', () => ({
  makeDraggable: vi.fn(),
  makeDroppable: vi.fn((_ref: unknown, options: StripDropOptions) => {
    stripDropOptions.push(options)
    return { isAllowed: ref(false), isDragOver: ref(false) }
  })
}))

vi.mock('../../../shared/api/pageProtectionApi', () => ({
  pageProtectionStatus: async (paths: string[]) => paths.map((path) => ({
    path,
    isProtected: path.includes('protected'),
    isLocked: !path.includes('unlocked')
  }))
}))

type MountOptions = {
  getStatus?: (path: string) => FileEditorStatus
  isActivePane?: boolean
  paneCount?: number
  otherPanePaths?: string[]
}

function mountTabs(pane: PaneState, options: MountOptions = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const events: string[] = []
  const getStatus = options.getStatus ?? (() => ({ dirty: false, saving: false, saveError: '' }))

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(EditorPaneTabs, {
          pane,
          isActivePane: options.isActivePane ?? true,
          getStatus,
          paneCount: options.paneCount ?? 1,
          otherPanePaths: options.otherPanePaths ?? [],
          onPaneFocus: (payload: { paneId: string }) => events.push(`focus:${payload.paneId}`),
          onTabClick: (payload: { paneId: string; tabId: string }) => events.push(`click:${payload.tabId}`),
          onTabClose: (payload: { paneId: string; tabId: string }) => events.push(`close:${payload.tabId}`),
          onTabCloseOthers: (payload: { paneId: string; tabId: string }) => events.push(`close-others:${payload.tabId}`),
          onTabCloseLeft: (payload: { paneId: string; tabId: string }) => events.push(`close-left:${payload.tabId}`),
          onTabCloseRight: (payload: { paneId: string; tabId: string }) => events.push(`close-right:${payload.tabId}`),
          onTabCloseAll: (payload: { paneId: string }) => events.push(`close-all:${payload.paneId}`),
          onTabCloseUnpinned: (payload: { paneId: string }) => events.push(`close-unpinned:${payload.paneId}`),
          onTabPin: (payload: { paneId: string; tabId: string; pinned: boolean }) =>
            events.push(`pin:${payload.tabId}:${payload.pinned}`),
          onTabMoveToOtherPane: (payload: { paneId: string; tabId: string }) =>
            events.push(`move-to-pane:${payload.tabId}`),
          onTabCopyLink: (payload: { paneId: string; tabId: string }) => events.push(`copy-link:${payload.tabId}`),
          onTabRevealInExplorer: (payload: { paneId: string; tabId: string }) =>
            events.push(`reveal:${payload.tabId}`),
          onTabReorder: (payload: { paneId: string; tabId: string; targetSlot: number }) =>
            events.push(`reorder:${payload.tabId}:${payload.targetSlot}`),
          onTabDrop: (payload: { paneId: string; tabId: string }) => events.push(`tab-drop:${payload.tabId}`),
          onCreateNote: (payload: { paneId: string }) => events.push(`create-note:${payload.paneId}`),
          onRequestMoveTab: (payload: { paneId: string; direction: 'next' | 'previous' }) =>
            events.push(`move:${payload.direction}`)
        })
    }
  }))

  app.mount(root)
  return { app, root, events }
}

/** Lets the protection composable settle before asserting on its badges. */
async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

function documentTab(id: string, path: string, pinned = false) {
  return { id, type: 'document' as const, path, pinned }
}

function tabItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.pane-tab-item'))
}

/** Captures the observer callback so a test can drive the overflow measurement. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  readonly callback: () => void

  constructor(callback: () => void) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }

  observe() {}
  unobserve() {}
  disconnect() {}

  trigger() {
    this.callback()
  }
}

function setScrollMetrics(element: HTMLElement, metrics: { scrollWidth: number; clientWidth: number; scrollLeft?: number }) {
  Object.defineProperty(element, 'scrollWidth', { value: metrics.scrollWidth, configurable: true })
  Object.defineProperty(element, 'clientWidth', { value: metrics.clientWidth, configurable: true })
  Object.defineProperty(element, 'scrollLeft', {
    value: metrics.scrollLeft ?? 0,
    configurable: true,
    writable: true
  })
}

describe('EditorPaneTabs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    FakeResizeObserver.instances = []
    stripDropOptions.length = 0
    document.body.innerHTML = ''
  })

  it('reorders a tab dropped on the right half of another tab', async () => {
    const pane: PaneState = {
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')],
      recentTabIds: ['doc-1']
    }
    const mounted = mountTabs(pane)
    await flush()

    stripDropOptions[0]?.events.onDrop({
      draggedItems: [{ item: 'doc-1' }],
      hoveredDraggable: { index: 1, placement: { right: true } }
    })
    await nextTick()

    expect(mounted.events).toEqual(['reorder:doc-1:2'])

    mounted.app.unmount()
  })

  it('reorders a tab dropped on the left half of another tab', async () => {
    const pane: PaneState = {
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')],
      recentTabIds: ['doc-1']
    }
    const mounted = mountTabs(pane)
    await flush()

    stripDropOptions[0]?.events.onDrop({
      draggedItems: [{ item: 'doc-2' }],
      hoveredDraggable: { index: 0, placement: { right: false } }
    })
    await nextTick()

    expect(mounted.events).toEqual(['reorder:doc-2:0'])

    mounted.app.unmount()
  })

  it('ignores a same-pane drop that lands on no tab', async () => {
    const pane: PaneState = {
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')],
      recentTabIds: ['doc-1']
    }
    const mounted = mountTabs(pane)
    await flush()

    stripDropOptions[0]?.events.onDrop({ draggedItems: [{ item: 'doc-1' }] })
    await nextTick()

    expect(mounted.events).toEqual([])

    mounted.app.unmount()
  })

  it('moves a tab dragged from another pane instead of reordering', async () => {
    const pane: PaneState = {
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      openTabs: [documentTab('doc-1', '/vault/a.md')],
      recentTabIds: ['doc-1']
    }
    const mounted = mountTabs(pane)
    await flush()

    stripDropOptions[0]?.events.onDrop({
      draggedItems: [{ item: 'doc-9' }],
      hoveredDraggable: { index: 0, placement: { right: true } }
    })
    await nextTick()

    expect(mounted.events).toEqual(['tab-drop:doc-9'])

    mounted.app.unmount()
  })

  it('marks protected document tabs', async () => {
    const pane: PaneState = {
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/protected.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/protected.md')]
    }
    const mounted = mountTabs(pane)
    await flush()
    expect(mounted.root.querySelector('[aria-label="Locked protected note"]')).not.toBeNull()
    mounted.app.unmount()
  })

  it('strips the Markdown extension from tab labels while leaving the path untouched', async () => {
    const mounted = mountTabs({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/Gestion du temps.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/Gestion du temps.md')]
    })
    await flush()

    const tab = tabItems(mounted.root)[0]
    expect(tab.querySelector('.pane-tab-name')?.textContent).toBe('Gestion du temps')
    expect(tab.getAttribute('title')).toContain('Gestion du temps.md')

    mounted.app.unmount()
  })

  it('adds the folder to the tooltip when two open tabs share a file name', async () => {
    const mounted = mountTabs({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/projets/Note.md',
      recentTabIds: [],
      openTabs: [
        documentTab('doc-1', '/vault/projets/Note.md'),
        documentTab('doc-2', '/vault/archives/Note.md')
      ]
    })
    await flush()

    const tabs = tabItems(mounted.root)
    expect(tabs[0]?.getAttribute('title')).toContain('this one is in projets')
    expect(tabs[1]?.getAttribute('title')).toContain('this one is in archives')

    mounted.app.unmount()
  })

  it('leaves the tooltip free of folder disambiguation when file names are unique', async () => {
    const mounted = mountTabs({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/projets/Note.md',
      recentTabIds: [],
      openTabs: [
        documentTab('doc-1', '/vault/projets/Note.md'),
        documentTab('doc-2', '/vault/archives/Autre.md')
      ]
    })
    await flush()

    expect(tabItems(mounted.root)[0]?.getAttribute('title')).not.toContain('Another open tab has the same name')

    mounted.app.unmount()
  })

  it('truncates a long title and exposes its full text on hover and focus', async () => {
    const longName = 'Créer des notes atomiques pour un jardin de connaissances durable'
    const mounted = mountTabs({
      id: 'pane-1', activeTabId: 'doc-1', activePath: `/vault/${longName}.md`,
      recentTabIds: [],
      openTabs: [documentTab('doc-1', `/vault/${longName}.md`)]
    })
    await flush()

    const tab = tabItems(mounted.root)[0]
    const name = tab.querySelector('.pane-tab-name')
    expect(name?.textContent).toBe(longName)
    expect(tab.getAttribute('title')).toContain(longName)
    expect(tab.getAttribute('aria-label')).toContain(longName)
    expect(tab.getAttribute('tabindex')).toBe('0')

    mounted.app.unmount()
  })

  it('reserves the close control slot on inactive tabs', async () => {
    const mounted = mountTabs({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')]
    })
    await flush()

    const tabs = tabItems(mounted.root)
    const activeClose = tabs[0]?.querySelector<HTMLElement>('.pane-tab-close')
    const inactiveClose = tabs[1]?.querySelector<HTMLElement>('.pane-tab-close')

    // Both tabs keep the control in the DOM so its slot is always reserved.
    expect(activeClose).not.toBeNull()
    expect(inactiveClose).not.toBeNull()
    expect(activeClose?.dataset.closeVisible).toBe('true')
    expect(inactiveClose?.dataset.closeVisible).toBe('false')

    mounted.app.unmount()
  })

  it('shows the unsaved marker for a dirty document', async () => {
    const mounted = mountTabs(
      {
        id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
        recentTabIds: [],
        openTabs: [documentTab('doc-1', '/vault/a.md')]
      },
      { getStatus: () => ({ dirty: true, saving: false, saveError: '' }) }
    )
    await flush()

    const marker = tabItems(mounted.root)[0]?.querySelector('.pane-tab-state')
    expect(marker?.textContent?.trim()).toBe('●')
    expect(marker?.getAttribute('title')).toBe('Unsaved changes')

    mounted.app.unmount()
  })

  it('shows the failed-save marker instead of the unsaved one', async () => {
    const mounted = mountTabs(
      {
        id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
        recentTabIds: [],
        openTabs: [documentTab('doc-1', '/vault/a.md')]
      },
      { getStatus: () => ({ dirty: true, saving: false, saveError: 'disk full' }) }
    )
    await flush()

    const markers = tabItems(mounted.root)[0]?.querySelectorAll('.pane-tab-state') ?? []
    expect(markers).toHaveLength(1)
    expect(markers[0]?.textContent?.trim()).toBe('!')
    expect(markers[0]?.getAttribute('title')).toBe('Save failed: disk full')

    mounted.app.unmount()
  })

  it('keeps a pinned, protected and unsaved tab to the immediately needed indicators', async () => {
    const mounted = mountTabs(
      {
        id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/protected.md',
        recentTabIds: [],
        openTabs: [documentTab('doc-1', '/vault/protected.md', true)]
      },
      { getStatus: () => ({ dirty: true, saving: false, saveError: '' }) }
    )
    await flush()

    const tab = tabItems(mounted.root)[0]
    expect(tab?.querySelector('[aria-label="Pinned"]')).not.toBeNull()
    expect(tab?.querySelector('[aria-label="Locked protected note"]')).not.toBeNull()
    expect(tab?.querySelectorAll('.pane-tab-state')).toHaveLength(1)
    expect(tab?.querySelector('.pane-tab-state')?.textContent?.trim()).toBe('●')
    // The name stays visible: a pinned tab is never reduced to its icon.
    expect(tab?.querySelector('.pane-tab-name')?.textContent).toBe('protected')

    mounted.app.unmount()
  })

  it('makes the close control of a pinned tab non-operable', async () => {
    const mounted = mountTabs({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/Journal.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/Journal.md', true)]
    })
    await flush()

    const close = mounted.root.querySelector<HTMLButtonElement>('.pane-tab-close')
    expect(close?.disabled).toBe(true)
    expect(close?.getAttribute('aria-label')).toBe('Pinned tab, unpin from the context menu')

    close?.click()
    await nextTick()
    expect(mounted.events).not.toContain('close:doc-1')

    // A middle click must not drop it either.
    const tab = tabItems(mounted.root)[0]
    tab?.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
    await nextTick()
    expect(mounted.events).not.toContain('close:doc-1')

    mounted.app.unmount()
  })

  it('offers pin and unpin from the tab context menu', async () => {
    const pane = reactive<PaneState>({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/a.md')]
    })
    const mounted = mountTabs(pane)
    await flush()

    const openMenu = async () => {
      tabItems(mounted.root)[0]?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 })
      )
      await nextTick()
    }
    const menuItem = (label: string) =>
      Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.pane-tab-menu .ui-menu-item'))
        .find((item) => item.textContent?.trim() === label)

    await openMenu()
    expect(menuItem('Pin Tab')).toBeTruthy()
    menuItem('Pin Tab')?.click()
    await nextTick()
    expect(mounted.events).toContain('pin:doc-1:true')

    pane.openTabs = [documentTab('doc-1', '/vault/a.md', true)]
    await flush()
    await openMenu()
    expect(menuItem('Unpin Tab')).toBeTruthy()
    menuItem('Unpin Tab')?.click()
    await nextTick()
    expect(mounted.events).toContain('pin:doc-1:false')

    mounted.app.unmount()
  })

  it('disables the cross-pane entries when the layout holds a single pane', async () => {
    const mounted = mountTabs(
      {
        id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
        recentTabIds: [],
        openTabs: [documentTab('doc-1', '/vault/a.md')]
      },
      { paneCount: 1 }
    )
    await flush()

    tabItems(mounted.root)[0]?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 })
    )
    await nextTick()

    const byLabel = (label: string) =>
      Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.pane-tab-menu .ui-menu-item'))
        .find((item) => item.textContent?.trim() === label)

    expect(byLabel('Move to Other Pane')?.disabled).toBe(true)
    expect(byLabel('Copy Note Link')?.disabled).toBe(false)
    expect(byLabel('Reveal in Explorer')?.disabled).toBe(false)

    mounted.app.unmount()
  })

  it('disables the cross-pane entries when the document is already in the other pane', async () => {
    const mounted = mountTabs(
      {
        id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
        recentTabIds: [],
        openTabs: [documentTab('doc-1', '/vault/a.md')]
      },
      { paneCount: 2, otherPanePaths: ['/vault/a.md'] }
    )
    await flush()

    tabItems(mounted.root)[0]?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 })
    )
    await nextTick()

    const byLabel = (label: string) =>
      Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.pane-tab-menu .ui-menu-item'))
        .find((item) => item.textContent?.trim() === label)

    expect(byLabel('Move to Other Pane')?.disabled).toBe(true)

    mounted.app.unmount()
  })

  it('runs the cross-pane and document actions from the context menu', async () => {
    const mounted = mountTabs(
      {
        id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
        recentTabIds: [],
        openTabs: [documentTab('doc-1', '/vault/a.md')]
      },
      { paneCount: 2, otherPanePaths: [] }
    )
    await flush()

    const openMenu = async () => {
      tabItems(mounted.root)[0]?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 })
      )
      await nextTick()
    }
    const clickItem = async (label: string) => {
      await openMenu()
      Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.pane-tab-menu .ui-menu-item'))
        .find((item) => item.textContent?.trim() === label)
        ?.click()
      await nextTick()
    }

    await clickItem('Move to Other Pane')
    await clickItem('Copy Note Link')
    await clickItem('Reveal in Explorer')

    expect(mounted.events).toEqual([
      'focus:pane-1', 'move-to-pane:doc-1',
      'focus:pane-1', 'copy-link:doc-1',
      'focus:pane-1', 'reveal:doc-1'
    ])

    mounted.app.unmount()
  })

  it('offers note creation on a double click in the empty strip space', async () => {
    const mounted = mountTabs({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/a.md')]
    })
    await flush()

    const scroll = mounted.root.querySelector<HTMLElement>('.pane-tabs-scroll')
    scroll?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await nextTick()

    expect(mounted.events).toContain('create-note:pane-1')

    mounted.app.unmount()
  })

  it('gives a double click on a tab no special action', async () => {
    const mounted = mountTabs({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/a.md')]
    })
    await flush()

    tabItems(mounted.root)[0]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await nextTick()

    expect(mounted.events).not.toContain('create-note:pane-1')
    expect(mounted.events).not.toContain('close:doc-1')

    mounted.app.unmount()
  })

  it('distinguishes a locked protected note from one unlocked for the session', async () => {
    const mounted = mountTabs({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/protected.md',
      recentTabIds: [],
      openTabs: [
        documentTab('doc-1', '/vault/protected.md'),
        documentTab('doc-2', '/vault/protected-unlocked.md')
      ]
    })
    await flush()

    const tabs = tabItems(mounted.root)
    expect(tabs[0]?.querySelector('[aria-label="Locked protected note"]')).not.toBeNull()
    expect(tabs[1]?.querySelector('[aria-label="Protected note, unlocked for this session"]')).not.toBeNull()
    expect(tabs[0]?.getAttribute('title')).toContain('Locked protected note')
    expect(tabs[1]?.getAttribute('title')).toContain('Protected note, unlocked for this session')

    mounted.app.unmount()
  })

  it('keeps the protection indicator stable across navigation', async () => {
    const pane = reactive<PaneState>({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/protected.md',
      recentTabIds: [],
      openTabs: [
        documentTab('doc-1', '/vault/protected.md'),
        documentTab('doc-2', '/vault/plain.md')
      ]
    })
    const mounted = mountTabs(pane)
    await flush()

    const before = tabItems(mounted.root)[0]?.querySelector('[aria-label="Locked protected note"]')
    expect(before).not.toBeNull()

    pane.activeTabId = 'doc-2'
    pane.activePath = '/vault/plain.md'
    await flush()

    const after = tabItems(mounted.root)[0]?.querySelector('[aria-label="Locked protected note"]')
    expect(after).not.toBeNull()
    expect(tabItems(mounted.root)[1]?.querySelector('[aria-label="Locked protected note"]')).toBeNull()

    mounted.app.unmount()
  })

  it('puts the active-pane affordance on the strip container', async () => {
    const mounted = mountTabs(
      {
        id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
        recentTabIds: [],
        openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')]
      },
      { isActivePane: true }
    )
    await flush()

    const strip = mounted.root.querySelector('.pane-tabs')
    expect(strip?.classList.contains('is-active-pane')).toBe(true)

    const tabs = tabItems(mounted.root)
    expect(tabs[0]?.classList.contains('active')).toBe(true)
    expect(tabs[0]?.classList.contains('active-pane')).toBe(false)

    mounted.app.unmount()
  })

  it('omits the active-pane affordance when the pane is not active', async () => {
    const mounted = mountTabs(
      {
        id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
        recentTabIds: [],
        openTabs: [documentTab('doc-1', '/vault/a.md')]
      },
      { isActivePane: false }
    )
    await flush()

    expect(mounted.root.querySelector('.pane-tabs')?.classList.contains('is-active-pane')).toBe(false)

    mounted.app.unmount()
  })

  it('shows the scroll controls only while the strip overflows', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const mounted = mountTabs({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')]
    })
    await flush()

    const scroll = mounted.root.querySelector<HTMLElement>('.pane-tabs-scroll')
    expect(scroll).not.toBeNull()
    expect(mounted.root.querySelector('[aria-label="Scroll tabs right"]')).toBeNull()

    setScrollMetrics(scroll!, { scrollWidth: 900, clientWidth: 300 })
    FakeResizeObserver.instances[0]?.trigger()
    await nextTick()

    expect(mounted.root.querySelector('[aria-label="Scroll tabs right"]')).not.toBeNull()
    expect(mounted.root.querySelector('[aria-label="Scroll tabs left"]')).not.toBeNull()

    setScrollMetrics(scroll!, { scrollWidth: 300, clientWidth: 300 })
    FakeResizeObserver.instances[0]?.trigger()
    await nextTick()

    expect(mounted.root.querySelector('[aria-label="Scroll tabs right"]')).toBeNull()
    expect(mounted.root.querySelector('[aria-label="Scroll tabs left"]')).toBeNull()

    mounted.app.unmount()
  })

  it('scrolls the strip by a page when a scroll control is used', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const mounted = mountTabs({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')]
    })
    await flush()

    const scroll = mounted.root.querySelector<HTMLElement>('.pane-tabs-scroll')!
    setScrollMetrics(scroll, { scrollWidth: 900, clientWidth: 300 })
    FakeResizeObserver.instances[0]?.trigger()
    await nextTick()

    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Scroll tabs right"]')?.click()
    await nextTick()

    expect(scroll.scrollLeft).toBe(210)

    mounted.app.unmount()
  })

  it('keeps a programmatically opened tab in view and refreshes the controls', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    const pane = reactive<PaneState>({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')]
    })
    const mounted = mountTabs(pane)
    await flush()

    const scroll = mounted.root.querySelector<HTMLElement>('.pane-tabs-scroll')!
    setScrollMetrics(scroll, { scrollWidth: 900, clientWidth: 300 })
    scrollIntoView.mockClear()

    pane.activeTabId = 'doc-2'
    pane.activePath = '/vault/b.md'
    await flush()

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(tabItems(mounted.root)[1])
    expect(mounted.root.querySelector('[aria-label="Scroll tabs right"]')).not.toBeNull()

    mounted.app.unmount()
  })

  it('opens the tab list from the strip trigger', async () => {
    const mounted = mountTabs({
      id: 'pane-1', activeTabId: 'doc-1', activePath: '/vault/a.md',
      recentTabIds: [],
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')]
    })
    await flush()

    const trigger = mounted.root.querySelector<HTMLButtonElement>('[aria-label="All open tabs"]')
    expect(trigger).not.toBeNull()
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')
    expect(mounted.root.querySelector('.pane-tab-list')).toBeNull()

    trigger?.click()
    await flush()

    expect(trigger?.getAttribute('aria-expanded')).toBe('true')
    expect(mounted.root.querySelector('.pane-tab-list')).not.toBeNull()

    mounted.app.unmount()
  })

  it('scrolls the active tab into view when document navigation changes it', async () => {
    const scrollIntoView = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => {})
    const pane = reactive<PaneState>({
      id: 'pane-1',
      activeTabId: 'doc-1',
      openTabs: [
        documentTab('doc-1', '/vault/a.md'),
        documentTab('doc-2', '/vault/b.md'),
        documentTab('doc-3', '/vault/c.md')
      ],
      activePath: '/vault/a.md',
      recentTabIds: []
    })
    const mounted = mountTabs(pane)
    await nextTick()
    await nextTick()
    scrollIntoView.mockClear()

    pane.activeTabId = 'doc-3'
    pane.activePath = '/vault/c.md'
    await nextTick()
    await nextTick()

    const activeTab = tabItems(mounted.root)[2]
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
        documentTab('doc-1', '/vault/a.md'),
        documentTab('doc-2', '/vault/b.md'),
        documentTab('doc-3', '/vault/c.md')
      ],
      activePath: '/vault/b.md',
      recentTabIds: []
    })

    const tabs = tabItems(mounted.root)
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
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')],
      activePath: '/vault/b.md',
      recentTabIds: []
    })

    const tab = tabItems(mounted.root)[1]
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
        documentTab('doc-1', '/vault/a.md'),
        documentTab('doc-2', '/vault/b.md'),
        documentTab('doc-3', '/vault/c.md')
      ],
      activePath: '/vault/b.md',
      recentTabIds: []
    })

    const tab = tabItems(mounted.root)[1]
    tab?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 180, clientY: 72 })
    )
    await nextTick()

    const menuItems = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.pane-tab-menu .ui-menu-item'))
    expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
      'Pin Tab',
      'Move to Other Pane',
      'Copy Note Link',
      'Reveal in Explorer',
      'Close',
      'Close Others',
      'Close Tabs to the Left',
      'Close Tabs to the Right'
    ])

    // Disabled entries are skipped: with a single pane the cross-pane actions
    // are unreachable from the keyboard.
    const expectedFocus = [0, 2, 3, 4, 5]
    for (const index of expectedFocus) {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
      await nextTick()
      expect(document.activeElement).toBe(menuItems[index])
    }

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
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')],
      activePath: '/vault/a.md',
      recentTabIds: []
    })

    const tab = tabItems(mounted.root)[0]
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

  it('names the strip controls explicitly and keeps the close variants out of the strip', async () => {
    const mounted = mountTabs({
      id: 'pane-1',
      activeTabId: 'doc-1',
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')],
      activePath: '/vault/a.md',
      recentTabIds: []
    })

    const actions = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.pane-tab-action'))
    expect(actions.map((action) => action.getAttribute('aria-label'))).toEqual([
      'All open tabs',
      'Move active tab to the previous pane',
      'Move active tab to the next pane'
    ])
    for (const action of actions) {
      expect(action.getAttribute('title')).toBeTruthy()
      expect(action.textContent?.trim()).toBe('')
    }

    actions[1].click()
    actions[2].click()
    expect(mounted.events).toEqual(['move:previous', 'move:next'])

    mounted.app.unmount()
  })

  it('offers closing every tab from the tab list instead of the strip', async () => {
    const mounted = mountTabs({
      id: 'pane-1',
      activeTabId: 'doc-1',
      openTabs: [documentTab('doc-1', '/vault/a.md'), documentTab('doc-2', '/vault/b.md')],
      activePath: '/vault/a.md',
      recentTabIds: []
    })

    mounted.root.querySelector<HTMLButtonElement>('.pane-tab-action')?.click()
    await nextTick()

    const closeAll = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.pane-tab-list-action'))
      .find((action) => action.textContent?.trim() === 'Close all tabs')
    expect(closeAll).toBeTruthy()
    closeAll?.click()

    expect(mounted.events).toContain('close-all:pane-1')

    mounted.app.unmount()
  })
})
