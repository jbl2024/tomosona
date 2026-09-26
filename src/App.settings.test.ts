import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import packageJson from '../package.json'
import type { AppSettingsView } from './shared/api/apiTypes'

vi.setConfig({ testTimeout: 15000 })

const hoisted = vi.hoisted(() => ({
  readAboutMetadata: vi.fn(async () => ({
    version: packageJson.version,
    build_commit: 'abc12345',
    build_channel: 'development',
    platform_label: 'macOS arm64',
    app_support_dir: '/Users/test/.tomosona',
    tauri_version: '2.10.2'
  })),
  openAppSupportDir: vi.fn(async () => {}),
  readAppSettings: vi.fn(async (): Promise<AppSettingsView> => ({
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
          default_temperature: 0.15,
          system_prompt: 'Always answer tersely.',
          api_key: 'openai-secret',
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
    embeddings: { mode: 'internal', external: null },
  })),
  writeAppSettings: vi.fn(async () => ({ path: '/Users/test/.tomosona/conf.json', embeddings_changed: false })),
  discoverCodexModels: vi.fn(async () => [
    { id: 'gpt-5.3-codex', display_name: 'GPT-5.3 Codex' },
    { id: 'gpt-5.2-codex', display_name: 'GPT-5.2 Codex' }
  ]),
  discoverLlmModels: vi.fn(async () => [
    { id: 'openweight-medium', display_name: 'Openweight Medium' },
    { id: 'openweight-small', display_name: 'Openweight Small' }
  ]),
  discoverEmbeddingModels: vi.fn(async () => [
    { id: 'text-embedding-3-small', display_name: 'Text Embedding 3 Small' },
    { id: 'text-embedding-3-large', display_name: 'Text Embedding 3 Large' }
  ])
}))

vi.mock('./shared/api/appApi', () => ({
  readAboutMetadata: hoisted.readAboutMetadata,
  openAppSupportDir: hoisted.openAppSupportDir,
  openExternalWebUrl: vi.fn(async () => {})
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
  openPathExternal: vi.fn(async () => {}),
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
  updateWikilinksForPathMoves: vi.fn(async () => ({ updated_files: 0, reindexed_files: 0, moved_markdown_files: 0, expanded_markdown_moves: [] })),
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
  readIndexOverviewStats: vi.fn(async () => ({
    semantic_links_count: 0,
    processed_notes_count: 0,
    workspace_notes_count: 0,
    last_run_finished_at_ms: null,
    last_run_title: null,
    last_run_duration_ms: null
  })),
  readIndexLogs: vi.fn(async () => []),
  readPropertyTypeSchema: vi.fn(async () => ({})),
  writePropertyTypeSchema: vi.fn(async () => {}),
  computeEchoesPack: vi.fn(async () => ({ anchorPath: '/Users/test/a.md', generatedAtMs: 1, items: [] }))
}))

