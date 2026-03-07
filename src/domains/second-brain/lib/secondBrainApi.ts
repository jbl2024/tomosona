import {
  appendMessageToDraft,
  cancelSecondBrainStream,
  createSecondBrainSession,
  deleteSecondBrainSession,
  listSecondBrainSessions,
  loadSecondBrainSession,
  listenSecondBrainStream,
  publishDraftToExistingNote,
  publishDraftToNewNote,
  readSecondBrainConfigStatus,
  saveSecondBrainDraft,
  exportSecondBrainSessionMarkdown,
  insertSecondBrainAssistantIntoTargetNote,
  sendSecondBrainMessage,
  setSecondBrainSessionTargetNote,
  updateSecondBrainContext
} from '../../../shared/api/secondBrainIpcApi'
import type {
  SecondBrainAttachmentMeta,
  SecondBrainConfigStatus,
  SecondBrainMessage,
  SecondBrainSessionPayload,
  SecondBrainSessionSummary,
  SecondBrainStreamEvent
} from '../../../shared/api/apiTypes'

/**
 * Reads active configuration status without exposing secrets.
 */
export async function fetchSecondBrainConfigStatus(): Promise<SecondBrainConfigStatus> {
  return await readSecondBrainConfigStatus()
}

/**
 * Lists persisted sessions sorted by most recent update.
 */
export async function fetchSecondBrainSessions(limit = 80): Promise<SecondBrainSessionSummary[]> {
  return await listSecondBrainSessions(limit)
}

/**
 * Creates a new deliberation session with an explicit context set.
 */
export async function createDeliberationSession(payload: {
  title?: string
  contextPaths: string[]
}): Promise<{ sessionId: string; createdAtMs: number }> {
  const result = await createSecondBrainSession({
    title: payload.title,
    context_paths: payload.contextPaths
  })
  return {
    sessionId: result.session_id,
    createdAtMs: result.created_at_ms
  }
}

/**
 * Loads a full session payload (context + messages + draft).
 */
export async function loadDeliberationSession(sessionId: string): Promise<SecondBrainSessionPayload> {
  return await loadSecondBrainSession(sessionId)
}

/** Deletes a persisted second brain session. */
export async function removeDeliberationSession(sessionId: string): Promise<void> {
  await deleteSecondBrainSession(sessionId)
}

/**
 * Replaces the active context paths for a session.
 */
export async function replaceSessionContext(sessionId: string, contextPaths: string[]): Promise<number> {
  const result = await updateSecondBrainContext({
    session_id: sessionId,
    context_paths: contextPaths
  })
  return result.token_estimate
}

/**
 * Sends a user message to the backend LLM orchestration.
 */
export async function runDeliberation(payload: {
  sessionId: string
  mode: string
  message: string
  attachments?: SecondBrainAttachmentMeta[]
}): Promise<{ userMessageId: string; assistantMessageId: string }> {
  const result = await sendSecondBrainMessage({
    session_id: payload.sessionId,
    mode: payload.mode,
    message: payload.message,
    attachments: payload.attachments ?? []
  })
  return {
    userMessageId: result.user_message_id,
    assistantMessageId: result.assistant_message_id
  }
}

/** Requests server-side cancellation for an in-flight deliberation stream. */
export async function cancelDeliberationStream(payload: {
  sessionId: string
  messageId?: string | null
}): Promise<void> {
  await cancelSecondBrainStream({
    session_id: payload.sessionId,
    message_id: payload.messageId ?? undefined
  })
}

/**
 * Saves current draft markdown for a session.
 */
export async function saveSessionDraft(sessionId: string, contentMd: string): Promise<void> {
  await saveSecondBrainDraft({ session_id: sessionId, content_md: contentMd })
}

/**
 * Appends an assistant message content into draft and returns full draft text.
 */
export async function appendAssistantMessageToDraft(sessionId: string, messageId: string): Promise<string> {
  return await appendMessageToDraft({ session_id: sessionId, message_id: messageId })
}

/**
 * Publishes draft into a newly created note.
 */
export async function publishSessionDraftToNewNote(payload: {
  sessionId: string
  targetDir: string
  fileName: string
  sources: string[]
}): Promise<{ path: string }> {
  return await publishDraftToNewNote({
    session_id: payload.sessionId,
    target_dir: payload.targetDir,
    file_name: payload.fileName,
    sources: payload.sources
  })
}

/**
 * Publishes draft by appending to an existing note.
 */
export async function publishSessionDraftToExistingNote(sessionId: string, targetPath: string): Promise<void> {
  await publishDraftToExistingNote({ session_id: sessionId, target_path: targetPath })
}

/** Links a persisted target note to a session. */
export async function linkSessionTargetNote(sessionId: string, targetPath: string): Promise<string> {
  const result = await setSecondBrainSessionTargetNote({ session_id: sessionId, target_path: targetPath })
  return result.target_note_path
}

/** Appends an assistant message into the linked target note. */
export async function insertAssistantMessageIntoTarget(sessionId: string, messageId: string): Promise<string> {
  const result = await insertSecondBrainAssistantIntoTargetNote({ session_id: sessionId, message_id: messageId })
  return result.target_note_path
}

/** Exports a session markdown artifact under internal second-brain folder. */
export async function exportSessionMarkdown(sessionId: string): Promise<string> {
  const result = await exportSecondBrainSessionMarkdown(sessionId)
  return result.path
}

/**
 * Subscribes to a backend streaming channel.
 */
export async function subscribeSecondBrainStream(
  eventName:
    | 'second-brain://assistant-start'
    | 'second-brain://assistant-delta'
    | 'second-brain://assistant-complete'
    | 'second-brain://assistant-error',
  handler: (payload: SecondBrainStreamEvent) => void
): Promise<() => void> {
  return await listenSecondBrainStream(eventName, handler)
}

/**
 * Decodes backend JSON citations payload into a list.
 */
export function parseMessageCitations(message: SecondBrainMessage): string[] {
  try {
    const parsed = JSON.parse(message.citations_json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}
