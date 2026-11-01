import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppShellPaneRuntime } from './useAppShellPaneRuntime'

describe('useAppShellPaneRuntime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('switches sidebar mode through the injected workspace port', () => {
    const sidebarMode = ref<'explorer' | 'favorites' | 'search'>('explorer')
    const setSidebarMode = vi.fn((mode: 'explorer' | 'favorites' | 'search') => {
      sidebarMode.value = mode
    })
    const toggleSidebar = vi.fn()

    const api = useAppShellPaneRuntime({
      activeFilePath: ref(''),
      multiPane: {
        layout: ref({ activePaneId: 'pane-1', panesById: {} }),
        setActivePane: vi.fn(),
        setActiveTabInPane: vi.fn(),
        closeTabInPane: vi.fn(),
        closeOtherTabsInPane: vi.fn(() => []),
        closeTabsLeftInPane: vi.fn(() => []),
        closeTabsRightInPane: vi.fn(() => []),
        closeAllTabsInPane: vi.fn(),
        closeAllUnpinnedTabsInPane: vi.fn(() => []),
        setTabPinnedInPane: vi.fn(),
        reorderTabInPane: vi.fn(),
        moveTabToPane: vi.fn(),
        openDocumentInPane: vi.fn(),
        getActiveTab: () => null,
        getActiveDocumentPath: () => null
      },
      editorState: {
        getStatus: vi.fn(() => ({ dirty: false, saving: false, saveError: '' })),
        updateStatus: vi.fn(),
        clearStatus: vi.fn(),
        setActiveOutline: vi.fn()
      },
      editorRef: ref(null),
      workspace: {
        sidebarMode,
        setSidebarMode,
        toggleSidebar
      },
      search: {
        selectGlobalSearchMode: vi.fn((mode: 'hybrid' | 'lexical') => ({
          caret: mode === 'hybrid' ? 0 : 7
        }))
      },
      setActiveTabWithAutosave: vi.fn(async () => true),
      propertiesPreview: ref([]),
      propertyParseErrorCount: ref(0),
      copyNoteLink: vi.fn(),
      revealPathInExplorer: vi.fn(),
      lockNote: vi.fn(),
      createNoteInPane: vi.fn()
    })

    api.setSidebarMode('search')
    expect(setSidebarMode).toHaveBeenCalledWith('search')

    api.setSidebarMode('search')
    expect(toggleSidebar).toHaveBeenCalled()
  })

  function createCloseHarness(options: { dirty: boolean; saveSucceeds: boolean }) {
    const status = { dirty: options.dirty, saving: false, saveError: '' }
    const closeTabInPane = vi.fn()
    const saveNow = vi.fn(async () => {
      if (options.saveSucceeds) status.dirty = false
    })

    const api = useAppShellPaneRuntime({
      activeFilePath: ref('/vault/a.md'),
      multiPane: {
        layout: ref({
          activePaneId: 'pane-1',
          panesById: {
            'pane-1': {
              id: 'pane-1',
              activeTabId: 'doc:/vault/a.md',
              activePath: '/vault/a.md',
              recentTabIds: ['doc:/vault/a.md'],
              openTabs: [{ id: 'doc:/vault/a.md', type: 'document' as const, path: '/vault/a.md', pinned: false }]
            }
          }
        }),
        setActivePane: vi.fn(),
        setActiveTabInPane: vi.fn(),
        closeTabInPane,
        closeOtherTabsInPane: vi.fn(() => []),
        closeTabsLeftInPane: vi.fn(() => []),
        closeTabsRightInPane: vi.fn(() => []),
        closeAllTabsInPane: vi.fn(),
        closeAllUnpinnedTabsInPane: vi.fn(() => []),
        setTabPinnedInPane: vi.fn(),
        reorderTabInPane: vi.fn(),
        moveTabToPane: vi.fn(),
        openDocumentInPane: vi.fn(),
        getActiveTab: () => null,
        getActiveDocumentPath: () => '/vault/a.md'
      },
      editorState: {
        getStatus: vi.fn(() => status),
        updateStatus: vi.fn(),
        clearStatus: vi.fn(),
        setActiveOutline: vi.fn()
      },
      editorRef: ref({ saveNow } as never),
      workspace: {
        sidebarMode: ref<'explorer' | 'favorites' | 'search'>('explorer'),
        setSidebarMode: vi.fn(),
        toggleSidebar: vi.fn()
      },
      search: { selectGlobalSearchMode: vi.fn(() => ({ caret: 0 })) },
      setActiveTabWithAutosave: vi.fn(async () => true),
      propertiesPreview: ref([]),
      propertyParseErrorCount: ref(0),
      copyNoteLink: vi.fn(),
      revealPathInExplorer: vi.fn(),
      lockNote: vi.fn(),
      createNoteInPane: vi.fn()
    })

    return { api, closeTabInPane, saveNow }
  }

  it('saves a dirty document before closing its tab', async () => {
    const harness = createCloseHarness({ dirty: true, saveSucceeds: true })

    await harness.api.closeActiveTab()

    expect(harness.saveNow).toHaveBeenCalledTimes(1)
    expect(harness.closeTabInPane).toHaveBeenCalledWith('pane-1', 'doc:/vault/a.md')
  })

  it('keeps the tab and the buffer when the save before close fails', async () => {
    const harness = createCloseHarness({ dirty: true, saveSucceeds: false })

    await harness.api.closeActiveTab()

    expect(harness.saveNow).toHaveBeenCalledTimes(1)
    expect(harness.closeTabInPane).not.toHaveBeenCalled()
  })

  it('closes a clean document without saving', async () => {
    const harness = createCloseHarness({ dirty: false, saveSucceeds: true })

    await harness.api.closeActiveTab()

    expect(harness.saveNow).not.toHaveBeenCalled()
    expect(harness.closeTabInPane).toHaveBeenCalledWith('pane-1', 'doc:/vault/a.md')
  })

  function createDropHarness() {
    const openDocumentInPane = vi.fn()
    const closeTabInPane = vi.fn()
    const setTabPinnedInPane = vi.fn()
    const moveTabToPane = vi.fn()
    const lockNote = vi.fn()

    const api = useAppShellPaneRuntime({
      activeFilePath: ref('/vault/a.md'),
      multiPane: {
        layout: ref({
          activePaneId: 'pane-1',
          panesById: {
            'pane-1': {
              id: 'pane-1',
              activeTabId: 'doc:/vault/a.md',
              activePath: '/vault/a.md',
              recentTabIds: ['doc:/vault/a.md'],
              openTabs: [{ id: 'doc:/vault/a.md', type: 'document' as const, path: '/vault/a.md', pinned: true }]
            },
            'pane-2': {
              id: 'pane-2',
              activeTabId: '',
              activePath: '',
              recentTabIds: [],
              openTabs: []
            }
          }
        }),
        setActivePane: vi.fn(),
        setActiveTabInPane: vi.fn(),
        closeTabInPane,
        closeOtherTabsInPane: vi.fn(() => []),
        closeTabsLeftInPane: vi.fn(() => []),
        closeTabsRightInPane: vi.fn(() => []),
        closeAllTabsInPane: vi.fn(),
        closeAllUnpinnedTabsInPane: vi.fn(() => []),
        setTabPinnedInPane,
        reorderTabInPane: vi.fn(),
        moveTabToPane,
        openDocumentInPane,
        getActiveTab: () => null,
        getActiveDocumentPath: () => '/vault/a.md'
      },
      editorState: {
        getStatus: vi.fn(() => ({ dirty: true, saving: false, saveError: '' })),
        updateStatus: vi.fn(),
        clearStatus: vi.fn(),
        setActiveOutline: vi.fn()
      },
      editorRef: ref(null),
      workspace: {
        sidebarMode: ref<'explorer' | 'favorites' | 'search'>('explorer'),
        setSidebarMode: vi.fn(),
        toggleSidebar: vi.fn()
      },
      search: { selectGlobalSearchMode: vi.fn(() => ({ caret: 0 })) },
      setActiveTabWithAutosave: vi.fn(async () => true),
      propertiesPreview: ref([]),
      propertyParseErrorCount: ref(0),
      copyNoteLink: vi.fn(),
      revealPathInExplorer: vi.fn(),
      lockNote,
      createNoteInPane: vi.fn()
    })

    return { api, openDocumentInPane, closeTabInPane, setTabPinnedInPane, moveTabToPane, lockNote }
  }

  it('relocates a tab dropped on another pane instead of reopening it', () => {
    const harness = createDropHarness()

    harness.api.onPaneTabDrop({ paneId: 'pane-2', tabId: 'doc:/vault/a.md' })

    expect(harness.moveTabToPane).toHaveBeenCalledWith('pane-1', 'doc:/vault/a.md', 'pane-2')
    expect(harness.openDocumentInPane).not.toHaveBeenCalled()
    expect(harness.closeTabInPane).not.toHaveBeenCalled()
  })

  it('ignores a drop of a tab that no other pane owns', () => {
    const harness = createDropHarness()

    harness.api.onPaneTabDrop({ paneId: 'pane-2', tabId: 'doc:/vault/unknown.md' })

    expect(harness.moveTabToPane).not.toHaveBeenCalled()
    expect(harness.openDocumentInPane).not.toHaveBeenCalled()
    expect(harness.closeTabInPane).not.toHaveBeenCalled()
  })

  it('locks the note behind the tab that was clicked', () => {
    const harness = createDropHarness()

    harness.api.onPaneTabLock({ paneId: 'pane-1', tabId: 'doc:/vault/a.md' })

    expect(harness.lockNote).toHaveBeenCalledWith('/vault/a.md')
  })

  it('ignores a lock request for a tab that no longer exists', () => {
    const harness = createDropHarness()

    harness.api.onPaneTabLock({ paneId: 'pane-1', tabId: 'doc:/vault/gone.md' })

    expect(harness.lockNote).not.toHaveBeenCalled()
  })
})
