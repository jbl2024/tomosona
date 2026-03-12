import { ref } from 'vue'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useAppWorkspaceController } from './useAppWorkspaceController'
import {
  clearOpenTraceDebugState,
  finishOpenTrace,
  readRecentOpenTraceEntries,
  startOpenTrace,
  startOpenTraceSpan
} from '../../shared/lib/openTrace'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createController() {
  const workingFolderPath = ref('/vault')
  const hasWorkspace = ref(true)
  const activeFilePath = ref('/vault/notes/a.md')
  const indexingState = ref<'idle' | 'indexing' | 'indexed' | 'out_of_sync'>('indexed')
  const errorMessage = ref('')
  const selectedCount = ref(0)
  const refreshCosmosGraph = vi.fn(async () => {})
  const removeMarkdownFromIndexInBackground = vi.fn()
  const enqueueMarkdownReindex = vi.fn()
  const resetIndexingState = vi.fn()
  const setWorkingFolder = vi.fn(async (path: string) => path)
  const clearWorkingFolder = vi.fn(async () => {})
  const initDb = vi.fn(async () => {})
  const readFileMetadata = vi.fn(async (_path: string) => ({
    created_at_ms: 10,
    updated_at_ms: 20
  }))
  const pathExists = vi.fn(async (path: string) => path === '/vault/journal/2026-03-06.md')
  const listChildren = vi.fn(async (path: string) => {
    if (path === '/vault') {
      return [
        { path: '/vault/notes', is_dir: true, is_markdown: false },
        { path: '/vault/root.md', is_dir: false, is_markdown: true }
      ]
    }
    if (path === '/vault/notes') {
      return [{ path: '/vault/notes/a.md', is_dir: false, is_markdown: true }]
    }
    return []
  })
  const listMarkdownFiles = vi.fn(async () => ['notes/a.md', 'journal/2026-03-06.md'])
  const readPropertyTypeSchema = vi.fn(async () => ({ mood: 'text' }))
  const writePropertyTypeSchema = vi.fn(async () => {})
  const createEntry = vi.fn(async (parentPath: string, name: string) => `${parentPath}/${name}`)
  const writeTextFile = vi.fn(async () => {})

  const controller = useAppWorkspaceController({
    workspaceShellPort: {
      workingFolderPath,
      hasWorkspace,
      activeFilePath,
      indexingState,
      errorMessage,
      selectedCount,
      storageKey: 'tomosona.test.workspace',
      setWorkspacePath: (path) => {
        workingFolderPath.value = path
        hasWorkspace.value = Boolean(path)
      },
      clearWorkspacePath: () => {
        workingFolderPath.value = ''
        hasWorkspace.value = false
      },
      resetIndexingState
    },
    workspaceFsPort: {
      setWorkingFolder,
      clearWorkingFolder,
      initDb,
      readFileMetadata,
      pathExists,
      listChildren,
      listMarkdownFiles,
      createEntry,
      writeTextFile
    },
    workspaceDocumentPort: {
      readPropertyTypeSchema,
      writePropertyTypeSchema,
      normalizePath: (path) => path.replace(/\\/g, '/'),
      normalizePathKey: (path) => path.replace(/\\/g, '/').toLowerCase(),
      isMarkdownPath: (path) => path.endsWith('.md'),
      isIsoDate: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
      dailyNotePath: (root, date) => `${root}/journal/${date}.md`
    },
    workspaceEffectsPort: {
      enqueueMarkdownReindex,
      removeMarkdownFromIndexInBackground,
      refreshCosmosGraph,
      hasCosmosSurface: () => true
    }
  })

  return {
    workingFolderPath,
    hasWorkspace,
    activeFilePath,
    indexingState,
    errorMessage,
    selectedCount,
    resetIndexingState,
    setWorkingFolder,
    clearWorkingFolder,
    initDb,
    readFileMetadata,
    pathExists,
    listChildren,
    listMarkdownFiles,
    readPropertyTypeSchema,
    writePropertyTypeSchema,
    createEntry,
    writeTextFile,
    refreshCosmosGraph,
    removeMarkdownFromIndexInBackground,
    enqueueMarkdownReindex,
    controller
  }
}

