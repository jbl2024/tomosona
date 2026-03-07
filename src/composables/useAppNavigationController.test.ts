import { ref } from 'vue'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { useDocumentHistory } from './useDocumentHistory'
import { useAppNavigationController } from './useAppNavigationController'

function createController() {
  const activeFilePath = ref('/vault/a.md')
  const allWorkspaceFiles = ref<string[]>([])
  const dirty = ref(false)
  const activePaneId = ref('pane-a')
  const opened: Array<{ path: string; paneId?: string; reveal: boolean }> = []
  let activeTabType = 'document'

  const documentHistory = useDocumentHistory()
  const controller = useAppNavigationController({
    hasWorkspace: ref(true),
    activeFilePath,
    allWorkspaceFiles,
    setErrorMessage: vi.fn(),
    toRelativePath: (path) => path.replace('/vault/', ''),
    ensureAllFilesLoaded: vi.fn(async () => {
      allWorkspaceFiles.value = ['/vault/a.md']
    }),
    saveActiveDocument: vi.fn(async () => {
      dirty.value = false
    }),
    focusEditor: vi.fn(),
    getDocumentStatus: () => ({ dirty: dirty.value, saveError: '' }),
    getActiveTab: () => ({ type: activeTabType }),
    getActiveDocumentPath: () => activeFilePath.value,
    getActivePaneId: () => activePaneId.value,
    getPaneOrder: () => ['pane-a', 'pane-b'],
    getDocumentPathsForPane: (paneId) => (paneId === 'pane-a' ? ['/vault/a.md', '/vault/b.md'] : ['/vault/c.md']),
    openPathInPane: (path, paneId) => {
      opened.push({ path, paneId, reveal: false })
      activeFilePath.value = path
    },
    revealDocumentInPane: (path, paneId) => {
      opened.push({ path, paneId, reveal: true })
      activeFilePath.value = path
    },
    setActivePathInPane: (_paneId, path) => {
      activeFilePath.value = path
    },
    openSurfaceInPane: vi.fn(),
    findPaneContainingSurface: (type) => (type === 'second-brain-chat' ? 'pane-b' : null),
    documentHistory,
    readCosmosHistorySnapshot: (payload) => payload as never,
    currentCosmosHistorySnapshot: () => ({
      query: 'graph',
      selectedNodeId: 'node-1',
      focusMode: false,
      focusDepth: 2
    }),
    cosmosSnapshotStateKey: (snapshot) => JSON.stringify(snapshot),
    cosmosHistoryLabel: (snapshot) => `Cosmos: ${snapshot.query}`,
    applyCosmosHistorySnapshot: vi.fn(async () => true),
    readSecondBrainHistorySnapshot: (payload) => payload as never,
    currentSecondBrainHistorySnapshot: () => ({ surface: 'chat' }),
    secondBrainSnapshotStateKey: (snapshot) => snapshot.surface,
    secondBrainHistoryLabel: () => 'Second Brain',
    openSecondBrainHistorySnapshot: vi.fn(async () => true),
    readHomeHistorySnapshot: (payload) => payload as never,
    currentHomeHistorySnapshot: () => ({ surface: 'hub' }),
    homeSnapshotStateKey: (snapshot) => snapshot.surface,
    homeHistoryLabel: () => 'Home',
    openHomeHistorySnapshot: vi.fn(async () => true)
  })

  return {
    activeFilePath,
    activePaneId,
    dirty,
    opened,
    documentHistory,
    controller,
    setActiveTabType: (type: string) => {
      activeTabType = type
    }
  }
}

describe('useAppNavigationController', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('saves the dirty active document before opening another tab', async () => {
    const { controller, dirty, activeFilePath, documentHistory } = createController()

    dirty.value = true
    const opened = await controller.openTabWithAutosave('/vault/b.md')

    expect(opened).toBe(true)
    expect(activeFilePath.value).toBe('/vault/b.md')
    expect(documentHistory.currentPath.value).toBe('/vault/b.md')
  })

  it('records a debounced cosmos history snapshot', () => {
    vi.useFakeTimers()
    const { controller, documentHistory, setActiveTabType } = createController()

    setActiveTabType('cosmos')
    controller.scheduleCosmosHistorySnapshot()
    vi.advanceTimersByTime(260)

    expect(documentHistory.currentEntry.value?.kind).toBe('cosmos')
    expect(documentHistory.currentEntry.value?.label).toBe('Cosmos: graph')
  })

  it('records a home history snapshot', () => {
    const { controller, documentHistory, setActiveTabType } = createController()

    setActiveTabType('home')
    controller.recordHomeHistorySnapshot()

    expect(documentHistory.currentEntry.value?.kind).toBe('home')
    expect(documentHistory.currentEntry.value?.label).toBe('Home')
  })

  it('opens second brain notes in another pane using reveal mode', async () => {
    const { controller, opened } = createController()

    await controller.openNoteFromSecondBrain('/vault/c.md')

    expect(opened).toEqual([{ path: '/vault/c.md', paneId: 'pane-a', reveal: true }])
  })

  it('cycles to the next document tab in the active pane', async () => {
    const { controller, activeFilePath } = createController()

    const opened = await controller.openNextTabWithAutosave()

    expect(opened).toBe(true)
    expect(activeFilePath.value).toBe('/vault/b.md')
  })
})
