import { ref } from 'vue'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useAppWorkspaceController } from './useAppWorkspaceController'

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

  const controller = useAppWorkspaceController({
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
    resetIndexingState: vi.fn(),
    setWorkingFolder: vi.fn(async (path: string) => path),
    clearWorkingFolder: vi.fn(async () => {}),
    initDb: vi.fn(async () => {}),
    readFileMetadata: vi.fn(async (path: string) => ({
      path,
      created_at_ms: 10,
      updated_at_ms: 20
    })),
    pathExists: vi.fn(async (path: string) => path === '/vault/journal/2026-03-06.md'),
    listChildren: vi.fn(async (path: string) => {
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
    }),
    listMarkdownFiles: vi.fn(async () => ['notes/a.md', 'journal/2026-03-06.md']),
    readPropertyTypeSchema: vi.fn(async () => ({ mood: 'text' })),
    writePropertyTypeSchema: vi.fn(async () => {}),
    createEntry: vi.fn(async (parentPath: string, name: string) => `${parentPath}/${name}`),
    writeTextFile: vi.fn(async () => {}),
    normalizePath: (path) => path.replace(/\\/g, '/'),
    normalizePathKey: (path) => path.replace(/\\/g, '/').toLowerCase(),
    isMarkdownPath: (path) => path.endsWith('.md'),
    isIsoDate: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
    dailyNotePath: (root, date) => `${root}/journal/${date}.md`,
    enqueueMarkdownReindex,
    removeMarkdownFromIndexInBackground,
    refreshCosmosGraph,
    hasCosmosSurface: () => true
  })

  return {
    workingFolderPath,
    hasWorkspace,
    activeFilePath,
    indexingState,
    errorMessage,
    selectedCount,
    refreshCosmosGraph,
    removeMarkdownFromIndexInBackground,
    enqueueMarkdownReindex,
    controller
  }
}

describe('useAppWorkspaceController', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('loads markdown files from the workspace tree', async () => {
    const { controller } = createController()

    await controller.loadAllFiles()

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
})
