import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  readAppSettings: vi.fn(async () => ({
    exists: true,
    path: '/Users/test/.tomosona/conf.json',
    llm: {
      active_profile: 'openai-profile',
      profiles: [
        {
          id: 'openai-profile',
          label: 'OpenAI Remote',
          provider: 'openai',
          model: 'gpt-4.1',
          has_api_key: true,
          base_url: null,
          default_mode: 'freestyle',
          capabilities: {
            text: true,
            image_input: true,
            audio_input: false,
            tool_calling: true,
            streaming: true
          }
        }
      ]
    },
    embeddings: { mode: 'internal', external: null }
  })),
  writeAppSettings: vi.fn(async () => ({ path: '/Users/test/.tomosona/conf.json', embeddings_changed: false })),
  discoverCodexModels: vi.fn(async () => [
    { id: 'gpt-5.3-codex', display_name: 'GPT-5.3 Codex' },
    { id: 'gpt-5.2-codex', display_name: 'GPT-5.2 Codex' }
  ])
}))

vi.mock('./shared/api/workspaceApi', () => ({
  selectWorkingFolder: vi.fn(async () => null),
  clearWorkingFolder: vi.fn(async () => {}),
  setWorkingFolder: vi.fn(async (path: string) => path),
  listChildren: vi.fn(async () => []),
  listMarkdownFiles: vi.fn(async () => []),
  pathExists: vi.fn(async () => false),
  readTextFile: vi.fn(async () => ''),
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
  computeEchoesPack: vi.fn(async () => ({ anchorPath: '/Users/test/a.md', generatedAtMs: 1, items: [] }))
}))

vi.mock('./shared/api/settingsApi', () => ({
  readAppSettings: hoisted.readAppSettings,
  writeAppSettings: hoisted.writeAppSettings,
  discoverCodexModels: hoisted.discoverCodexModels
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
  const app = createApp(App)
  app.mount(root)
  return { app, root }
}

describe('App settings modal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('opens from command palette', async () => {
    const mounted = mountApp()
    await flushUi()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }))
    await flushUi()
    const paletteInput = mounted.root.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')
    expect(paletteInput).toBeTruthy()
    if (!paletteInput) return
    paletteInput.value = '>open settings'
    paletteInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushUi()
    expect(mounted.root.querySelector('[data-modal="settings"]')).toBeTruthy()
    expect(mounted.root.textContent).toContain('LLM')
    expect(mounted.root.textContent).toContain('Embeddings')
    mounted.app.unmount()
  })

  it('opens from overflow menu and writes settings', async () => {
    const mounted = mountApp()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="View options"]')?.click()
    await flushUi()
    const settingsBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent?.includes('Open Settings'))
    settingsBtn?.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-modal="settings"]')).toBeTruthy()
    const embTab = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent === 'Embeddings')
    embTab?.click()
    await flushUi()
    const externalMode = mounted.root.querySelector<HTMLInputElement>('input[type="radio"][value="external"]')
    externalMode?.click()
    await flushUi()
    const embModel = mounted.root.querySelector<HTMLInputElement>('#settings-emb-model')
    if (embModel) {
      embModel.value = 'text-embedding-3-small'
      embModel.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const embKey = mounted.root.querySelector<HTMLInputElement>('#settings-emb-apikey')
    if (embKey) {
      embKey.value = 'emb-key'
      embKey.dispatchEvent(new Event('input', { bubbles: true }))
    }
    hoisted.writeAppSettings.mockResolvedValueOnce({ path: '/Users/test/.tomosona/conf.json', embeddings_changed: true })
    const saveBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent === 'Save')
    saveBtn?.click()
    await flushUi()
    expect(hoisted.writeAppSettings).toHaveBeenCalledTimes(1)
    const firstCall = hoisted.writeAppSettings.mock.calls[0]
    expect(firstCall).toBeDefined()
    if (!firstCall) throw new Error('Expected writeAppSettings to be called')
    const rawPayload = (firstCall as unknown[])[0]
    if (!rawPayload || typeof rawPayload !== 'object') throw new Error('Expected payload object')
    const payload = rawPayload as { embeddings: { mode: string } }
    expect(payload.embeddings.mode).toBe('external')
    expect((mounted.root.textContent ?? '').toLowerCase()).toContain('out of sync')
    mounted.app.unmount()
  })

  it('writes codex preset without api key', async () => {
    const mounted = mountApp()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="View options"]')?.click()
    await flushUi()
    const settingsBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent?.includes('Open Settings'))
    settingsBtn?.click()
    await flushUi()

    const provider = mounted.root.querySelector<HTMLSelectElement>('#settings-llm-provider')
    if (provider) {
      provider.value = 'codex'
      provider.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await flushUi()
    expect(hoisted.discoverCodexModels).toHaveBeenCalled()
    expect(mounted.root.textContent).toContain('Discover models')

    const saveBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent === 'Save')
    saveBtn?.click()
    await flushUi()

    expect(hoisted.writeAppSettings).toHaveBeenCalledTimes(1)
    const firstCall = hoisted.writeAppSettings.mock.calls[0]
    expect(firstCall).toBeDefined()
    if (!firstCall) throw new Error('Expected writeAppSettings to be called')
    const rawPayload = (firstCall as unknown[])[0]
    if (!rawPayload || typeof rawPayload !== 'object') throw new Error('Expected payload object')
    const payload = rawPayload as {
      llm: {
        profiles: Array<{
          provider: string
          model: string
          preserve_existing_api_key: boolean
          api_key?: string
        }>
      }
    }
    expect(payload.llm.profiles[0]?.provider).toBe('openai-codex')
    expect(payload.llm.profiles[0]?.model).toBe('gpt-5.2-codex')
    expect(payload.llm.profiles[0]?.preserve_existing_api_key).toBe(false)
    expect(payload.llm.profiles[0]?.api_key).toBeUndefined()
    mounted.app.unmount()
  })
})