vi.mock('./shared/api/settingsApi', () => ({
  readAppSettings: hoisted.readAppSettings,
  writeAppSettings: hoisted.writeAppSettings,
  discoverCodexModels: hoisted.discoverCodexModels,
  discoverLlmModels: hoisted.discoverLlmModels,
  discoverEmbeddingModels: hoisted.discoverEmbeddingModels
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

  it('keeps the settings modal open when clicking outside it', async () => {
    const mounted = mountApp()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="View options"]')?.click()
    await flushUi()
    const settingsBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent?.includes('Open Settings'))
    settingsBtn?.click()
    await flushUi()

    const overlay = mounted.root.querySelector<HTMLElement>('.modal-overlay')
    overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushUi()

    expect(mounted.root.querySelector('[data-modal="settings"]')).toBeTruthy()
    expect(hoisted.writeAppSettings).not.toHaveBeenCalled()
    mounted.app.unmount()
  })

  it('opens about from overflow menu and shows the current version', async () => {
    const mounted = mountApp()
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="View options"]')?.click()
    await flushUi()

    const aboutBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent?.includes('About'))
    aboutBtn?.click()
    await flushUi()

    expect(mounted.root.querySelector('[data-modal="about"]')).toBeTruthy()
    expect(mounted.root.textContent).toContain('Tomosona')
    expect(mounted.root.textContent).toContain(`v${packageJson.version}`)
    expect(mounted.root.textContent).toContain('abc12345')
    expect(mounted.root.textContent).toContain('macOS arm64')
    expect(mounted.root.textContent).toContain('/Users/test/.tomosona')
    expect(mounted.root.textContent).toContain('Open Data Folder')
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

  it('tests custom endpoint models and saves the selected model', async () => {
    const mounted = mountApp()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="View options"]')?.click()
    await flushUi()
    const settingsBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent?.includes('Open Settings'))
    settingsBtn?.click()
    await flushUi()

    const provider = mounted.root.querySelector<HTMLSelectElement>('#settings-llm-provider')
    if (provider) {
      provider.value = 'custom'
      provider.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await flushUi()

    const customProvider = mounted.root.querySelector<HTMLInputElement>('#settings-llm-custom-provider')
    if (customProvider) {
      customProvider.value = ''
      customProvider.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const baseUrl = mounted.root.querySelector<HTMLInputElement>('#settings-llm-base-url')
    if (baseUrl) {
      baseUrl.value = 'https://albert.api.etalab.gouv.fr/v1/'
      baseUrl.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const apiKey = mounted.root.querySelector<HTMLInputElement>('#settings-llm-apikey')
    if (apiKey) {
      apiKey.value = 'albert-key'
      apiKey.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const model = mounted.root.querySelector<HTMLInputElement>('#settings-llm-model')
    if (model) {
      model.value = ''
      model.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushUi()

    const testBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent === 'Test')
    testBtn?.click()
    await flushUi()

    expect(hoisted.discoverLlmModels).toHaveBeenCalledTimes(1)
    const discoverCall = hoisted.discoverLlmModels.mock.calls[0]
    expect(discoverCall).toBeDefined()
    if (!discoverCall) throw new Error('Expected discoverLlmModels to be called')
    const discoverPayload = (discoverCall as unknown[])[0]
    if (!discoverPayload || typeof discoverPayload !== 'object') throw new Error('Expected discover payload object')
    expect((discoverPayload as { provider: string }).provider).toBe('custom')
    expect((discoverPayload as { profile_id: string }).profile_id).toBe('custom-profile')
    expect((discoverPayload as { base_url?: string | null }).base_url).toBe('https://albert.api.etalab.gouv.fr/v1/')
    expect((discoverPayload as { api_key?: string }).api_key).toBe('albert-key')

    const dropdownOptions = Array.from(document.body.querySelectorAll('.ui-filterable-dropdown-option')) as HTMLButtonElement[]
    expect(dropdownOptions.length).toBeGreaterThan(0)
    dropdownOptions[0]?.click()
    await flushUi()

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
          default_temperature: number
          system_prompt: string
          base_url?: string | null
        }>
      }
    }
    expect(payload.llm.profiles[0]?.provider).toBe('custom')
    expect(payload.llm.profiles[0]?.model).toBe('openweight-medium')
    expect(payload.llm.profiles[0]?.default_temperature).toBe(0.15)
    expect(payload.llm.profiles[0]?.system_prompt).toBe('Always answer tersely.')
    expect(payload.llm.profiles[0]?.base_url).toBe('https://albert.api.etalab.gouv.fr/v1/')
    mounted.app.unmount()
  })

  it('surfaces detailed model discovery errors', async () => {
    hoisted.discoverLlmModels.mockRejectedValueOnce({
      message: 'Model discovery failed for https://albert.api.etalab.gouv.fr/v1/models: HTTP 404 Not Found. Response body: {"detail":"Model not found."}'
    })

    const mounted = mountApp()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="View options"]')?.click()
    await flushUi()
    const settingsBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent?.includes('Open Settings'))
    settingsBtn?.click()
    await flushUi()

    const provider = mounted.root.querySelector<HTMLSelectElement>('#settings-llm-provider')
    if (provider) {
      provider.value = 'custom'
      provider.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await flushUi()

    const baseUrl = mounted.root.querySelector<HTMLInputElement>('#settings-llm-base-url')
    if (baseUrl) {
      baseUrl.value = 'https://albert.api.etalab.gouv.fr/v1/'
      baseUrl.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const apiKey = mounted.root.querySelector<HTMLInputElement>('#settings-llm-apikey')
    if (apiKey) {
      apiKey.value = 'albert-key'
      apiKey.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushUi()

    const testBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent === 'Test')
    testBtn?.click()
    await flushUi()

    expect(mounted.root.textContent).toContain('Model discovery failed for https://albert.api.etalab.gouv.fr/v1/models: HTTP 404 Not Found.')
    expect(mounted.root.textContent).toContain('Response body:')
    mounted.app.unmount()
  })

  it('shows api keys as masked values with a reveal toggle', async () => {
    const mounted = mountApp()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="View options"]')?.click()
    await flushUi()
    const settingsBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent?.includes('Open Settings'))
    settingsBtn?.click()
    await flushUi()

    const llmKey = mounted.root.querySelector<HTMLInputElement>('#settings-llm-apikey')
    expect(llmKey?.getAttribute('type')).toBe('password')
    expect(llmKey?.value).toBe('openai-secret')

    const revealLlm = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.getAttribute('aria-label') === 'Reveal API key')
    revealLlm?.click()
    await flushUi()
    expect(mounted.root.querySelector<HTMLInputElement>('#settings-llm-apikey')?.getAttribute('type')).toBe('text')

    const embTab = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent === 'Embeddings')
    embTab?.click()
    await flushUi()
    const externalMode = mounted.root.querySelector<HTMLInputElement>('input[type="radio"][value="external"]')
    externalMode?.click()
    await flushUi()

    const embKey = mounted.root.querySelector<HTMLInputElement>('#settings-emb-apikey')
    expect(embKey?.getAttribute('type')).toBe('password')
    expect(embKey?.value).toBe('')
    expect(embKey?.getAttribute('placeholder')).toBe('api key')
    mounted.app.unmount()
  })

  it('shows stored key markers when api keys already exist', async () => {
    hoisted.readAppSettings.mockResolvedValue({
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
            default_temperature: 0.15,
            system_prompt: '',
            api_key: 'openai-secret',
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
      embeddings: {
        mode: 'external',
        external: {
          id: 'emb-openai-profile',
          label: 'OpenAI Embeddings',
          provider: 'openai',
          model: 'text-embedding-3-small',
          api_key: 'emb-secret',
          base_url: 'https://albert.api.etalab.gouv.fr/v1/'
        }
      },
    })

    const mounted = mountApp()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="View options"]')?.click()
    await flushUi()
    const settingsBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent?.includes('Open Settings'))
    settingsBtn?.click()
    await flushUi()

    const llmKey = mounted.root.querySelector<HTMLInputElement>('#settings-llm-apikey')
    expect(llmKey?.value).toBe('openai-secret')

    const embTab = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent === 'Embeddings')
    embTab?.click()
    await flushUi()

    const externalMode = mounted.root.querySelector<HTMLInputElement>('input[type="radio"][value="external"]')
    externalMode?.click()
    await flushUi()

    const embKey = mounted.root.querySelector<HTMLInputElement>('#settings-emb-apikey')
    expect(embKey?.value).toBe('emb-secret')
    mounted.app.unmount()
  })

  it('tests external embeddings models and saves the selected embedding model', async () => {
    const mounted = mountApp()
    await flushUi()
    mounted.root.querySelector<HTMLButtonElement>('button[aria-label="View options"]')?.click()
    await flushUi()
    const settingsBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent?.includes('Open Settings'))
    settingsBtn?.click()
    await flushUi()

    const embTab = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent === 'Embeddings')
    embTab?.click()
    await flushUi()

    const externalMode = mounted.root.querySelector<HTMLInputElement>('input[type="radio"][value="external"]')
    externalMode?.click()
    await flushUi()

    const embBaseUrl = mounted.root.querySelector<HTMLInputElement>('#settings-emb-base-url')
    if (embBaseUrl) {
      embBaseUrl.value = 'https://albert.api.etalab.gouv.fr/v1/'
      embBaseUrl.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const embKey = mounted.root.querySelector<HTMLInputElement>('#settings-emb-apikey')
    if (embKey) {
      embKey.value = 'emb-key'
      embKey.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const embModel = mounted.root.querySelector<HTMLInputElement>('#settings-emb-model')
    if (embModel) {
      embModel.value = ''
      embModel.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushUi()

    const testBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent === 'Test')
    testBtn?.click()
    await flushUi()

    expect(hoisted.discoverEmbeddingModels).toHaveBeenCalledTimes(1)
    const call = hoisted.discoverEmbeddingModels.mock.calls[0]
    expect(call).toBeDefined()
    if (!call) throw new Error('Expected discoverEmbeddingModels to be called')
    const rawPayload = (call as unknown[])[0]
    if (!rawPayload || typeof rawPayload !== 'object') throw new Error('Expected embedding discovery payload object')
    const payload = rawPayload as {
      profile_id: string
      api_key?: string
      base_url?: string | null
    }
    expect(payload.profile_id).toBe('emb-openai-profile')
    expect(payload.api_key).toBe('emb-key')
    expect(payload.base_url).toBe('https://albert.api.etalab.gouv.fr/v1/')

    const dropdownOptions = Array.from(document.body.querySelectorAll('.ui-filterable-dropdown-option')) as HTMLButtonElement[]
    expect(dropdownOptions.length).toBeGreaterThan(0)
    dropdownOptions[1]?.click()
    await flushUi()

    const saveBtn = Array.from(mounted.root.querySelectorAll('button')).find((item) => item.textContent === 'Save')
    saveBtn?.click()
    await flushUi()

    const firstCall = hoisted.writeAppSettings.mock.calls[hoisted.writeAppSettings.mock.calls.length - 1]
    expect(firstCall).toBeDefined()
    if (!firstCall) throw new Error('Expected writeAppSettings to be called')
    const savePayload = (firstCall as unknown[])[0]
    if (!savePayload || typeof savePayload !== 'object') throw new Error('Expected save payload object')
    const typed = savePayload as {
      embeddings: {
        mode: string
        external?: {
          model: string
        }
      }
    }
    expect(typed.embeddings.mode).toBe('external')
    expect(typed.embeddings.external?.model).toBe('text-embedding-3-large')
    mounted.app.unmount()
  })
})
