import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IndexLogEntry } from '../../shared/api/apiTypes'
import { useAppIndexingController } from './useAppIndexingController'

async function flushMicrotasks(times = 3) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}

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
  const indexingState = ref<'idle' | 'indexing' | 'indexed' | 'out_of_sync'>('indexed')
  const refreshBacklinks = vi.fn(async () => {})
  const refreshCosmosGraph = vi.fn(async () => {})
  const readIndexLogs = vi.fn(async (): Promise<IndexLogEntry[]> => [])
  const readIndexOverviewStats = vi.fn(async () => ({
    semantic_links_count: 71,
    indexed_notes_count: 10,
    workspace_notes_count: 20,
    last_run_finished_at_ms: 1710836339000,
    last_run_title: 'Workspace rebuild done'
  }))
  const readIndexRuntimeStatus = vi.fn(async () => ({
    model_name: 'bge',
    model_state: 'ready',
    model_init_attempts: 1,
    model_last_started_at_ms: null,
    model_last_finished_at_ms: null,
    model_last_duration_ms: null,
    model_last_error: null
  }))
  const requestIndexCancel = vi.fn(async () => {})
  const rebuildWorkspaceIndex = vi.fn(async () => ({ indexed_files: 2, canceled: false }))
  const reindexMarkdownFileLexical = vi.fn(async () => {})
  const reindexMarkdownFileSemantic = vi.fn(async () => {})
  const refreshSemanticEdgesCacheNow = vi.fn(async () => {})
  const removeMarkdownFileFromIndex = vi.fn(async () => {})
  const confirmStopCurrentOperation = vi.fn(() => true)
  const notifyInfo = vi.fn()
  const notifySuccess = vi.fn()
  const notifyError = vi.fn()
  const isBusyOpeningDocument = vi.fn(() => false)

  return {
    workingFolderPath,
    hasWorkspace,
    indexingState,
    readIndexLogs,
    readIndexRuntimeStatus,
    requestIndexCancel,
    rebuildWorkspaceIndex,
    reindexMarkdownFileLexical,
    reindexMarkdownFileSemantic,
    refreshSemanticEdgesCacheNow,
    removeMarkdownFileFromIndex,
    refreshBacklinks,
    refreshCosmosGraph,
    readIndexOverviewStats,
    confirmStopCurrentOperation,
    notifyInfo,
    notifySuccess,
    notifyError,
    isBusyOpeningDocument,
    controller: useAppIndexingController({
      indexingShellPort: {
        workingFolderPath,
        hasWorkspace,
        indexingState,
        toRelativePath: (path) => path.replace('/vault/', '')
      },
      indexingApiPort: {
        readIndexLogs,
        readIndexRuntimeStatus,
        readIndexOverviewStats,
        requestIndexCancel,
        rebuildWorkspaceIndex,
        reindexMarkdownFileLexical,
        reindexMarkdownFileSemantic,
        refreshSemanticEdgesCacheNow,
        removeMarkdownFileFromIndex
      },
      indexingDocumentPort: {
        isMarkdownPath: (path) => path.endsWith('.md')
      },
      indexingSurfacePort: {
        refreshBacklinks,
        refreshCosmosGraph,
        hasCosmosSurface: () => false
      },
      indexingUiEffectsPort: {
        confirmStopCurrentOperation,
        notifyInfo,
        notifySuccess,
        notifyError,
        isBusyOpeningDocument
      }
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
    expect(controller.indexCurrentOperationLabel.value).toBe('')
  })

  it('queues markdown reindex and updates progress state', async () => {
    vi.useFakeTimers()
    const { controller, indexingState, refreshBacklinks, reindexMarkdownFileLexical } = createController()

    controller.enqueueMarkdownReindex('/vault/a.md')
    await vi.advanceTimersByTimeAsync(200)

    expect(indexingState.value).toBe('indexed')
    expect(reindexMarkdownFileLexical).toHaveBeenCalledWith('/vault/a.md')
    expect(controller.indexRunCompleted.value).toBe(1)
    expect(refreshBacklinks).toHaveBeenCalled()
  })

  it('rebuilds the index and reports completion', async () => {
    vi.useFakeTimers()
    const { controller, indexingState, refreshBacklinks } = createController()

    const run = controller.rebuildIndex()
    await vi.runAllTimersAsync()
    await run

    expect(indexingState.value).toBe('indexed')
    expect(controller.indexRunPhase.value).toBe('done')
    expect(controller.indexRunCompleted.value).toBe(2)
    expect(refreshBacklinks).toHaveBeenCalled()
  })

  it('runs a workspace mutation and refreshes derived views once', async () => {
    const { controller, indexingState, refreshBacklinks } = createController()

    await controller.runWorkspaceMutation(async () => ({
      updatedFiles: 2,
      reindexedFiles: 3
    }))

    expect(indexingState.value).toBe('indexed')
    expect(controller.indexRunKind.value).toBe('mutation')
    expect(controller.indexRunCompleted.value).toBe(3)
    expect(controller.indexRunPhase.value).toBe('done')
    expect(refreshBacklinks).toHaveBeenCalledOnce()
  })

  it('yields once before refreshing derived views after a workspace mutation', async () => {
    vi.useFakeTimers()
    const { controller, refreshBacklinks } = createController()

    const run = controller.runWorkspaceMutation(async () => ({
      updatedFiles: 1,
      reindexedFiles: 1
    }))
    await flushMicrotasks()

    expect(refreshBacklinks).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    await run

    expect(refreshBacklinks).toHaveBeenCalledOnce()
  })

  it('marks the index out of sync when a workspace mutation fails', async () => {
    const { controller, indexingState } = createController()

    await expect(controller.runWorkspaceMutation(async () => {
      throw new Error('rewrite failed')
    })).rejects.toThrow('rewrite failed')

    expect(indexingState.value).toBe('out_of_sync')
    expect(controller.semanticIndexState.value).toBe('error')
    expect(controller.indexRunPhase.value).toBe('error')
    expect(controller.indexRunMessage.value).toBe('rewrite failed')
  })

  it('ignores non-markdown paths when queueing reindex work', async () => {
    const { controller, indexingState, reindexMarkdownFileLexical } = createController()

    controller.enqueueMarkdownReindex('/vault/a.png')
    await Promise.resolve()
    await Promise.resolve()

    expect(indexingState.value).toBe('indexed')
    expect(reindexMarkdownFileLexical).not.toHaveBeenCalled()
  })

  it('ignores queueing when no workspace is open', async () => {
    const { controller, hasWorkspace, workingFolderPath, reindexMarkdownFileLexical } = createController()
    hasWorkspace.value = false
    workingFolderPath.value = ''

    controller.enqueueMarkdownReindex('/vault/a.md')
    await Promise.resolve()
    await Promise.resolve()

    expect(reindexMarkdownFileLexical).not.toHaveBeenCalled()
  })

  it('deduplicates queued markdown paths', async () => {
    const { controller, reindexMarkdownFileLexical } = createController()
    const lexical = deferred<void>()
    reindexMarkdownFileLexical.mockImplementationOnce(async () => await lexical.promise)

    controller.enqueueMarkdownReindex('/vault/a.md')
    controller.enqueueMarkdownReindex('/vault/a.md')
    await flushMicrotasks()
    lexical.resolve()
    await flushMicrotasks()

    expect(reindexMarkdownFileLexical).toHaveBeenCalledTimes(1)
  })

  it('keeps the index out of sync and reports the failing file when lexical reindex fails', async () => {
    vi.useFakeTimers()
    const { controller, indexingState, reindexMarkdownFileLexical } = createController()
    reindexMarkdownFileLexical.mockRejectedValueOnce(new Error('failed'))

    controller.enqueueMarkdownReindex('/vault/a.md')
    await vi.advanceTimersByTimeAsync(200)

    expect(indexingState.value).toBe('out_of_sync')
    expect(controller.indexRunMessage.value).toBe('Failed to reindex a.md.')
  })

  it('surfaces the live semantic refresh step from backend activity logs', async () => {
    const { controller, readIndexLogs } = createController()
    readIndexLogs.mockResolvedValueOnce([
      {
        ts_ms: 1_000,
        message: 'semantic_edges:refresh_start run_id=3 phase=scan_sources sources=10 top_k=3 threshold=0.62'
      },
      {
        ts_ms: 1_100,
        message: 'semantic_edges:refresh_phase run_id=3 phase=query_neighbors source_index=4 source_total=10 source_path=/vault/Area/Note.md'
      }
    ])

    await controller.refreshIndexModalData()

    expect(controller.indexCurrentOperationLabel.value).toBe('Refreshing semantic links')
    expect(controller.indexCurrentOperationDetail.value).toBe('scan 4/10 · Area/Note.md')
    expect(controller.indexCurrentOperationPath.value).toBe('Area/Note.md')
    expect(controller.filteredIndexActivityRows.value).toEqual([])
  })

  it('uses detailed semantic error activity in the modal alert', async () => {
    const { controller, readIndexLogs } = createController()
    controller.semanticIndexState.value = 'error'
    readIndexLogs.mockResolvedValueOnce([
      {
        ts_ms: 1_000,
        message: 'semantic_edges:refresh_error run_id=3 phase=insert_edge source_path=/vault/Area/Note.md sqlite_code=ConstraintViolation sqlite_msg=UNIQUE_constraint_failed'
      }
    ])

    await controller.refreshIndexModalData()

    expect(controller.indexAlert.value?.message).toContain('phase insert edge')
    expect(controller.indexAlert.value?.message).toContain('sqlite ConstraintViolation')
  })

  it('runs semantic refresh work only for due paths and refreshes backlinks once', async () => {
    vi.useFakeTimers()
    const {
      controller,
      reindexMarkdownFileSemantic,
      refreshSemanticEdgesCacheNow,
      refreshBacklinks
    } = createController()

    controller.enqueueMarkdownReindex('/vault/a.md')
    vi.advanceTimersByTime(15_000)
    await vi.runAllTimersAsync()

    expect(reindexMarkdownFileSemantic).toHaveBeenCalledWith('/vault/a.md')
    expect(refreshSemanticEdgesCacheNow).toHaveBeenCalledOnce()
    expect(refreshBacklinks).toHaveBeenCalled()
    expect(controller.semanticIndexState.value).toBe('idle')
  })

  it('coalesces derived view refreshes across adjacent background batches', async () => {
    vi.useFakeTimers()
    const { controller, refreshBacklinks, reindexMarkdownFileLexical } = createController()
    const first = deferred<void>()
    const second = deferred<void>()
    reindexMarkdownFileLexical
      .mockImplementationOnce(async () => await first.promise)
      .mockImplementationOnce(async () => await second.promise)

    controller.enqueueMarkdownReindex('/vault/a.md')
    await flushMicrotasks()
    controller.enqueueMarkdownReindex('/vault/b.md')
    await flushMicrotasks()

    first.resolve()
    await flushMicrotasks()
    second.resolve()
    await vi.advanceTimersByTimeAsync(200)

    expect(refreshBacklinks).toHaveBeenCalledTimes(1)
  })

  it('defers derived view refresh while a document open is in progress', async () => {
    vi.useFakeTimers()
    const { controller, refreshBacklinks, isBusyOpeningDocument } = createController()
    isBusyOpeningDocument.mockReturnValue(true)

    controller.enqueueMarkdownReindex('/vault/a.md')
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(400)
    expect(refreshBacklinks).not.toHaveBeenCalled()

    isBusyOpeningDocument.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(200)

    expect(refreshBacklinks).toHaveBeenCalledTimes(1)
  })

  it('marks semantic indexing as error when semantic reindex fails', async () => {
    vi.useFakeTimers()
    const { controller, reindexMarkdownFileSemantic } = createController()
    reindexMarkdownFileSemantic.mockRejectedValueOnce(new Error('semantic failed'))

    controller.enqueueMarkdownReindex('/vault/a.md')
    vi.advanceTimersByTime(15_000)
    await vi.runAllTimersAsync()

    expect(controller.semanticIndexState.value).toBe('error')
  })

  it('removes markdown from the index in background and refreshes derived views', async () => {
    vi.useFakeTimers()
    const { controller, removeMarkdownFileFromIndex, refreshBacklinks } = createController()

    controller.removeMarkdownFromIndexInBackground('/vault/a.md')
    await vi.advanceTimersByTimeAsync(200)

    expect(removeMarkdownFileFromIndex).toHaveBeenCalledWith('/vault/a.md')
    expect(refreshBacklinks).toHaveBeenCalled()
  })

  it('ignores empty paths when removing markdown from the index in background', async () => {
    const { controller, removeMarkdownFileFromIndex } = createController()

    controller.removeMarkdownFromIndexInBackground('   ')
    await Promise.resolve()

    expect(removeMarkdownFileFromIndex).not.toHaveBeenCalled()
  })

  it('reports canceled rebuilds via notifyInfo', async () => {
    const { controller, indexingState, rebuildWorkspaceIndex, notifyInfo } = createController()
    rebuildWorkspaceIndex.mockResolvedValueOnce({ indexed_files: 0, canceled: true })

    await controller.rebuildIndex()

    expect(indexingState.value).toBe('out_of_sync')
    expect(controller.indexRunPhase.value).toBe('error')
    expect(notifyInfo).toHaveBeenCalledWith('Index rebuild canceled.')
  })

  it('reports rebuild errors via notifyError', async () => {
    const { controller, indexingState, rebuildWorkspaceIndex, notifyError } = createController()
    rebuildWorkspaceIndex.mockRejectedValueOnce(new Error('boom'))

    await controller.rebuildIndex()

    expect(indexingState.value).toBe('out_of_sync')
    expect(controller.indexRunPhase.value).toBe('error')
    expect(notifyError).toHaveBeenCalledWith('boom')
  })

  it('requests stop when the primary action is confirmed during a running rebuild', async () => {
    const { controller, requestIndexCancel, indexingState } = createController()
    controller.indexStatusBusy.value = false
    controller.indexRunKind.value = 'rebuild'
    controller.indexRunPhase.value = 'indexing_files'
    controller.indexRunCurrentPath.value = ''
    controller.indexRunCompleted.value = 0
    controller.indexRunTotal.value = 1
    indexingState.value = 'indexing'

    await controller.onIndexPrimaryAction()

    expect(requestIndexCancel).toHaveBeenCalledOnce()
  })

  it('does not request stop when confirmation is refused', async () => {
    const { controller, requestIndexCancel, confirmStopCurrentOperation, indexingState } = createController()
    confirmStopCurrentOperation.mockReturnValueOnce(false)
    indexingState.value = 'indexing'
    controller.indexRunKind.value = 'rebuild'
    controller.indexRunPhase.value = 'indexing_files'

    await controller.onIndexPrimaryAction()

    expect(requestIndexCancel).not.toHaveBeenCalled()
  })

  it('opens and closes the index status modal with polling-safe state', async () => {
    vi.useFakeTimers()
    const { controller, readIndexLogs, readIndexOverviewStats, readIndexRuntimeStatus } = createController()

    controller.openIndexStatusModal()
    await Promise.resolve()
    expect(controller.indexStatusModalVisible.value).toBe(true)
    expect(readIndexLogs).toHaveBeenCalled()
    expect(readIndexOverviewStats).toHaveBeenCalled()
    expect(readIndexRuntimeStatus).toHaveBeenCalled()

    readIndexLogs.mockClear()
    readIndexOverviewStats.mockClear()
    readIndexRuntimeStatus.mockClear()
    controller.closeIndexStatusModal()
    vi.advanceTimersByTime(1_000)

    expect(controller.indexStatusModalVisible.value).toBe(false)
    expect(readIndexLogs).not.toHaveBeenCalled()
    expect(readIndexOverviewStats).not.toHaveBeenCalled()
    expect(readIndexRuntimeStatus).not.toHaveBeenCalled()
  })

  it('resetIndexingState clears queues and transient run state', async () => {
    vi.useFakeTimers()
    const { controller } = createController()

    controller.enqueueMarkdownReindex('/vault/a.md')
    controller.resetIndexingState()

    expect(controller.pendingReindexCount.value).toBe(0)
    expect(controller.indexRunKind.value).toBe('idle')
    expect(controller.indexRunPhase.value).toBe('idle')
    expect(controller.indexRunMessage.value).toBe('')
    expect(controller.semanticIndexState.value).toBe('idle')
  })
})
