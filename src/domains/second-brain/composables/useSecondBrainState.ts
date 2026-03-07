import { computed, ref } from 'vue'
import type {
  SecondBrainConfigStatus,
  SecondBrainContextItem,
  SecondBrainMessage,
  SecondBrainSessionSummary
} from '../../../shared/api/apiTypes'
import { fetchSecondBrainConfigStatus, parseMessageCitations } from '../lib/secondBrainApi'
import { SECOND_BRAIN_MODES } from '../lib/secondBrainModes'
import { useSecondBrainDeliberation } from './useSecondBrainDeliberation'
import { useSecondBrainDraft } from './useSecondBrainDraft'
import { useSecondBrainSessions } from './useSecondBrainSessions'

export function useSecondBrainState() {
  const configStatus = ref<SecondBrainConfigStatus | null>(null)
  const configLoading = ref(false)
  const configError = ref('')

  const activeSessionId = ref('')
  const activeSessionTitle = ref('')
  const activeProvider = ref('')
  const activeModel = ref('')
  const contextItems = ref<SecondBrainContextItem[]>([])
  const messages = ref<SecondBrainMessage[]>([])
  const citationsByMessageId = ref<Record<string, string[]>>({})
  const selectedMode = ref('freestyle')
  const inputMessage = ref('')

  const sessions = useSecondBrainSessions({ parseCitations: parseMessageCitations })
  const deliberation = useSecondBrainDeliberation()
  const draft = useSecondBrainDraft()

  const tokenEstimate = computed(() => contextItems.value.reduce((acc, item) => acc + item.token_estimate, 0))

  const activeSessionSummary = computed<SecondBrainSessionSummary | null>(() =>
    sessions.sessions.value.find((item) => item.session_id === activeSessionId.value) ?? null
  )

  async function refreshConfigStatus() {
    configLoading.value = true
    configError.value = ''
    try {
      configStatus.value = await fetchSecondBrainConfigStatus()
    } catch (err) {
      configStatus.value = null
      configError.value = err instanceof Error ? err.message : 'Could not load Second Brain config.'
    } finally {
      configLoading.value = false
    }
  }

  async function refreshSessionList() {
    await sessions.refreshSessions()
  }

  async function createSessionFromPaths(paths: string[], title = '') {
    const sessionId = await sessions.createSession(paths, title)
    await loadSession(sessionId)
    await refreshSessionList()
    return sessionId
  }

  async function loadSession(sessionId: string) {
    const loaded = await sessions.loadSession(sessionId)
    activeSessionId.value = loaded.payload.session_id
    activeSessionTitle.value = loaded.payload.title
    activeProvider.value = loaded.payload.provider
    activeModel.value = loaded.payload.model
    contextItems.value = loaded.payload.context_items
    messages.value = loaded.payload.messages
    citationsByMessageId.value = loaded.citationsByMessageId
    draft.draftContent.value = loaded.payload.draft_content
  }

  async function replaceContext(paths: string[]) {
    if (!activeSessionId.value) return
    const nextItems = paths.map((path) => ({ path, token_estimate: 0 }))
    const newEstimate = await sessions.updateContext(activeSessionId.value, nextItems)
    contextItems.value = nextItems
    if (contextItems.value.length > 0) {
      const average = Math.max(1, Math.round(newEstimate / contextItems.value.length))
      contextItems.value = contextItems.value.map((item) => ({ ...item, token_estimate: average }))
    }
  }

  async function sendCurrentMessage() {
    const sessionId = activeSessionId.value
    const message = inputMessage.value.trim()
    if (!sessionId || !message) return

    const localUserMessage: SecondBrainMessage = {
      id: `tmp-user-${Date.now()}`,
      role: 'user',
      mode: selectedMode.value,
      content_md: message,
      citations_json: '[]',
      attachments_json: '[]',
      created_at_ms: Date.now()
    }
    messages.value = [...messages.value, localUserMessage]
    inputMessage.value = ''

    const response = await deliberation.sendMessage({
      sessionId,
      mode: selectedMode.value,
      message
    })

    const assistantPlaceholder: SecondBrainMessage = {
      id: response.assistantMessageId,
      role: 'assistant',
      mode: selectedMode.value,
      content_md: '',
      citations_json: JSON.stringify(contextItems.value.map((item) => item.path)),
      attachments_json: '[]',
      created_at_ms: Date.now()
    }
    messages.value = [...messages.value, assistantPlaceholder]
  }

  function getMessageContent(message: SecondBrainMessage): string {
    if (message.role === 'assistant') {
      return deliberation.resolveAssistantMessage(message)
    }
    return message.content_md
  }

  return {
    modes: SECOND_BRAIN_MODES,
    configStatus,
    configLoading,
    configError,
    activeSessionId,
    activeSessionTitle,
    activeProvider,
    activeModel,
    contextItems,
    messages,
    citationsByMessageId,
    selectedMode,
    inputMessage,
    tokenEstimate,
    activeSessionSummary,
    sessions,
    deliberation,
    draft,
    refreshConfigStatus,
    refreshSessionList,
    createSessionFromPaths,
    loadSession,
    replaceContext,
    sendCurrentMessage,
    getMessageContent
  }
}
