import { computed, ref } from 'vue'
import type {
  SecondBrainConfigStatus,
  SecondBrainContextItem,
  SecondBrainMessage,
  SecondBrainSessionSummary
} from '../../../shared/api/apiTypes'
import { fetchSecondBrainConfigStatus, parseMessageCitations } from '../lib/secondBrainApi'
import { SECOND_BRAIN_MODES } from '../lib/secondBrainModes'
import {
  buildContextItems,
  createAssistantPlaceholderMessage,
  createLoadedSecondBrainState,
  createOptimisticUserMessage,
  rebalanceContextItemEstimates,
  resolveSecondBrainMessageContent
} from './secondBrainStateModel'
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
    const snapshot = createLoadedSecondBrainState(loaded)
    activeSessionId.value = snapshot.activeSessionId
    activeSessionTitle.value = snapshot.activeSessionTitle
    activeProvider.value = snapshot.activeProvider
    activeModel.value = snapshot.activeModel
    contextItems.value = snapshot.contextItems
    messages.value = snapshot.messages
    citationsByMessageId.value = snapshot.citationsByMessageId
    draft.draftContent.value = snapshot.draftContent
  }

  async function replaceContext(paths: string[]) {
    if (!activeSessionId.value) return
    const nextItems = buildContextItems(paths)
    const newEstimate = await sessions.updateContext(activeSessionId.value, nextItems)
    contextItems.value = rebalanceContextItemEstimates(nextItems, newEstimate)
  }

  async function sendCurrentMessage() {
    const sessionId = activeSessionId.value
    const message = inputMessage.value.trim()
    if (!sessionId || !message) return

    const createdAtMs = Date.now()
    messages.value = [...messages.value, createOptimisticUserMessage(selectedMode.value, message, createdAtMs)]
    inputMessage.value = ''

    const response = await deliberation.sendMessage({
      sessionId,
      mode: selectedMode.value,
      message
    })

    messages.value = [
      ...messages.value,
      createAssistantPlaceholderMessage(selectedMode.value, response.assistantMessageId, contextItems.value, Date.now())
    ]
  }

  function getMessageContent(message: SecondBrainMessage): string {
    return resolveSecondBrainMessageContent(message, deliberation.resolveAssistantMessage)
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
