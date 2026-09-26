import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppShellCommands } from './useAppShellCommands'

function createCommands() {
  const activePaneId = ref('pane-1')
  const panesById = ref({
    'pane-1': {
      activeTabId: 'doc-1',
      openTabs: [
        { id: 'doc-1', type: 'document' as const, path: '/vault/a.md' },
        { id: 'home', type: 'home' as const, pinned: true }
      ]
    },
    'pane-2': {
      activeTabId: 'doc-2',
      openTabs: [{ id: 'doc-2', type: 'document' as const, path: '/vault/b.md' }]
    }
  })

  const workspacePort = {
    hasWorkspace: ref(true),
    activeFilePath: ref('/vault/a.md'),
    allWorkspaceFiles: ref(['/vault/a.md']),
    setSidebarMode: vi.fn(),
    notifyError: vi.fn(),
    notifySuccess: vi.fn()
  }
  const documentPort = {
    isMarkdownPath: vi.fn((path: string) => path.endsWith('.md')),
    normalizePathKey: vi.fn((path: string) => path.toLowerCase()),
    toRelativePath: vi.fn((path: string) => path.replace('/vault/', '')),
    clearEditorStatusForPaths: vi.fn(),
    resetActiveOutline: vi.fn()
  }
  const panePort = {
    activePaneId,
    panesById,
    openSurfaceInPane: vi.fn(),
    splitPane: vi.fn(() => 'pane-3'),
    setActivePane: vi.fn(),
    focusPaneByIndex: vi.fn(() => true),
    focusAdjacentPane: vi.fn(() => true),
    moveActiveTabToAdjacentPane: vi.fn(() => true),
    closePane: vi.fn(() => true),
    joinAllPanes: vi.fn(),
    resetToSinglePane: vi.fn(),
    closeAllTabsAndResetLayout: vi.fn(),
    closeAllTabsInPane: vi.fn(),
    closeOtherTabsInPane: vi.fn()
  }
  const navigationPort = {
    openTabWithAutosave: vi.fn(async () => true),
    recordHomeHistorySnapshot: vi.fn(),
    recordSecondBrainHistorySnapshot: vi.fn(),
  }
  const favoritesPort = {
    isFavorite: vi.fn(() => false),
    addFavorite: vi.fn(async () => ({})),
    removeFavorite: vi.fn(async () => {})
  }
  const actionPort = {
    loadAllFiles: vi.fn(async () => {}),
    addActiveNoteToSecondBrain: vi.fn(async () => true),
    primeSecondBrainSessionRequest: vi.fn(() => ''),
    openSettingsModal: vi.fn(async () => {}),
    openQuickOpen: vi.fn(async () => {}),
    openTodayNote: vi.fn(async () => true),
    openWorkspacePicker: vi.fn(async () => true),
    closeWorkspace: vi.fn(async () => {}),
    revealInFileManager: vi.fn(async () => {}),
    convertMarkdownToWord: vi.fn(async (path: string) => `${path.replace(/\.md$/i, '')}.docx`),
    closeOverflowMenu: vi.fn(),
    focusSearchInput: vi.fn(),
  }

  const scope = effectScope()
  const api = scope.run(() => useAppShellCommands({
    workspacePort,
    documentPort,
    panePort,
    navigationPort,
    favoritesPort,
    actionPort
  }))
  if (!api) throw new Error('Expected shell commands')

  return {
    api,
    scope,
    workspacePort,
    documentPort,
    panePort,
    navigationPort,
    favoritesPort,
    actionPort
  }
}

