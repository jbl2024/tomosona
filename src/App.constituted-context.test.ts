import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const secondBrainApi = vi.hoisted(() => ({
  createDeliberationSession: vi.fn(),
  loadDeliberationSession: vi.fn(),
  replaceSessionContext: vi.fn()
}))

vi.mock('./domains/second-brain/lib/secondBrainApi', () => ({
  createDeliberationSession: secondBrainApi.createDeliberationSession,
  fetchSecondBrainConfigStatus: vi.fn(async () => ({ configured: true, error: null })),
  fetchSecondBrainSessions: vi.fn(async () => []),
  loadDeliberationSession: secondBrainApi.loadDeliberationSession,
  removeDeliberationSession: vi.fn(async () => {}),
  replaceSessionContext: secondBrainApi.replaceSessionContext,
  runDeliberation: vi.fn(async () => ({ userMessageId: 'u1', assistantMessageId: 'a1' })),
  subscribeSecondBrainStream: vi.fn(async () => () => {})
}))

vi.mock('./shared/api/workspaceApi', () => ({
  selectWorkingFolder: vi.fn(async () => null),
  clearWorkingFolder: vi.fn(async () => {}),
  setWorkingFolder: vi.fn(async (path: string) => path),
  listChildren: vi.fn(async () => []),
  listMarkdownFiles: vi.fn(async () => ['/vault/a.md', '/vault/b.md']),
  pathExists: vi.fn(async () => true),
  readTextFile: vi.fn(async (path: string) => path.endsWith('/b.md') ? '# B' : '# A'),
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
  revealInFileManager: vi.fn(async () => {}),
  listenWorkspaceFsChanged: vi.fn(async () => () => {})
}))

vi.mock('./shared/api/indexApi', () => ({
  initDb: vi.fn(async () => {}),
  reindexMarkdownFileLexical: vi.fn(async () => {}),
  reindexMarkdownFileSemantic: vi.fn(async () => {}),
  refreshSemanticEdgesCacheNow: vi.fn(async () => {}),
  removeMarkdownFileFromIndex: vi.fn(async () => {}),
  ftsSearch: vi.fn(async () => []),
  backlinksForPath: vi.fn(async (path: string) => path.endsWith('/a.md') ? [{ path: '/vault/ref.md' }] : []),
  semanticLinksForPath: vi.fn(async () => []),
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
  getWikilinkGraph: vi.fn(async () => ({
    nodes: [
      { id: '/vault/a.md', path: '/vault/a.md', label: 'A', degree: 1, tags: [], cluster: null },
      { id: '/vault/b.md', path: '/vault/b.md', label: 'B', degree: 1, tags: [], cluster: null }
    ],
    edges: [],
    generated_at_ms: Date.now()
  })),
  computeEchoesPack: vi.fn(async (anchorPath: string) => ({
    anchorPath,
    generatedAtMs: 1,
    items: anchorPath.endsWith('/a.md')
      ? [{
          path: '/vault/b.md',
          title: 'B',
          reasonLabel: 'Direct link',
          reasonLabels: ['Direct link'],
          score: 1,
          signalSources: ['direct']
        }]
      : []
  }))
}))

vi.mock('./shared/api/settingsApi', () => ({
  readAppSettings: vi.fn(async () => ({
    exists: false,
    path: '/Users/test/.tomosona/conf.json',
    llm: null,
    embeddings: { mode: 'internal', external: null }
  })),
  writeAppSettings: vi.fn(async () => ({ path: '/Users/test/.tomosona/conf.json', embeddings_changed: false })),
  discoverCodexModels: vi.fn(async () => [])
}))

vi.mock('./shared/api/favoritesApi', () => ({
  listFavorites: vi.fn(async () => []),
  addFavorite: vi.fn(async (path: string) => ({ path, added_at_ms: 1, exists: true })),
  removeFavorite: vi.fn(async () => {}),
  renameFavorite: vi.fn(async () => {})
}))

