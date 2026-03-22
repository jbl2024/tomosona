import type { SecondBrainContextItem, SecondBrainMessage } from '../../../shared/api/apiTypes'
import type { LoadedSession } from './useSecondBrainSessions'

/**
 * Pure transformation helpers for the Second Brain state container.
 *
 * The composable owns refs and async I/O. This module keeps the state-shaping
 * logic deterministic so it can be tested directly.
 */
export type LoadedSecondBrainState = LoadedSession & {
  draftContent: string
}

export type SecondBrainStateSnapshot = {
  activeSessionId: string
  activeSessionTitle: string
  activeProvider: string
  activeModel: string
  contextItems: SecondBrainContextItem[]
  messages: SecondBrainMessage[]
  citationsByMessageId: Record<string, string[]>
  draftContent: string
}

/**
 * Converts selected context paths into empty context items.
 */
export function buildContextItems(paths: string[]): SecondBrainContextItem[] {
  return paths.map((path) => ({ path, token_estimate: 0 }))
}

/**
 * Rebalances token estimates after the backend returns an aggregate value.
 */
export function rebalanceContextItemEstimates(
  items: SecondBrainContextItem[],
  totalEstimate: number
): SecondBrainContextItem[] {
  if (!items.length) return items
  const average = Math.max(1, Math.round(totalEstimate / items.length))
  return items.map((item) => ({ ...item, token_estimate: average }))
}

/**
 * Projects a loaded session payload into the local UI state fields.
 */
export function createLoadedSecondBrainState(loaded: LoadedSession): SecondBrainStateSnapshot {
  return {
    activeSessionId: loaded.payload.session_id,
    activeSessionTitle: loaded.payload.title,
    activeProvider: loaded.payload.provider,
    activeModel: loaded.payload.model,
    contextItems: loaded.payload.context_items,
    messages: loaded.payload.messages,
    citationsByMessageId: loaded.citationsByMessageId,
    draftContent: loaded.payload.draft_content
  }
}

/**
 * Creates the optimistic user message inserted before the backend responds.
 */
export function createOptimisticUserMessage(mode: string, message: string, createdAtMs: number): SecondBrainMessage {
  return {
    id: `tmp-user-${createdAtMs}`,
    role: 'user',
    mode,
    content_md: message,
    citations_json: '[]',
    attachments_json: '[]',
    created_at_ms: createdAtMs
  }
}

/**
 * Creates the placeholder assistant message that will later be filled by the stream.
 */
export function createAssistantPlaceholderMessage(
  mode: string,
  assistantMessageId: string,
  contextItems: SecondBrainContextItem[],
  createdAtMs: number
): SecondBrainMessage {
  return {
    id: assistantMessageId,
    role: 'assistant',
    mode,
    content_md: '',
    citations_json: JSON.stringify(contextItems.map((item) => item.path)),
    attachments_json: '[]',
    created_at_ms: createdAtMs
  }
}

/**
 * Resolves the user-facing content for a message, preferring streamed text for assistants.
 */
export function resolveSecondBrainMessageContent(
  message: SecondBrainMessage,
  resolveAssistantMessage: (message: SecondBrainMessage) => string
): string {
  if (message.role === 'assistant') {
    return resolveAssistantMessage(message)
  }
  return message.content_md
}
