import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useDocumentHistory } from '../../domains/editor/composables/useDocumentHistory'
import { useAppNavigationController } from './useAppNavigationController'
import { usePaneReadingPositions } from './usePaneReadingPositions'

function createHarness() {
  const activeFilePath = ref('/vault/a.md')
  const documentHistory = useDocumentHistory()
  const readingPositions = usePaneReadingPositions()
  const scrollTops: Record<string, number> = { '/vault/a.md': 420, '/vault/b.md': 90 }
  const applied: Array<{ paneId: string; path: string; value: number }> = []

  const api = useAppNavigationController({
    workspacePort: {
      hasWorkspace: ref(true),
      allWorkspaceFiles: ref(['/vault/a.md', '/vault/b.md']),
      setErrorMessage: vi.fn(),
      toRelativePath: (path: string) => path,
      ensureAllFilesLoaded: vi.fn(async () => {}),
      recordRecentNote: vi.fn()
    },
    editorPort: {
      activeFilePath,
      saveActiveDocument: vi.fn(async () => {}),
      focusEditor: vi.fn(),
      getDocumentStatus: () => ({ dirty: false, saveError: '' }),
      isMarkdownPath: () => true,
      isTextFile: async () => true
    },
    panePort: {
      getActiveTab: () => ({ type: 'document' }),
      getActiveDocumentPath: () => activeFilePath.value,
      getActivePaneId: () => 'pane-1',
      getPaneOrder: () => ['pane-1'],
      getDocumentPathsForPane: () => ['/vault/a.md', '/vault/b.md'],
      openPathInPane: (path: string) => { activeFilePath.value = path },
      openInspectorInPane: vi.fn(),
      revealDocumentInPane: vi.fn(),
      setActivePathInPane: (_paneId: string, path: string) => { activeFilePath.value = path },
      openSurfaceInPane: vi.fn(),
      findPaneContainingSurface: () => null,
      getRecentTabTarget: () => '',
      cycleRecentTab: () => false,
      reopenLastClosedTab: () => false
    },
    historyPort: {
      documentHistory: {
        record: (path: string) => documentHistory.record(path),
        recordEntry: (entry) => documentHistory.recordEntry(entry),
        goBackEntry: () => documentHistory.goBackEntry(),
        goForwardEntry: () => documentHistory.goForwardEntry(),
        jumpToEntry: (index: number) => documentHistory.jumpToEntry(index),
        currentIndex: documentHistory.currentIndex
      },
      home: {
        read: () => null,
        current: () => ({ surface: 'hub' }),
        stateKey: () => 'home',
        label: () => 'Home',
        open: async () => true
      }
    },
    readingPositionPort: {
      capture: (paneId: string, path: string) => {
        readingPositions.capture(paneId, path, scrollTops[path] ?? 0)
      },
      restore: (paneId: string, path: string) => {
        const value = readingPositions.read(paneId, path)
        applied.push({ paneId, path, value })
      }
    }
  })

  return { api, activeFilePath, documentHistory, readingPositions, applied }
}

describe('useAppNavigationController history reading position', () => {
  it('restores the document and its reading position when going back', async () => {
    const harness = createHarness()
    harness.documentHistory.record('/vault/a.md')
    harness.documentHistory.record('/vault/b.md')
    // The reader was at 420 in a.md before moving on to b.md.
    harness.readingPositions.capture('pane-1', '/vault/a.md', 420)
    harness.activeFilePath.value = '/vault/b.md'

    expect(await harness.api.goBackInHistory()).toBe(true)

    expect(harness.activeFilePath.value).toBe('/vault/a.md')
    // The outgoing position is captured, then the target's own position applied.
    expect(harness.readingPositions.read('pane-1', '/vault/b.md')).toBe(90)
    expect(harness.applied).toEqual([{ paneId: 'pane-1', path: '/vault/a.md', value: 420 }])
  })

  it('restores the reading position when going forward again', async () => {
    const harness = createHarness()
    harness.documentHistory.record('/vault/a.md')
    harness.documentHistory.record('/vault/b.md')
    harness.activeFilePath.value = '/vault/b.md'

    await harness.api.goBackInHistory()
    harness.applied.length = 0
    expect(await harness.api.goForwardInHistory()).toBe(true)

    expect(harness.activeFilePath.value).toBe('/vault/b.md')
    expect(harness.applied).toEqual([{ paneId: 'pane-1', path: '/vault/b.md', value: 90 }])
  })
})
