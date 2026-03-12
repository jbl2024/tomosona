import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./shared/api/workspaceApi', () => ({
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
  getWikilinkGraph: vi.fn(async () => ({ nodes: [], edges: [], generated_at_ms: Date.now() }))
  ,
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
        getZoom: () => 1
      })
      return () =>
        h('div', { 'data-pane-grid-stub': 'true' }, [
          h(
            'div',
            { 'data-pane-layout': 'true' },
            `panes:${Object.keys((props.layout as { panesById: Record<string, unknown> }).panesById ?? {}).length};active:${(props.layout as { activePaneId: string }).activePaneId}`
          ),
          h('button', { type: 'button', 'data-focus-pane-1': 'true', onClick: () => emit('pane-focus', { paneId: 'pane-1' }) }, 'focus1'),
          h('button', { type: 'button', 'data-focus-pane-2': 'true', onClick: () => emit('pane-focus', { paneId: 'pane-2' }) }, 'focus2')
        ])
    }
  })
}))

vi.mock('./app/components/panes/MultiPaneToolbarMenu.vue', () => ({
  default: defineComponent({
    name: 'MultiPaneToolbarMenuStub',
    setup(_, { emit }) {
      return () =>
        h('div', { 'data-multi-toolbar': 'true' }, [
          h('button', { type: 'button', 'data-multi-split-right': 'true', onClick: () => emit('split-right') }, 'split-right'),
          h('button', { type: 'button', 'data-multi-join': 'true', onClick: () => emit('join-panes') }, 'join'),
          h('button', { type: 'button', 'data-multi-reset': 'true', onClick: () => emit('reset-layout') }, 'reset')
        ])
    }
  })
}))

vi.mock('./domains/editor/components/EditorRightPane.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./domains/explorer/components/ExplorerTree.vue', () => ({
  default: defineComponent({
    emits: ['open'],
    setup(_, { emit }) {
      return () =>
        h('button', {
          type: 'button',
          'data-explorer-open': 'true',
          onClick: () => emit('open', '/vault/new.md')
        }, 'open')
    }
  })
}))
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
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(App)
  app.mount(root)
  return { app, root }
}

describe('App multi-pane', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('runs split and reset from toolbar controls', async () => {
    const mounted = mountApp()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('[data-multi-split-right="true"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-pane-layout]')?.textContent).toContain('panes:2')

    mounted.root.querySelector<HTMLButtonElement>('[data-multi-join="true"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-pane-layout]')?.textContent).toContain('panes:1')

    mounted.root.querySelector<HTMLButtonElement>('[data-multi-reset="true"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-pane-layout]')?.textContent).toContain('panes:1')

    mounted.app.unmount()
  })

  it('runs split command from command palette', async () => {
    const mounted = mountApp()
    await flushUi()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }))
    await flushUi()
    const input = mounted.root.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')
    expect(input).toBeTruthy()
    if (!input) return

    input.value = '>split pane right'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushUi()

    expect(mounted.root.querySelector('[data-pane-layout]')?.textContent).toContain('panes:2')
    mounted.app.unmount()
  })

  it('supports keyboard split shortcut', async () => {
    const mounted = mountApp()
    await flushUi()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true, bubbles: true }))
    await flushUi()

    expect(mounted.root.querySelector('[data-pane-layout]')?.textContent).toContain('panes:2')
    mounted.app.unmount()
  })

  it('keeps Mod+B sidebar toggle when editor selection is empty', async () => {
    const mounted = mountApp()
    await flushUi()

    expect(mounted.root.querySelector('.left-sidebar')).toBeTruthy()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }))
    await flushUi()
    expect(mounted.root.querySelector('.left-sidebar')).toBeNull()

    mounted.app.unmount()
  })

  it('defers Mod+B to editor when text selection is non-empty', async () => {
    const mounted = mountApp()
    await flushUi()

    const shell = document.createElement('div')
    shell.className = 'editor-shell'
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.textContent = 'bold me'
    shell.appendChild(editable)
    document.body.appendChild(shell)

    const text = editable.firstChild as Text | null
    if (!text) throw new Error('Expected editable text node')
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 4)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(mounted.root.querySelector('.left-sidebar')).toBeTruthy()
    editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }))
    await flushUi()
    expect(mounted.root.querySelector('.left-sidebar')).toBeTruthy()

    selection?.removeAllRanges()
    shell.remove()
    mounted.app.unmount()
  })

  it('prevents native window close for Mod+W from input targets', async () => {
    const mounted = mountApp()
    await flushUi()

    const input = document.createElement('input')
    document.body.appendChild(input)

    const event = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true })
    input.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)

    input.remove()
    mounted.app.unmount()
  })

  it('opens explorer file in currently focused pane', async () => {
    const mounted = mountApp()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('[data-multi-split-right="true"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-pane-layout]')?.textContent).toContain('active:pane-2')

    mounted.root.querySelector<HTMLButtonElement>('[data-focus-pane-1="true"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-pane-layout]')?.textContent).toContain('active:pane-1')

    mounted.root.querySelector<HTMLButtonElement>('[data-focus-pane-2="true"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-pane-layout]')?.textContent).toContain('active:pane-2')

    mounted.root.querySelector<HTMLButtonElement>('[data-explorer-open="true"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-pane-layout]')?.textContent).toContain('active:pane-2')

    mounted.app.unmount()
  })

  it('hydrates multi-pane layout from session storage', async () => {
    window.sessionStorage.setItem(
      'tomosona:editor:multi-pane',
      JSON.stringify({
        root: {
          kind: 'split',
          axis: 'row',
          ratio: 0.5,
          a: { kind: 'pane', paneId: 'pane-1' },
          b: { kind: 'pane', paneId: 'pane-2' }
        },
        panesById: {
          'pane-1': { id: 'pane-1', openTabs: [], activeTabId: '', activePath: '' },
          'pane-2': { id: 'pane-2', openTabs: [], activeTabId: '', activePath: '' }
        },
        activePaneId: 'pane-2'
      })
    )

    const mounted = mountApp()
    await flushUi()

    expect(mounted.root.querySelector('[data-pane-layout]')?.textContent).toContain('panes:2')
    expect(mounted.root.querySelector('[data-pane-layout]')?.textContent).toContain('active:pane-2')

    mounted.app.unmount()
  })
})
