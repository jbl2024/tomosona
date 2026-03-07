import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const secondBrainApi = vi.hoisted(() => ({
  createDeliberationSession: vi.fn(),
  loadDeliberationSession: vi.fn(),
  replaceSessionContext: vi.fn()
}))

vi.mock('./lib/secondBrainApi', () => ({
  createDeliberationSession: secondBrainApi.createDeliberationSession,
  fetchSecondBrainConfigStatus: vi.fn(async () => ({ configured: true, error: null })),
  fetchSecondBrainSessions: vi.fn(async () => []),
  loadDeliberationSession: secondBrainApi.loadDeliberationSession,
  removeDeliberationSession: vi.fn(async () => {}),
  replaceSessionContext: secondBrainApi.replaceSessionContext,
  runDeliberation: vi.fn(async () => ({ userMessageId: 'u1', assistantMessageId: 'a1' })),
  subscribeSecondBrainStream: vi.fn(async () => () => {})
}))

vi.mock('./lib/workspaceApi', () => ({
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
  revealInFileManager: vi.fn(async () => {}),
  listenWorkspaceFsChanged: vi.fn(async () => () => {})
}))

vi.mock('./lib/indexApi', () => ({
  initDb: vi.fn(async () => {}),
  reindexMarkdownFileLexical: vi.fn(async () => {}),
  reindexMarkdownFileSemantic: vi.fn(async () => {}),
  refreshSemanticEdgesCacheNow: vi.fn(async () => {}),
  removeMarkdownFileFromIndex: vi.fn(async () => {}),
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
  getWikilinkGraph: vi.fn(async () => ({ nodes: [], edges: [], generated_at_ms: Date.now() })),
  computeEchoesPack: vi.fn(async () => ({ anchorPath: '/vault/a.md', generatedAtMs: 1, items: [] }))
}))

vi.mock('./lib/settingsApi', () => ({
  readAppSettings: vi.fn(async () => ({
    exists: false,
    path: '/Users/test/.tomosona/conf.json',
    llm: null,
    embeddings: { mode: 'internal', external: null }
  })),
  writeAppSettings: vi.fn(async () => ({ path: '/Users/test/.tomosona/conf.json', embeddings_changed: false })),
  discoverCodexModels: vi.fn(async () => [])
}))

vi.mock('./components/panes/EditorPaneGrid.vue', () => ({
  default: defineComponent({
    name: 'EditorPaneGridStub',
    setup(_, { expose, emit }) {
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
      void nextTick(() => {
        emit('open-note', '/vault/a.md')
      })
      return () => h('div', { 'data-pane-grid-stub': 'true' })
    }
  })
}))
vi.mock('./components/panes/MultiPaneToolbarMenu.vue', () => ({
  default: defineComponent({
    name: 'MultiPaneToolbarMenuStub',
    setup() {
      return () => h('div')
    }
  })
}))
vi.mock('./components/EditorRightPane.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./components/explorer/ExplorerTree.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./components/cosmos/CosmosView.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./components/cosmos/CosmosSidebarPanel.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./components/second-brain/SecondBrainView.vue', () => ({ default: defineComponent(() => () => h('div')) }))

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
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {}
  }
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(App)
  app.mount(root)
  return { app, root }
}

async function runPaletteAction(root: HTMLElement, query: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }))
  await flushUi()
  const input = root.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')
  if (!input) throw new Error('quick open input missing')
  input.value = query
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushUi()
  const actionButton = root.querySelector<HTMLButtonElement>('.quick-open .modal-list .modal-item')
  if (!actionButton) throw new Error('quick open action item missing')
  actionButton.click()
  await flushUi()
}

describe('App second-brain add-active-note command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')

    secondBrainApi.createDeliberationSession.mockResolvedValue({ sessionId: 's-new', createdAtMs: 1 })
    secondBrainApi.loadDeliberationSession.mockResolvedValue({
      session_id: 's-new',
      context_items: []
    })
    secondBrainApi.replaceSessionContext.mockResolvedValue(12)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('normalizes relative session context paths into absolute paths on update', async () => {
    window.localStorage.setItem('tomosona:second-brain:last-session-id:%2Fvault', 's1')
    secondBrainApi.loadDeliberationSession
      .mockResolvedValueOnce({ session_id: 's1', context_items: [{ path: 'seed.md' }] })
      .mockResolvedValueOnce({ session_id: 's1', context_items: [{ path: 'seed.md' }] })

    const mounted = mountApp()
    await flushUi()
    await runPaletteAction(mounted.root, '>add active note to second brain')

    expect(secondBrainApi.createDeliberationSession).not.toHaveBeenCalled()
    expect(secondBrainApi.replaceSessionContext).toHaveBeenCalledWith('s1', ['/vault/seed.md', '/vault/a.md'])
    mounted.app.unmount()
  })

  it('creates a session when no persisted session exists', async () => {
    const mounted = mountApp()
    await flushUi()
    await runPaletteAction(mounted.root, '>add active note to second brain')

    expect(secondBrainApi.createDeliberationSession).toHaveBeenCalledWith({
      contextPaths: ['/vault/a.md'],
      title: ''
    })
    expect(secondBrainApi.replaceSessionContext).toHaveBeenCalledWith('s-new', ['/vault/a.md'])
    mounted.app.unmount()
  })
})
