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

  it('keeps special surfaces unique across panes', () => {
    const store = useMultiPaneWorkspaceState()
    store.openSurfaceInPane('home')
    store.openSurfaceInPane('second-brain-chat')
    const pane2 = store.splitPane('pane-1', 'row')
    store.openSurfaceInPane('home', pane2!)
    store.openSurfaceInPane('second-brain-chat', pane2!)

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
    store.openSurfaceInPane('second-brain-chat', pane2!)
    store.setActivePane(pane2!)

    store.joinAllPanes()

    const tabs = store.layout.value.panesById['pane-1'].openTabs
    expect(store.paneOrder.value).toEqual(['pane-1'])
    expect(tabs.map((tab) => tab.type)).toEqual(['document', 'home', 'document', 'second-brain-chat'])
  })

  it('serializes and hydrates current layout', () => {
    const store = useMultiPaneWorkspaceState()
    store.openDocumentInPane('/vault/a.md')
    store.openSurfaceInPane('home')

    const payload = serializeLayout(store.layout.value)
    const hydrated = hydrateLayout(payload)

    expect(hydrated).toBeTruthy()
    expect(hydrated?.panesById['pane-1'].openTabs).toHaveLength(2)
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

  it('hydrates legacy second-brain sessions surface as chat', () => {
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
    expect(hydrated?.panesById['pane-1'].openTabs[0].type).toBe('second-brain-chat')
    expect(hydrated?.panesById['pane-1'].openTabs[0].id).toBe('surface:second-brain-chat')
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
})
