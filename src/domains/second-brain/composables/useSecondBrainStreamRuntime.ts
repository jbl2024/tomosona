/**
 * Stream runtime for the Second Brain chat surface.
 *
 * This module owns the assistant event listeners, cancellation handling, and
 * thread scroll behavior so the composer runtime does not need to understand
 * backend stream timing or DOM observer details.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { SecondBrainMessage } from '../../../shared/api/apiTypes'
import {
  cancelDeliberationStream,
  subscribeSecondBrainStream
} from '../lib/secondBrainApi'
import { renderSecondBrainMarkdownPreview } from '../lib/secondBrainMarkdownPreview'

export type UseSecondBrainStreamRuntimeOptions = {
  workspacePath: Ref<string>
  contextPaths: Ref<string[]>
  messages: Ref<SecondBrainMessage[]>
  streamByMessage: Ref<Record<string, string>>
  sessionId: Ref<string>
  scrollRequestNonce: Ref<number>
}

/**
 * Owns Second Brain stream subscriptions, thread auto-scroll, and cancellation.
 *
 * The caller is responsible for composing prompts and sending requests. This
 * composable only tracks the active assistant stream and updates thread state
 * as backend events arrive.
 */
export function useSecondBrainStreamRuntime(options: UseSecondBrainStreamRuntimeOptions) {
  const sending = ref(false)
  const requestInFlight = ref(false)
  const sendError = ref('')
  const suppressCancellationError = ref(false)
  const threadRef = ref<HTMLElement | null>(null)
  const threadBottomSentinel = ref<HTMLElement | null>(null)
  const threadAutoScrollEnabled = ref(true)
  const activeAssistantStreamMessageId = ref<string | null>(null)

  const streamUnsubscribers: Array<() => void> = []
  const ignoredAssistantMessageIds = new Set<string>()
  let threadBottomObserver: IntersectionObserver | null = null

  /**
   * Returns the text currently visible for a message.
   *
   * Assistant messages prefer the live stream buffer so partial responses are
   * rendered without waiting for the persisted payload to catch up.
   */
  function displayMessage(message: SecondBrainMessage): string {
    if (message.role === 'assistant') {
      return options.streamByMessage.value[message.id] ?? message.content_md
    }
    return message.content_md
  }

  /**
   * Renders assistant content to sanitized HTML for preview display.
   */
  function renderAssistantMarkdown(message: SecondBrainMessage): string {
    return renderSecondBrainMarkdownPreview(displayMessage(message))
  }

  function isThreadNearBottom(thread: HTMLElement): boolean {
    const remaining = thread.scrollHeight - thread.scrollTop - thread.clientHeight
    return remaining <= 8
  }

  /**
   * Scrolls the thread to the bottom when auto-scroll is enabled.
   *
   * `force` bypasses the auto-scroll gate for explicit navigation events such
   * as session load or a freshly appended local message.
   */
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

  /**
   * Updates the auto-scroll gate from a manual scroll event.
   */
  function onThreadScroll() {
    const thread = threadRef.value
    if (!thread) return
    if (threadBottomObserver) return
    threadAutoScrollEnabled.value = isThreadNearBottom(thread)
  }

  /**
   * Hooks an intersection observer to keep the auto-scroll state in sync with
   * the thread sentinel when the browser supports it.
   */
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

  /**
   * Marks a stream message id as ignored after cancellation.
   */
  function markAssistantMessageIgnored(messageId: string | null) {
    if (!messageId) return
    ignoredAssistantMessageIds.add(messageId)
  }

  /**
   * Cancels the active assistant stream and suppresses the expected cancel
   * error that follows from the backend.
   */
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
    threadBottomObserver?.disconnect()
    threadBottomObserver = null
    for (const unsubscribe of streamUnsubscribers) {
      unsubscribe()
    }
  })

  watch(
    () => options.scrollRequestNonce.value,
    () => {
      void scrollThreadToBottom({ force: true })
    }
  )

  return {
    activeAssistantStreamMessageId,
    displayMessage,
    markAssistantMessageIgnored,
    onStopStreaming,
    onThreadScroll,
    requestInFlight,
    renderAssistantMarkdown,
    scrollThreadToBottom,
    sendError,
    sending,
    suppressCancellationError,
    threadBottomSentinel,
    threadRef
  }
}
