import { describe, expect, it } from 'vitest'
import {
  createInitialLayout,
  hydrateLayout,
  serializeLayout,
  useMultiPaneWorkspaceState
} from './useMultiPaneWorkspaceState'

describe('useMultiPaneWorkspaceState', () => {
  it('starts with single pane layout', () => {
    const store = useMultiPaneWorkspaceState()
    expect(store.paneOrder.value).toEqual(['pane-1'])
    expect(store.layout.value.activePaneId).toBe('pane-1')
  })

  it('keeps documents unique across panes', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    const pane2 = store.splitPane('pane-1', 'row')
    expect(pane2).toBe('pane-2')

    store.openDocumentInPane('/vault/a.md', pane2!)

    expect(store.layout.value.activePaneId).toBe('pane-1')
    expect(store.getActiveDocumentPath()).toBe('/vault/a.md')
    expect(store.layout.value.panesById['pane-2'].openTabs).toEqual([])
  })

  it('keeps inspector tabs unique across panes', () => {
    const store = useMultiPaneWorkspaceState()
    store.openInspectorInPane('/vault/photo.png')
    const pane2 = store.splitPane('pane-1', 'row')
    expect(pane2).toBe('pane-2')

    store.openInspectorInPane('/vault/photo.png', pane2!)

    expect(store.layout.value.activePaneId).toBe('pane-1')
    expect(store.layout.value.panesById['pane-2'].openTabs).toEqual([])
  })

  it('keeps the home surface unique across panes', () => {
    const store = useMultiPaneWorkspaceState()
    store.openSurfaceInPane('home')
    const pane2 = store.splitPane('pane-1', 'row')
    store.openSurfaceInPane('home', pane2!)

    expect(store.layout.value.activePaneId).toBe('pane-1')
  })

  it('closes tabs to the left of the requested tab and activates the clicked tab when needed', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')
    store.openDocumentInPane('/vault/c.md')
    store.openDocumentInPane('/vault/d.md')
    store.setActiveTabInPane('pane-1', 'doc:/vault/a.md')

    const removed = store.closeTabsLeftInPane('pane-1', 'doc:/vault/c.md')

    expect(removed).toEqual(['/vault/a.md', '/vault/b.md'])
    expect(store.layout.value.panesById['pane-1'].openTabs.map((tab) => tab.id)).toEqual([
      'doc:/vault/c.md',
      'doc:/vault/d.md'
    ])
    expect(store.layout.value.panesById['pane-1'].activeTabId).toBe('doc:/vault/c.md')
    expect(store.getActiveDocumentPath()).toBe('/vault/c.md')
  })

  it('closes tabs to the right of the requested tab and falls back to the clicked tab when the active tab is removed', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')
    store.openDocumentInPane('/vault/c.md')
    store.openDocumentInPane('/vault/d.md')

    const removed = store.closeTabsRightInPane('pane-1', 'doc:/vault/b.md')

    expect(removed).toEqual(['/vault/c.md', '/vault/d.md'])
    expect(store.layout.value.panesById['pane-1'].openTabs.map((tab) => tab.id)).toEqual([
      'doc:/vault/a.md',
      'doc:/vault/b.md'
    ])
    expect(store.layout.value.panesById['pane-1'].activeTabId).toBe('doc:/vault/b.md')
    expect(store.getActiveDocumentPath()).toBe('/vault/b.md')
  })

  it('supports split and max 4 panes', () => {
    const store = useMultiPaneWorkspaceState()
    const p2 = store.splitPane('pane-1', 'row')
    const p3 = store.splitPane(p2!, 'column')
    const p4 = store.splitPane(p3!, 'row')
    const p5 = store.splitPane(p4!, 'column')

    expect(p2).toBeTruthy()
    expect(p3).toBeTruthy()
    expect(p4).toBeTruthy()
    expect(p5).toBeNull()
    expect(store.paneOrder.value).toHaveLength(4)
  })

  it('moves active tab to adjacent pane', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.splitPane('pane-1', 'row')
    store.setActivePane('pane-1')

    const moved = store.moveActiveTabToAdjacentPane('next')

    expect(moved).toBe(true)
    expect(store.layout.value.activePaneId).toBe('pane-2')
    expect(store.getActiveDocumentPath('pane-2')).toBe('/vault/a.md')
  })

  it('reveals a document in the requested pane by moving it out of the source pane', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    const pane2 = store.splitPane('pane-1', 'row')

    store.revealDocumentInPane('/vault/a.md', pane2!)

    expect(store.findPaneContainingDocument('/vault/a.md')).toBe('pane-2')
    expect(store.layout.value.panesById['pane-1'].openTabs).toEqual([])
    expect(store.layout.value.activePaneId).toBe('pane-2')
    expect(store.getActiveDocumentPath('pane-2')).toBe('/vault/a.md')
  })

  it('activates an already-open document when it is already in the target pane', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    const pane2 = store.splitPane('pane-1', 'row')
    store.openDocumentInPane('/vault/b.md', pane2!)
    store.openDocumentInPane('/vault/c.md', pane2!)

    store.revealDocumentInPane('/vault/b.md', pane2!)

    expect(store.findPaneContainingDocument('/vault/b.md')).toBe('pane-2')
    expect(store.layout.value.activePaneId).toBe('pane-2')
    expect(store.getActiveDocumentPath('pane-2')).toBe('/vault/b.md')
    expect(store.layout.value.panesById['pane-1'].openTabs).toHaveLength(1)
  })

  it('moves a tab into another pane without reopening it', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')
    const pane2 = store.splitPane('pane-1', 'row')!

    store.moveTabToPane('pane-1', 'doc:/vault/b.md', pane2)

    expect(store.layout.value.panesById['pane-1'].openTabs.map((tab) => tab.id)).toEqual(['doc:/vault/a.md'])
    expect(store.layout.value.panesById[pane2].openTabs.map((tab) => tab.id)).toEqual(['doc:/vault/b.md'])
    expect(store.getActiveDocumentPath(pane2)).toBe('/vault/b.md')
    expect(store.layout.value.activePaneId).toBe(pane2)
  })

  it('keeps the pinned state of a moved tab', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.setTabPinnedInPane('pane-1', 'doc:/vault/a.md', true)
    const pane2 = store.splitPane('pane-1', 'row')!

    store.moveTabToPane('pane-1', 'doc:/vault/a.md', pane2)

    expect(store.layout.value.panesById[pane2].openTabs[0]?.pinned).toBe(true)
  })

  it('collapses a move into an activation when the target already shows the tab', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    const pane2 = store.splitPane('pane-1', 'row')!
    store.openDocumentInPane('/vault/b.md', pane2)

    store.moveTabToPane('pane-1', 'doc:/vault/a.md', pane2)

    expect(store.layout.value.panesById['pane-1'].openTabs).toEqual([])
    expect(store.layout.value.panesById[pane2].openTabs.map((tab) => tab.id)).toEqual([
      'doc:/vault/b.md',
      'doc:/vault/a.md'
    ])
    expect(store.getActiveDocumentPath(pane2)).toBe('/vault/a.md')
  })

  it('creates a pane when moving active tab to next pane from single-pane layout', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')

    const moved = store.moveActiveTabToAdjacentPane('next')

    expect(moved).toBe(true)
    expect(store.paneOrder.value).toEqual(['pane-1', 'pane-2'])
    expect(store.layout.value.panesById['pane-1'].openTabs).toEqual([])
    expect(store.getActiveDocumentPath('pane-2')).toBe('/vault/a.md')
  })

  it('joins panes and keeps mixed unique tabs', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openSurfaceInPane('home')
    const pane2 = store.splitPane('pane-1', 'row')
    store.openDocumentInPane('/vault/b.md', pane2!)
    store.setActivePane(pane2!)

    store.joinAllPanes()

    const tabs = store.layout.value.panesById['pane-1'].openTabs
    expect(store.paneOrder.value).toEqual(['pane-1'])
    expect(tabs.map((tab) => tab.type)).toEqual(['document', 'home', 'document'])
  })

  it('serializes and hydrates current layout', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')

    const payload = serializeLayout(store.layout.value)
    const hydrated = hydrateLayout(payload)

    expect(hydrated).toBeTruthy()
    expect(hydrated?.panesById['pane-1'].openTabs).toHaveLength(2)
    expect(hydrated?.panesById['pane-1'].recentTabIds).toEqual(['doc:/vault/b.md', 'doc:/vault/a.md'])
  })

  it('drops persisted home tabs and seeds the MRU order from the active tab', () => {
    const hydrated = hydrateLayout({
      root: { kind: 'pane', paneId: 'pane-1' },
      activePaneId: 'pane-1',
      panesById: {
        'pane-1': {
          id: 'pane-1',
          openTabs: [
            { id: 'surface:home', type: 'home', pinned: false },
            { id: 'doc:/vault/a.md', type: 'document', path: '/vault/a.md' },
            { id: 'doc:/vault/b.md', type: 'document', path: '/vault/b.md' }
          ],
          activeTabId: 'doc:/vault/a.md',
          activePath: '/vault/a.md'
        }
      }
    })

    expect(hydrated).toBeTruthy()
    const pane = hydrated!.panesById['pane-1']
    expect(pane.openTabs.map((tab) => tab.type)).toEqual(['document', 'document'])
    expect(pane.recentTabIds).toEqual(['doc:/vault/a.md'])
    expect(pane.openTabs.every((tab) => tab.pinned === false)).toBe(true)
  })

  it('rejects invalid layouts', () => {
    expect(hydrateLayout(null)).toBeNull()
    expect(hydrateLayout({})).toBeNull()
  })

  it('ignores removed Cosmos tabs when restoring a workspace', () => {
    const hydrated = hydrateLayout({
      root: { kind: 'pane', paneId: 'pane-1' },
      activePaneId: 'pane-1',
      panesById: {
        'pane-1': {
          id: 'pane-1',
          activeTabId: 'surface:cosmos',
          openTabs: [
            { id: 'surface:cosmos', type: 'cosmos', pinned: true },
            { id: 'doc:/vault/a.md', type: 'document', path: '/vault/a.md', pinned: false }
          ]
        }
      }
    })
    expect(hydrated?.panesById['pane-1'].openTabs).toEqual([
      { id: 'doc:/vault/a.md', type: 'document', path: '/vault/a.md', pinned: false }
    ])
    expect(hydrated?.panesById['pane-1'].activeTabId).toBe('doc:/vault/a.md')
  })

  it('keeps a pane valid when its only saved tab was Cosmos', () => {
    const hydrated = hydrateLayout({
      root: { kind: 'pane', paneId: 'pane-1' },
      activePaneId: 'pane-1',
      panesById: {
        'pane-1': {
          id: 'pane-1', activeTabId: 'surface:cosmos',
          openTabs: [{ id: 'surface:cosmos', type: 'cosmos', pinned: false }]
        }
      }
    })
    expect(hydrated?.panesById['pane-1'].openTabs).toEqual([])
    expect(hydrated?.panesById['pane-1'].activeTabId).toBe('')
  })

  it('ignores removed legacy surfaces when restoring a layout', () => {
    const hydrated = hydrateLayout({
      root: { kind: 'pane', paneId: 'pane-1' },
      panesById: {
        'pane-1': {
          id: 'pane-1',
          openTabs: [
            { id: 'surface:second-brain-sessions', type: 'second-brain-sessions', pinned: false }
          ],
          activeTabId: 'surface:second-brain-sessions',
          activePath: ''
        }
      },
      activePaneId: 'pane-1'
    })

    expect(hydrated).toBeTruthy()
    expect(hydrated?.panesById['pane-1'].openTabs).toEqual([])
  })

  it('creates a valid initial layout helper', () => {
    const initial = createInitialLayout()
    expect(initial.root.kind).toBe('pane')
    expect(initial.activePaneId).toBe('pane-1')
  })

  it('keeps the renamed document active when the active tab path changes', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')

    expect(store.getActiveDocumentPath()).toBe('/vault/b.md')

    store.replacePath('/vault/b.md', '/vault/b-renamed.md')

    expect(store.getActiveDocumentPath()).toBe('/vault/b-renamed.md')
    expect(store.layout.value.panesById['pane-1'].activeTabId).toBe('doc:/vault/b-renamed.md')
    expect(store.layout.value.panesById['pane-1'].openTabs.map((tab) => tab.id)).toEqual([
      'doc:/vault/a.md',
      'doc:/vault/b-renamed.md'
    ])
  })

  it('renames inspector tabs in place', () => {
    const store = useMultiPaneWorkspaceState()
    store.openInspectorInPane('/vault/photo.png')

    store.replacePath('/vault/photo.png', '/vault/photo-renamed.png')

    expect(store.getActiveDocumentPath()).toBe('/vault/photo-renamed.png')
    expect(store.layout.value.panesById['pane-1'].activeTabId).toBe('file-inspector:/vault/photo-renamed.png')
    expect(store.layout.value.panesById['pane-1'].openTabs.map((tab) => tab.id)).toEqual([
      'file-inspector:/vault/photo-renamed.png'
    ])
  })

  it('closes all tabs globally and resets to a single pane', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    const pane2 = store.splitPane('pane-1', 'row')
    store.openDocumentInPane('/vault/b.md', pane2!)

    store.closeAllTabsAndResetLayout()

    expect(store.paneOrder.value).toEqual(['pane-1'])
    expect(store.layout.value.activePaneId).toBe('pane-1')
    expect(store.layout.value.panesById['pane-1'].openTabs).toEqual([])
  })

  it('returns to the most recently consulted tab when the active tab closes', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')
    store.openDocumentInPane('/vault/c.md')
    store.setActiveTabInPane('pane-1', 'doc:/vault/a.md')
    store.setActiveTabInPane('pane-1', 'doc:/vault/b.md')
    store.setActiveTabInPane('pane-1', 'doc:/vault/c.md')

    store.closeTabInPane('pane-1', 'doc:/vault/c.md')

    // B was consulted just before C, so it wins over the visual neighbour.
    expect(store.layout.value.panesById['pane-1'].activeTabId).toBe('doc:/vault/b.md')
  })

  it('leaves the displayed document alone when an inactive tab closes', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')

    store.closeTabInPane('pane-1', 'doc:/vault/a.md')

    expect(store.layout.value.panesById['pane-1'].activeTabId).toBe('doc:/vault/b.md')
  })

  it('reopens the last closed tab in the pane it came from', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')
    store.closeTabInPane('pane-1', 'doc:/vault/a.md')

    expect(store.reopenLastClosedTab()).toBe(true)

    const pane = store.layout.value.panesById['pane-1']
    expect(pane.openTabs.map((tab) => tab.id)).toEqual(['doc:/vault/a.md', 'doc:/vault/b.md'])
    expect(pane.activeTabId).toBe('doc:/vault/a.md')
  })

  it('reports nothing to reopen when the stack is empty', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')

    expect(store.reopenLastClosedTab()).toBe(false)
    expect(store.layout.value.panesById['pane-1'].openTabs).toHaveLength(1)
  })

  it('caps the reopen stack at twenty entries', () => {
    const store = useMultiPaneWorkspaceState()
    for (let index = 0; index < 25; index += 1) {
      store.openDocumentInPane(`/vault/note-${index}.md`)
    }
    for (let index = 0; index < 25; index += 1) {
      store.closeTabInPane('pane-1', `doc:/vault/note-${index}.md`)
    }

    expect(store.closedTabs.value).toHaveLength(20)
    // The oldest five were dropped, so the last closed tab is the newest entry.
    expect(store.closedTabs.value[store.closedTabs.value.length - 1].tab.id).toBe('doc:/vault/note-24.md')
  })

  it('cycles the active pane tabs in most-recently-consulted order', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')
    store.openDocumentInPane('/vault/c.md')
    store.setActiveTabInPane('pane-1', 'doc:/vault/a.md')

    // MRU order is [a, c, b]: c was consulted just before the user returned to a.
    expect(store.cycleRecentTab('next')).toBe(true)
    expect(store.layout.value.panesById['pane-1'].activeTabId).toBe('doc:/vault/c.md')

    expect(store.cycleRecentTab('previous')).toBe(true)
    expect(store.layout.value.panesById['pane-1'].activeTabId).toBe('doc:/vault/a.md')
  })

  it('does not cycle when the pane holds a single tab', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')

    expect(store.cycleRecentTab('next')).toBe(false)
  })

  it('returns the pane to its home surface when the last tab closes', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')

    store.closeTabInPane('pane-1', 'doc:/vault/a.md')

    const pane = store.layout.value.panesById['pane-1']
    expect(pane.openTabs).toEqual([])
    expect(pane.activeTabId).toBe('')
    expect(pane.activePath).toBe('')
    expect(store.getActiveTab()).toBeNull()
  })

  it('moves a pinned tab to the front of the strip', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')
    store.openDocumentInPane('/vault/c.md')

    store.setTabPinnedInPane('pane-1', 'doc:/vault/c.md', true)

    expect(store.layout.value.panesById['pane-1'].openTabs.map((tab) => tab.id)).toEqual([
      'doc:/vault/c.md',
      'doc:/vault/a.md',
      'doc:/vault/b.md'
    ])
    expect(store.layout.value.panesById['pane-1'].openTabs[0].pinned).toBe(true)
  })

  it('moves an unpinned tab to the first unpinned slot', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')
    store.openDocumentInPane('/vault/c.md')
    store.setTabPinnedInPane('pane-1', 'doc:/vault/a.md', true)
    store.setTabPinnedInPane('pane-1', 'doc:/vault/b.md', true)

    store.setTabPinnedInPane('pane-1', 'doc:/vault/a.md', false)

    expect(store.layout.value.panesById['pane-1'].openTabs.map((tab) => tab.id)).toEqual([
      'doc:/vault/b.md',
      'doc:/vault/a.md',
      'doc:/vault/c.md'
    ])
    expect(store.layout.value.panesById['pane-1'].openTabs[1].pinned).toBe(false)
  })

  it('reorders a tab to the requested insertion slot', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')
    store.openDocumentInPane('/vault/c.md')

    // Drop "a" in the gap after "c".
    store.reorderTabInPane('pane-1', 'doc:/vault/a.md', 3)

    expect(store.layout.value.panesById['pane-1'].openTabs.map((tab) => tab.id)).toEqual([
      'doc:/vault/b.md',
      'doc:/vault/c.md',
      'doc:/vault/a.md'
    ])
  })

  it('clamps a drag that would cross the pinned boundary', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')
    store.openDocumentInPane('/vault/c.md')
    store.setTabPinnedInPane('pane-1', 'doc:/vault/a.md', true)

    // An unpinned tab cannot be dropped into the pinned prefix.
    store.reorderTabInPane('pane-1', 'doc:/vault/c.md', 0)
    expect(store.layout.value.panesById['pane-1'].openTabs.map((tab) => tab.id)).toEqual([
      'doc:/vault/a.md',
      'doc:/vault/c.md',
      'doc:/vault/b.md'
    ])

    // A pinned tab cannot be dropped after the pinned prefix.
    store.reorderTabInPane('pane-1', 'doc:/vault/a.md', 3)
    expect(store.layout.value.panesById['pane-1'].openTabs.map((tab) => tab.id)).toEqual([
      'doc:/vault/a.md',
      'doc:/vault/c.md',
      'doc:/vault/b.md'
    ])
  })

  it('keeps pinned tabs when closing the other tabs', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')
    store.openDocumentInPane('/vault/c.md')
    store.setTabPinnedInPane('pane-1', 'doc:/vault/a.md', true)

    store.closeOtherTabsInPane('pane-1', 'doc:/vault/c.md')

    expect(store.layout.value.panesById['pane-1'].openTabs.map((tab) => tab.id)).toEqual([
      'doc:/vault/a.md',
      'doc:/vault/c.md'
    ])
  })

  it('keeps pinned tabs when closing all unpinned tabs', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')
    store.openDocumentInPane('/vault/c.md')
    store.setTabPinnedInPane('pane-1', 'doc:/vault/a.md', true)
    store.setActiveTabInPane('pane-1', 'doc:/vault/c.md')

    const removed = store.closeAllUnpinnedTabsInPane('pane-1')

    expect(removed).toEqual(['/vault/b.md', '/vault/c.md'])
    expect(store.layout.value.panesById['pane-1'].openTabs.map((tab) => tab.id)).toEqual(['doc:/vault/a.md'])
    expect(store.layout.value.panesById['pane-1'].activeTabId).toBe('doc:/vault/a.md')
  })

  it('restores pinned tabs on reopen without touching the note itself', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')
    store.setTabPinnedInPane('pane-1', 'doc:/vault/b.md', true)

    const before = store.layout.value.panesById['pane-1'].openTabs.find((tab) => tab.id === 'doc:/vault/b.md')
    const hydrated = hydrateLayout(JSON.parse(JSON.stringify(serializeLayout(store.layout.value))))
    expect(hydrated).not.toBeNull()
    const after = hydrated!.panesById['pane-1'].openTabs.find((tab) => tab.id === 'doc:/vault/b.md')

    // Pinning is layout state only: the tab keeps its identity and its path.
    expect(after).toEqual(before)
    expect(after?.pinned).toBe(true)
    expect(hydrated!.panesById['pane-1'].openTabs[0].id).toBe('doc:/vault/b.md')
  })

  it('keeps each pane tab selection independent', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openDocumentInPane('/vault/b.md')
    const pane2 = store.splitPane('pane-1', 'row')!
    store.openDocumentInPane('/vault/c.md', pane2)
    store.openDocumentInPane('/vault/d.md', pane2)

    store.setActiveTabInPane(pane2, 'doc:/vault/c.md')
    store.setActiveTabInPane('pane-1', 'doc:/vault/a.md')

    expect(store.layout.value.panesById['pane-1'].activeTabId).toBe('doc:/vault/a.md')
    expect(store.layout.value.panesById[pane2].activeTabId).toBe('doc:/vault/c.md')

    // Switching in one pane must not touch the other pane's selection or its
    // most-recently-consulted order.
    const otherBefore = store.layout.value.panesById[pane2]
    store.setActiveTabInPane('pane-1', 'doc:/vault/b.md')

    expect(store.layout.value.panesById[pane2]).toEqual(otherBefore)
    expect(store.layout.value.panesById['pane-1'].activeTabId).toBe('doc:/vault/b.md')
  })
})
