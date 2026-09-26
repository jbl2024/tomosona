import { computed, getCurrentInstance, onBeforeUnmount, ref, type Ref } from 'vue'
import type { IndexLogEntry, IndexOverviewStats } from '../../shared/api/apiTypes'
import { buildIndexActivityRows, type IndexActivityRow, type IndexLogFilter } from '../lib/indexActivity'
import { formatTimestamp } from '../lib/appShellPaths'

/**
 * Module: useAppIndexingController
 *
 * Purpose:
 * - Own app-shell indexing state, background workers, and modal polling.
 *
 * Boundaries:
 * - This composable manages indexing state transitions and worker orchestration.
 * - Callers remain responsible for workspace/file-list mutations and any
 *   non-indexing side effects around note creation or navigation.
 */

/** Identifies which indexing workflow currently owns the shell progress state. */
export type IndexRunKind = 'idle' | 'background' | 'rebuild' | 'mutation'
/** Describes the current step within the active indexing workflow. */
export type IndexRunPhase = 'idle' | 'indexing_files' | 'refreshing_views' | 'done' | 'error'

/**
 * Shell state consumed by the indexing controller.
 *
 * Ports group coherent dependencies so the controller contract stays readable
 * as orchestration grows.
 */
export type AppIndexingShellPort = {
  workingFolderPath: Readonly<Ref<string>>
  hasWorkspace: Readonly<Ref<boolean>>
  indexingState: Ref<'idle' | 'indexing' | 'indexed' | 'out_of_sync'>
  toRelativePath: (path: string) => string
}

/** Backend operations used by the indexing controller. */
export type AppIndexingApiPort = {
  readIndexLogs: (limit: number) => Promise<IndexLogEntry[]>
  readIndexOverviewStats: () => Promise<IndexOverviewStats>
  requestIndexCancel: () => Promise<void>
  rebuildWorkspaceIndex: () => Promise<{ indexed_files: number; canceled: boolean }>
  reindexMarkdownFileLexical: (path: string) => Promise<void>
  removeMarkdownFileFromIndex: (path: string) => Promise<void>
}

/** Markdown-specific decisions used to filter indexing work. */
export type AppIndexingDocumentPort = {
  isMarkdownPath: (path: string) => boolean
}

/** Derived surfaces that need refreshes after indexing work completes. */
export type AppIndexingSurfacePort = {
  refreshBacklinks: () => Promise<void>
}

/** UI-side effects triggered by indexing flows. */
export type AppIndexingUiEffectsPort = {
  confirmStopCurrentOperation?: () => boolean
  notifyInfo?: (message: string) => void
  notifySuccess?: (message: string) => void
  notifyError?: (message: string) => void
  isBusyOpeningDocument?: () => boolean
}

/** Declares the cohesive ports required by the indexing controller. */
export type UseAppIndexingControllerOptions = {
  indexingShellPort: AppIndexingShellPort
  indexingApiPort: AppIndexingApiPort
  indexingDocumentPort: AppIndexingDocumentPort
  indexingSurfacePort: AppIndexingSurfacePort
  indexingUiEffectsPort?: AppIndexingUiEffectsPort
}

export type WorkspaceMutationResult = {
  updatedFiles: number
  reindexedFiles: number
}

/**
 * Owns app-shell indexing state, modal polling, and background reindex
 * scheduling.
 */
