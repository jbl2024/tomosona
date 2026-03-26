import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AlterExplorationPanel from './AlterExplorationPanel.vue'

vi.mock('../../../shared/components/workspace/WorkspaceSessionDropdown.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'WorkspaceSessionDropdownStub',
      props: {
        sessions: {
          type: Array,
          default: () => []
        },
        loading: {
          type: Boolean,
          default: false
        }
      },
      emits: ['select'],
      setup(props, { emit }) {
        return () =>
          h(
            'button',
            {
              type: 'button',
              class: 'sb-session-gear-btn',
              disabled: props.loading,
              onClick: () => emit('select', 'session-markdown')
            },
            'Sessions'
          )
      }
    })
  }
})

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
    const loadedSession = {
      id: 'session-1',
      workspace_id: 'workspace',
      subject: { subject_type: 'prompt', text: 'Prompt', source_id: null },
      alter_ids: ['alter-a', 'alter-b'],
      mode: 'challenge',
      rounds: 2,
      output_format: 'summary',
      state: 'completed',
      round_results: [
        {
          round_number: 1,
          alter_id: 'alter-a',
          alter_name: 'Sober Architect',
          content: '## Round 1\n\n- Item A\n- Item B',
          references_alter_ids: ['alter-b']
        }
      ],
      final_synthesis: '### Synthesis\n\n| Point | Value |\n| --- | --- |\n| One | Two |',
      error_message: null,
      created_at_ms: 1,
      updated_at_ms: 1
    }
    alterExplorationApi.fetchAlterExplorationSessions.mockResolvedValue([])
    alterExplorationApi.createWorkspaceAlterExplorationSession.mockResolvedValue({
      ...loadedSession,
      state: 'draft',
      final_synthesis: null
    })
    alterExplorationApi.runWorkspaceAlterExplorationSession.mockResolvedValue(loadedSession)
    alterExplorationApi.loadWorkspaceAlterExplorationSession.mockResolvedValue(loadedSession)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the exploration setup and timeline', async () => {
    const mounted = mountPanel()
    await nextTick()

    expect(mounted.root.textContent).toContain('Alter Exploration')
    expect(mounted.root.querySelector('label[for="alter-exploration-subject"]')).toBeFalsy()
    expect(mounted.root.textContent).not.toContain('Type `@` to add workspace notes')
    expect(mounted.root.textContent).toContain('Reader')
    expect(mounted.root.textContent).toContain('Setup')
    expect(mounted.root.textContent).not.toContain('Subject source')
    expect(mounted.root.querySelector('.send-icon-btn')).toBeTruthy()
    expect(mounted.root.querySelector('.sb-session-gear-btn')).toBeTruthy()
    expect(mounted.root.querySelector('.alter-exploration__reader-nav')).toBeFalsy()

    const panelState = (mounted.app as any)._instance?.subTree.component?.setupState
    await panelState.showSession('session-markdown')
    await nextTick()
    await nextTick()

    expect(mounted.root.textContent).toContain('Round 1')
    expect(mounted.root.textContent).toContain('Synthesis')
    expect(mounted.root.textContent).toContain('Show setup')
    expect(mounted.root.querySelector('.alter-exploration__reader-nav')).toBeTruthy()
    expect(mounted.root.querySelector('.alter-exploration__markdown table')).toBeTruthy()

    mounted.root.querySelector<HTMLButtonElement>('.alter-exploration__reader-nav-btn')?.click()
    await nextTick()

    expect(mounted.root.querySelector('.alter-exploration__response-card')).toBeTruthy()
    expect(mounted.root.textContent).toContain('Sober Architect')

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
