import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  workspaceFsChangedHandler: null as null | ((payload: {
    session_id: number
    root: string
    changes: Array<{
      kind: 'created' | 'removed' | 'renamed' | 'modified'
      path?: string
      old_path?: string
      new_path?: string
      is_dir?: boolean
    }>
    ts_ms: number
  }) => void),
  getWikilinkGraph: vi.fn(async () => ({
    nodes: [
      {
        id: '/vault/a.md',
        path: '/vault/a.md',
        label: 'a',
        displayLabel: 'a',
        degree: 1,
        tags: [],
        cluster: null,
        folderKey: ''
      }
    ],
    edges: [],
    generated_at_ms: Date.now()
  }))
}))

vi.mock('./lib/api', () => ({
  selectWorkingFolder: vi.fn(async () => null),
  clearWorkingFolder: vi.fn(async () => {}),
  setWorkingFolder: vi.fn(async (path: string) => path),
  listChildren: vi.fn(async () => []),
  listMarkdownFiles: vi.fn(async () => ['/vault/a.md']),
  pathExists: vi.fn(async () => true),
  readTextFile: vi.fn(async () => '# A'),
  readFileMetadata: vi.fn(async () => ({ created_at_ms: null, updated_at_ms: null })),
  writeTextFile: vi.fn(async () => {}),
  reindexMarkdownFileLexical: vi.fn(async () => {}),
  reindexMarkdownFileSemantic: vi.fn(async () => {}),
  refreshSemanticEdgesCacheNow: vi.fn(async () => {}),
  removeMarkdownFileFromIndex: vi.fn(async () => {}),
  createEntry: vi.fn(async (parent: string, name: string) => `${parent}/${name}`),
  renameEntry: vi.fn(async (path: string, name: string) => path.replace(/[^/]+$/, name)),
  duplicateEntry: vi.fn(async (path: string) => `${path}.copy`),
  copyEntry: vi.fn(async (source: string) => source),
  moveEntry: vi.fn(async (source: string) => source),
  trashEntry: vi.fn(async (path: string) => path),
  openPathExternal: vi.fn(async () => {}),
  openExternalUrl: vi.fn(async () => {}),
  revealInFileManager: vi.fn(async () => {}),
  initDb: vi.fn(async () => {}),
  ftsSearch: vi.fn(async () => []),
  backlinksForPath: vi.fn(async () => []),
  updateWikilinksForRename: vi.fn(async () => ({ updated_files: 0 })),
  rebuildWorkspaceIndex: vi.fn(async () => ({ indexed_files: 0, canceled: false })),
  requestIndexCancel: vi.fn(async () => {}),
  readIndexRuntimeStatus: vi.fn(async () => ({
    model_name: 'bge',
    model_state: 'not_initialized',
    model_init_attempts: 0,
    model_last_started_at_ms: null,
    model_last_finished_at_ms: null,
    model_last_duration_ms: null,
    model_last_error: null
  })),
  readIndexLogs: vi.fn(async () => []),
  readPropertyTypeSchema: vi.fn(async () => ({})),
  writePropertyTypeSchema: vi.fn(async () => {}),
  readAppSettings: vi.fn(async () => ({
    exists: false,
    path: '/Users/test/.tomosona/conf.json',
    llm: null,
    embeddings: { mode: 'internal', external: null }
  })),
  writeAppSettings: vi.fn(async () => ({ path: '/Users/test/.tomosona/conf.json', embeddings_changed: false })),
  listenWorkspaceFsChanged: vi.fn(async (handler: typeof hoisted.workspaceFsChangedHandler) => {
    hoisted.workspaceFsChangedHandler = handler
    return () => {
      hoisted.workspaceFsChangedHandler = null
    }
  }),
  getWikilinkGraph: hoisted.getWikilinkGraph,
  computeEchoesPack: vi.fn(async () => ({ anchorPath: '/vault/a.md', generatedAtMs: 1, items: [] }))
}))

