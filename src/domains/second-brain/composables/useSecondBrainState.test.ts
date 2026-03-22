import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { SecondBrainMessage, SecondBrainSessionPayload, SecondBrainSessionSummary } from '../../../shared/api/apiTypes'
import { useSecondBrainState } from './useSecondBrainState'

const stateMocks = vi.hoisted(() => ({
  fetchConfigStatus: vi.fn(),
  sessions: {
    loadingSessions: { value: false },
    sessions: { value: [] as SecondBrainSessionSummary[] },
    sessionError: { value: '' },
    refreshSessions: vi.fn(),
    createSession: vi.fn(),
    loadSession: vi.fn(),
    updateContext: vi.fn()
  },
  deliberation: {
    sending: { value: false },
    sendError: { value: '' },
    streamTextByMessageId: { value: {} as Record<string, string> },
    activeStreamingMessageIds: { value: [] as string[] },
    bindStreamEvents: vi.fn(),
    sendMessage: vi.fn(),
    resolveAssistantMessage: vi.fn()
  },
  draft: {
    draftContent: { value: '' },
    draftSaving: { value: false },
    draftError: { value: '' }
  }
}))

vi.mock('../lib/secondBrainApi', () => ({
  fetchSecondBrainConfigStatus: stateMocks.fetchConfigStatus,
  parseMessageCitations: vi.fn()
}))

vi.mock('./useSecondBrainSessions', () => ({
  useSecondBrainSessions: () => stateMocks.sessions
}))

vi.mock('./useSecondBrainDeliberation', () => ({
  useSecondBrainDeliberation: () => stateMocks.deliberation
}))

vi.mock('./useSecondBrainDraft', () => ({
  useSecondBrainDraft: () => stateMocks.draft
}))

