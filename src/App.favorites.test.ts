import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => {
  const favoritesState: Array<{ path: string; added_at_ms: number; exists: boolean }> = []
  return {
    favoritesState,
    listFavorites: vi.fn(async () => [...favoritesState]),
    addFavorite: vi.fn(async (path: string) => {
      const relative = path.replace('/vault/', '')
      if (!favoritesState.some((item) => item.path === relative)) {
        favoritesState.push({ path: relative, added_at_ms: 1, exists: true })
      }
      return favoritesState.find((item) => item.path === relative)!
    }),
    removeFavorite: vi.fn(async (path: string) => {
      const relative = path.replace('/vault/', '')
      const index = favoritesState.findIndex((item) => item.path === relative)
      if (index >= 0) favoritesState.splice(index, 1)
    }),
    renameFavorite: vi.fn(async (oldPath: string, newPath: string) => {
      const oldRelative = oldPath.replace('/vault/', '')
      const newRelative = newPath.replace('/vault/', '')
      const existing = favoritesState.find((item) => item.path === oldRelative)
      if (existing) existing.path = newRelative
    })
  }
})

vi.mock('./shared/api/workspaceApi', () => ({
  selectWorkingFolder: vi.fn(async () => null),
  clearWorkingFolder: vi.fn(async () => {}),
  setWorkingFolder: vi.fn(async (path: string) => path),
  listChildren: vi.fn(async (path: string) => path === '/vault'
    ? [{ path: '/vault/a.md', is_dir: false, is_markdown: true, has_children: false }]
    : []),
  listMarkdownFiles: vi.fn(async () => ['/vault/a.md']),
  pathExists: vi.fn(async (path: string) => path === '/vault/a.md'),
  readTextFile: vi.fn(async () => '# A'),
  readFileMetadata: vi.fn(async () => ({ created_at_ms: null, updated_at_ms: null })),
  writeTextFile: vi.fn(async () => {}),
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
  backlinksForPath: vi.fn(async () => []),
  semanticLinksForPath: vi.fn(async () => []),
  updateWikilinksForRename: vi.fn(async () => ({ updated_files: 0 })),
  updateWikilinksForPathMoves: vi.fn(async () => ({ updated_files: 0, reindexed_files: 0, moved_markdown_files: 0 })),
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
  listFavorites: hoisted.listFavorites,
  addFavorite: hoisted.addFavorite,
  removeFavorite: hoisted.removeFavorite,
  renameFavorite: hoisted.renameFavorite
}))

vi.mock('./app/components/panes/EditorPaneGrid.vue', () => ({
  default: defineComponent({
    setup(_, { expose }) {
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
      return () => h('div', 'editor')
    }
  })
}))

vi.mock('./app/components/panes/MultiPaneToolbarMenu.vue', () => ({
  default: defineComponent({
    setup() {
      return () => h('button', { type: 'button' }, 'multi-pane')
    }
  })
}))

vi.mock('./domains/editor/components/EditorRightPane.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./domains/explorer/components/ExplorerTree.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./domains/cosmos/components/CosmosView.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./domains/second-brain/components/SecondBrainView.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./domains/cosmos/components/CosmosSidebarPanel.vue', () => ({ default: defineComponent(() => () => h('div')) }))

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
  const root = document.createElement('div')
  document.body.appendChild(root)
  window.localStorage.setItem('tomosona.working-folder.path', '/vault')
  const app = createApp(App)
  app.mount(root)
  return { app, root }
}

describe('App favorites', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
    window.sessionStorage.clear()
    hoisted.favoritesState.splice(0, hoisted.favoritesState.length)
    vi.clearAllMocks()
  })

  it('adds the active note from the command palette and removes missing favorites from the sidebar', async () => {
    let mounted = mountApp()
    await flushUi()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, bubbles: true }))
    await flushUi()
    const quickOpenInput = mounted.root.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')
    if (!quickOpenInput) throw new Error('Expected quick open input')
    quickOpenInput.value = 'a'
    quickOpenInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushUi()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }))
    await flushUi()
    const paletteInput = mounted.root.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')
    if (!paletteInput) throw new Error('Expected command palette input')
    paletteInput.value = '>add active note to favorites'
    paletteInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Favorites"]')?.click()
    await flushUi()
    expect(mounted.root.textContent).toContain('a.md')

    mounted.app.unmount()
    hoisted.favoritesState[0].exists = false
    mounted = mountApp()
    await flushUi()
    expect(mounted.root.textContent).toContain('Missing')
    mounted.root.querySelector<HTMLButtonElement>('.favorites-row-remove')?.click()
    await flushUi()

    expect(hoisted.removeFavorite).toHaveBeenCalled()
    expect(mounted.root.querySelector('.favorites-row')).toBeNull()

    mounted.app.unmount()
  })
})
