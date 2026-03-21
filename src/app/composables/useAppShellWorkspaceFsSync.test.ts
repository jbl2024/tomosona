import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppShellWorkspaceFsSync } from './useAppShellWorkspaceFsSync'

const hoisted = vi.hoisted(() => ({
  listenWorkspaceFsChanged: vi.fn()
}))

vi.mock('../../shared/api/workspaceApi', () => ({
  listenWorkspaceFsChanged: hoisted.listenWorkspaceFsChanged
}))

describe('useAppShellWorkspaceFsSync', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('subscribes once and fans out matching workspace changes', async () => {
    const unlisten = vi.fn()
    const controllerPort = {
      applyWorkspaceFsChanges: vi.fn(),
      relayEditorFsChanges: vi.fn(async () => {})
    }
    const favoritesPort = {
      applyWorkspaceFsChanges: vi.fn(),
      renameFavorite: vi.fn(async () => {})
    }
    const uiPort = {
      invalidateRecentNotes: vi.fn(),
      removeLaunchpadRecentNote: vi.fn(),
      renameLaunchpadRecentNote: vi.fn()
    }
    const shellPort = {
      workingFolderPath: ref('/vault'),
      normalizePath: (path: string) => path.replace(/\\/g, '/'),
      notifyError: vi.fn()
    }

    hoisted.listenWorkspaceFsChanged.mockImplementationOnce(async (handler: (payload: {
      root: string
      changes: Array<{
        kind: 'created' | 'removed' | 'renamed' | 'modified'
        path?: string
        old_path?: string
        new_path?: string
        is_dir?: boolean
      }>
    }) => void) => {
      handler({
        root: '/other',
        changes: [{ kind: 'created', path: '/other/ignored.md' }]
      })
      handler({
        root: '/vault',
        changes: [
          { kind: 'renamed', old_path: '/vault/a.md', new_path: '/vault/b.md' },
          { kind: 'removed', path: '/vault/c.md' },
          { kind: 'modified', path: '/vault/d.md' }
        ]
      })
      return unlisten
    })

    const sync = useAppShellWorkspaceFsSync({
      shellPort,
      controllerPort,
      favoritesPort,
      uiPort
    })

    await sync.start()
    await sync.start()

    expect(hoisted.listenWorkspaceFsChanged).toHaveBeenCalledTimes(1)
    expect(controllerPort.applyWorkspaceFsChanges).toHaveBeenCalledTimes(1)
    expect(controllerPort.relayEditorFsChanges).toHaveBeenCalledTimes(1)
    expect(favoritesPort.applyWorkspaceFsChanges).toHaveBeenCalledTimes(1)
    expect(favoritesPort.renameFavorite).toHaveBeenCalledWith('/vault/a.md', '/vault/b.md')
    expect(uiPort.removeLaunchpadRecentNote).toHaveBeenCalledWith('/vault/c.md')
    expect(uiPort.renameLaunchpadRecentNote).toHaveBeenCalledWith('/vault/a.md', '/vault/b.md')
    expect(uiPort.invalidateRecentNotes).toHaveBeenCalledTimes(1)

    sync.dispose()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('ignores watcher payloads from a different workspace root', async () => {
    const controllerPort = {
      applyWorkspaceFsChanges: vi.fn(),
      relayEditorFsChanges: vi.fn(async () => {})
    }
    const favoritesPort = {
      applyWorkspaceFsChanges: vi.fn(),
      renameFavorite: vi.fn(async () => {})
    }
    const uiPort = {
      invalidateRecentNotes: vi.fn(),
      removeLaunchpadRecentNote: vi.fn(),
      renameLaunchpadRecentNote: vi.fn()
    }
    const shellPort = {
      workingFolderPath: ref('/vault'),
      normalizePath: (path: string) => path.replace(/\\/g, '/'),
      notifyError: vi.fn()
    }

    hoisted.listenWorkspaceFsChanged.mockImplementationOnce(async (handler: (payload: {
      root: string
      changes: Array<never>
    }) => void) => {
      handler({ root: '/elsewhere', changes: [] })
      return vi.fn()
    })

    const sync = useAppShellWorkspaceFsSync({
      shellPort,
      controllerPort,
      favoritesPort,
      uiPort
    })

    await sync.start()

    expect(controllerPort.applyWorkspaceFsChanges).not.toHaveBeenCalled()
    expect(favoritesPort.applyWorkspaceFsChanges).not.toHaveBeenCalled()
    expect(uiPort.invalidateRecentNotes).not.toHaveBeenCalled()

    sync.dispose()
  })
})
