import { ref } from 'vue'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useAlterExploration } from './useAlterExploration'
import type { AlterExplorationSession, AlterExplorationSessionSummary } from '../../../shared/api/apiTypes'

const api = vi.hoisted(() => ({
  fetchAlterExplorationSessions: vi.fn(),
  loadWorkspaceAlterExplorationSession: vi.fn(),
  createWorkspaceAlterExplorationSession: vi.fn(),
  runWorkspaceAlterExplorationSession: vi.fn(),
  cancelWorkspaceAlterExplorationSession: vi.fn()
}))

vi.mock('../lib/alterExplorationApi', () => api)

function sampleSession(id = 'session-1'): AlterExplorationSession {
  return {
    id,
    workspace_id: 'workspace',
    subject: {
      subject_type: 'prompt',
      text: 'Should we add runtime blocks?',
      source_id: null
    },
    alter_ids: ['alter-a', 'alter-b'],
    mode: 'challenge',
    rounds: 2,
    output_format: 'summary',
    state: 'completed',
    round_results: [],
    final_synthesis: 'Synthesis',
    error_message: null,
    created_at_ms: 1,
    updated_at_ms: 2,
    alters: []
  }
}

function sampleSummary(id = 'session-1'): AlterExplorationSessionSummary {
  return {
    id,
    workspace_path: '/vault',
    subject_preview: 'Should we add runtime blocks?',
    alter_count: 2,
    mode: 'challenge',
    rounds: 2,
    output_format: 'summary',
    state: 'completed',
    cancel_requested: false,
    created_at_ms: 1,
    updated_at_ms: 2
  }
}

describe('useAlterExploration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selects up to three defaults when available', () => {
    const controller = useAlterExploration()
    controller.setDefaultAlters([
      { id: 'a', name: 'A', slug: 'a', description: '', icon: null, color: null, category: null, mission: '', is_favorite: false, is_built_in: false, revision_count: 0, updated_at_ms: 1 },
      { id: 'b', name: 'B', slug: 'b', description: '', icon: null, color: null, category: null, mission: '', is_favorite: false, is_built_in: false, revision_count: 0, updated_at_ms: 1 },
      { id: 'c', name: 'C', slug: 'c', description: '', icon: null, color: null, category: null, mission: '', is_favorite: false, is_built_in: false, revision_count: 0, updated_at_ms: 1 },
      { id: 'd', name: 'D', slug: 'd', description: '', icon: null, color: null, category: null, mission: '', is_favorite: false, is_built_in: false, revision_count: 0, updated_at_ms: 1 }
    ])

    expect(controller.selectedAlterIds.value.length).toBe(3)
  })

  it('blocks selection beyond the max', () => {
    const controller = useAlterExploration()
    controller.toggleAlter('a')
    controller.toggleAlter('b')
    controller.toggleAlter('c')
    controller.toggleAlter('d')
    controller.toggleAlter('e')

    expect(controller.selectedAlterIds.value).toHaveLength(4)
    expect(controller.error.value).toContain('Select up to')
  })

  it('creates and runs a session when valid', async () => {
    api.createWorkspaceAlterExplorationSession.mockResolvedValue(sampleSession('session-1'))
    api.runWorkspaceAlterExplorationSession.mockResolvedValue(sampleSession('session-1'))
    api.fetchAlterExplorationSessions.mockResolvedValue([sampleSummary('session-1')])

    const controller = useAlterExploration()
    controller.subjectText.value = 'Test subject'
    controller.toggleAlter('alter-a')
    controller.toggleAlter('alter-b')

    const ok = await controller.startSession()
    expect(ok).toBe(true)
    expect(api.createWorkspaceAlterExplorationSession).toHaveBeenCalled()
    expect(api.runWorkspaceAlterExplorationSession).toHaveBeenCalled()
    expect(controller.activeSession.value?.id).toBe('session-1')
  })

  it('captures selected prompt context chips in the session payload', async () => {
    api.createWorkspaceAlterExplorationSession.mockResolvedValue(sampleSession('session-1'))
    api.runWorkspaceAlterExplorationSession.mockResolvedValue(sampleSession('session-1'))
    api.fetchAlterExplorationSessions.mockResolvedValue([sampleSummary('session-1')])

    const controller = useAlterExploration({
      workspacePath: ref('/vault'),
      allWorkspaceFiles: ref(['/vault/notes/context.md']),
      availableAlters: ref([
        { id: 'alter-a', name: 'A', slug: 'a', description: '', icon: null, color: null, category: null, mission: '', is_favorite: false, is_built_in: false, revision_count: 0, updated_at_ms: 1 },
        { id: 'alter-b', name: 'B', slug: 'b', description: '', icon: null, color: null, category: null, mission: '', is_favorite: false, is_built_in: false, revision_count: 0, updated_at_ms: 1 }
      ])
    })

    controller.subjectText.value = 'Investigate runtime notes'
    controller.addPromptContextPath('/vault/notes/context.md')
    controller.toggleAlter('alter-a')
    controller.toggleAlter('alter-b')

    const ok = await controller.startSession()
    expect(ok).toBe(true)
    expect(api.createWorkspaceAlterExplorationSession).toHaveBeenCalledWith(expect.objectContaining({
      subject: expect.objectContaining({
        text: 'Investigate runtime notes',
        source_id: '/vault/notes/context.md'
      })
    }))
  })

  it('loads sessions list on refresh', async () => {
    api.fetchAlterExplorationSessions.mockResolvedValue([sampleSummary('session-2')])
    const controller = useAlterExploration()
    await controller.refreshSessions()
    expect(controller.sessions.value).toHaveLength(1)
    expect(controller.sessions.value[0]?.id).toBe('session-2')
  })
})
