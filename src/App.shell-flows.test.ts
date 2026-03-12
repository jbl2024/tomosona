import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => {
  const existingPaths = new Set<string>(['/vault', '/vault/a.md'])
  const fileContents = new Map<string, string>([['/vault/a.md', '# A']])

  function resetWorkspaceState() {
    existingPaths.clear()
    existingPaths.add('/vault')
    existingPaths.add('/vault/a.md')
    fileContents.clear()
    fileContents.set('/vault/a.md', '# A')
  }

  return {
    existingPaths,
    fileContents,
    resetWorkspaceState,
    selectWorkingFolder: vi.fn(async () => null),
    clearWorkingFolder: vi.fn(async () => {}),
    setWorkingFolder: vi.fn(async (path: string) => path),
    listChildren: vi.fn(async () => []),
    listMarkdownFiles: vi.fn(async () => Array.from(existingPaths).filter((path) => path.endsWith('.md'))),
    pathExists: vi.fn(async (path: string) => existingPaths.has(path)),
    readTextFile: vi.fn(async (path: string) => fileContents.get(path) ?? ''),
    readFileMetadata: vi.fn(async () => ({ created_at_ms: null, updated_at_ms: null })),
    writeTextFile: vi.fn(async (path: string, content: string) => {
      existingPaths.add(path)
      fileContents.set(path, content)
    }),
    createEntry: vi.fn(async (parent: string, name: string, kind: 'file' | 'folder') => {
      const path = `${parent}/${name}`
      existingPaths.add(path)
      if (kind === 'file') {
        fileContents.set(path, '')
      }
      return path
    }),
    renameEntry: vi.fn(async (path: string, name: string) => path.replace(/[^/]+$/, name)),
    duplicateEntry: vi.fn(async (path: string) => `${path}.copy`),
    copyEntry: vi.fn(async (source: string) => source),
    moveEntry: vi.fn(async (source: string) => source),
    trashEntry: vi.fn(async (path: string) => path),
    revealInFileManager: vi.fn(async () => {}),
    listenWorkspaceFsChanged: vi.fn(async () => () => {}),
    getWikilinkGraph: vi.fn(async () => ({ nodes: [], edges: [], generated_at_ms: Date.now() }))
  }
})

vi.mock('./shared/api/workspaceApi', () => ({
  selectWorkingFolder: hoisted.selectWorkingFolder,
  clearWorkingFolder: hoisted.clearWorkingFolder,
  setWorkingFolder: hoisted.setWorkingFolder,
  listChildren: hoisted.listChildren,
  listMarkdownFiles: hoisted.listMarkdownFiles,
  pathExists: hoisted.pathExists,
  readTextFile: hoisted.readTextFile,
  readFileMetadata: hoisted.readFileMetadata,
  writeTextFile: hoisted.writeTextFile,
  reindexMarkdownFileLexical: vi.fn(async () => {}),
  reindexMarkdownFileSemantic: vi.fn(async () => {}),
  refreshSemanticEdgesCacheNow: vi.fn(async () => {}),
  removeMarkdownFileFromIndex: vi.fn(async () => {}),
  createEntry: hoisted.createEntry,
  renameEntry: hoisted.renameEntry,
  duplicateEntry: hoisted.duplicateEntry,
  copyEntry: hoisted.copyEntry,
  moveEntry: hoisted.moveEntry,
  trashEntry: hoisted.trashEntry,
  revealInFileManager: hoisted.revealInFileManager,
  listenWorkspaceFsChanged: hoisted.listenWorkspaceFsChanged
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
  getWikilinkGraph: hoisted.getWikilinkGraph,
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
      return () => h('button', { type: 'button', 'aria-label': 'Multi-pane layout' }, 'multi-pane')
    }
  })
}))

vi.mock('./domains/editor/components/EditorRightPane.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./domains/explorer/components/ExplorerTree.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./domains/cosmos/components/CosmosView.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./domains/cosmos/components/CosmosSidebarPanel.vue', () => ({ default: defineComponent(() => () => h('div')) }))
vi.mock('./domains/second-brain/components/SecondBrainView.vue', () => ({ default: defineComponent(() => () => h('div')) }))

import App from './app/App.vue'
import * as workspaceApi from './shared/api/workspaceApi'

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

async function openCommandPalette(root: HTMLElement, query: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }))
  await flushUi()
  const input = root.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')
  if (!input) throw new Error('Expected command palette input')
  input.value = query
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushUi()
  return input
}

