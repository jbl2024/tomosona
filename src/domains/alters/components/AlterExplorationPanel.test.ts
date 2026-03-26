import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AlterExplorationPanel from './AlterExplorationPanel.vue'

const alterExplorationApi = vi.hoisted(() => ({
  cancelWorkspaceAlterExplorationSession: vi.fn(),
  createWorkspaceAlterExplorationSession: vi.fn(),
  fetchAlterExplorationSessions: vi.fn(),
  loadWorkspaceAlterExplorationSession: vi.fn(),
  runWorkspaceAlterExplorationSession: vi.fn()
}))

vi.mock('../lib/alterExplorationApi', () => alterExplorationApi)

const echoesApi = vi.hoisted(() => ({
  computeEchoesPack: vi.fn(async () => ({
    anchorPath: '/vault/notes/context.md',
    generatedAtMs: 1,
    items: []
  }))
}))

vi.mock('../../../shared/api/indexApi', async () => {
  const actual = await vi.importActual<typeof import('../../../shared/api/indexApi')>('../../../shared/api/indexApi')
  return {
    ...actual,
    computeEchoesPack: echoesApi.computeEchoesPack
  }
})

function mountPanel() {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const app = createApp(defineComponent({
    setup() {
      return () => h(AlterExplorationPanel, {
        workspacePath: '/vault',
        allWorkspaceFiles: ['/vault/notes/context.md'],
        activeNotePath: '',
        availableAlters: [
          {
            id: 'alter-a',
            name: 'Sober Architect',
            slug: 'sober-architect',
            description: 'Tests structure.',
            icon: null,
            color: null,
            category: 'Strategy',
            mission: 'Stress test designs.',
            is_favorite: false,
            is_built_in: false,
            revision_count: 0,
            updated_at_ms: 1
          },
          {
            id: 'alter-b',
            name: 'Pragmatic Builder',
            slug: 'pragmatic-builder',
            description: 'Optimizes delivery.',
            icon: null,
            color: null,
            category: 'Execution',
            mission: 'Ship reliable plans.',
            is_favorite: false,
            is_built_in: false,
            revision_count: 0,
            updated_at_ms: 1
          }
        ]
      })
    }
  }))

  app.mount(root)
  return { app, root }
}

describe('AlterExplorationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    alterExplorationApi.fetchAlterExplorationSessions.mockResolvedValue([])
    alterExplorationApi.createWorkspaceAlterExplorationSession.mockResolvedValue({
      id: 'session-1',
      workspace_id: 'workspace',
      subject: { subject_type: 'prompt', text: 'Prompt', source_id: null },
      alter_ids: [],
      mode: 'challenge',
      rounds: 2,
      output_format: 'summary',
      state: 'draft',
      round_results: [],
      final_synthesis: null,
      error_message: null,
      created_at_ms: 1,
      updated_at_ms: 1
    })
    alterExplorationApi.runWorkspaceAlterExplorationSession.mockResolvedValue({
      id: 'session-1',
      workspace_id: 'workspace',
      subject: { subject_type: 'prompt', text: 'Prompt', source_id: null },
      alter_ids: [],
      mode: 'challenge',
      rounds: 2,
      output_format: 'summary',
      state: 'completed',
      round_results: [],
      final_synthesis: 'Synthesis',
      error_message: null,
      created_at_ms: 1,
      updated_at_ms: 1
    })
    alterExplorationApi.loadWorkspaceAlterExplorationSession.mockResolvedValue({
      id: 'session-1',
      workspace_id: 'workspace',
      subject: { subject_type: 'prompt', text: 'Prompt', source_id: null },
      alter_ids: [],
      mode: 'challenge',
      rounds: 2,
      output_format: 'summary',
      state: 'completed',
      round_results: [],
      final_synthesis: 'Synthesis',
      error_message: null,
      created_at_ms: 1,
      updated_at_ms: 1
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the exploration setup and timeline', async () => {
    const mounted = mountPanel()
    await nextTick()

    expect(mounted.root.textContent).toContain('Alter Exploration')
    expect(mounted.root.textContent).toContain('Prompt composer')
    expect(mounted.root.textContent).toContain('Sessions')
    expect(mounted.root.textContent).toContain('Start exploration')
    expect(mounted.root.textContent).toContain('Round-by-round output')
    expect(mounted.root.textContent).not.toContain('Subject source')

    mounted.app.unmount()
  })

  it('adds selected mention notes as prompt chips', async () => {
    const mounted = mountPanel()
    await nextTick()

    const textarea = mounted.root.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.getAttribute('rows')).toBe('1')
    expect(mounted.root.querySelector('.alter-exploration__echoes')).toBeFalsy()
    textarea.value = 'Investigate @no'
    textarea.dispatchEvent(new Event('input'))
    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'o' }))

    await nextTick()

    const suggestion = mounted.root.querySelector<HTMLButtonElement>('.sb-at-item')
    expect(suggestion).toBeTruthy()
    suggestion?.click()
    await nextTick()

    expect(mounted.root.textContent).toContain('context.md')
    expect(mounted.root.textContent).toContain('Open')
    expect(mounted.root.querySelector('.workspace-context-chip')).toBeTruthy()
    expect(mounted.root.querySelector('.alter-exploration__echoes')).toBeFalsy()

    mounted.root.querySelector<HTMLButtonElement>('.workspace-context-chip__main')?.click()
    await nextTick()

    expect(mounted.root.querySelector('.alter-exploration__echoes')).toBeTruthy()

    mounted.app.unmount()
  })
})