vi.mock('./app/components/panes/EditorPaneGrid.vue', () => ({
  default: defineComponent({
    name: 'EditorPaneGridStub',
    props: {
      layout: { type: Object, required: true }
    },
    setup(props, { expose, emit }) {
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
        getZoom: () => 1,
        focusCosmosNodeById: () => {}
      })
      return () => {
        const layout = props.layout as {
          activePaneId: string
          panesById: Record<string, { openTabs: Array<{ type: string }> }>
        }
        const pane = layout.panesById[layout.activePaneId]
        const tabs = (pane?.openTabs ?? []).map((tab) => tab.type).join(',')
        return h('div', { 'data-pane-grid-stub': 'true' }, [
          h('div', { 'data-pane-tabs': 'true' }, tabs),
          h('button', { type: 'button', 'data-open-a': 'true', onClick: () => emit('open-note', '/vault/a.md') }, 'open-a'),
          h('button', { type: 'button', 'data-open-b': 'true', onClick: () => emit('open-note', '/vault/b.md') }, 'open-b'),
          h('button', { type: 'button', 'data-grid-cosmos-add-context': 'true', onClick: () => emit('cosmos-add-to-context', '/vault/b.md') }, 'grid-cosmos-add-context')
        ])
      }
    }
  })
}))

vi.mock('./app/components/panes/MultiPaneToolbarMenu.vue', () => ({
  default: defineComponent({
    name: 'MultiPaneToolbarMenuStub',
    setup() {
      return () => h('div')
    }
  })
}))

vi.mock('./domains/editor/components/EditorRightPane.vue', () => ({
  default: defineComponent({
    name: 'EditorRightPaneStub',
    props: {
      activeNoteTitle: { type: String, required: true },
      localContextItems: { type: Array, required: true },
      pinnedContextItems: { type: Array, required: true },
      canReasonOnContext: { type: Boolean, required: true }
    },
    emits: [
      'active-note-add-to-context',
      'active-note-open-cosmos',
      'echoes-add-to-context',
      'context-pin',
      'context-clear-pinned',
      'context-open-second-brain',
      'context-open-pulse'
    ],
    setup(props, { emit }) {
      return () => h('div', { 'data-right-pane-stub': 'true' }, [
        h('div', { 'data-active-note-title': 'true' }, props.activeNoteTitle),
        h('div', { 'data-context-mode': 'true' }, (props.pinnedContextItems as Array<unknown>).length ? 'pinned' : 'local'),
        h('div', { 'data-context-count': 'true' }, String((props.localContextItems as Array<unknown>).length + (props.pinnedContextItems as Array<unknown>).length)),
        h('div', { 'data-local-context-count': 'true' }, String((props.localContextItems as Array<unknown>).length)),
        h('div', { 'data-pinned-context-count': 'true' }, String((props.pinnedContextItems as Array<unknown>).length)),
        h('div', { 'data-context-can-reason': 'true' }, String(props.canReasonOnContext)),
        h('button', { type: 'button', 'data-add-active-context': 'true', onClick: () => emit('active-note-add-to-context') }, 'add-active'),
        h('button', { type: 'button', 'data-open-note-cosmos': 'true', onClick: () => emit('active-note-open-cosmos') }, 'open-note-cosmos'),
        h('button', { type: 'button', 'data-add-echoes-context': 'true', onClick: () => emit('echoes-add-to-context', '/vault/b.md') }, 'add-echo'),
        h('button', { type: 'button', 'data-pin-context': 'true', onClick: () => emit('context-pin') }, 'pin'),
        h('button', { type: 'button', 'data-clear-pinned-context': 'true', onClick: () => emit('context-clear-pinned') }, 'clear-pinned'),
        h('button', { type: 'button', 'data-open-context-second-brain': 'true', onClick: () => emit('context-open-second-brain') }, 'open-sb'),
        h('button', { type: 'button', 'data-open-context-pulse': 'true', onClick: () => emit('context-open-pulse') }, 'open-pulse')
      ])
    }
  })
}))
vi.mock('./domains/explorer/components/ExplorerTree.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./domains/cosmos/components/CosmosView.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./domains/cosmos/components/CosmosSidebarPanel.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./domains/second-brain/components/SecondBrainView.vue', () => ({ default: defineComponent(() => () => h('div')) }))

