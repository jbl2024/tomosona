/**
 * Session list/load helpers for the Second Brain domain.
 *
 * This composable keeps the low-level fetch/create/update calls grouped so the
 * higher-level view workflows can stay focused on UI intent and state mapping.
 */
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
} from '../../../shared/api/apiTypes'

export type LoadedSession = {
  payload: SecondBrainSessionPayload
  citationsByMessageId: Record<string, string[]>
}

/**
 * Wraps the backend session APIs needed by the Second Brain UI.
 *
 * The caller injects a citation parser so this module stays transport-focused
 * and does not own any rendering or markdown assumptions.
 */
export function useSecondBrainSessions(deps: {
  parseCitations: (message: SecondBrainMessage) => string[]
}) {
  const loadingSessions = ref(false)
  const sessions = ref<SecondBrainSessionSummary[]>([])
  const sessionError = ref('')

  /**
   * Refreshes the session list shown in the dropdown and session panels.
   *
   * Failures are downgraded to an empty list so the UI can still mount and
   * show a recoverable error state instead of crashing the whole view.
   */
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

  /**
   * Creates a new persisted session and returns its id.
   */
  async function createSession(contextPaths: string[], title = '') {
    const created = await createDeliberationSession({ contextPaths, title })
    return created.sessionId
  }

  /**
   * Loads a persisted session and precomputes message citations.
   */
  async function loadSession(sessionId: string): Promise<LoadedSession> {
    const payload = await loadDeliberationSession(sessionId)
    const citationsByMessageId: Record<string, string[]> = {}
    for (const message of payload.messages) {
      citationsByMessageId[message.id] = deps.parseCitations(message)
    }
    return { payload, citationsByMessageId }
  }

  /**
   * Persists the active context list for a session.
   */
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
