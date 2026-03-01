import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

type MockWikilinkGraph = {
  nodes: Array<{ id: string; path: string; label: string; degree: number; tags: string[]; cluster: number | null }>
  edges: Array<{ source: string; target: string; type: 'wikilink' | 'semantic'; score?: number }>
  generated_at_ms: number
}

const hoisted = vi.hoisted(() => ({
  listChildren: vi.fn(async (path: string) => {
    if (path === '/vault') {
      return [
        {
          path: '/vault/opened-from-cosmos.md',
          name: 'opened-from-cosmos.md',
          is_dir: false,
          is_markdown: true
        }
      ]
    }
    return []
  }),
  getWikilinkGraph: vi.fn(async () => ({
    nodes: [
      {
        id: '/vault/opened-from-cosmos.md',
        path: '/vault/opened-from-cosmos.md',
        label: 'opened-from-cosmos',
        degree: 1,
        tags: [] as string[],
        cluster: null as number | null
      }
    ],
    edges: [] as Array<{ source: string; target: string; type: 'wikilink' | 'semantic'; score?: number }>,
    generated_at_ms: Date.now()
  }))
}))

vi.mock('./lib/api', () => ({
  selectWorkingFolder: vi.fn(async () => null),
  clearWorkingFolder: vi.fn(async () => {}),
  setWorkingFolder: vi.fn(async (path: string) => path),
  listChildren: hoisted.listChildren,
  listMarkdownFiles: vi.fn(async () => []),
  pathExists: vi.fn(async () => false),
  readTextFile: vi.fn(async () => ''),
  readFileMetadata: vi.fn(async () => ({ created_at_ms: null, updated_at_ms: null })),
  writeTextFile: vi.fn(async () => {}),
  reindexMarkdownFile: vi.fn(async () => {}),
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
    model_name: 'BAAI/bge-m3',
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
  listenWorkspaceFsChanged: vi.fn(async () => () => {}),
  getWikilinkGraph: hoisted.getWikilinkGraph
}))

vi.mock('./components/EditorView.vue', () => ({
  default: defineComponent({
    name: 'EditorViewStub',
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
      return () => h('div', { 'data-editor-stub': 'true' }, 'editor')
    }
  })
}))

vi.mock('./components/EditorRightPane.vue', () => ({
  default: defineComponent({
    name: 'EditorRightPaneStub',
    setup() {
      return () => h('div', { 'data-right-pane-stub': 'true' }, 'right-pane')
    }
  })
}))

vi.mock('./components/explorer/ExplorerTree.vue', () => ({
  default: defineComponent({
    name: 'ExplorerTreeStub',
    setup() {
      return () => h('div', { 'data-explorer-stub': 'true' }, 'explorer')
    }
  })
}))

vi.mock('./components/cosmos/CosmosView.vue', () => ({
  default: defineComponent({
    name: 'CosmosViewStub',
    emits: ['select-node'],
    setup(_, { emit }) {
      return () =>
        h('div', { 'data-cosmos-stub': 'true' }, [
          h(
            'button',
            {
              type: 'button',
              'data-cosmos-open': 'true',
              onClick: () => emit('select-node', '/vault/opened-from-cosmos.md')
            },
            'select-node'
          )
        ])
    }
  })
}))

vi.mock('./components/second-brain/SecondBrainView.vue', () => ({
  default: defineComponent({
    name: 'SecondBrainViewStub',
    setup() {
      return () => h('div', { 'data-second-brain-stub': 'true' }, 'second-brain')
    }
  })
}))

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