describe('useAppWorkspaceController', () => {
  beforeEach(() => {
    window.localStorage.clear()
    clearOpenTraceDebugState()
  })

  it('loads markdown files from the workspace tree', async () => {
    const { controller } = createController()

    await controller.loadAllFiles()

    expect(controller.allWorkspaceFiles.value).toEqual(['/vault/notes/a.md', '/vault/root.md'])
  })

  it('skips internal application directories while scanning workspace files', async () => {
    const { controller, listChildren } = createController()
    listChildren.mockImplementation(async (path: string) => {
      if (path === '/vault') {
        return [
          { path: '/vault/.tomosona', is_dir: true, is_markdown: false },
          { path: '/vault/.tomosona-trash', is_dir: true, is_markdown: false },
          { path: '/vault/notes', is_dir: true, is_markdown: false },
          { path: '/vault/root.md', is_dir: false, is_markdown: true }
        ]
      }
      if (path === '/vault/notes') {
        return [{ path: '/vault/notes/a.md', is_dir: false, is_markdown: true }]
      }
      throw new Error(`unexpected path: ${path}`)
    })

    await controller.loadAllFiles()

    expect(listChildren).toHaveBeenCalledWith('/vault')
    expect(listChildren).toHaveBeenCalledWith('/vault/notes')
    expect(listChildren).not.toHaveBeenCalledWith('/vault/.tomosona')
    expect(listChildren).not.toHaveBeenCalledWith('/vault/.tomosona-trash')
    expect(controller.allWorkspaceFiles.value).toEqual(['/vault/notes/a.md', '/vault/root.md'])
  })

  it('creates and opens a missing daily note', async () => {
    const { controller } = createController()
    const openPath = vi.fn(async () => true)

    const opened = await controller.openDailyNote('2026-03-07', openPath)

    expect(opened).toBe(true)
    expect(openPath).toHaveBeenCalledWith('/vault/journal/2026-03-07.md')
    expect(controller.allWorkspaceFiles.value).toContain('/vault/journal/2026-03-07.md')
  })

  it('applies filesystem rename changes to the cached file list and indexing hooks', async () => {
    const {
      controller,
      enqueueMarkdownReindex,
      removeMarkdownFromIndexInBackground,
      refreshCosmosGraph
    } = createController()

    controller.allWorkspaceFiles.value = ['/vault/notes/a.md', '/vault/notes/b.md']
    controller.applyWorkspaceFsChanges([
      {
        kind: 'renamed',
        old_path: '/vault/notes/a.md',
        new_path: '/vault/journal/a.md',
        is_dir: false
      }
    ])

    expect(controller.allWorkspaceFiles.value).toEqual(['/vault/journal/a.md', '/vault/notes/b.md'])
    expect(removeMarkdownFromIndexInBackground).toHaveBeenCalledWith('/vault/notes/a.md')
    expect(enqueueMarkdownReindex).toHaveBeenCalledWith('/vault/journal/a.md')
    expect(refreshCosmosGraph).toHaveBeenCalled()
  })

  it('loads a workspace and persists its canonical path', async () => {
    const { controller, indexingState } = createController()

    const canonical = await controller.loadWorkingFolder('/vault')

    expect(canonical).toBe('/vault')
    expect(indexingState.value).toBe('indexed')
    expect(window.localStorage.getItem('tomosona.test.workspace')).toBe('/vault')
  })

  it('ignores stale metadata responses when a newer request wins', async () => {
    const { controller, readFileMetadata, activeFilePath } = createController()
    const slow = deferred<{ path: string; created_at_ms: number; updated_at_ms: number }>()
    const fast = deferred<{ path: string; created_at_ms: number; updated_at_ms: number }>()

    readFileMetadata.mockImplementationOnce(async () => await slow.promise)
    readFileMetadata.mockImplementationOnce(async () => await fast.promise)

    activeFilePath.value = '/vault/notes/a.md'
    const first = controller.refreshActiveFileMetadata('/vault/notes/a.md')
    activeFilePath.value = '/vault/notes/b.md'
    const second = controller.refreshActiveFileMetadata('/vault/notes/b.md')

    fast.resolve({ path: '/vault/notes/b.md', created_at_ms: 2, updated_at_ms: 3 })
    await second
    slow.resolve({ path: '/vault/notes/a.md', created_at_ms: 4, updated_at_ms: 5 })
    await first

    expect(controller.activeFileMetadata.value).toEqual(expect.objectContaining({
      created_at_ms: 2,
      updated_at_ms: 3
    }))
  })

  it('clears active metadata when the target path is empty', async () => {
    const { controller } = createController()
    controller.activeFileMetadata.value = { created_at_ms: 1, updated_at_ms: 2 }

    await controller.refreshActiveFileMetadata('')

    expect(controller.activeFileMetadata.value).toBeNull()
  })

  it('clears active metadata when reading the active file fails', async () => {
    const { controller, readFileMetadata } = createController()
    readFileMetadata.mockRejectedValueOnce(new Error('missing'))

    await controller.refreshActiveFileMetadata('/vault/notes/a.md')

    expect(controller.activeFileMetadata.value).toBeNull()
  })

  it('traces active metadata refresh spans when a trace context is provided', async () => {
    const { controller } = createController()
    const traceId = startOpenTrace('/vault/notes/a.md', 'navigation-open')
    const parentSpanId = startOpenTraceSpan(traceId, 'open.active_note_effects', { bucket: 'active_note_effects' })

    await controller.refreshActiveFileMetadata('/vault/notes/a.md', { traceId, parentSpanId })
    finishOpenTrace(traceId, 'done', { stage: 'open.complete' })

    const entries = readRecentOpenTraceEntries()
    expect(entries.some((entry) => entry.message === 'open.metadata started')).toBe(true)
    expect(entries.some((entry) => entry.message === 'open.metadata done')).toBe(true)
  })

  it('fails opening a daily note when no workspace is available', async () => {
    const { controller, workingFolderPath, hasWorkspace, errorMessage } = createController()
    workingFolderPath.value = ''
    hasWorkspace.value = false

    const opened = await controller.openDailyNote('2026-03-07', vi.fn(async () => true))

    expect(opened).toBe(false)
    expect(errorMessage.value).toBe('Working folder is not set.')
  })

  it('fails opening a daily note when the date is invalid', async () => {
    const { controller, errorMessage } = createController()

    const opened = await controller.openDailyNote('bad-date', vi.fn(async () => true))

    expect(opened).toBe(false)
    expect(errorMessage.value).toBe('Invalid date format. Use YYYY-MM-DD.')
  })

  it('does not recreate an existing daily note', async () => {
    const { controller, writeTextFile, createEntry } = createController()
    const openPath = vi.fn(async () => true)

    const opened = await controller.openDailyNote('2026-03-06', openPath)

    expect(opened).toBe(true)
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(createEntry).not.toHaveBeenCalled()
  })

  it('creates missing parent folders in order for a daily note', async () => {
    const { controller, pathExists, createEntry } = createController()
    pathExists.mockResolvedValue(false)

    await controller.openDailyNote('2026-03-07', vi.fn(async () => true))

    expect(createEntry).toHaveBeenCalledTimes(1)
    expect(createEntry).toHaveBeenCalledWith('/vault', 'journal', 'folder', 'fail')
  })

  it('clears active metadata when the active markdown file is removed', () => {
    const { controller } = createController()
    controller.activeFileMetadata.value = { created_at_ms: 1, updated_at_ms: 2 }

    controller.applyWorkspaceFsChanges([
      { kind: 'removed', path: '/vault/notes/a.md', is_dir: false }
    ])

    expect(controller.activeFileMetadata.value).toBeNull()
  })

  it('refreshes active metadata when the active markdown file is modified', async () => {
    const { controller, readFileMetadata } = createController()
    readFileMetadata.mockResolvedValueOnce({
      created_at_ms: 11,
      updated_at_ms: 22
    })

    controller.applyWorkspaceFsChanges([
      { kind: 'modified', path: '/vault/notes/a.md', is_dir: false }
    ])

    await Promise.resolve()
    await Promise.resolve()

    expect(controller.activeFileMetadata.value).toEqual(expect.objectContaining({
      created_at_ms: 11,
      updated_at_ms: 22
    }))
  })

  it('refreshes cosmos only when the surface is mounted', () => {
    const state = createController()
    state.controller.applyWorkspaceFsChanges([
      { kind: 'created', path: '/vault/notes/b.md', is_dir: false }
    ])
    expect(state.refreshCosmosGraph).toHaveBeenCalledTimes(1)

    state.refreshCosmosGraph.mockClear()
    const controllerWithoutCosmos = useAppWorkspaceController({
      workspaceShellPort: {
        workingFolderPath: state.workingFolderPath,
        hasWorkspace: state.hasWorkspace,
        activeFilePath: state.activeFilePath,
        indexingState: state.indexingState,
        errorMessage: state.errorMessage,
        selectedCount: state.selectedCount,
        storageKey: 'tomosona.test.workspace',
        setWorkspacePath: (path) => {
          state.workingFolderPath.value = path
          state.hasWorkspace.value = Boolean(path)
        },
        clearWorkspacePath: () => {
          state.workingFolderPath.value = ''
          state.hasWorkspace.value = false
        },
        resetIndexingState: state.resetIndexingState
      },
      workspaceFsPort: {
        setWorkingFolder: state.setWorkingFolder,
        clearWorkingFolder: state.clearWorkingFolder,
        initDb: state.initDb,
        readFileMetadata: state.readFileMetadata,
        pathExists: state.pathExists,
        listChildren: state.listChildren,
        listMarkdownFiles: state.listMarkdownFiles,
        createEntry: state.createEntry,
        writeTextFile: state.writeTextFile
      },
      workspaceDocumentPort: {
        readPropertyTypeSchema: state.readPropertyTypeSchema,
        writePropertyTypeSchema: state.writePropertyTypeSchema,
        normalizePath: (path) => path.replace(/\\/g, '/'),
        normalizePathKey: (path) => path.replace(/\\/g, '/').toLowerCase(),
        isMarkdownPath: (path) => path.endsWith('.md'),
        isIsoDate: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
        dailyNotePath: (root, date) => `${root}/journal/${date}.md`
      },
      workspaceEffectsPort: {
        enqueueMarkdownReindex: state.enqueueMarkdownReindex,
        removeMarkdownFromIndexInBackground: state.removeMarkdownFromIndexInBackground,
        refreshCosmosGraph: state.refreshCosmosGraph,
        hasCosmosSurface: () => false
      }
    })

    controllerWithoutCosmos.applyWorkspaceFsChanges([
      { kind: 'created', path: '/vault/notes/c.md', is_dir: false }
    ])

    expect(state.refreshCosmosGraph).not.toHaveBeenCalled()
  })

  it('handles rename events with only old_path by removing and deindexing markdown files', () => {
    const { controller, removeMarkdownFromIndexInBackground } = createController()
    controller.allWorkspaceFiles.value = ['/vault/notes/a.md']

    controller.applyWorkspaceFsChanges([
      { kind: 'renamed', old_path: '/vault/notes/a.md', is_dir: false }
    ])

    expect(controller.allWorkspaceFiles.value).toEqual([])
    expect(removeMarkdownFromIndexInBackground).toHaveBeenCalledWith('/vault/notes/a.md')
  })

  it('handles rename events with only new_path by adding and reindexing markdown files', () => {
    const { controller, enqueueMarkdownReindex } = createController()

    controller.applyWorkspaceFsChanges([
      { kind: 'renamed', new_path: '/vault/notes/b.md', is_dir: false }
    ])

    expect(controller.allWorkspaceFiles.value).toEqual(['/vault/notes/b.md'])
    expect(enqueueMarkdownReindex).toHaveBeenCalledWith('/vault/notes/b.md')
  })

  it('ignores non-markdown files in workspace change caches', () => {
    const { controller, enqueueMarkdownReindex } = createController()

    controller.applyWorkspaceFsChanges([
      { kind: 'created', path: '/vault/notes/image.png', is_dir: false }
    ])

    expect(controller.allWorkspaceFiles.value).toEqual([])
    expect(enqueueMarkdownReindex).not.toHaveBeenCalled()
  })

  it('resets shell state and clears persistence when closing the workspace', async () => {
    const { controller, selectedCount, hasWorkspace, workingFolderPath, indexingState } = createController()
    controller.allWorkspaceFiles.value = ['/vault/notes/a.md']
    controller.activeFileMetadata.value = { created_at_ms: 1, updated_at_ms: 2 }
    selectedCount.value = 3
    window.localStorage.setItem('tomosona.test.workspace', '/vault')

    await controller.closeWorkspace()

    expect(controller.allWorkspaceFiles.value).toEqual([])
    expect(controller.activeFileMetadata.value).toBeNull()
    expect(selectedCount.value).toBe(0)
    expect(hasWorkspace.value).toBe(false)
    expect(workingFolderPath.value).toBe('')
    expect(indexingState.value).toBe('indexed')
    expect(window.localStorage.getItem('tomosona.test.workspace')).toBeNull()
  })

  it('keeps a user-safe error when closing the workspace fails', async () => {
    const { controller, clearWorkingFolder, errorMessage } = createController()
    clearWorkingFolder.mockRejectedValueOnce(new Error('close failed'))

    await controller.closeWorkspace()

    expect(errorMessage.value).toBe('close failed')
  })

  it('clears persisted state and reports an error when opening a workspace fails', async () => {
    const { controller, setWorkingFolder, errorMessage, hasWorkspace, workingFolderPath } = createController()
    window.localStorage.setItem('tomosona.test.workspace', '/vault')
    setWorkingFolder.mockRejectedValueOnce(new Error('open failed'))

    const canonical = await controller.loadWorkingFolder('/vault')

    expect(canonical).toBeNull()
    expect(errorMessage.value).toBe('open failed')
    expect(window.localStorage.getItem('tomosona.test.workspace')).toBeNull()
    expect(hasWorkspace.value).toBe(false)
    expect(workingFolderPath.value).toBe('')
  })
})
