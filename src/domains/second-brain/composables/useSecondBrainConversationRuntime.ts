import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { FilterableDropdownItem } from '../../../shared/components/ui/UiFilterableDropdown.vue'
import type { PulseActionId, SecondBrainMessage, SecondBrainSessionSummary } from '../../../shared/api/apiTypes'
import { writeClipboardText } from '../../../shared/api/clipboardApi'
import { readTextFile } from '../../../shared/api/workspaceApi'
import { PULSE_ACTIONS_BY_SOURCE, getPulseDropdownItems } from '../../pulse/lib/pulse'
import {
  cancelDeliberationStream,
  runDeliberation,
  subscribeSecondBrainStream
} from '../lib/secondBrainApi'
import { renderSecondBrainMarkdownPreview } from '../lib/secondBrainMarkdownPreview'
import { useSecondBrainAtMentions, type SecondBrainAtMentionItem } from './useSecondBrainAtMentions'

type CopyToast = {
  visible: boolean
  kind: 'success' | 'error'
  message: string
}

type ContextSyncResult = { ok: true } | { ok: false; error: string }

export type UseSecondBrainConversationRuntimeOptions = {
  workspacePath: Ref<string>
  allWorkspaceFiles: Ref<string[]>
  contextPaths: Ref<string[]>
  messages: Ref<SecondBrainMessage[]>
  streamByMessage: Ref<Record<string, string>>
  mentionInfo: Ref<string>
  composerContextPaths: Ref<string[]>
  sessionId: Ref<string>
  sessionTitle: Ref<string>
  selectedAlterId: Ref<string>
  sessionsIndex: Ref<SecondBrainSessionSummary[]>
  scrollRequestNonce: Ref<number>
  mergeContextPaths: (nextPaths: string[]) => string[]
  replaceContextPaths: (nextPaths: string[], config?: { revertOnFailure?: boolean }) => Promise<ContextSyncResult>
  refreshSessionsIndex: () => Promise<void>
  requestedPrompt: Ref<string>
  requestedPromptNonce: Ref<number>
}

/**
 * Owns the runtime chat surface for Second Brain.
 *
 * This composable is intentionally limited to message composition, streaming,
 * copy/export affordances, Pulse prompts, and mention handling. Session and
 * context persistence stay in the sibling session workflow composable.
 */
