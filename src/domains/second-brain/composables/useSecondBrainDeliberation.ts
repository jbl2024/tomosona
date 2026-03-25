/**
 * Thin deliberation transport wrapper for the Second Brain domain.
 *
 * This module owns the lower-level send/stream wiring used by older state
 * containers and tests. Keep it small and transport-focused so higher-level
 * workflows can layer on mention handling, optimistic messages, and copy UI.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { runDeliberation, subscribeSecondBrainStream } from '../lib/secondBrainApi'
import type { SecondBrainAttachmentMeta, SecondBrainMessage } from '../../../shared/api/apiTypes'

/**
 * Exposes the minimal backend deliberation primitives needed by legacy
 * Second Brain state containers.
 */
export function useSecondBrainDeliberation() {
  const sending = ref(false)
  const sendError = ref('')
  const streamTextByMessageId = ref<Record<string, string>>({})
  const unlisteners: Array<() => void> = []

  const activeStreamingMessageIds = computed(() => Object.keys(streamTextByMessageId.value))

  /**
   * Binds backend assistant stream events to local per-message buffers.
   *
   * Callers that still use this helper are expected to pair it with
   * `resolveAssistantMessage` when rendering assistant messages.
   */
  async function bindStreamEvents() {
    const onStart = await subscribeSecondBrainStream('second-brain://assistant-start', (payload) => {
      streamTextByMessageId.value = {
        ...streamTextByMessageId.value,
        [payload.message_id]: ''
      }
    })
    const onDelta = await subscribeSecondBrainStream('second-brain://assistant-delta', (payload) => {
      const current = streamTextByMessageId.value[payload.message_id] ?? ''
      streamTextByMessageId.value = {
        ...streamTextByMessageId.value,
        [payload.message_id]: `${current}${payload.chunk}`
      }
    })
    const onComplete = await subscribeSecondBrainStream('second-brain://assistant-complete', (payload) => {
      streamTextByMessageId.value = {
        ...streamTextByMessageId.value,
        [payload.message_id]: payload.chunk
      }
    })
    const onError = await subscribeSecondBrainStream('second-brain://assistant-error', (payload) => {
      sendError.value = payload.error || 'LLM stream error.'
    })
    unlisteners.push(onStart, onDelta, onComplete, onError)
  }

  /**
   * Sends a deliberation request and returns the backend message ids.
   */
  async function sendMessage(payload: {
    sessionId: string
    mode: string
    message: string
    attachments?: SecondBrainAttachmentMeta[]
  }): Promise<{ userMessageId: string; assistantMessageId: string }> {
    sendError.value = ''
    sending.value = true
    try {
      return await runDeliberation(payload)
    } catch (err) {
      sendError.value = err instanceof Error ? err.message : 'Could not send message.'
      throw err
    } finally {
      sending.value = false
    }
  }

  /**
   * Resolves assistant message content by preferring the live stream buffer.
   */
  function resolveAssistantMessage(message: SecondBrainMessage): string {
    return streamTextByMessageId.value[message.id] ?? message.content_md
  }

  onBeforeUnmount(() => {
    while (unlisteners.length) {
      unlisteners.pop()?.()
    }
  })

  return {
    sending,
    sendError,
    streamTextByMessageId,
    activeStreamingMessageIds,
    bindStreamEvents,
    sendMessage,
    resolveAssistantMessage
  }
}
