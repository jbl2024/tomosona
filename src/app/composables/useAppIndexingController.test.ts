import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppIndexingController } from './useAppIndexingController'

function createController() {
  const indexingState = ref<'idle' | 'indexing' | 'indexed' | 'out_of_sync'>('indexed')
  const refreshBacklinks = vi.fn(async () => {})
  const refreshCosmosGraph = vi.fn(async () => {})

  return {
    indexingState,
    refreshBacklinks,
    refreshCosmosGraph,
    controller: useAppIndexingController({
      workingFolderPath: ref('/vault'),
      hasWorkspace: ref(true),
      indexingState,
      readIndexLogs: vi.fn(async () => []),
      readIndexRuntimeStatus: vi.fn(async () => ({
        model_name: 'bge',
        model_state: 'ready',
        model_init_attempts: 1,
        model_last_started_at_ms: null,
        model_last_finished_at_ms: null,
        model_last_duration_ms: null,
        model_last_error: null
      })),
      requestIndexCancel: vi.fn(async () => {}),
      rebuildWorkspaceIndex: vi.fn(async () => ({ indexed_files: 2, canceled: false })),
      reindexMarkdownFileLexical: vi.fn(async () => {}),
      reindexMarkdownFileSemantic: vi.fn(async () => {}),
      refreshSemanticEdgesCacheNow: vi.fn(async () => {}),
      removeMarkdownFileFromIndex: vi.fn(async () => {}),
      isMarkdownPath: (path) => path.endsWith('.md'),
      toRelativePath: (path) => path.replace('/vault/', ''),
      refreshBacklinks,
      refreshCosmosGraph,
      hasCosmosSurface: () => false,
      confirmStopCurrentOperation: () => true
    })
  }
}

describe('useAppIndexingController', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('derives the ready badge from indexed state', () => {
    const { controller } = createController()

    expect(controller.indexStateLabel.value).toBe('indexed')
    expect(controller.indexStatusBadgeLabel.value).toBe('Ready')
  })

  it('queues markdown reindex and updates progress state', async () => {
    const { controller, indexingState, refreshBacklinks } = createController()

    controller.enqueueMarkdownReindex('/vault/a.md')
    await Promise.resolve()
    await Promise.resolve()

    expect(indexingState.value).toBe('indexed')
    expect(controller.indexRunKind.value).toBe('background')
    expect(controller.indexRunCompleted.value).toBe(1)
    expect(refreshBacklinks).toHaveBeenCalled()
  })

  it('rebuilds the index and reports completion', async () => {
    const { controller, indexingState, refreshBacklinks } = createController()

    await controller.rebuildIndex()

    expect(indexingState.value).toBe('indexed')
    expect(controller.indexRunPhase.value).toBe('done')
    expect(controller.indexRunCompleted.value).toBe(2)
    expect(refreshBacklinks).toHaveBeenCalled()
  })
})