import App from './app/App.vue'

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
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {}
  }
  window.localStorage.setItem('tomosona.working-folder.path', '/vault')
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(App)
  app.mount(root)
  return { app, root }
}

async function showRightPane() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }))
  await flushUi()
}

describe('App constituted context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    secondBrainApi.createDeliberationSession.mockResolvedValue({ sessionId: 's-new', createdAtMs: 1 })
    secondBrainApi.loadDeliberationSession.mockResolvedValue({ session_id: 's-new', context_items: [] })
    secondBrainApi.replaceSessionContext.mockResolvedValue(12)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('resets local constituted context when the active note changes', async () => {
    const mounted = mountApp()
    await flushUi()
    await showRightPane()

    mounted.root.querySelector<HTMLButtonElement>('[data-open-a="true"]')?.click()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('[data-add-active-context="true"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-context-count="true"]')?.textContent).toBe('1')

    mounted.root.querySelector<HTMLButtonElement>('[data-open-b="true"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-context-mode="true"]')?.textContent).toBe('local')
    expect(mounted.root.querySelector('[data-context-count="true"]')?.textContent).toBe('0')

    mounted.app.unmount()
  })

  it('keeps pinned constituted context across note changes while local context resets', async () => {
    const mounted = mountApp()
    await flushUi()
    await showRightPane()

    mounted.root.querySelector<HTMLButtonElement>('[data-open-a="true"]')?.click()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('[data-add-echoes-context="true"]')?.click()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('[data-pin-context="true"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-local-context-count="true"]')?.textContent).toBe('1')
    expect(mounted.root.querySelector('[data-pinned-context-count="true"]')?.textContent).toBe('1')

    mounted.root.querySelector<HTMLButtonElement>('[data-open-b="true"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-context-mode="true"]')?.textContent).toBe('pinned')
    expect(mounted.root.querySelector('[data-context-count="true"]')?.textContent).toBe('1')
    expect(mounted.root.querySelector('[data-local-context-count="true"]')?.textContent).toBe('0')
    expect(mounted.root.querySelector('[data-pinned-context-count="true"]')?.textContent).toBe('1')

    mounted.root.querySelector<HTMLButtonElement>('[data-clear-pinned-context="true"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-context-mode="true"]')?.textContent).toBe('local')
    expect(mounted.root.querySelector('[data-context-count="true"]')?.textContent).toBe('0')

    mounted.app.unmount()
  })

  it('adds the selected cosmos note into the constituted context', async () => {
    const mounted = mountApp()
    await flushUi()
    await showRightPane()

    mounted.root.querySelector<HTMLButtonElement>('[data-open-a="true"]')?.click()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('[data-open-note-cosmos="true"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-pane-tabs="true"]')?.textContent).toContain('cosmos')

    mounted.root.querySelector<HTMLButtonElement>('[data-grid-cosmos-add-context="true"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-context-count="true"]')?.textContent).toBe('1')

    mounted.app.unmount()
  })

  it('opens Second Brain with the constituted context for both reason and pulse actions', async () => {
    const mounted = mountApp()
    await flushUi()
    await showRightPane()

    mounted.root.querySelector<HTMLButtonElement>('[data-open-a="true"]')?.click()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('[data-add-active-context="true"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[data-add-echoes-context="true"]')?.click()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('[data-open-context-second-brain="true"]')?.click()
    await flushUi()
    expect(secondBrainApi.replaceSessionContext).toHaveBeenLastCalledWith('s-new', ['/vault/a.md', '/vault/b.md'])

    mounted.root.querySelector<HTMLButtonElement>('[data-open-context-pulse="true"]')?.click()
    await flushUi()
    expect(secondBrainApi.replaceSessionContext).toHaveBeenLastCalledWith('s-new', ['/vault/a.md', '/vault/b.md'])

    mounted.app.unmount()
  })
})
