import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppShellCommands } from './useAppShellCommands'

type PaneTab = { id: string; type: 'document'; path: string } | { id: string; type: 'home'; pinned: boolean }

type HarnessOptions = {
  panes: Record<string, { activeTabId: string; openTabs: PaneTab[] }>
  activePaneId?: string
  activeFilePath?: string
  dirtyPaths?: string[]
  /** Paths whose save does not clear the dirty flag. */
  failingPaths?: string[]
}

function createHarness(options: HarnessOptions) {
  const dirty = new Set(options.dirtyPaths ?? [])
  const failing = new Set(options.failingPaths ?? [])
  const panesById = ref(options.panes)
  const activePaneId = ref(options.activePaneId ?? Object.keys(options.panes)[0])

  const closePane = vi.fn(() => true)
  const openDocumentInPane = vi.fn()
  const joinAllPanes = vi.fn()
  const saveOpenDocument = vi.fn(async (path: string) => {
    if (failing.has(path)) return false
    dirty.delete(path)
    return true
  })

  const api = useAppShellCommands({
    workspacePort: {
      hasWorkspace: ref(true),
      activeFilePath: ref(options.activeFilePath ?? ''),
      allWorkspaceFiles: ref([]),
      setSidebarMode: vi.fn(),
      notifyError: vi.fn(),
      notifySuccess: vi.fn()
    },
    documentPort: {
      isMarkdownPath: () => true,
      normalizePathKey: (path: string) => path,
      toRelativePath: (path: string) => path,
      clearEditorStatusForPaths: vi.fn(),
      resetActiveOutline: vi.fn(),
      isDirty: (path: string) => dirty.has(path),
      saveOpenDocument
    },
    panePort: {
      activePaneId: computed(() => activePaneId.value),
      panesById: computed(() => panesById.value),
      openSurfaceInPane: vi.fn(),
      splitPane: vi.fn(() => null),
      setActivePane: vi.fn(),
      focusPaneByIndex: vi.fn(() => false),
      focusAdjacentPane: vi.fn(() => false),
      moveActiveTabToAdjacentPane: vi.fn(() => false),
      closePane,
      openDocumentInPane,
      joinAllPanes,
      resetToSinglePane: vi.fn(),
      closeAllTabsAndResetLayout: vi.fn(),
      closeAllTabsInPane: vi.fn(),
      closeOtherTabsInPane: vi.fn(),
      reopenLastClosedTab: vi.fn(() => false)
    },
    navigationPort: {
      openTabWithAutosave: vi.fn(async () => true),
      recordHomeHistorySnapshot: vi.fn()
    },
    favoritesPort: {
      isFavorite: vi.fn(() => false),
      addFavorite: vi.fn(async () => ({})),
      removeFavorite: vi.fn(async () => {})
    },
    actionPort: {
      loadAllFiles: vi.fn(async () => {}),
      openQuickOpen: vi.fn(async () => {}),
      openTodayNote: vi.fn(async () => true),
      openWorkspacePicker: vi.fn(async () => true),
      closeWorkspace: vi.fn(async () => {}),
      revealInFileManager: vi.fn(async () => {}),
      convertMarkdownToWord: vi.fn(async () => ''),
      closeOverflowMenu: vi.fn(),
      focusSearchInput: vi.fn()
    }
  })

  return { api, closePane, openDocumentInPane, joinAllPanes, saveOpenDocument }
}

describe('useAppShellCommands pane close and join', () => {
  it('closes the active pane without closing its tabs one by one', async () => {
    const harness = createHarness({
      panes: {
        'pane-1': { activeTabId: 'doc:/vault/a.md', openTabs: [{ id: 'doc:/vault/a.md', type: 'document', path: '/vault/a.md' }] },
        'pane-2': { activeTabId: 'doc:/vault/b.md', openTabs: [{ id: 'doc:/vault/b.md', type: 'document', path: '/vault/b.md' }] }
      }
    })

    expect(await harness.api.closeActivePaneFromPalette()).toBe(true)
    expect(harness.closePane).toHaveBeenCalledWith('pane-1')
  })

  it('saves a dirty document before closing its pane', async () => {
    const harness = createHarness({
      panes: {
        'pane-1': { activeTabId: 'doc:/vault/a.md', openTabs: [{ id: 'doc:/vault/a.md', type: 'document', path: '/vault/a.md' }] },
        'pane-2': { activeTabId: '', openTabs: [] }
      },
      dirtyPaths: ['/vault/a.md']
    })

    expect(await harness.api.closeActivePaneFromPalette()).toBe(true)
    expect(harness.saveOpenDocument).toHaveBeenCalledWith('/vault/a.md')
    expect(harness.closePane).toHaveBeenCalledWith('pane-1')
  })

  it('keeps the pane when a save fails', async () => {
    const harness = createHarness({
      panes: {
        'pane-1': { activeTabId: 'doc:/vault/a.md', openTabs: [{ id: 'doc:/vault/a.md', type: 'document', path: '/vault/a.md' }] },
        'pane-2': { activeTabId: '', openTabs: [] }
      },
      dirtyPaths: ['/vault/a.md'],
      failingPaths: ['/vault/a.md']
    })

    expect(await harness.api.closeActivePaneFromPalette()).toBe(false)
    expect(harness.closePane).not.toHaveBeenCalled()
  })

  it('joins panes and keeps the tabs of both', async () => {
    const harness = createHarness({
      panes: {
        'pane-1': { activeTabId: 'doc:/vault/a.md', openTabs: [{ id: 'doc:/vault/a.md', type: 'document', path: '/vault/a.md' }] },
        'pane-2': { activeTabId: 'doc:/vault/b.md', openTabs: [{ id: 'doc:/vault/b.md', type: 'document', path: '/vault/b.md' }] }
      }
    })

    expect(await harness.api.joinPanesFromPalette()).toBe(true)
    expect(harness.joinAllPanes).toHaveBeenCalledTimes(1)
  })

  it('does not join panes when a joined pane holds unsaved changes that fail to save', async () => {
    const harness = createHarness({
      panes: {
        'pane-1': { activeTabId: 'doc:/vault/a.md', openTabs: [{ id: 'doc:/vault/a.md', type: 'document', path: '/vault/a.md' }] },
        'pane-2': { activeTabId: 'doc:/vault/b.md', openTabs: [{ id: 'doc:/vault/b.md', type: 'document', path: '/vault/b.md' }] }
      },
      dirtyPaths: ['/vault/b.md'],
      failingPaths: ['/vault/b.md']
    })

    expect(await harness.api.joinPanesFromPalette()).toBe(false)
    expect(harness.joinAllPanes).not.toHaveBeenCalled()
  })
})