export function useSecondBrainConversationRuntime(options: UseSecondBrainConversationRuntimeOptions) {
  const inputMessage = ref('')
  const sending = ref(false)
  const requestInFlight = ref(false)
  const sendError = ref('')
  const suppressCancellationError = ref(false)
  const copiedByMessageId = ref<Record<string, boolean>>({})
  const copyToast = ref<CopyToast>({
    visible: false,
    kind: 'success',
    message: ''
  })
  const composerRef = ref<HTMLTextAreaElement | null>(null)
  const threadRef = ref<HTMLElement | null>(null)
  const threadBottomSentinel = ref<HTMLElement | null>(null)
  const threadAutoScrollEnabled = ref(true)
  const activeAssistantStreamMessageId = ref<string | null>(null)
  const pulseActionId = ref<PulseActionId>('synthesize')
  const pulseDropdownOpen = ref(false)
  const pulseDropdownQuery = ref('')
  const pulseDropdownActiveIndex = ref(0)

  const streamUnsubscribers: Array<() => void> = []
  const ignoredAssistantMessageIds = new Set<string>()
  const copyFeedbackTimers: Record<string, ReturnType<typeof setTimeout>> = {}
  let copyToastTimer: ReturnType<typeof setTimeout> | null = null
  let threadBottomObserver: IntersectionObserver | null = null

  const mentions = useSecondBrainAtMentions({
    workspacePath: options.workspacePath,
    allWorkspaceFiles: options.allWorkspaceFiles
  })

  const pulseActions = computed(() => PULSE_ACTIONS_BY_SOURCE.second_brain_context)
  const pulseDropdownItems = computed(() => getPulseDropdownItems('second_brain_context', { grouped: true }))
  const activePulseAction = computed(
    () => pulseActions.value.find((item) => item.id === pulseActionId.value) ?? pulseActions.value[0]
  )

  const canCopyConversation = computed(() =>
    Boolean(options.sessionId.value && !requestInFlight.value && (options.contextPaths.value.length > 0 || options.messages.value.length > 0))
  )

  function toRelativePath(path: string): string {
    const value = path.replace(/\\/g, '/')
    const root = options.workspacePath.value.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!root) return value
    if (value === root) return '.'
    if (value.startsWith(`${root}/`)) return value.slice(root.length + 1)
    return value
  }

  function displayMessage(message: SecondBrainMessage): string {
    if (message.role === 'assistant') {
      return options.streamByMessage.value[message.id] ?? message.content_md
    }
    return message.content_md
  }

  function renderAssistantMarkdown(message: SecondBrainMessage): string {
    return renderSecondBrainMarkdownPreview(displayMessage(message))
  }

  function isThreadNearBottom(thread: HTMLElement): boolean {
    const remaining = thread.scrollHeight - thread.scrollTop - thread.clientHeight
    return remaining <= 8
  }

  async function scrollThreadToBottom(config: { force?: boolean } = {}) {
    await nextTick()
    const thread = threadRef.value
    if (!thread) return
    if (!config.force && !threadAutoScrollEnabled.value) return
    const sentinel = threadBottomSentinel.value
    if (sentinel && typeof sentinel.scrollIntoView === 'function') {
      sentinel.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'auto' })
    } else {
      thread.scrollTop = thread.scrollHeight
    }
    threadAutoScrollEnabled.value = true
  }

  function onThreadScroll() {
    const thread = threadRef.value
    if (!thread) return
    if (threadBottomObserver) return
    threadAutoScrollEnabled.value = isThreadNearBottom(thread)
  }

  function setupThreadBottomObserver() {
    if (typeof IntersectionObserver === 'undefined') return
    const thread = threadRef.value
    const sentinel = threadBottomSentinel.value
    if (!thread || !sentinel) return

    threadBottomObserver?.disconnect()
    threadBottomObserver = new IntersectionObserver(([entry]) => {
      threadAutoScrollEnabled.value = Boolean(entry?.isIntersecting)
    }, {
      root: thread,
      threshold: 1
    })
    threadBottomObserver.observe(sentinel)
  }

  function showCopyToast(kind: 'success' | 'error', message: string, durationMs = 2000) {
    if (copyToastTimer) clearTimeout(copyToastTimer)
    copyToast.value = {
      visible: true,
      kind,
      message
    }
    copyToastTimer = setTimeout(() => {
      copyToast.value.visible = false
      copyToastTimer = null
    }, durationMs)
  }

  function buildConversationMarkdown(contextEntries: Array<{ path: string; content: string }>): string {
    const lines: string[] = [`# ${options.sessionTitle.value || 'Second Brain Session'}`, '', '## Context', '']

    for (const entry of contextEntries) {
      lines.push(`### ${toRelativePath(entry.path)}`, '', entry.content.trimEnd(), '')
    }

    lines.push('## Conversation', '')
    for (const message of options.messages.value) {
      lines.push(`### ${message.role === 'assistant' ? 'Assistant' : 'You'}`, '')
      lines.push(displayMessage(message).trimEnd(), '')
    }

    return lines.join('\n').trim()
  }

  async function writeTextToClipboard(text: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return
      }
    } catch {
      // Fall back to the native Tauri clipboard helper when the web clipboard is unavailable.
    }
    await writeClipboardText(text)
  }

  async function onCopyConversation() {
    if (!canCopyConversation.value) return

    try {
      const contextEntries = await Promise.all(options.contextPaths.value.map(async (path) => ({
        path,
        content: await readTextFile(path)
      })))
      const markdown = buildConversationMarkdown(contextEntries)
      await writeTextToClipboard(markdown)
      showCopyToast('success', 'Conversation copied to clipboard.')
    } catch (err) {
      showCopyToast(
        'error',
        err instanceof Error ? err.message : 'Could not copy conversation.',
        2700
      )
    }
  }

  async function onCopyAssistantMessage(message: SecondBrainMessage) {
    if (message.role !== 'assistant') return
    const content = displayMessage(message).trim()
    if (!content) return

    try {
      await writeTextToClipboard(content)
      copiedByMessageId.value = {
        ...copiedByMessageId.value,
        [message.id]: true
      }
      if (copyFeedbackTimers[message.id]) {
        clearTimeout(copyFeedbackTimers[message.id])
      }
      copyFeedbackTimers[message.id] = setTimeout(() => {
        const next = { ...copiedByMessageId.value }
        delete next[message.id]
        copiedByMessageId.value = next
        delete copyFeedbackTimers[message.id]
      }, 1300)
      showCopyToast('success', 'Copied to clipboard.')
    } catch (err) {
      showCopyToast(
        'error',
        err instanceof Error ? err.message : 'Could not copy assistant response.',
        2700
      )
    }
  }

  function updateMentionTriggerFromComposer() {
    mentions.updateTrigger(inputMessage.value, composerRef.value?.selectionStart ?? null)
  }

  function onComposerInput(event: Event) {
    inputMessage.value = (event.target as HTMLTextAreaElement).value
    updateMentionTriggerFromComposer()
  }

  async function applyMentionSuggestion(item: SecondBrainAtMentionItem) {
    const trigger = mentions.trigger.value
    const previousComposerPaths = [...options.composerContextPaths.value]
    if (trigger) {
      inputMessage.value = `${inputMessage.value.slice(0, trigger.start)}${inputMessage.value.slice(trigger.end)}`
    }
    options.composerContextPaths.value = Array.from(new Set([
      ...options.composerContextPaths.value,
      item.absolutePath
    ]))
    const added = await addPathToContext(item.absolutePath)
    if (!added) {
      options.composerContextPaths.value = previousComposerPaths
      return
    }

    options.mentionInfo.value = ''
    mentions.close()

    void nextTick(() => {
      composerRef.value?.focus()
      const caret = trigger?.start ?? composerRef.value?.value.length ?? 0
      composerRef.value?.setSelectionRange(caret, caret)
    })
  }

  function onComposerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void onSendMessage()
      return
    }

    if (!mentions.isOpen.value) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      mentions.moveActive(1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      mentions.moveActive(-1)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const next = mentions.suggestions.value[mentions.activeIndex.value]
      if (next) {
        void applyMentionSuggestion(next)
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      mentions.close()
    }
  }

  function pulseDropdownMatcher(item: FilterableDropdownItem, query: string): boolean {
    const aliases = Array.isArray(item.aliases) ? item.aliases.map((entry) => String(entry).toLowerCase()) : []
    return aliases.some((token) => token.includes(query))
  }

  async function runPulseFromSecondBrain() {
    if (!options.contextPaths.value.length) {
      options.mentionInfo.value = 'Add note context before using Pulse.'
      return
    }
    const nextInstruction = inputMessage.value.trim()
    const pulsePrompts: Partial<Record<PulseActionId, string>> = {
      rewrite: 'Rewrite the current context into a clearer version while preserving meaning.',
      condense: 'Condense the current context into a shorter version that keeps the key information.',
      expand: 'Expand the current context into a fuller draft with clearer structure and supporting detail.',
      change_tone: 'Rewrite the current context in a different tone while keeping the substance intact.',
      synthesize: 'Synthesize the current context into a concise, structured summary. Highlight key themes and uncertainties.',
      outline: 'Turn the current context into a clear outline with sections and logical progression.',
      brief: 'Draft a working brief from the current context, including objective, key points, and open questions.',
      extract_themes: 'Extract the dominant themes from the current context and explain how they relate.',
      identify_tensions: 'Identify tensions, contradictions, or open questions in the current context.'
    }
    const basePrompt = pulsePrompts[pulseActionId.value] ?? 'Transform the current context into a useful written output.'
    inputMessage.value = nextInstruction ? `${basePrompt}\n\nAdditional guidance: ${nextInstruction}` : basePrompt
    void nextTick(() => composerRef.value?.focus())
  }

  async function onPulseAction(actionId: PulseActionId) {
    pulseActionId.value = actionId
    await runPulseFromSecondBrain()
  }

  function onPulseDropdownSelect(item: FilterableDropdownItem) {
    void onPulseAction(item.id as PulseActionId)
  }

  async function addPathToContext(path: string): Promise<boolean> {
    const next = options.mergeContextPaths([path])
    const sync = await options.replaceContextPaths(next, { revertOnFailure: true })
    if (!sync.ok) {
      options.mentionInfo.value = `Could not add ${toRelativePath(path)} to Second Brain context: ${sync.error}`
      return false
    }

    options.mentionInfo.value = ''
    return true
  }

  async function onSendMessage() {
    if (!options.sessionId.value || !inputMessage.value.trim() || requestInFlight.value) return
    requestInFlight.value = true
    sending.value = true
    sendError.value = ''
    options.mentionInfo.value = ''
    activeAssistantStreamMessageId.value = null
    const outgoing = inputMessage.value.trim()

    const mentionResolution = mentions.resolveMentionedPaths(outgoing)
    const mergedMentionPaths = Array.from(new Set([
      ...options.composerContextPaths.value,
      ...mentionResolution.resolvedPaths
    ]))

    if (mergedMentionPaths.length > 0) {
      const sync = await options.replaceContextPaths(options.mergeContextPaths(mergedMentionPaths), { revertOnFailure: false })
      if (!sync.ok) {
        options.mentionInfo.value = `Could not update Second Brain context: ${sync.error}`
      }
    }
    if (mentionResolution.unresolved.length > 0) {
      options.mentionInfo.value = `Ignored unresolved mentions: ${mentionResolution.unresolved.map((item) => `@${item}`).join(', ')}`
    }

    const tempUserId = `temp-user-${Date.now()}`
    inputMessage.value = ''
    options.composerContextPaths.value = []
    mentions.close()

    options.messages.value = [...options.messages.value, {
      id: tempUserId,
      role: 'user',
      mode: 'freestyle',
      content_md: outgoing,
      citations_json: '[]',
      attachments_json: '[]',
      created_at_ms: Date.now()
    }]
    void scrollThreadToBottom({ force: true })

    try {
      const result = await runDeliberation(
        options.selectedAlterId.value
          ? {
              sessionId: options.sessionId.value,
              mode: 'freestyle',
              message: outgoing,
              alterId: options.selectedAlterId.value
            }
          : {
              sessionId: options.sessionId.value,
              mode: 'freestyle',
              message: outgoing
            }
      )

      options.messages.value = options.messages.value.map((message) =>
        message.id === tempUserId ? { ...message, id: result.userMessageId } : message
      )

      if (!options.messages.value.some((message) => message.id === result.assistantMessageId)) {
        options.messages.value = [...options.messages.value, {
          id: result.assistantMessageId,
          role: 'assistant',
          mode: 'freestyle',
          content_md: options.streamByMessage.value[result.assistantMessageId] ?? '',
          citations_json: JSON.stringify(options.contextPaths.value.map((path) => path.replace(`${options.workspacePath.value}/`, ''))),
          attachments_json: '[]',
          created_at_ms: Date.now()
        }]
        void scrollThreadToBottom({ force: true })
      }

      await options.refreshSessionsIndex()
      const updated = options.sessionsIndex.value.find((item) => item.session_id === options.sessionId.value)
      if (updated?.title) {
        options.sessionTitle.value = updated.title
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send message.'
      if (suppressCancellationError.value && /cancel/i.test(message)) {
        sendError.value = ''
      } else {
        sendError.value = message
      }
    } finally {
      sending.value = false
      requestInFlight.value = false
      activeAssistantStreamMessageId.value = null
      suppressCancellationError.value = false
    }
  }

  async function onStopStreaming() {
    if (!requestInFlight.value || !sending.value) return
    sending.value = false
    suppressCancellationError.value = true
    const activeId = activeAssistantStreamMessageId.value
    if (activeId) {
      ignoredAssistantMessageIds.add(activeId)
    }
    if (!options.sessionId.value) return
    try {
      await cancelDeliberationStream({
        sessionId: options.sessionId.value,
        messageId: activeId
      })
    } catch (err) {
      suppressCancellationError.value = false
      sendError.value = err instanceof Error ? err.message : 'Could not stop generation.'
    }
  }

  onMounted(async () => {
    await nextTick()
    setupThreadBottomObserver()

    streamUnsubscribers.push(await subscribeSecondBrainStream('second-brain://assistant-start', (payload) => {
      if (payload.session_id !== options.sessionId.value) return
      activeAssistantStreamMessageId.value = payload.message_id
      if (ignoredAssistantMessageIds.has(payload.message_id)) return
      options.streamByMessage.value = {
        ...options.streamByMessage.value,
        [payload.message_id]: ''
      }
      if (!options.messages.value.some((message) => message.id === payload.message_id)) {
        options.messages.value = [...options.messages.value, {
          id: payload.message_id,
          role: 'assistant',
          mode: 'freestyle',
          content_md: '',
          citations_json: JSON.stringify(options.contextPaths.value.map((path) => path.replace(`${options.workspacePath.value}/`, ''))),
          attachments_json: '[]',
          created_at_ms: Date.now()
        }]
        void scrollThreadToBottom()
      }
    }))

    streamUnsubscribers.push(await subscribeSecondBrainStream('second-brain://assistant-delta', (payload) => {
      if (payload.session_id !== options.sessionId.value) return
      if (ignoredAssistantMessageIds.has(payload.message_id)) return
      const current = options.streamByMessage.value[payload.message_id] ?? ''
      options.streamByMessage.value = {
        ...options.streamByMessage.value,
        [payload.message_id]: `${current}${payload.chunk}`
      }
      if (!options.messages.value.some((message) => message.id === payload.message_id)) {
        options.messages.value = [...options.messages.value, {
          id: payload.message_id,
          role: 'assistant',
          mode: 'freestyle',
          content_md: '',
          citations_json: JSON.stringify(options.contextPaths.value.map((path) => path.replace(`${options.workspacePath.value}/`, ''))),
          attachments_json: '[]',
          created_at_ms: Date.now()
        }]
      }
      void scrollThreadToBottom()
    }))

    streamUnsubscribers.push(await subscribeSecondBrainStream('second-brain://assistant-complete', (payload) => {
      if (payload.session_id !== options.sessionId.value) return
      if (ignoredAssistantMessageIds.has(payload.message_id)) {
        ignoredAssistantMessageIds.delete(payload.message_id)
        if (activeAssistantStreamMessageId.value === payload.message_id) {
          activeAssistantStreamMessageId.value = null
        }
        return
      }
      options.streamByMessage.value = {
        ...options.streamByMessage.value,
        [payload.message_id]: payload.chunk
      }
      if (activeAssistantStreamMessageId.value === payload.message_id) {
        activeAssistantStreamMessageId.value = null
      }
      sending.value = false
    }))

    streamUnsubscribers.push(await subscribeSecondBrainStream('second-brain://assistant-error', (payload) => {
      if (payload.session_id !== options.sessionId.value) return
      if (ignoredAssistantMessageIds.has(payload.message_id)) {
        ignoredAssistantMessageIds.delete(payload.message_id)
        if (activeAssistantStreamMessageId.value === payload.message_id) {
          activeAssistantStreamMessageId.value = null
        }
        return
      }
      if (activeAssistantStreamMessageId.value === payload.message_id) {
        activeAssistantStreamMessageId.value = null
      }
      sending.value = false
      sendError.value = payload.error || 'Assistant stream failed.'
    }))
  })

  onBeforeUnmount(() => {
    if (copyToastTimer) {
      clearTimeout(copyToastTimer)
      copyToastTimer = null
    }
    threadBottomObserver?.disconnect()
    threadBottomObserver = null
    for (const timer of Object.values(copyFeedbackTimers)) {
      clearTimeout(timer)
    }
    for (const unsubscribe of streamUnsubscribers) {
      unsubscribe()
    }
  })

  watch(
    () => `${options.requestedPromptNonce.value}::${options.requestedPrompt.value}`,
    (value) => {
      const [nonce] = value.split('::')
      if (!nonce.trim()) return
      inputMessage.value = options.requestedPrompt.value
      void nextTick(() => composerRef.value?.focus())
    },
    { immediate: true }
  )

  watch(
    () => options.scrollRequestNonce.value,
    () => {
      void scrollThreadToBottom({ force: true })
    }
  )

  return {
    activePulseAction,
    applyMentionSuggestion,
    canCopyConversation,
    composerRef,
    copyToast,
    copiedByMessageId,
    displayMessage,
    inputMessage,
    mentionInfo: options.mentionInfo,
    mentions,
    messages: options.messages,
    onComposerInput,
    onComposerKeydown,
    onCopyAssistantMessage,
    onCopyConversation,
    onPulseAction,
    onPulseDropdownSelect,
    onSendMessage,
    onStopStreaming,
    onThreadScroll,
    pulseDropdownActiveIndex,
    pulseDropdownItems,
    pulseDropdownMatcher,
    pulseDropdownOpen,
    pulseDropdownQuery,
    requestInFlight,
    renderAssistantMarkdown,
    sendError,
    sending,
    streamByMessage: options.streamByMessage,
    threadBottomSentinel,
    threadRef,
    updateMentionTriggerFromComposer
  }
}