describe('useSecondBrainState', () => {
  beforeEach(() => {
    stateMocks.fetchConfigStatus.mockReset()
    stateMocks.sessions.refreshSessions.mockReset()
    stateMocks.sessions.createSession.mockReset()
    stateMocks.sessions.loadSession.mockReset()
    stateMocks.sessions.updateContext.mockReset()
    stateMocks.deliberation.sendMessage.mockReset()
    stateMocks.deliberation.resolveAssistantMessage.mockReset()
    stateMocks.sessions.sessions.value = []
    stateMocks.sessions.sessionError.value = ''
    stateMocks.draft.draftContent.value = ''
    stateMocks.deliberation.streamTextByMessageId.value = {}
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refreshes config, session list, and local state from loaded sessions', async () => {
    stateMocks.fetchConfigStatus.mockResolvedValueOnce({ enabled: true } as never)
    stateMocks.sessions.createSession.mockResolvedValueOnce('session-1')
    stateMocks.sessions.loadSession.mockResolvedValueOnce({
      payload: {
        session_id: 'session-1',
        title: 'Draft',
        provider: 'openai',
        model: 'gpt-5.2',
        context_items: [
          { path: 'notes/a.md', token_estimate: 4 },
          { path: 'notes/b.md', token_estimate: 6 }
        ],
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            mode: 'freestyle',
            content_md: 'fallback',
            citations_json: '[]',
            attachments_json: '[]',
            created_at_ms: 1
          }
        ],
        draft_content: 'draft body'
      } satisfies SecondBrainSessionPayload,
      citationsByMessageId: { 'assistant-1': ['notes/a.md'] }
    })

    stateMocks.sessions.sessions.value = [{ session_id: 'session-1', title: 'Draft' } as SecondBrainSessionSummary]

    const state = useSecondBrainState()

    await state.refreshConfigStatus()
    expect(state.configStatus.value).toEqual({ enabled: true })
    expect(state.configError.value).toBe('')
    expect(state.configLoading.value).toBe(false)

    stateMocks.fetchConfigStatus.mockRejectedValueOnce(new Error('config failed'))
    await state.refreshConfigStatus()
    expect(state.configStatus.value).toBeNull()
    expect(state.configError.value).toBe('config failed')

    const sessionId = await state.createSessionFromPaths(['notes/a.md', 'notes/b.md'], 'Draft')
    expect(sessionId).toBe('session-1')
    expect(stateMocks.sessions.createSession).toHaveBeenCalledWith(['notes/a.md', 'notes/b.md'], 'Draft')
    expect(stateMocks.sessions.loadSession).toHaveBeenCalledWith('session-1')
    expect(stateMocks.sessions.refreshSessions).toHaveBeenCalledTimes(1)
    expect(state.activeSessionId.value).toBe('session-1')
    expect(state.activeSessionTitle.value).toBe('Draft')
    expect(state.activeProvider.value).toBe('openai')
    expect(state.activeModel.value).toBe('gpt-5.2')
    expect(state.contextItems.value).toEqual([
      { path: 'notes/a.md', token_estimate: 4 },
      { path: 'notes/b.md', token_estimate: 6 }
    ])
    expect(state.messages.value).toHaveLength(1)
    expect(state.citationsByMessageId.value).toEqual({ 'assistant-1': ['notes/a.md'] })
    expect(state.draft.draftContent.value).toBe('draft body')
    expect(state.activeSessionSummary.value).toEqual({ session_id: 'session-1', title: 'Draft' })
  })

  it('replaces context, sends messages, and resolves assistant content', async () => {
    const state = useSecondBrainState()
    state.activeSessionId.value = 'session-1'
    state.selectedMode.value = 'diagnostic'
    state.contextItems.value = [
      { path: 'notes/a.md', token_estimate: 2 },
      { path: 'notes/b.md', token_estimate: 3 }
    ]

    await state.replaceContext([])
    expect(stateMocks.sessions.updateContext).toHaveBeenCalledTimes(1)
    expect(state.contextItems.value).toEqual([])

    stateMocks.sessions.updateContext.mockResolvedValueOnce(9)
    await state.replaceContext(['notes/a.md', 'notes/b.md'])
    expect(stateMocks.sessions.updateContext).toHaveBeenCalledWith('session-1', [
      { path: 'notes/a.md', token_estimate: 0 },
      { path: 'notes/b.md', token_estimate: 0 }
    ])
    expect(state.contextItems.value).toEqual([
      { path: 'notes/a.md', token_estimate: 5 },
      { path: 'notes/b.md', token_estimate: 5 }
    ])

    state.inputMessage.value = '   '
    await state.sendCurrentMessage()
    expect(stateMocks.deliberation.sendMessage).not.toHaveBeenCalled()

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockImplementationOnce(() => 100).mockImplementationOnce(() => 200)
    state.inputMessage.value = ' Hello world '
    stateMocks.deliberation.sendMessage.mockResolvedValueOnce({
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1'
    })

    await state.sendCurrentMessage()
    expect(state.inputMessage.value).toBe('')
    expect(stateMocks.deliberation.sendMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      mode: 'diagnostic',
      message: 'Hello world'
    })
    expect(state.messages.value).toEqual([
      {
        id: 'tmp-user-100',
        role: 'user',
        mode: 'diagnostic',
        content_md: 'Hello world',
        citations_json: '[]',
        attachments_json: '[]',
        created_at_ms: 100
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        mode: 'diagnostic',
        content_md: '',
        citations_json: '["notes/a.md","notes/b.md"]',
        attachments_json: '[]',
        created_at_ms: 200
      }
    ])

    stateMocks.deliberation.resolveAssistantMessage.mockReturnValueOnce('streamed answer')
    const assistantMessage = state.messages.value[1] as SecondBrainMessage
    const userMessage = state.messages.value[0] as SecondBrainMessage
    expect(state.getMessageContent(assistantMessage)).toBe('streamed answer')
    expect(state.getMessageContent(userMessage)).toBe('Hello world')
    expect(stateMocks.deliberation.resolveAssistantMessage).toHaveBeenCalledTimes(1)
  })
})