async function runPaletteCommand(root: HTMLElement, query: string) {
  await openCommandPalette(root, query)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flushUi()
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

describe('App shell flows', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
    window.sessionStorage.clear()
    hoisted.resetWorkspaceState()
    vi.clearAllMocks()
    hoisted.getWikilinkGraph.mockResolvedValue({ nodes: [], edges: [], generated_at_ms: Date.now() })
  })

  it('opens the New Note modal from the command palette and creates a workspace file', async () => {
    const mounted = mountApp()
    await flushUi()

    await runPaletteCommand(mounted.root, '>new note')

    const input = mounted.root.querySelector<HTMLInputElement>('[data-new-file-input="true"]')
    expect(input).toBeTruthy()
    if (!input) throw new Error('Expected new note input')

    input.value = 'test-note'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()

    const createButton = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent === 'Create')
    createButton?.click()
    await flushUi()

    expect(workspaceApi.createEntry).toHaveBeenCalledWith('/vault', 'test-note.md', 'file', 'fail')
    expect(mounted.root.querySelector('[data-new-file-input="true"]')).toBeNull()
    expect(mounted.root.textContent).toContain('test-note.md')

    mounted.app.unmount()
  })

  it('validates and then opens a specific daily note from the command palette', async () => {
    const mounted = mountApp()
    await flushUi()

    await runPaletteCommand(mounted.root, '>open specific date')

    const input = mounted.root.querySelector<HTMLInputElement>('[data-open-date-input="true"]')
    expect(input).toBeTruthy()
    if (!input) throw new Error('Expected open date input')

    input.value = 'bad-date'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent === 'Open')?.click()
    await flushUi()

    expect(mounted.root.textContent).toContain('Invalid date. Use YYYY-MM-DD')

    input.value = '2026-02-22'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent === 'Open')?.click()
    await flushUi()

    expect(workspaceApi.writeTextFile).toHaveBeenCalledWith('/vault/journal/2026-02-22.md', '')
    expect(mounted.root.querySelector('[data-open-date-input="true"]')).toBeNull()
    expect(mounted.root.textContent).toContain('journal/2026-02-22.md')

    mounted.app.unmount()
  })

  it('shows the Cosmos loading modal while the palette command is still running', async () => {
    const graphRequest = deferred<{ nodes: []; edges: []; generated_at_ms: number }>()
    hoisted.getWikilinkGraph.mockImplementationOnce(() => graphRequest.promise)

    const mounted = mountApp()
    await flushUi()

    await openCommandPalette(mounted.root, '>open cosmos view')
    const actionButton = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.modal-item'))
      .find((item) => item.textContent?.includes('Open Cosmos View'))
    if (!actionButton) throw new Error('Expected Open Cosmos View action')

    actionButton.click()
    await flushUi()

    expect(document.querySelector('[data-modal="cosmos-command-loading"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Loading graph...')

    graphRequest.resolve({ nodes: [], edges: [], generated_at_ms: Date.now() })
    await flushUi()

    expect(document.querySelector('[data-modal="cosmos-command-loading"]')).toBeNull()

    mounted.app.unmount()
  })

  it('applies a named theme directly from the command palette', async () => {
    const mounted = mountApp()
    await flushUi()

    await runPaletteCommand(mounted.root, '>theme: tokyo night')

    expect(document.documentElement.dataset.theme).toBe('tokyo-night')
    expect(document.documentElement.dataset.colorScheme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    mounted.app.unmount()
  })

  it('opens the theme picker from shell entrypoints and applies a selected theme', async () => {
    const mounted = mountApp()
    await flushUi()

    await runPaletteCommand(mounted.root, '>theme: select theme')

    const pickerInput = mounted.root.querySelector<HTMLInputElement>('[data-theme-picker-input="true"]')
    expect(pickerInput).toBeTruthy()
    if (!pickerInput) throw new Error('Expected theme picker input')

    pickerInput.value = 'catppuccin mocha'
    pickerInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()

    Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.theme-picker-item'))
      .find((item) => item.textContent?.includes('Catppuccin Mocha'))
      ?.click()
    await flushUi()

    expect(document.documentElement.dataset.theme).toBe('catppuccin-mocha')

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="View options"]')?.click()
    await flushUi()
    Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.overflow-item'))
      .find((item) => item.textContent?.includes('Theme picker'))
      ?.click()
    await flushUi()

    expect(mounted.root.querySelector('[data-modal="theme-picker"]')).toBeTruthy()

    mounted.app.unmount()
  })

  it('previews hovered themes and restores the committed theme when the picker closes', async () => {
    const mounted = mountApp()
    await flushUi()

    await runPaletteCommand(mounted.root, '>theme: tokyo night')
    expect(document.documentElement.dataset.theme).toBe('tokyo-night')

    await runPaletteCommand(mounted.root, '>theme: select theme')

    const harborButton = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.theme-picker-item'))
      .find((item) => item.textContent?.includes('Harbor Light'))
    expect(harborButton).toBeTruthy()
    harborButton?.dispatchEvent(new Event('mouseenter', { bubbles: true }))
    await flushUi()

    expect(document.documentElement.dataset.theme).toBe('harbor-light')
    expect(document.documentElement.dataset.colorScheme).toBe('light')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushUi()

    expect(document.documentElement.dataset.theme).toBe('tokyo-night')
    expect(document.documentElement.dataset.colorScheme).toBe('dark')

    mounted.app.unmount()
  })

  it('closes the current workspace from the command palette and clears shell workspace UI', async () => {
    const mounted = mountApp()
    await flushUi()

    expect(mounted.root.textContent).toContain('workspace: /vault')

    await runPaletteCommand(mounted.root, '>close workspace')

    expect(workspaceApi.clearWorkingFolder).toHaveBeenCalled()
    expect(mounted.root.textContent).toContain('workspace: none')

    mounted.app.unmount()
  })
})
