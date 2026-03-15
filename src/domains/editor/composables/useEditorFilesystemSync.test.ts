import { describe, expect, it, vi } from 'vitest'
import type { DocumentSession } from './useDocumentEditorSessions'
import { useEditorFilesystemSync } from './useEditorFilesystemSync'

function createSession(path: string, overrides: Partial<DocumentSession> = {}): DocumentSession {
  return {
    path,
    editor: {} as any,
    loadedText: '',
    baseVersion: null,
    currentDiskVersion: null,
    conflict: null,
    isLoaded: true,
    dirty: false,
    saving: false,
    saveError: '',
    scrollTop: 0,
    caret: null,
    autosaveTimer: null,
    outlineTimer: null,
    ...overrides
  }
}

describe('useEditorFilesystemSync', () => {
  it('reloads a clean open note after an external modification', async () => {
    const session = createSession('a.md')
    const loadCurrentFile = vi.fn(async () => {})
    const emitExternalReload = vi.fn()

    const sync = useEditorFilesystemSync({
      getSession: (path) => (path === 'a.md' ? session : null),
      listPaths: () => ['a.md'],
      currentPath: () => 'a.md',
      renameSessionPath: vi.fn(),
      moveLifecyclePathState: vi.fn(),
      moveFrontmatterPathState: vi.fn(),
      moveTitlePathState: vi.fn(),
      setActiveSession: vi.fn(),
      nextRequestId: vi.fn(() => 7),
      loadCurrentFile,
      emitExternalReload
    })

    await sync.applyWorkspaceFsChanges([{ kind: 'modified', path: 'a.md', is_dir: false, version: { mtimeMs: 9, size: 12 } }])

    expect(session.currentDiskVersion).toEqual({ mtimeMs: 9, size: 12 })
    expect(loadCurrentFile).toHaveBeenCalledWith('a.md', { forceReload: true, requestId: 7 })
    expect(emitExternalReload).toHaveBeenCalledWith({ path: 'a.md' })
  })

  it('marks a dirty note conflicted instead of reloading it', async () => {
    const session = createSession('a.md', { dirty: true })
    const loadCurrentFile = vi.fn(async () => {})

    const sync = useEditorFilesystemSync({
      getSession: () => session,
      listPaths: () => ['a.md'],
      currentPath: () => 'a.md',
      renameSessionPath: vi.fn(),
      moveLifecyclePathState: vi.fn(),
      moveFrontmatterPathState: vi.fn(),
      moveTitlePathState: vi.fn(),
      setActiveSession: vi.fn(),
      nextRequestId: vi.fn(() => 1),
      loadCurrentFile,
      emitExternalReload: vi.fn()
    })

    await sync.applyWorkspaceFsChanges([{ kind: 'modified', path: 'a.md', is_dir: false, version: { mtimeMs: 4, size: 6 } }])

    expect(loadCurrentFile).not.toHaveBeenCalled()
    expect(session.conflict).toEqual({
      kind: 'modified',
      diskVersion: { mtimeMs: 4, size: 6 },
      detectedAt: expect.any(Number)
    })
  })

  it('does not reload a clean note again for a duplicate watcher version', async () => {
    const session = createSession('a.md', {
      baseVersion: { mtimeMs: 9, size: 12 },
      currentDiskVersion: { mtimeMs: 9, size: 12 }
    })
    const loadCurrentFile = vi.fn(async () => {})
    const emitExternalReload = vi.fn()

    const sync = useEditorFilesystemSync({
      getSession: (path) => (path === 'a.md' ? session : null),
      listPaths: () => ['a.md'],
      currentPath: () => 'a.md',
      renameSessionPath: vi.fn(),
      moveLifecyclePathState: vi.fn(),
      moveFrontmatterPathState: vi.fn(),
      moveTitlePathState: vi.fn(),
      setActiveSession: vi.fn(),
      nextRequestId: vi.fn(() => 8),
      loadCurrentFile,
      emitExternalReload
    })

    await sync.applyWorkspaceFsChanges([{ kind: 'modified', path: 'a.md', is_dir: false, version: { mtimeMs: 9, size: 12 } }])

    expect(loadCurrentFile).not.toHaveBeenCalled()
    expect(emitExternalReload).not.toHaveBeenCalled()
    expect(session.conflict).toBeNull()
  })

  it('reloads only once when the same external watcher version is delivered repeatedly', async () => {
    const session = createSession('a.md')
    const loadCurrentFile = vi.fn(async () => {
      session.baseVersion = { mtimeMs: 9, size: 12 }
      session.currentDiskVersion = { mtimeMs: 9, size: 12 }
    })
    const emitExternalReload = vi.fn()

    const sync = useEditorFilesystemSync({
      getSession: (path) => (path === 'a.md' ? session : null),
      listPaths: () => ['a.md'],
      currentPath: () => 'a.md',
      renameSessionPath: vi.fn(),
      moveLifecyclePathState: vi.fn(),
      moveFrontmatterPathState: vi.fn(),
      moveTitlePathState: vi.fn(),
      setActiveSession: vi.fn(),
      nextRequestId: vi.fn(() => 9),
      loadCurrentFile,
      emitExternalReload
    })

    const duplicateChange = { kind: 'modified' as const, path: 'a.md', is_dir: false, version: { mtimeMs: 9, size: 12 } }
    await sync.applyWorkspaceFsChanges([duplicateChange])
    await sync.applyWorkspaceFsChanges([duplicateChange])
    await sync.applyWorkspaceFsChanges([duplicateChange])

    expect(loadCurrentFile).toHaveBeenCalledTimes(1)
    expect(emitExternalReload).toHaveBeenCalledTimes(1)
    expect(session.conflict).toBeNull()
  })

  it('ignores watcher changes for an in-flight manual rename save target', async () => {
    const session = createSession('b.md', { dirty: true, saving: true })
    const loadCurrentFile = vi.fn(async () => {})

    const sync = useEditorFilesystemSync({
      getSession: () => session,
      listPaths: () => ['b.md'],
      currentPath: () => 'b.md',
      renameSessionPath: vi.fn(),
      moveLifecyclePathState: vi.fn(),
      moveFrontmatterPathState: vi.fn(),
      moveTitlePathState: vi.fn(),
      setActiveSession: vi.fn(),
      nextRequestId: vi.fn(() => 1),
      loadCurrentFile,
      emitExternalReload: vi.fn(),
      shouldIgnoreOwnSaveWatcherChange: (path) => path === 'b.md'
    })

    await sync.applyWorkspaceFsChanges([{ kind: 'modified', path: 'b.md', is_dir: false, version: { mtimeMs: 5, size: 7 } }])

    expect(loadCurrentFile).not.toHaveBeenCalled()
    expect(session.currentDiskVersion).toBeNull()
    expect(session.conflict).toBeNull()
  })

  it('ignores watcher removal on the source path during an in-flight manual rename save', async () => {
    const session = createSession('a.md', { dirty: true, saving: true })

    const sync = useEditorFilesystemSync({
      getSession: () => session,
      listPaths: () => ['a.md'],
      currentPath: () => 'a.md',
      renameSessionPath: vi.fn(),
      moveLifecyclePathState: vi.fn(),
      moveFrontmatterPathState: vi.fn(),
      moveTitlePathState: vi.fn(),
      setActiveSession: vi.fn(),
      nextRequestId: vi.fn(() => 1),
      loadCurrentFile: vi.fn(async () => {}),
      emitExternalReload: vi.fn(),
      shouldIgnoreOwnSaveWatcherChange: (path) => path === 'a.md'
    })

    await sync.applyWorkspaceFsChanges([{ kind: 'removed', path: 'a.md', is_dir: false }])

    expect(session.currentDiskVersion).toBeNull()
    expect(session.conflict).toBeNull()
  })

  it('keeps a dirty note in a single modified conflict state across duplicate watcher events', async () => {
    const session = createSession('a.md', { dirty: true })
    const loadCurrentFile = vi.fn(async () => {})

    const sync = useEditorFilesystemSync({
      getSession: () => session,
      listPaths: () => ['a.md'],
      currentPath: () => 'a.md',
      renameSessionPath: vi.fn(),
      moveLifecyclePathState: vi.fn(),
      moveFrontmatterPathState: vi.fn(),
      moveTitlePathState: vi.fn(),
      setActiveSession: vi.fn(),
      nextRequestId: vi.fn(() => 10),
      loadCurrentFile,
      emitExternalReload: vi.fn()
    })

    const firstChange = { kind: 'modified' as const, path: 'a.md', is_dir: false, version: { mtimeMs: 4, size: 6 } }
    const secondChange = { kind: 'modified' as const, path: 'a.md', is_dir: false, version: { mtimeMs: 4, size: 6 } }
    await sync.applyWorkspaceFsChanges([firstChange])
    const firstDetectedAt = session.conflict?.detectedAt
    await sync.applyWorkspaceFsChanges([secondChange])

    expect(loadCurrentFile).not.toHaveBeenCalled()
    expect(session.conflict).toEqual({
      kind: 'modified',
      diskVersion: { mtimeMs: 4, size: 6 },
      detectedAt: firstDetectedAt
    })
  })

  it('ignores a delayed duplicate watcher version even when the note is dirty', async () => {
    const session = createSession('a.md', {
      dirty: true,
      baseVersion: { mtimeMs: 12, size: 20 },
      currentDiskVersion: { mtimeMs: 12, size: 20 }
    })

    const sync = useEditorFilesystemSync({
      getSession: () => session,
      listPaths: () => ['a.md'],
      currentPath: () => 'a.md',
      renameSessionPath: vi.fn(),
      moveLifecyclePathState: vi.fn(),
      moveFrontmatterPathState: vi.fn(),
      moveTitlePathState: vi.fn(),
      setActiveSession: vi.fn(),
      nextRequestId: vi.fn(() => 12),
      loadCurrentFile: vi.fn(async () => {}),
      emitExternalReload: vi.fn()
    })

    await sync.applyWorkspaceFsChanges([{ kind: 'modified', path: 'a.md', is_dir: false, version: { mtimeMs: 12, size: 20 } }])

    expect(session.currentDiskVersion).toEqual({ mtimeMs: 12, size: 20 })
    expect(session.conflict).toBeNull()
  })

  it('marks a clean note deleted and reloads once when it is recreated externally', async () => {
    const session = createSession('a.md')
    const loadCurrentFile = vi.fn(async () => {
      session.baseVersion = { mtimeMs: 12, size: 20 }
      session.currentDiskVersion = { mtimeMs: 12, size: 20 }
      session.conflict = null
    })
    const emitExternalReload = vi.fn()

    const sync = useEditorFilesystemSync({
      getSession: () => session,
      listPaths: () => ['a.md'],
      currentPath: () => 'a.md',
      renameSessionPath: vi.fn(),
      moveLifecyclePathState: vi.fn(),
      moveFrontmatterPathState: vi.fn(),
      moveTitlePathState: vi.fn(),
      setActiveSession: vi.fn(),
      nextRequestId: vi.fn(() => 11),
      loadCurrentFile,
      emitExternalReload
    })

    await sync.applyWorkspaceFsChanges([{ kind: 'removed', path: 'a.md', is_dir: false }])
    expect(session.conflict).toEqual({
      kind: 'deleted',
      detectedAt: expect.any(Number)
    })

    await sync.applyWorkspaceFsChanges([{ kind: 'created', path: 'a.md', is_dir: false, version: { mtimeMs: 12, size: 20 } }])

    expect(loadCurrentFile).toHaveBeenCalledTimes(1)
    expect(emitExternalReload).toHaveBeenCalledTimes(1)
    expect(session.baseVersion).toEqual({ mtimeMs: 12, size: 20 })
    expect(session.currentDiskVersion).toEqual({ mtimeMs: 12, size: 20 })
    expect(session.conflict).toBeNull()
  })
})
