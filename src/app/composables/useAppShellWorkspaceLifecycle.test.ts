import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppShellWorkspaceLifecycle } from './useAppShellWorkspaceLifecycle'

function createLifecycle() {
  const activePaneId = ref('pane-1')
  let fsChangedHandler: ((payload: { root: string; changes: Array<{
    kind: 'created' | 'removed' | 'renamed' | 'modified'
    path?: string
    old_path?: string
    new_path?: string
    is_dir?: boolean
  }> }) => void) | null = null

  const shellPort = {
    storageKey: 'tomosona.working-folder.path',
    workingFolderPath: ref(''),
    hasWorkspace: ref(false),
    activeFilePath: ref(''),
    normalizePath: vi.fn((path: string) => path.replace(/\\/g, '/')),
    clearError: vi.fn(),
    notifyError: vi.fn()
  }
  const controllerPort = {
    loadWorkingFolderInternal: vi.fn(async (path: string) => {
      shellPort.workingFolderPath.value = path
      shellPort.hasWorkspace.value = true
      return path
    }),
    closeWorkspaceInternal: vi.fn(async () => {
      shellPort.workingFolderPath.value = ''
      shellPort.hasWorkspace.value = false
    }),
    resetWorkspaceState: vi.fn(),
    applyWorkspaceFsChanges: vi.fn()
  }
  const uiPort = {
    activePaneId,
    resetToSinglePane: vi.fn(),
    closeAllTabsInPane: vi.fn(),
    findPaneContainingSurface: vi.fn(() => null),
    resetDocumentHistory: vi.fn(),
    resetActiveOutline: vi.fn(),
    resetSearchState: vi.fn(),
    resetWorkspaceRecentState: vi.fn(),
    recordRecentWorkspace: vi.fn(),
    removeRecentWorkspaceEntry: vi.fn(),
    invalidateRecentNotes: vi.fn(),
    removeLaunchpadRecentNote: vi.fn(),
    renameLaunchpadRecentNote: vi.fn(),
    resetInspectorPanels: vi.fn(),
    closeOverflowMenu: vi.fn()
  }
  const favoritesPort = {
    loadFavorites: vi.fn(async () => {}),
    reset: vi.fn(),
    applyWorkspaceFsChanges: vi.fn(),
    renameFavorite: vi.fn(async () => {})
  }
  const cosmosPort = {
    clearState: vi.fn(),
    refreshGraph: vi.fn(async () => {})
  }
  const fsPort = {
    selectWorkingFolder: vi.fn(async () => '/vault'),
    listenWorkspaceFsChanged: vi.fn(async (handler) => {
      fsChangedHandler = handler
      return () => {
        fsChangedHandler = null
      }
    })
  }

  const scope = effectScope()
  const api = scope.run(() => useAppShellWorkspaceLifecycle({
    shellPort,
    controllerPort,
    uiPort,
    favoritesPort,
    cosmosPort,
    fsPort
  }))
  if (!api) throw new Error('Expected workspace lifecycle')

  return {
    api,
    scope,
    shellPort,
    controllerPort,
    uiPort,
    favoritesPort,
    cosmosPort,
    fsPort,
    emitFsChanged: (payload: Parameters<NonNullable<typeof fsChangedHandler>>[0]) => fsChangedHandler?.(payload)
  }
}

describe('useAppShellWorkspaceLifecycle', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('boots the saved workspace and subscribes to workspace fs changes', async () => {
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')
    const { api, scope, controllerPort, fsPort } = createLifecycle()

    await api.start()

    expect(fsPort.listenWorkspaceFsChanged).toHaveBeenCalledTimes(1)
    expect(controllerPort.loadWorkingFolderInternal).toHaveBeenCalledWith('/vault')
    scope.stop()
  })

  it('closes the workspace and resets shell-owned cross-domain state', async () => {
    const { api, scope, shellPort, uiPort, favoritesPort, cosmosPort, controllerPort } = createLifecycle()
    shellPort.hasWorkspace.value = true
    shellPort.workingFolderPath.value = '/vault'

    await api.closeWorkspace()

    expect(uiPort.resetToSinglePane).toHaveBeenCalled()
    expect(uiPort.closeAllTabsInPane).toHaveBeenCalledWith('pane-1')
    expect(uiPort.resetSearchState).toHaveBeenCalled()
    expect(uiPort.resetInspectorPanels).toHaveBeenCalled()
    expect(favoritesPort.reset).toHaveBeenCalled()
    expect(cosmosPort.clearState).toHaveBeenCalled()
    expect(controllerPort.closeWorkspaceInternal).toHaveBeenCalled()
    expect(uiPort.closeOverflowMenu).toHaveBeenCalled()
    scope.stop()
  })

  it('removes a recent workspace entry when reopen fails', async () => {
    const { api, scope, controllerPort, uiPort, shellPort } = createLifecycle()
    controllerPort.loadWorkingFolderInternal.mockResolvedValueOnce('')
    shellPort.hasWorkspace.value = false

    await api.openRecentWorkspace('/missing')

    expect(uiPort.removeRecentWorkspaceEntry).toHaveBeenCalledWith('/missing')
    expect(shellPort.notifyError).toHaveBeenCalledWith('Could not reopen that workspace.')
    scope.stop()
  })

  it('syncs favorites and recent notes from workspace fs rename/remove events', async () => {
    const { api, scope, shellPort, controllerPort, favoritesPort, uiPort, emitFsChanged } = createLifecycle()
    shellPort.workingFolderPath.value = '/vault'

    await api.start()
    emitFsChanged({
      root: '/vault',
      changes: [
        { kind: 'renamed', old_path: '/vault/a.md', new_path: '/vault/b.md' },
        { kind: 'removed', path: '/vault/c.md' }
      ]
    })

    expect(controllerPort.applyWorkspaceFsChanges).toHaveBeenCalled()
    expect(favoritesPort.applyWorkspaceFsChanges).toHaveBeenCalled()
    expect(favoritesPort.renameFavorite).toHaveBeenCalledWith('/vault/a.md', '/vault/b.md')
    expect(uiPort.renameLaunchpadRecentNote).toHaveBeenCalledWith('/vault/a.md', '/vault/b.md')
    expect(uiPort.removeLaunchpadRecentNote).toHaveBeenCalledWith('/vault/c.md')
    expect(uiPort.invalidateRecentNotes).toHaveBeenCalled()
    scope.stop()
  })

  it('opens a selected workspace and reports picker failures safely', async () => {
    const { api, scope, fsPort, controllerPort, shellPort } = createLifecycle()

    expect(await api.onSelectWorkingFolder()).toBe(true)
    expect(fsPort.selectWorkingFolder).toHaveBeenCalled()
    expect(controllerPort.loadWorkingFolderInternal).toHaveBeenCalledWith('/vault')

    fsPort.selectWorkingFolder.mockRejectedValueOnce(new Error('denied'))
    expect(await api.onSelectWorkingFolder()).toBe(false)
    expect(shellPort.notifyError).toHaveBeenCalledWith('denied')
    scope.stop()
  })
})
