import { ref } from 'vue'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { useDocumentHistory } from '../../domains/editor/composables/useDocumentHistory'
import { useAppNavigationController } from './useAppNavigationController'

function createController(options: {
  saveClearsDirty?: boolean
  activeFilePath?: string
  openDocumentPathsByPane?: Record<string, string[]>
  activeTabType?: string
} = {}) {
  const activeFilePath = ref(options.activeFilePath ?? '/vault/a.md')
  const allWorkspaceFiles = ref<string[]>([])
  const dirty = ref(false)
  const activePaneId = ref('pane-a')
  const opened: Array<{ path: string; paneId?: string; reveal: boolean }> = []
  let activeTabType = options.activeTabType ?? 'document'
  const documentPathsByPane = options.openDocumentPathsByPane ?? {
    'pane-a': ['/vault/a.md', '/vault/b.md'],
    'pane-b': ['/vault/c.md']
  }
  const setErrorMessage = vi.fn()
  const recordRecentNote = vi.fn()
  const focusEditor = vi.fn()
  const ensureAllFilesLoaded = vi.fn(async () => {
    allWorkspaceFiles.value = ['/vault/a.md']
  })
  const saveActiveDocument = vi.fn(async () => {
    if (options.saveClearsDirty !== false) {
      dirty.value = false
    }
  })
  const openSecondBrainHistorySnapshot = vi.fn(async () => true)
  const openHomeHistorySnapshot = vi.fn(async () => true)

  const documentHistory = useDocumentHistory()
  const controller = useAppNavigationController({
    workspacePort: {
      hasWorkspace: ref(true),
      allWorkspaceFiles,
      setErrorMessage,
      toRelativePath: (path) => path.replace('/vault/', ''),
      ensureAllFilesLoaded,
      recordRecentNote
    },
    editorPort: {
      activeFilePath,
      saveActiveDocument,
      focusEditor,
      getDocumentStatus: () => ({ dirty: dirty.value, saveError: '' }),
      isMarkdownPath: (path: string) => path.endsWith('.md') || path.endsWith('.markdown'),
      isTextFile: async (path: string) =>
        /\.(txt|text|json|yaml|yml|toml|ini|cfg|conf|env|csv|tsv|xml|ts|tsx|js|jsx|vue|css|scss|sass|less|cpp|c|h|hpp|rs|py|go|java|kt|sh|bash|zsh|fish|desktop|ini|cmake|makefile|dockerfile)$/i.test(path) || !/\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|tar|gz|bz2|xz|7z|rar|docx?|xlsx?|pptx?|odt|ods|odp|epub|mp3|wav|flac|aac|ogg|m4a|mp4|mkv|mov|avi|webm|exe|dll|so|dylib|bin|iso|woff2?|ttf|otf|eot)$/i.test(path)
    },
    panePort: {
      getActiveTab: () => ({ type: activeTabType }),
      getActiveDocumentPath: () => activeFilePath.value,
      getActivePaneId: () => activePaneId.value,
      getPaneOrder: () => ['pane-a', 'pane-b'],
      getDocumentPathsForPane: (paneId) => documentPathsByPane[paneId] ?? [],
      openPathInPane: (path, paneId) => {
        opened.push({ path, paneId, reveal: false })
        if (paneId) {
          activePaneId.value = paneId
        }
        activeFilePath.value = path
        activeTabType = 'document'
      },
      openInspectorInPane: (path, paneId) => {
        opened.push({ path, paneId, reveal: false })
        if (paneId) {
          activePaneId.value = paneId
        }
        activeFilePath.value = path
        activeTabType = 'file-inspector'
      },
      revealDocumentInPane: (path, paneId) => {
        opened.push({ path, paneId, reveal: true })
        if (paneId) {
          activePaneId.value = paneId
        }
        activeFilePath.value = path
        activeTabType = 'document'
      },
      setActivePathInPane: (_paneId, path) => {
        activeFilePath.value = path
      },
      openSurfaceInPane: vi.fn(),
      findPaneContainingSurface: (type) => (type === 'second-brain-chat' ? 'pane-b' : null)
    },
    historyPort: {
      documentHistory,
      secondBrain: {
        read: (payload) => payload as never,
        current: () => ({ surface: 'chat' }),
        stateKey: (snapshot) => snapshot.surface,
        label: () => 'Second Brain',
        open: openSecondBrainHistorySnapshot
      },
      home: {
        read: (payload) => payload as never,
        current: () => ({ surface: 'hub' }),
        stateKey: (snapshot) => snapshot.surface,
        label: () => 'Home',
        open: openHomeHistorySnapshot
      }
    }
  })

  return {
    activeFilePath,
    activePaneId,
    dirty,
    opened,
    documentHistory,
    setErrorMessage,
    recordRecentNote,
    focusEditor,
    ensureAllFilesLoaded,
    openSecondBrainHistorySnapshot,
    openHomeHistorySnapshot,
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
    const { controller, dirty, activeFilePath, documentHistory, recordRecentNote, focusEditor } = createController()

    dirty.value = true
    const opened = await controller.openTabWithAutosave('/vault/b.md')

    expect(opened).toBe(true)
    expect(activeFilePath.value).toBe('/vault/b.md')
    expect(documentHistory.currentPath.value).toBe('/vault/b.md')
    expect(recordRecentNote).toHaveBeenCalledWith('/vault/b.md')
    expect(focusEditor).toHaveBeenCalledTimes(1)
  })

  it('opens non-markdown files in inspector tabs and records them as recent files', async () => {
    const { controller, opened, recordRecentNote } = createController()

    const openedInspector = await controller.openTabWithAutosave('/vault/image.png')

    expect(openedInspector).toBe(true)
    expect(opened).toEqual([{ path: '/vault/image.png', paneId: undefined, reveal: false }])
    expect(recordRecentNote).toHaveBeenCalledWith('/vault/image.png')
  })

  it('opens source text files in document tabs', async () => {
    const { controller, opened, recordRecentNote } = createController()

    const openedDocument = await controller.openTabWithAutosave('/vault/test.txt')

    expect(openedDocument).toBe(true)
    expect(opened).toEqual([{ path: '/vault/test.txt', paneId: undefined, reveal: false }])
    expect(recordRecentNote).toHaveBeenCalledWith('/vault/test.txt')
  })

  it('switches an inspector tab to a document tab for editable text files already active in the pane', async () => {
    const { controller, opened, setActiveTabType } = createController({ activeFilePath: '/vault/test.txt' })

    setActiveTabType('file-inspector')
    const openedDocument = await controller.openTabWithAutosave('/vault/test.txt')

    expect(openedDocument).toBe(true)
    expect(opened).toEqual([{ path: '/vault/test.txt', paneId: undefined, reveal: false }])
  })

  it('opens generic source files as document tabs', async () => {
    const { controller, opened } = createController({ activeFilePath: '/vault/other.md' })

    const openedDocument = await controller.openTabWithAutosave('/vault/app.ts')

    expect(openedDocument).toBe(true)
    expect(opened).toEqual([{ path: '/vault/app.ts', paneId: undefined, reveal: false }])
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
    const { controller, activeFilePath, focusEditor } = createController()

    const opened = await controller.openNextTabWithAutosave()

    expect(opened).toBe(true)
    expect(activeFilePath.value).toBe('/vault/b.md')
    expect(focusEditor).toHaveBeenCalledTimes(1)
  })

  it('surfaces a save error when the active document stays dirty', async () => {
    const { controller, dirty, setErrorMessage, recordRecentNote } = createController({ saveClearsDirty: false })

    dirty.value = true
    const opened = await controller.openTabWithAutosave('/vault/b.md')

    expect(opened).toBe(false)
    expect(setErrorMessage).toHaveBeenCalledWith('Could not save current note before switching tabs.')
    expect(recordRecentNote).not.toHaveBeenCalled()
  })

  it('records recent notes when activating an existing tab', async () => {
    const { controller, activeFilePath, recordRecentNote, focusEditor } = createController()

    const opened = await controller.setActiveTabWithAutosave('/vault/b.md')

    expect(opened).toBe(true)
    expect(activeFilePath.value).toBe('/vault/b.md')
    expect(recordRecentNote).toHaveBeenCalledWith('/vault/b.md')
    expect(focusEditor).toHaveBeenCalledTimes(1)
  })

  it('records recent files when activating a non-markdown tab', async () => {
    const { controller, activeFilePath, recordRecentNote, focusEditor } = createController()

    const opened = await controller.setActiveTabWithAutosave('/vault/photo.png')

    expect(opened).toBe(true)
    expect(activeFilePath.value).toBe('/vault/photo.png')
    expect(recordRecentNote).toHaveBeenCalledWith('/vault/photo.png')
    expect(focusEditor).toHaveBeenCalledTimes(1)
  })

  it('focuses the editor after reopening a document from history', async () => {
    const { controller, documentHistory, focusEditor } = createController()

    documentHistory.record('/vault/a.md')
    documentHistory.record('/vault/b.md')

    const opened = await controller.goBackInHistory()

    expect(opened).toBe(true)
    expect(focusEditor).toHaveBeenCalledTimes(1)
  })

  it('loads workspace files before opening a second brain history entry', async () => {
    const {
      controller,
      documentHistory,
      ensureAllFilesLoaded,
      openSecondBrainHistorySnapshot,
      setActiveTabType
    } = createController()

    setActiveTabType('second-brain-chat')
    controller.recordSecondBrainHistorySnapshot()
    documentHistory.record('/vault/a.md')

    const opened = await controller.goBackInHistory()

    expect(opened).toBe(true)
    expect(ensureAllFilesLoaded).toHaveBeenCalledOnce()
    expect(openSecondBrainHistorySnapshot).toHaveBeenCalledOnce()
  })
})