export function useAppIndexingController(options: UseAppIndexingControllerOptions) {
  const {
    indexingShellPort,
    indexingApiPort,
    indexingDocumentPort,
    indexingSurfacePort,
    indexingUiEffectsPort
  } = options
  const indexedViewRefreshDebounceMs = 120
  const indexedViewRefreshRetryMs = 120
  const indexedViewRefreshBusyTimeoutMs = 5_000
  let reindexWorkerRunning = false
  let reindexGeneration = 0
  const pendingReindexPaths = new Set<string>()
  const pendingReindexCount = ref(0)
  let indexStatusPollTimer: ReturnType<typeof setInterval> | null = null
  let indexedViewRefreshRequestVersion = 0
  let indexedViewRefreshInFlight: Promise<number> | null = null

  const indexRunKind = ref<IndexRunKind>('idle')
  const indexRunPhase = ref<IndexRunPhase>('idle')
  const indexRunCurrentPath = ref('')
  const indexRunCompleted = ref(0)
  const indexRunTotal = ref(0)
  const indexFinalizeCompleted = ref(0)
  const indexFinalizeTotal = ref(0)
  const indexRunMessage = ref('')
  const indexRunLastFinishedAt = ref<number | null>(null)
  const indexStatusBusy = ref(false)
  const indexOverviewStats = ref<IndexOverviewStats | null>(null)
  const indexLogEntries = ref<IndexLogEntry[]>([])
  const indexLogFilter = ref<IndexLogFilter>('all')
  const indexStatusModalVisible = ref(false)

  async function refreshIndexedViews(): Promise<number> {
    indexFinalizeCompleted.value = 0
    indexFinalizeTotal.value = 1
    await indexingSurfacePort.refreshBacklinks()
    indexFinalizeCompleted.value = 1
    return indexFinalizeCompleted.value
  }

  function shouldDelayIndexedViewRefresh(): boolean {
    if (indexingUiEffectsPort?.isBusyOpeningDocument) {
      return indexingUiEffectsPort.isBusyOpeningDocument()
    }
    return false
  }

  /** Coalesces repeated backlink refresh requests so background indexing does not thrash the UI. */
  async function refreshIndexedViewsDeferred(): Promise<number> {
    indexedViewRefreshRequestVersion += 1
    if (indexedViewRefreshInFlight) return indexedViewRefreshInFlight

    indexedViewRefreshInFlight = (async () => {
      let handledVersion = 0
      while (handledVersion < indexedViewRefreshRequestVersion) {
        await new Promise<void>((resolve) => setTimeout(resolve, indexedViewRefreshDebounceMs))
        const waitStartedAt = Date.now()
        while (shouldDelayIndexedViewRefresh()) {
          if (Date.now() - waitStartedAt >= indexedViewRefreshBusyTimeoutMs) {
            console.warn('[index] derived-views-refresh:busy-timeout', {
              waitedMs: Date.now() - waitStartedAt
            })
            break
          }
          await new Promise<void>((resolve) => setTimeout(resolve, indexedViewRefreshRetryMs))
        }
        handledVersion = indexedViewRefreshRequestVersion
        await refreshIndexedViews()
      }
      return indexFinalizeCompleted.value
    })()

    try {
      return await indexedViewRefreshInFlight
    } finally {
      indexedViewRefreshInFlight = null
    }
  }

  const indexStateLabel = computed(() => {
    if (indexingShellPort.indexingState.value === 'indexing') return 'reindexing'
    if (indexingShellPort.indexingState.value === 'indexed') return 'indexed'
    return 'out of sync'
  })

  const indexStateClass = computed(() => {
    if (indexingShellPort.indexingState.value === 'indexing') return 'status-item-indexing'
    if (indexingShellPort.indexingState.value === 'indexed') return 'status-item-indexed'
    return 'status-item-out-of-sync'
  })

  const indexRunning = computed(() => indexingShellPort.indexingState.value === 'indexing')

  const indexProgressLabel = computed(() => {
    if (!indexRunning.value) return indexStateLabel.value
    if (indexRunKind.value === 'background') {
      if (indexRunPhase.value === 'refreshing_views') {
        const total = Math.max(1, indexFinalizeTotal.value)
        const completed = Math.min(indexFinalizeCompleted.value, total)
        return `refreshing views ${completed}/${total}`
      }
      const total = Math.max(indexRunTotal.value, indexRunCompleted.value + pendingReindexCount.value)
      if (total <= 0) return 'waiting for queued files'
      return `indexing files ${indexRunCompleted.value}/${total}`
    }
    if (indexRunKind.value === 'rebuild') {
      if (indexRunPhase.value === 'refreshing_views') {
        const total = Math.max(1, indexFinalizeTotal.value)
        const completed = Math.min(indexFinalizeCompleted.value, total)
        return `refreshing views ${completed}/${total}`
      }
      return 'rebuilding index'
    }
    if (indexRunKind.value === 'mutation') {
      if (indexRunPhase.value === 'refreshing_views') {
        const total = Math.max(1, indexFinalizeTotal.value)
        const completed = Math.min(indexFinalizeCompleted.value, total)
        return `refreshing views ${completed}/${total}`
      }
      return 'updating note links'
    }
    return 'indexing'
  })

  const indexActionLabel = computed(() => (indexRunning.value ? 'Stop' : 'Rebuild index'))

  const indexStatusBadgeLabel = computed(() => {
    if (indexRunPhase.value === 'error' || indexingShellPort.indexingState.value === 'out_of_sync') return 'Needs attention'
    if (indexRunning.value) return 'Reindexing'
    return 'Ready'
  })

  const indexStatusBadgeClass = computed(() => {
    if (indexRunPhase.value === 'error' || indexingShellPort.indexingState.value === 'out_of_sync') return 'index-badge-error'
    if (indexRunning.value) return 'index-badge-running'
    return 'index-badge-ready'
  })

  const indexProgressTotal = computed(() => {
    if (indexRunKind.value === 'background') {
      return Math.max(indexRunTotal.value, indexRunCompleted.value + pendingReindexCount.value)
    }
    return Math.max(indexRunTotal.value, indexRunCompleted.value)
  })

  const indexProgressCurrent = computed(() => {
    const total = indexProgressTotal.value
    if (total <= 0) return 0
    return Math.min(indexRunCompleted.value, total)
  })

  const indexProgressPercent = computed(() => {
    if (indexRunning.value) {
      if (indexRunPhase.value === 'refreshing_views') {
        const finalizeTotal = Math.max(1, indexFinalizeTotal.value)
        const finalizeCurrent = Math.min(indexFinalizeCompleted.value, finalizeTotal)
        const finalizePercent = Math.round((finalizeCurrent / finalizeTotal) * 15)
        return Math.min(99, 85 + Math.max(0, finalizePercent))
      }
      const total = indexProgressTotal.value
      if (total <= 0) return 8
      return Math.min(85, Math.max(0, Math.round((indexProgressCurrent.value / total) * 85)))
    }
    return indexingShellPort.indexingState.value === 'indexed' ? 100 : 0
  })

  const indexProgressSummary = computed(() => {
    if (!indexRunning.value) {
      if (indexingShellPort.indexingState.value === 'out_of_sync') return 'Pending reindex'
      return indexRunLastFinishedAt.value ? `Last run ${formatTimestamp(indexRunLastFinishedAt.value)}` : ''
    }
    if (indexRunPhase.value === 'refreshing_views') {
      const total = Math.max(1, indexFinalizeTotal.value)
      const completed = Math.min(indexFinalizeCompleted.value, total)
      return `Refreshing derived views ${completed}/${total}`
    }
    const total = indexProgressTotal.value
    if (total <= 0) return indexProgressLabel.value
    return `${indexProgressCurrent.value}/${total} files`
  })

  const indexShowProgressBar = computed(() => indexRunning.value)

  const indexProcessedNotesCount = computed(() => indexOverviewStats.value?.processed_notes_count ?? 0)

  const indexWorkspaceNotesCount = computed(() => indexOverviewStats.value?.workspace_notes_count ?? 0)

  const indexLastRunFinishedAtMs = computed(() => indexOverviewStats.value?.last_run_finished_at_ms ?? null)

  const indexLastRunTitle = computed(() => indexOverviewStats.value?.last_run_title ?? null)

  const indexLastRunDurationMs = computed(() => indexOverviewStats.value?.last_run_duration_ms ?? null)

  const indexActivityRows = computed(() => buildIndexActivityRows(indexLogEntries.value, indexingShellPort.toRelativePath))

  const indexCurrentActivity = computed<IndexActivityRow | null>(() => {
    for (const row of indexActivityRows.value) {
      if (row.state === 'running') return row
    }
    return null
  })

  const indexCurrentOperationLabel = computed(() => {
    const row = indexCurrentActivity.value
    if (row) return row.title
    if (indexRunning.value) return indexProgressLabel.value
    return ''
  })

  const indexCurrentOperationDetail = computed(() => {
    const row = indexCurrentActivity.value
    if (row?.detail) return row.detail
    if (indexRunMessage.value && indexRunning.value) return indexRunMessage.value
    return ''
  })

  const indexCurrentOperationPath = computed(() => {
    const row = indexCurrentActivity.value
    if (row?.path) return row.path
    if (indexRunCurrentPath.value) return indexingShellPort.toRelativePath(indexRunCurrentPath.value)
    return ''
  })

  const indexCurrentOperationStatusLabel = computed(() => {
    if (indexCurrentActivity.value?.state === 'running') return 'In progress'
    if (indexRunPhase.value === 'error') return 'Attention'
    if (indexRunning.value) return 'In progress'
    return 'Idle'
  })

  const latestIndexError = computed(() => {
    for (const row of indexActivityRows.value) {
      if (row.state === 'error') return row
    }
    return null
  })

  const indexAlert = computed(() => {
    if (indexRunPhase.value === 'error') {
      return {
        level: 'error' as const,
        title: 'Index run interrupted',
        message:
          indexRunMessage.value ||
          latestIndexError.value?.detail ||
          'An indexing step failed. You can retry a full rebuild.'
      }
    }
    if (indexingShellPort.indexingState.value === 'out_of_sync') {
      return {
        level: 'warning' as const,
        title: 'Workspace changed',
        message: 'Some files are not indexed yet. Run a rebuild to sync search.'
      }
    }
    return null
  })

  const filteredIndexActivityRows = computed(() => {
    const finishedRows = indexActivityRows.value.filter((row) => row.state !== 'running')
    if (indexLogFilter.value === 'all') return finishedRows
    if (indexLogFilter.value === 'errors') return finishedRows.filter((row) => row.state === 'error')
    return finishedRows.filter((row) => (row.durationMs ?? 0) > 1000)
  })

  const indexErrorCount = computed(() => indexActivityRows.value.filter((row) => row.state === 'error').length)
  const indexSlowCount = computed(() => indexActivityRows.value.filter((row) => (row.durationMs ?? 0) > 1000).length)

  /** Mirrors the pending lexical queue size into reactive state for progress UI. */
  function updatePendingReindexCount() {
    pendingReindexCount.value = pendingReindexPaths.size
  }

  /** Marks the index dirty without interrupting an already running indexing pass. */
  function markIndexOutOfSync() {
    if (indexingShellPort.indexingState.value !== 'indexing') {
      indexingShellPort.indexingState.value = 'out_of_sync'
    }
  }

  /** Resets transient indexing state when the workspace closes or gets reloaded. */
  function resetIndexingState() {
    reindexGeneration += 1
    pendingReindexPaths.clear()
    updatePendingReindexCount()
    reindexWorkerRunning = false
    indexRunKind.value = 'idle'
    indexRunPhase.value = 'idle'
    indexRunCurrentPath.value = ''
    indexRunCompleted.value = 0
    indexRunTotal.value = 0
    indexFinalizeCompleted.value = 0
    indexFinalizeTotal.value = 0
    indexRunMessage.value = ''
  }

  /** Stops modal polling so background timers do not survive hidden UI. */
  function stopIndexStatusPolling() {
    if (indexStatusPollTimer) {
      clearInterval(indexStatusPollTimer)
      indexStatusPollTimer = null
    }
  }

  /** Starts lightweight polling while the index status modal stays open. */
  function startIndexStatusPolling() {
    stopIndexStatusPolling()
    indexStatusPollTimer = setInterval(() => {
      if (!indexStatusModalVisible.value) return
      void refreshIndexModalData()
    }, 900)
  }

  /** Opens the index status modal and immediately hydrates its runtime data. */
  function openIndexStatusModal() {
    indexStatusModalVisible.value = true
    void refreshIndexModalData()
    startIndexStatusPolling()
  }

  /** Closes the index status modal and tears down its polling loop. */
  function closeIndexStatusModal() {
    indexStatusModalVisible.value = false
    stopIndexStatusPolling()
  }

  /** Refreshes recent backend index log entries for modal display. */
  async function refreshIndexLogs() {
    if (!indexingShellPort.hasWorkspace.value) {
      indexLogEntries.value = []
      return
    }
    try {
      indexLogEntries.value = await indexingApiPort.readIndexLogs(160)
    } catch {
      indexLogEntries.value = []
    }
  }

  /** Refreshes persisted index overview counts used by the summary cards. */
  async function refreshIndexOverviewStats() {
    if (!indexingShellPort.hasWorkspace.value) return
    try {
      indexOverviewStats.value = await indexingApiPort.readIndexOverviewStats()
    } catch {
      indexOverviewStats.value = null
    }
  }

  /** Refreshes both index overview stats and activity logs in parallel. */
  async function refreshIndexModalData() {
    await Promise.all([refreshIndexOverviewStats(), refreshIndexLogs()])
  }

  /** Processes the lexical reindex queue and updates shell progress state. */
  async function runReindexWorker() {
    if (reindexWorkerRunning) return
    if (!indexingShellPort.workingFolderPath.value) return
    const generationAtStart = reindexGeneration
    reindexWorkerRunning = true
    console.info('[index] background:worker:start', { queued: pendingReindexCount.value })
    indexRunKind.value = 'background'
    indexRunPhase.value = 'indexing_files'
    indexRunCompleted.value = 0
    indexRunTotal.value = Math.max(1, pendingReindexCount.value)
    indexFinalizeCompleted.value = 0
    indexFinalizeTotal.value = 0
    indexRunCurrentPath.value = ''
    indexRunMessage.value = ''
    indexingShellPort.indexingState.value = 'indexing'
    try {
      while (pendingReindexPaths.size > 0) {
        if (reindexGeneration !== generationAtStart) {
          pendingReindexPaths.clear()
          updatePendingReindexCount()
          return
        }
        const [nextPath] = pendingReindexPaths
        if (!nextPath) break
        pendingReindexPaths.delete(nextPath)
        updatePendingReindexCount()
        indexRunCurrentPath.value = nextPath
        indexRunTotal.value = Math.max(indexRunTotal.value, indexRunCompleted.value + pendingReindexCount.value + 1)
        try {
          await indexingApiPort.reindexMarkdownFileLexical(nextPath)
        } catch {
          indexingShellPort.indexingState.value = 'out_of_sync'
          indexRunPhase.value = 'error'
          indexRunMessage.value = `Failed to reindex ${indexingShellPort.toRelativePath(nextPath)}.`
          console.warn('[index] background:file:error', { path: nextPath })
        }
        indexRunCompleted.value += 1
        indexRunCurrentPath.value = ''
      }
    } finally {
      reindexWorkerRunning = false
      if (reindexGeneration !== generationAtStart) return
      if (pendingReindexPaths.size > 0) {
        indexingShellPort.indexingState.value = 'out_of_sync'
        console.info('[index] background:worker:restart', { queued: pendingReindexPaths.size })
        void runReindexWorker()
        return
      }
      indexRunPhase.value = 'refreshing_views'
      indexRunCurrentPath.value = ''
      await refreshIndexedViewsDeferred()
      if (indexingShellPort.indexingState.value !== 'out_of_sync') {
        indexingShellPort.indexingState.value = 'indexed'
        indexRunPhase.value = 'done'
        indexRunMessage.value = ''
        indexRunLastFinishedAt.value = Date.now()
        console.info('[index] background:worker:done', {
          indexed: indexRunCompleted.value,
          total: indexRunTotal.value
        })
        setTimeout(() => {
          if (indexRunKind.value === 'background' && indexRunPhase.value === 'done' && pendingReindexCount.value === 0) {
            indexRunKind.value = 'idle'
            indexRunPhase.value = 'idle'
          }
        }, 600)
      } else {
        indexRunPhase.value = 'error'
        console.warn('[index] background:worker:out_of_sync')
      }
    }
  }

  /** Queues a markdown file for lexical reindex. */
  function enqueueMarkdownReindex(path: string) {
    if (!indexingShellPort.workingFolderPath.value || !indexingDocumentPort.isMarkdownPath(path)) return
    if (indexRunKind.value === 'background' && indexRunCurrentPath.value === path) return
    pendingReindexPaths.add(path)
    updatePendingReindexCount()
    if (indexingShellPort.indexingState.value !== 'indexing') {
      indexingShellPort.indexingState.value = 'out_of_sync'
    }
    if (indexRunKind.value !== 'background' || indexRunPhase.value === 'idle') {
      indexRunKind.value = 'background'
      indexRunPhase.value = 'idle'
      indexRunCompleted.value = 0
      indexRunTotal.value = Math.max(1, pendingReindexCount.value)
      indexFinalizeCompleted.value = 0
      indexFinalizeTotal.value = 0
      indexRunCurrentPath.value = ''
      indexRunMessage.value = ''
    } else {
      indexRunTotal.value = Math.max(indexRunTotal.value, indexRunCompleted.value + pendingReindexCount.value)
    }
    void runReindexWorker()
  }

  /** Removes a file from the index asynchronously and refreshes dependent views afterward. */
  function removeMarkdownFromIndexInBackground(path: string) {
    if (!path.trim()) return
    void indexingApiPort.removeMarkdownFileFromIndex(path).then(() => {
      console.info('[index] background:remove:done', { path })
      void indexingSurfacePort.refreshBacklinks()
    }).catch((err) => {
      console.warn('[index] background:remove:error', {
        path,
        reason: err instanceof Error ? err.message : String(err)
      })
      markIndexOutOfSync()
    })
  }

  /** Runs a full workspace rebuild and refreshes shell views when it completes. */
  async function rebuildIndex() {
    const root = indexingShellPort.workingFolderPath.value
    if (!root) return
    reindexGeneration += 1
    pendingReindexPaths.clear()
    updatePendingReindexCount()
    reindexWorkerRunning = false
    indexRunKind.value = 'rebuild'
    indexRunPhase.value = 'indexing_files'
    indexRunCurrentPath.value = ''
    indexRunCompleted.value = 0
    indexRunTotal.value = 0
    indexFinalizeCompleted.value = 0
    indexFinalizeTotal.value = 0
    indexRunMessage.value = ''
    indexingShellPort.indexingState.value = 'indexing'
    console.info('[index] rebuild:start')
    try {
      const result = await indexingApiPort.rebuildWorkspaceIndex()
      indexRunTotal.value = result.indexed_files
      indexRunCompleted.value = result.indexed_files
      if (result.canceled) {
        indexingShellPort.indexingState.value = 'out_of_sync'
        indexRunPhase.value = 'error'
        indexRunMessage.value = 'Rebuild canceled by user.'
        indexingUiEffectsPort?.notifyInfo?.('Index rebuild canceled.')
        return
      }
      indexRunPhase.value = 'refreshing_views'
      await refreshIndexedViewsDeferred()
      indexingShellPort.indexingState.value = 'indexed'
      indexRunPhase.value = 'done'
      indexRunLastFinishedAt.value = Date.now()
      console.info('[index] rebuild:done', { indexed: result.indexed_files })
      indexingUiEffectsPort?.notifySuccess?.(`Index rebuilt (${result.indexed_files} file${result.indexed_files === 1 ? '' : 's'}).`)
    } catch (err) {
      indexingShellPort.indexingState.value = 'out_of_sync'
      indexRunPhase.value = 'error'
      indexRunMessage.value = err instanceof Error ? err.message : 'Could not rebuild index.'
      console.warn('[index] rebuild:error', {
        message: err instanceof Error ? err.message : 'Could not rebuild index.'
      })
      indexingUiEffectsPort?.notifyError?.(err instanceof Error ? err.message : 'Could not rebuild index.')
    }
  }

  /**
   * Runs a foreground path-mutation workflow and refreshes derived shell views
   * exactly once after the caller's rewrite/reindex task completes.
   */
  async function runWorkspaceMutation(task: () => Promise<WorkspaceMutationResult>) {
    const root = indexingShellPort.workingFolderPath.value
    if (!root) return

    indexRunKind.value = 'mutation'
    indexRunPhase.value = 'indexing_files'
    indexRunCurrentPath.value = ''
    indexRunCompleted.value = 0
    indexRunTotal.value = 0
    indexFinalizeCompleted.value = 0
    indexFinalizeTotal.value = 0
    indexRunMessage.value = ''
    indexingShellPort.indexingState.value = 'indexing'

    try {
      const result = await task()
      const completed = Math.max(result.reindexedFiles, result.updatedFiles)
      indexRunTotal.value = completed
      indexRunCompleted.value = completed
      indexRunPhase.value = 'refreshing_views'
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      await refreshIndexedViewsDeferred()
      indexingShellPort.indexingState.value = 'indexed'
      indexRunPhase.value = 'done'
      indexRunLastFinishedAt.value = Date.now()
    } catch (err) {
      indexingShellPort.indexingState.value = 'out_of_sync'
      indexRunPhase.value = 'error'
      indexRunMessage.value = err instanceof Error ? err.message : 'Could not update workspace links.'
      throw err
    }
  }

  /** Stops the current run using either local queue cancellation or backend cancellation. */
  async function stopCurrentIndexOperation() {
    if (!indexRunning.value) return
    if (indexRunKind.value === 'background') {
      reindexGeneration += 1
      pendingReindexPaths.clear()
      updatePendingReindexCount()
      reindexWorkerRunning = false
      indexingShellPort.indexingState.value = 'out_of_sync'
      indexRunPhase.value = 'error'
      indexRunMessage.value = 'Stopped by user.'
      return
    }
    try {
      await indexingApiPort.requestIndexCancel()
      indexRunMessage.value = 'Stop requested. Waiting for backend to stop...'
    } catch {
      indexRunMessage.value = 'Could not request stop.'
    }
  }

  /** Handles the index modal primary button, toggling between stop and rebuild. */
  async function onIndexPrimaryAction() {
    if (indexStatusBusy.value) return
    indexStatusBusy.value = true
    try {
      if (indexRunning.value) {
        const confirmed = indexingUiEffectsPort?.confirmStopCurrentOperation ? indexingUiEffectsPort.confirmStopCurrentOperation() : true
        if (!confirmed) return
        await stopCurrentIndexOperation()
      } else {
        await rebuildIndex()
      }
      await refreshIndexModalData()
    } finally {
      indexStatusBusy.value = false
    }
  }

  /** Disposes timers and polling loops owned by the controller. */
  function dispose() {
    stopIndexStatusPolling()
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      dispose()
    })
  }

  return {
    indexRunKind,
    indexRunPhase,
    indexRunCurrentPath,
    indexRunCompleted,
    indexRunTotal,
    indexFinalizeCompleted,
    indexFinalizeTotal,
    indexRunMessage,
    indexRunLastFinishedAt,
    indexStatusBusy,
    indexOverviewStats,
    indexProcessedNotesCount,
    indexWorkspaceNotesCount,
    indexLastRunFinishedAtMs,
    indexLastRunTitle,
    indexLastRunDurationMs,
    indexLogEntries,
    indexLogFilter,
    indexStatusModalVisible,
    pendingReindexCount,
    indexStateLabel,
    indexStateClass,
    indexRunning,
    indexProgressLabel,
    indexActionLabel,
    indexStatusBadgeLabel,
    indexStatusBadgeClass,
    indexProgressTotal,
    indexProgressCurrent,
    indexProgressPercent,
    indexProgressSummary,
    indexShowProgressBar,
    indexAlert,
    indexCurrentActivity,
    indexCurrentOperationLabel,
    indexCurrentOperationDetail,
    indexCurrentOperationPath,
    indexCurrentOperationStatusLabel,
    indexActivityRows,
    filteredIndexActivityRows,
    indexErrorCount,
    indexSlowCount,
    markIndexOutOfSync,
    refreshIndexModalData,
    openIndexStatusModal,
    closeIndexStatusModal,
    stopIndexStatusPolling,
    onIndexPrimaryAction,
    enqueueMarkdownReindex,
    removeMarkdownFromIndexInBackground,
    rebuildIndex,
    runWorkspaceMutation,
    resetIndexingState,
    dispose
  }
}