describe('App cosmos integration', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('focuses cosmos view from activity bar without toggling it off on second click', async () => {
    const mounted = mountApp()
    await flushUi()

    const cosmosBtn = mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')
    cosmosBtn?.click()
    await flushUi()
    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('cosmos')
    expect(mounted.root.querySelector('[data-cosmos-stub="true"]')).toBeTruthy()

    cosmosBtn?.click()
    await flushUi()
    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('cosmos')
    expect(mounted.root.querySelector('[data-cosmos-stub="true"]')).toBeTruthy()

    mounted.app.unmount()
  })

  it('exits cosmos on Escape and returns to previous view', async () => {
    const mounted = mountApp()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Search"]')?.click()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushUi()

    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('search')

    mounted.app.unmount()
  })

  it('restores mode from session storage and keeps cosmos focused on cosmos button click', async () => {
    window.sessionStorage.setItem('tomosona:view:active', 'cosmos')
    window.sessionStorage.setItem('tomosona:view:last-non-cosmos', 'search')

    const mounted = mountApp()
    await flushUi()

    expect(mounted.root.querySelector('[data-cosmos-stub="true"]')).toBeTruthy()

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-cosmos-stub="true"]')).toBeTruthy()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushUi()
    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('search')

    mounted.app.unmount()
  })

  it('opens selected node only via explicit panel button', async () => {
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')
    const mounted = mountApp()
    await flushUi()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[data-cosmos-open="true"]')?.click()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('.cosmos-node-title-link')?.click()
    await flushUi()

    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('explorer')
    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('opened-from-cosmos.md')

    mounted.app.unmount()
  })

  it('keeps cosmos search query and matches after selecting a node', async () => {
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')
    const mounted = mountApp()
    await flushUi()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    await flushUi()

    const input = mounted.root.querySelector<HTMLInputElement>('.cosmos-search-input')
    expect(input).toBeTruthy()
    if (!input) {
      mounted.app.unmount()
      return
    }

    input.value = 'opened'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()

    expect(input.value).toBe('opened')
    expect(mounted.root.querySelectorAll('.cosmos-match-item').length).toBeGreaterThan(0)

    mounted.root.querySelector<HTMLButtonElement>('button[data-cosmos-open="true"]')?.click()
    await flushUi()

    const updatedInput = mounted.root.querySelector<HTMLInputElement>('.cosmos-search-input')
    expect(updatedInput?.value).toBe('opened')
    expect(mounted.root.querySelectorAll('.cosmos-match-item').length).toBeGreaterThan(0)

    mounted.app.unmount()
  })

  it('restores cosmos state via back after opening a note from cosmos', async () => {
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')
    const mounted = mountApp()
    await flushUi()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    await flushUi()

    const input = mounted.root.querySelector<HTMLInputElement>('.cosmos-search-input')
    expect(input).toBeTruthy()
    if (!input) {
      mounted.app.unmount()
      return
    }

    input.value = 'opened'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    await new Promise<void>((resolve) => setTimeout(resolve, 320))
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[data-cosmos-open="true"]')?.click()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('.cosmos-node-title-link')?.click()
    await flushUi()

    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('opened-from-cosmos.md')

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label^="Back"]')?.click()
    await flushUi()
    await flushUi()

    expect(mounted.root.querySelector('[data-cosmos-stub="true"]')).toBeTruthy()
    expect(mounted.root.querySelector<HTMLInputElement>('.cosmos-search-input')?.value).toBe('opened')

    mounted.app.unmount()
  })

  it('supports command palette actions for opening cosmos and opening active note in cosmos', async () => {
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')
    const mounted = mountApp()
    await flushUi()
    await flushUi()

    // Build an active note first by opening one from cosmos.
    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('button[data-cosmos-open="true"]')?.click()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('.cosmos-node-title-link')?.click()
    await flushUi()
    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('opened-from-cosmos.md')

    // Command: Open Cosmos View
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }))
    await flushUi()
    const paletteInput = mounted.root.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')
    expect(paletteInput).toBeTruthy()
    if (!paletteInput) {
      mounted.app.unmount()
      return
    }
    paletteInput.value = '>open cosmos view'
    paletteInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushUi()
    await flushUi()
    expect(mounted.root.querySelector('[data-cosmos-stub="true"]')).toBeTruthy()
    expect(mounted.root.querySelector('[data-quick-open-input="true"]')).toBeFalsy()

    // Back to note, then command: Open Note in Cosmos
    mounted.root.querySelector<HTMLButtonElement>('button[aria-label^="Back"]')?.click()
    await flushUi()
    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('opened-from-cosmos.md')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }))
    await flushUi()
    const paletteInput2 = mounted.root.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')
    expect(paletteInput2).toBeTruthy()
    if (!paletteInput2) {
      mounted.app.unmount()
      return
    }
    paletteInput2.value = '>open note in cosmos'
    paletteInput2.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushUi()
    await flushUi()

    expect(mounted.root.querySelector('[data-cosmos-stub="true"]')).toBeTruthy()
    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('opened-from-cosmos')
    expect(mounted.root.querySelector('[data-quick-open-input="true"]')).toBeFalsy()

    mounted.app.unmount()
  })

  it('opens a file from quick open while in cosmos without requiring tab click', async () => {
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')
    const mounted = mountApp()
    await flushUi()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    await flushUi()
    expect(mounted.root.querySelector('[data-cosmos-stub="true"]')).toBeTruthy()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }))
    await flushUi()
    const input = mounted.root.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')
    expect(input).toBeTruthy()
    if (!input) {
      mounted.app.unmount()
      return
    }

    input.value = 'opened-from-cosmos'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushUi()
    await flushUi()

    const hiddenCosmosAfterQuickOpen = mounted.root.querySelector<HTMLElement>('[data-cosmos-stub="true"]')
    expect(hiddenCosmosAfterQuickOpen).toBeTruthy()
    expect(hiddenCosmosAfterQuickOpen?.style.display).toBe('none')
    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('opened-from-cosmos.md')

    mounted.app.unmount()
  })

  it('keeps cosmos tab after opening a file and allows re-focusing cosmos from activity bar', async () => {
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')
    const mounted = mountApp()
    await flushUi()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    await flushUi()
    expect(mounted.root.querySelector('[data-cosmos-stub="true"]')).toBeTruthy()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }))
    await flushUi()
    const input = mounted.root.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')
    expect(input).toBeTruthy()
    if (!input) {
      mounted.app.unmount()
      return
    }
    input.value = 'opened-from-cosmos'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushUi()
    await flushUi()

    const hiddenCosmosAfterFileOpen = mounted.root.querySelector<HTMLElement>('[data-cosmos-stub="true"]')
    expect(hiddenCosmosAfterFileOpen).toBeTruthy()
    expect(hiddenCosmosAfterFileOpen?.style.display).toBe('none')
    const cosmosTab = Array.from(mounted.root.querySelectorAll<HTMLElement>('.tab-item'))
      .find((item) => item.querySelector('.tab-name')?.textContent?.trim() === 'Cosmos')
    expect(cosmosTab).toBeTruthy()

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    await flushUi()
    expect(mounted.root.querySelector('[data-cosmos-stub="true"]')).toBeTruthy()

    mounted.app.unmount()
  })

  it('does not refresh graph again when re-focusing an already loaded cosmos tab', async () => {
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')
    const mounted = mountApp()
    await flushUi()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    await flushUi()
    expect(hoisted.getWikilinkGraph.mock.calls.length).toBeGreaterThan(0)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }))
    await flushUi()
    const input = mounted.root.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')
    expect(input).toBeTruthy()
    if (!input) {
      mounted.app.unmount()
      return
    }
    input.value = 'opened-from-cosmos'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushUi()
    await flushUi()

    const callsBeforeRefocus = hoisted.getWikilinkGraph.mock.calls.length
    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    await flushUi()

    expect(hoisted.getWikilinkGraph.mock.calls.length).toBe(callsBeforeRefocus)

    mounted.app.unmount()
  })

  it('closes command palette immediately and shows cosmos loading modal while action is running', async () => {
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')
    let resolveGraphLoad: ((value: MockWikilinkGraph | PromiseLike<MockWikilinkGraph>) => void) | undefined

    hoisted.getWikilinkGraph.mockImplementationOnce(
      () => new Promise<MockWikilinkGraph>((resolve) => {
        resolveGraphLoad = resolve
      })
    )

    const mounted = mountApp()
    await flushUi()
    await flushUi()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }))
    await flushUi()

    const paletteInput = mounted.root.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')
    expect(paletteInput).toBeTruthy()
    if (!paletteInput) {
      mounted.app.unmount()
      return
    }

    paletteInput.value = '>open cosmos view'
    paletteInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushUi()

    expect(mounted.root.querySelector('[data-quick-open-input="true"]')).toBeFalsy()
    expect(mounted.root.querySelector('[data-modal="cosmos-command-loading"]')).toBeTruthy()

    expect(resolveGraphLoad).toBeTruthy()
    resolveGraphLoad?.({
      nodes: [
        {
          id: '/vault/opened-from-cosmos.md',
          path: '/vault/opened-from-cosmos.md',
          label: 'opened-from-cosmos',
          degree: 1,
          tags: [] as string[],
          cluster: null
        }
      ],
      edges: [] as Array<{ source: string; target: string; type: 'wikilink' | 'semantic'; score?: number }>,
      generated_at_ms: Date.now()
    })
    await flushUi()
    await flushUi()

    expect(mounted.root.querySelector('[data-modal="cosmos-command-loading"]')).toBeFalsy()

    mounted.app.unmount()
  })

  it('exits cosmos when clicking a file tab', async () => {
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')
    const mounted = mountApp()
    await flushUi()
    await flushUi()

    // Open a note first so at least one tab exists.
    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('button[data-cosmos-open="true"]')?.click()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('.cosmos-node-title-link')?.click()
    await flushUi()

    // Return to cosmos, then click the file tab.
    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    await flushUi()
    expect(mounted.root.querySelector('[data-cosmos-stub="true"]')).toBeTruthy()

    mounted.root.querySelector<HTMLElement>('.tab-item')?.click()
    await flushUi()

    const hiddenCosmosAfterTabClick = mounted.root.querySelector<HTMLElement>('[data-cosmos-stub="true"]')
    expect(hiddenCosmosAfterTabClick).toBeTruthy()
    expect(hiddenCosmosAfterTabClick?.style.display).toBe('none')
    expect(mounted.root.querySelector('[data-editor-stub="true"]')).toBeTruthy()

    mounted.app.unmount()
  })

  it('shows a cosmos tab when cosmos is active and closes to explorer via tab close', async () => {
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')
    const mounted = mountApp()
    await flushUi()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    await flushUi()

    const cosmosTab = Array.from(mounted.root.querySelectorAll<HTMLElement>('.tab-item'))
      .find((item) => item.querySelector('.tab-name')?.textContent?.trim() === 'Cosmos')
    expect(cosmosTab).toBeTruthy()
    cosmosTab?.querySelector<HTMLButtonElement>('.tab-close')?.click()
    await flushUi()

    expect(mounted.root.querySelector('[data-cosmos-stub="true"]')).toBeFalsy()
    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('explorer')

    mounted.app.unmount()
  })

  it('closes cosmos tab via Ctrl+W and returns to explorer with last opened file', async () => {
    window.localStorage.setItem('tomosona.working-folder.path', '/vault')
    const mounted = mountApp()
    await flushUi()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('button[data-cosmos-open="true"]')?.click()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('.cosmos-node-title-link')?.click()
    await flushUi()
    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('opened-from-cosmos.md')

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Cosmos view"]')?.click()
    await flushUi()
    await flushUi()
    expect(mounted.root.querySelector('[data-cosmos-stub="true"]')).toBeTruthy()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true }))
    await flushUi()
    await flushUi()

    expect(mounted.root.querySelector('[data-cosmos-stub="true"]')).toBeFalsy()
    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('explorer')
    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('opened-from-cosmos.md')

    mounted.app.unmount()
  })

  it('opens and closes second brain tab with activity button and Cmd/Ctrl+W', async () => {
    const mounted = mountApp()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="Second Brain"]')?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-second-brain-stub="true"]')).toBeTruthy()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', metaKey: true, bubbles: true }))
    await flushUi()
    expect(mounted.root.querySelector('[data-second-brain-stub="true"]')).toBeFalsy()

    mounted.app.unmount()
  })
})