vi.mock('./components/panes/EditorPaneGrid.vue', () => ({
  default: defineComponent({
    name: 'EditorPaneGridStub',
    props: {
      layout: { type: Object, required: true }
    },
    setup(props, { expose }) {
      expose({
        saveNow: async () => {},
        reloadCurrent: async () => {},
        focusEditor: () => {},
        focusFirstContentBlock: async () => {},
        revealSnippet: async () => {},
        revealOutlineHeading: async () => {},
        revealAnchor: async () => true,
        zoomIn: () => 1,
        zoomOut: () => 1,
        resetZoom: () => 1,
        getZoom: () => 1
      })
      return () => {
        const layout = props.layout as {
          activePaneId: string
          panesById: Record<string, { openTabs: Array<{ type: string }>; activeTabId: string }>
        }
        const pane = layout.panesById[layout.activePaneId]
        const types = (pane?.openTabs ?? []).map((tab) => tab.type).join(',')
        return h('div', { 'data-pane-grid-stub': 'true' }, `active:${layout.activePaneId};tabs:${types}`)
      }
    }
  })
}))

vi.mock('./components/panes/MultiPaneToolbarMenu.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./components/EditorRightPane.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./components/explorer/ExplorerTree.vue', () => ({ default: defineComponent(() => () => h('div')) }))

import App from './App.vue'

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function mountApp() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })

  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(App)
  app.mount(root)
  return { app, root }
}

describe('App pane-native surfaces', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('opens cosmos as a pane tab and reuses existing tab on second click', async () => {
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')

    const mounted = mountApp()
    await flushUi()

    const cosmosBtn = mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')
    cosmosBtn?.click()
    await flushUi()

    expect(mounted.root.querySelector('[data-pane-grid-stub]')?.textContent).toContain('tabs:cosmos')
    const callsAfterFirstOpen = hoisted.getWikilinkGraph.mock.calls.length

    cosmosBtn?.click()
    await flushUi()

    expect(mounted.root.querySelector('[data-pane-grid-stub]')?.textContent).toContain('tabs:cosmos')
    expect(hoisted.getWikilinkGraph.mock.calls.length).toBe(callsAfterFirstOpen)

    mounted.app.unmount()
  })

  it('opens second brain as a pane tab from activity button', async () => {
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')

    const mounted = mountApp()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Second Brain"]')?.click()
    await flushUi()

    expect(mounted.root.querySelector('[data-pane-grid-stub]')?.textContent).toContain('second-brain-chat')

    mounted.app.unmount()
  })

  it('refreshes semantic panels automatically after delayed semantic batch', async () => {
    vi.useFakeTimers()
    try {
      window.localStorage.setItem('tomosona.working-folder.path', '/vault')
      const mounted = mountApp()
      await nextTick()
      await vi.advanceTimersByTimeAsync(0)
      await nextTick()

      mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
      await nextTick()
      await vi.advanceTimersByTimeAsync(0)
      await nextTick()

      const api = await import('./lib/api')
      const refreshSemanticEdgesMock = vi.mocked(api.refreshSemanticEdgesCacheNow)
      const semanticReindexMock = vi.mocked(api.reindexMarkdownFileSemantic)
      const baselineGraphCalls = hoisted.getWikilinkGraph.mock.calls.length

      expect(hoisted.workspaceFsChangedHandler).toBeTypeOf('function')
      hoisted.workspaceFsChangedHandler?.({
        session_id: 1,
        root: '/vault',
        changes: [{ kind: 'modified', path: '/vault/a.md', is_dir: false }],
        ts_ms: Date.now()
      })

      await nextTick()
      await vi.advanceTimersByTimeAsync(0)
      await nextTick()

      const beforeSemanticDelayCalls = hoisted.getWikilinkGraph.mock.calls.length
      await vi.advanceTimersByTimeAsync(15_000)
      await nextTick()
      await vi.advanceTimersByTimeAsync(0)
      await nextTick()

      expect(semanticReindexMock).toHaveBeenCalled()
      expect(refreshSemanticEdgesMock).toHaveBeenCalled()
      expect(hoisted.getWikilinkGraph.mock.calls.length).toBeGreaterThan(beforeSemanticDelayCalls)
      expect(hoisted.getWikilinkGraph.mock.calls.length).toBeGreaterThanOrEqual(baselineGraphCalls + 1)

      mounted.app.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
