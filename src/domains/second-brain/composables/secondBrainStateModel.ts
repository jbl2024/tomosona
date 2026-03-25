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
 *
 * The backend fills token estimates later, so the frontend starts with a
 * stable zeroed shape and then rebalances once the total estimate is known.
 */
export function buildContextItems(paths: string[]): SecondBrainContextItem[] {
  return paths.map((path) => ({ path, token_estimate: 0 }))
}

/**
 * Rebalances token estimates after the backend returns an aggregate value.
 *
 * The current UI only needs a rough per-chip estimate, not exact item-level
 * accounting, so we distribute the total evenly to keep the display simple.
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
 *
 * This isolates the shape mapping from the rest of the session workflow so the
 * rest of the composable can remain focused on intent instead of field copying.
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
 *
 * We keep the message id time-based so it cannot collide with backend ids in a
 * normal session and can be replaced when the real response arrives.
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
 *
 * The assistant placeholder keeps the UI stable while the backend streams the
 * answer, which avoids reflow and lets the copy action read the live content.
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
 *
 * Assistant messages can be backed by live stream text or persisted content,
 * so this helper keeps the precedence rule in one place.
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