describe('useAppShellCommands', () => {
  it('loads files when opening Second Brain with an empty workspace file cache', async () => {
    const { api, scope, workspacePort, actionPort, panePort, navigationPort } = createCommands()
    workspacePort.allWorkspaceFiles.value = []

    expect(await api.openSecondBrainViewFromPalette()).toBe(true)

    expect(actionPort.primeSecondBrainSessionRequest).toHaveBeenCalledTimes(1)
    expect(panePort.openSurfaceInPane).toHaveBeenCalledWith('second-brain-chat')
    expect(navigationPort.recordSecondBrainHistorySnapshot).toHaveBeenCalled()
    expect(actionPort.loadAllFiles).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('adds and removes the active favorite through the favorites domain port', async () => {
    const { api, scope, favoritesPort, workspacePort } = createCommands()

    expect(await api.addActiveNoteToFavoritesFromPalette()).toBe(true)
    expect(favoritesPort.addFavorite).toHaveBeenCalledWith('/vault/a.md')
    expect(workspacePort.notifySuccess).toHaveBeenCalledWith('Added a.md to favorites.')

    favoritesPort.isFavorite.mockReturnValue(true)
    expect(await api.removeActiveNoteFromFavoritesFromPalette()).toBe(true)
    expect(favoritesPort.removeFavorite).toHaveBeenCalledWith('/vault/a.md')
    expect(workspacePort.notifySuccess).toHaveBeenCalledWith('Removed a.md from favorites.')
    scope.stop()
  })

  it('adds and removes non-markdown active files through the favorites domain port', async () => {
    const { api, scope, favoritesPort, workspacePort } = createCommands()
    workspacePort.activeFilePath.value = '/vault/photo.png'

    expect(await api.addActiveNoteToFavoritesFromPalette()).toBe(true)
    expect(favoritesPort.addFavorite).toHaveBeenCalledWith('/vault/photo.png')
    expect(workspacePort.notifySuccess).toHaveBeenCalledWith('Added photo.png to favorites.')

    favoritesPort.isFavorite.mockReturnValue(true)
    expect(await api.removeActiveNoteFromFavoritesFromPalette()).toBe(true)
    expect(favoritesPort.removeFavorite).toHaveBeenCalledWith('/vault/photo.png')
    expect(workspacePort.notifySuccess).toHaveBeenCalledWith('Removed photo.png from favorites.')
    scope.stop()
  })

  it('persists search sidebar selection and focuses the search input', async () => {
    const { api, scope, actionPort } = createCommands()

    api.openSearchPanel()
    await nextTick()
    expect(actionPort.closeOverflowMenu).toHaveBeenCalled()
    expect(actionPort.focusSearchInput).toHaveBeenCalled()
    scope.stop()
  })

  it('converts the active markdown note to Word through the backend port', async () => {
    const { api, scope, actionPort, workspacePort } = createCommands()

    expect(await api.convertMarkdownToWord('/vault/a.md')).toBe(true)
    expect(actionPort.convertMarkdownToWord).toHaveBeenCalledWith('/vault/a.md')
    expect(workspacePort.notifySuccess).toHaveBeenCalledWith('Converted a.md to a.docx.')

    actionPort.convertMarkdownToWord.mockRejectedValueOnce(new Error('Word conversion failed.'))
    expect(await api.convertMarkdownToWord('/vault/a.md')).toBe(false)
    expect(workspacePort.notifyError).toHaveBeenCalledWith('Word conversion failed.')
    scope.stop()
  })

  it('rejects non-markdown conversion targets before invoking the backend port', async () => {
    const { api, scope, actionPort, workspacePort } = createCommands()

    expect(await api.convertMarkdownToWord('/vault/a.txt')).toBe(false)
    expect(actionPort.convertMarkdownToWord).not.toHaveBeenCalled()
    expect(workspacePort.notifyError).toHaveBeenCalledWith('Select a Markdown file to convert.')
    scope.stop()
  })

  it('runs pane management commands and resets outline when closing tabs', async () => {
    const { api, scope, panePort, documentPort } = createCommands()

    expect(await api.splitPaneFromPalette('row')).toBe(true)
    await nextTick()
    expect(panePort.setActivePane).toHaveBeenCalledWith('pane-3')

    expect(api.closeAllTabsFromPalette()).toBe(true)
    expect(panePort.closeAllTabsAndResetLayout).toHaveBeenCalled()
    expect(documentPort.clearEditorStatusForPaths).toHaveBeenCalledWith(['/vault/a.md', '/vault/b.md'])
    expect(documentPort.resetActiveOutline).toHaveBeenCalled()
    scope.stop()
  })

})
