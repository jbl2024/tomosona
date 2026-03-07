import { ref } from 'vue'
import {
  createDeliberationSession,
  fetchSecondBrainSessions,
  loadDeliberationSession,
  replaceSessionContext
} from '../lib/secondBrainApi'
import type {
  SecondBrainContextItem,
  SecondBrainMessage,
  SecondBrainSessionPayload,
  SecondBrainSessionSummary
} from '../lib/apiTypes'

export type LoadedSession = {
  payload: SecondBrainSessionPayload
  citationsByMessageId: Record<string, string[]>
}

export function useSecondBrainSessions(deps: {
  parseCitations: (message: SecondBrainMessage) => string[]
}) {
  const loadingSessions = ref(false)
  const sessions = ref<SecondBrainSessionSummary[]>([])
  const sessionError = ref('')

  async function refreshSessions(limit = 80) {
    loadingSessions.value = true
    sessionError.value = ''
    try {
      sessions.value = await fetchSecondBrainSessions(limit)
    } catch (err) {
      sessionError.value = err instanceof Error ? err.message : 'Could not list sessions.'
      sessions.value = []
    } finally {
      loadingSessions.value = false
    }
  }

  async function createSession(contextPaths: string[], title = '') {
    const created = await createDeliberationSession({ contextPaths, title })
    return created.sessionId
  }

  async function loadSession(sessionId: string): Promise<LoadedSession> {
    const payload = await loadDeliberationSession(sessionId)
    const citationsByMessageId: Record<string, string[]> = {}
    for (const message of payload.messages) {
      citationsByMessageId[message.id] = deps.parseCitations(message)
    }
    return { payload, citationsByMessageId }
  }

  async function updateContext(sessionId: string, contextItems: SecondBrainContextItem[]) {
    return await replaceSessionContext(
      sessionId,
      contextItems.map((item) => item.path)
    )
  }

  return {
    loadingSessions,
    sessions,
    sessionError,
    refreshSessions,
    createSession,
    loadSession,
    updateContext
  }
}
