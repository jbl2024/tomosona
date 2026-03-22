import { describe, expect, it } from 'vitest'
import type { LoadedSession } from './useSecondBrainSessions'
import {
  buildContextItems,
  createAssistantPlaceholderMessage,
  createLoadedSecondBrainState,
  createOptimisticUserMessage,
  rebalanceContextItemEstimates,
  resolveSecondBrainMessageContent
} from './secondBrainStateModel'

describe('secondBrainStateModel', () => {
  const loadedSession = {
    payload: {
      session_id: 'session-1',
      title: 'Draft',
      provider: 'openai',
      model: 'gpt-5.2',
      context_items: [
        { path: 'notes/a.md', token_estimate: 10 },
        { path: 'notes/b.md', token_estimate: 20 }
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
    },
    citationsByMessageId: { 'assistant-1': ['notes/a.md'] }
  } satisfies LoadedSession

  it('creates loaded state snapshots', () => {
    expect(createLoadedSecondBrainState(loadedSession)).toEqual({
      activeSessionId: 'session-1',
      activeSessionTitle: 'Draft',
      activeProvider: 'openai',
      activeModel: 'gpt-5.2',
      contextItems: loadedSession.payload.context_items,
      messages: loadedSession.payload.messages,
      citationsByMessageId: loadedSession.citationsByMessageId,
      draftContent: 'draft body'
    })
  })

  it('builds and rebalances context items deterministically', () => {
    const items = buildContextItems(['notes/a.md', 'notes/b.md'])
    expect(items).toEqual([
      { path: 'notes/a.md', token_estimate: 0 },
      { path: 'notes/b.md', token_estimate: 0 }
    ])
    expect(rebalanceContextItemEstimates(items, 7)).toEqual([
      { path: 'notes/a.md', token_estimate: 4 },
      { path: 'notes/b.md', token_estimate: 4 }
    ])
    expect(rebalanceContextItemEstimates([], 7)).toEqual([])
  })

  it('creates optimistic messages and resolves assistant content from streams', () => {
    const optimistic = createOptimisticUserMessage('diagnostic', 'Check this', 42)
    expect(optimistic).toMatchObject({
      id: 'tmp-user-42',
      role: 'user',
      mode: 'diagnostic',
      content_md: 'Check this'
    })

    const assistant = createAssistantPlaceholderMessage(
      'diagnostic',
      'assistant-42',
      [{ path: 'notes/a.md', token_estimate: 1 }],
      99
    )
    expect(assistant).toMatchObject({
      id: 'assistant-42',
      role: 'assistant',
      mode: 'diagnostic',
      citations_json: '["notes/a.md"]'
    })
    expect(
      resolveSecondBrainMessageContent(assistant, (message) => `stream:${message.id}`)
    ).toBe('stream:assistant-42')
    expect(
      resolveSecondBrainMessageContent(optimistic, (message) => `stream:${message.id}`)
    ).toBe('Check this')
  })
})
