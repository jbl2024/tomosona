import { createApp, defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import IndexStatusModal from './IndexStatusModal.vue'
import type { IndexActivityRow } from '../../lib/indexActivity'

function createRow(partial: Partial<IndexActivityRow> & Pick<IndexActivityRow, 'id' | 'ts' | 'timeLabel' | 'state' | 'group' | 'path' | 'directory' | 'fileName' | 'title' | 'detail' | 'durationMs' | 'chunks' | 'targets' | 'properties' | 'embeddingStatus' | 'rawMessage'>): IndexActivityRow {
  return partial
}

function mountModal() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const events: string[] = []

  const rows: IndexActivityRow[] = [
    createRow({
      id: 'rebuild-done',
      ts: 1710836300000,
      timeLabel: '10:18:20',
      state: 'done',
      group: 'rebuild',
      path: '',
      directory: '',
      fileName: '',
      title: 'Workspace rebuild done',
      detail: '474000 ms',
      durationMs: 474000,
      chunks: null,
      targets: null,
      properties: null,
      embeddingStatus: '',
      rawMessage: 'rebuild:done indexed=32 semantic_indexed=29 scanned=32 canceled=false total_ms=474000'
    }),
    createRow({
      id: 'semantic-refresh-done',
      ts: 1710836239000,
      timeLabel: '10:17:19',
      state: 'done',
      group: 'engine',
      path: '/vault/notes/index.md',
      directory: 'vault/notes',
      fileName: 'index.md',
      title: 'Semantic links refreshed',
      detail: 'added 71 · notes 24 · 86 ms',
      durationMs: 86,
      chunks: null,
      targets: null,
      properties: null,
      embeddingStatus: '',
      rawMessage: 'semantic_edges:refresh_done added=71 sources_with_vector=24 total_ms=86'
    }),
    createRow({
      id: 'file-done',
      ts: 1710836219000,
      timeLabel: '10:16:59',
      state: 'done',
      group: 'file',
      path: '/vault/notes/test1.md',
      directory: 'vault/notes',
      fileName: 'test1.md',
      title: 'Indexed file content',
      detail: 'chunks 3 · 14 ms',
      durationMs: 14,
      chunks: 3,
      targets: 1,
      properties: 2,
      embeddingStatus: 'ready',
      rawMessage: 'reindex:done path=/vault/notes/test1.md total_ms=14'
    })
  ]

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(IndexStatusModal, {
          visible: true,
          running: false,
          busy: false,
          runtimeStatus: {
            model_name: 'modernbert-embed-large',
            model_state: 'not_initialized',
            model_init_attempts: 1,
            model_last_started_at_ms: null,
            model_last_finished_at_ms: 1710836000000,
            model_last_duration_ms: 1200,
            model_last_error: null
          },
          badgeLabel: 'Ready',
          badgeClass: 'index-badge-ready',
          showProgressBar: false,
          progressPercent: 0,
          progressLabel: 'idle',
          progressSummary: 'Last run 10:17:19',
          currentPathLabel: '',
          currentOperationLabel: '',
          currentOperationDetail: '',
          currentOperationPath: '',
          currentOperationStatusLabel: 'Idle',
          modelStateClass: 'index-model-idle',
          modelStatusLabel: 'Not initialized',
          showWarmupNote: true,
          alert: null,
          semanticLinksCount: 71,
          processedNotesCount: 10,
          notesTotalCount: 20,
          notesTotalLoading: false,
          lastRunFinishedAtMs: 1710836339000,
          lastRunTitle: 'Workspace rebuild done',
          lastRunDurationMs: 474000,
          logFilter: 'all',
          filteredRows: rows,
          errorCount: 0,
          slowCount: 0,
          actionLabel: 'Rebuild index',
          formatDurationMs: (value: number | null) => `${value ?? 0} ms`,
          formatTimestamp: (value: number | null) => `ts:${value ?? 0}`,
          onClose: () => events.push('close'),
          onAction: () => events.push('action'),
          'onUpdate:logFilter': (value: 'all' | 'errors' | 'slow') => events.push(`filter:${value}`)
        })
    }
  }))

  app.mount(root)
  return { app, root, events }
}

function clickButton(root: HTMLElement, label: string) {
  const button = Array.from(root.querySelectorAll('button')).find((item) =>
    item.textContent?.replace(/\s+/g, ' ').includes(label)
  ) as HTMLButtonElement | undefined
  expect(button).toBeTruthy()
  button?.click()
}

describe('IndexStatusModal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the compact premium layout and keeps the main actions wired', () => {
    const mounted = mountModal()

    expect(mounted.root.textContent).toContain('Index Status')
    expect(mounted.root.textContent).toContain('Semantic links')
    expect(mounted.root.textContent).toContain('Notes processed')
    expect(mounted.root.textContent).toContain('Last run')
    expect(mounted.root.textContent).toContain('71')
    expect(mounted.root.textContent).toContain('10/20')
    expect(mounted.root.textContent).toContain('Workspace rebuild done')
    expect(mounted.root.textContent).toContain('86 ms')
    expect(mounted.root.textContent).toContain('474000 ms')
    expect(mounted.root.textContent).toContain('Rebuild index')
    expect(mounted.root.textContent).toContain('Close')

    clickButton(mounted.root, 'Errors (0)')
    clickButton(mounted.root, 'Rebuild index')
    clickButton(mounted.root, 'Close')

    expect(mounted.events).toEqual(['filter:errors', 'action', 'close'])

    mounted.app.unmount()
  })

  it('falls back to persisted last run metadata when recent logs are unavailable', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(IndexStatusModal, {
            visible: true,
            running: false,
            busy: false,
            runtimeStatus: {
              model_name: 'modernbert-embed-large',
              model_state: 'ready',
              model_init_attempts: 1,
              model_last_started_at_ms: null,
              model_last_finished_at_ms: null,
              model_last_duration_ms: null,
              model_last_error: null
            },
            badgeLabel: 'Ready',
            badgeClass: 'index-badge-ready',
            showProgressBar: false,
            progressPercent: 0,
            progressLabel: 'idle',
            progressSummary: '',
            currentPathLabel: '',
            currentOperationLabel: '',
            currentOperationDetail: '',
            currentOperationPath: '',
            currentOperationStatusLabel: 'Idle',
            modelStateClass: 'index-model-idle',
            modelStatusLabel: 'Ready',
            showWarmupNote: false,
            alert: null,
            semanticLinksCount: 5,
            processedNotesCount: 7,
            notesTotalCount: 12,
            notesTotalLoading: false,
            lastRunFinishedAtMs: 1710836339000,
            lastRunTitle: 'Workspace rebuild done',
            lastRunDurationMs: 474000,
            logFilter: 'all',
            filteredRows: [],
            errorCount: 0,
            slowCount: 0,
            actionLabel: 'Rebuild index',
            formatDurationMs: (value: number | null) => `${value ?? 0} ms`,
            formatTimestamp: (value: number | null) => `ts:${value ?? 0}`,
            onClose: () => {},
            onAction: () => {},
            'onUpdate:logFilter': () => {}
          })
      }
    }))

    app.mount(root)

    expect(root.textContent).toContain('ts:1710836339000')
    expect(root.textContent).toContain('Workspace rebuild done')
    expect(root.textContent).toContain('474000 ms')

    app.unmount()
  })
})
