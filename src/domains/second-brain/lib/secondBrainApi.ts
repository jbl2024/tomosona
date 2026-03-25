/**
 * Transport-only adapter for the Second Brain backend contract.
 *
 * Keep this module as the single frontend boundary to the Tauri IPC layer so
 * higher-level composables can stay focused on workflow instead of transport
 * details and naming conversions.
 */
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
  setSecondBrainSessionAlter,
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
 * Reads the active backend configuration state without exposing secrets.
 *
 * This is the first health check for the Second Brain UI: it tells the view
 * whether the backend is ready to send prompts, stream responses, and render
 * the current provider/model state.
 */
export async function fetchSecondBrainConfigStatus(): Promise<SecondBrainConfigStatus> {
  return await readSecondBrainConfigStatus()
}

/**
 * Lists persisted sessions sorted by most recent update.
 *
 * The UI uses this to populate the session dropdown and to refresh the list
 * after create/delete/send flows that may change the active session title.
 */
export async function fetchSecondBrainSessions(limit = 80): Promise<SecondBrainSessionSummary[]> {
  return await listSecondBrainSessions(limit)
}

/**
 * Creates a new deliberation session with an explicit context set.
 *
 * The payload uses explicit context paths so the backend can persist the
 * session as a concrete state snapshot instead of implicit workspace state.
 */
export async function createDeliberationSession(payload: {
  title?: string
  contextPaths: string[]
  alterId?: string | null
}): Promise<{ sessionId: string; createdAtMs: number }> {
  const result = await createSecondBrainSession({
    title: payload.title,
    context_paths: payload.contextPaths,
    alter_id: payload.alterId ?? undefined
  })
  return {
    sessionId: result.session_id,
    createdAtMs: result.created_at_ms
  }
}

/**
 * Loads a full session payload including context, messages, and draft.
 */
export async function loadDeliberationSession(sessionId: string): Promise<SecondBrainSessionPayload> {
  return await loadSecondBrainSession(sessionId)
}

/**
 * Deletes a persisted Second Brain session.
 *
 * This is intentionally separate from load/create so the UI can keep a narrow
 * delete path and refresh the list only after the backend confirms removal.
 */
export async function removeDeliberationSession(sessionId: string): Promise<void> {
  await deleteSecondBrainSession(sessionId)
}

/**
 * Replaces the active context paths for a session.
 *
 * The backend returns a token estimate so the frontend can keep its local view
 * consistent with the persisted context without guessing the sizing.
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
 *
 * This is the single send primitive used by the composer runtime; everything
 * else about mention resolution, optimistic messages, and stream display stays
 * in the frontend workflow layer.
 */
export async function runDeliberation(payload: {
  sessionId: string
  mode: string
  message: string
  alterId?: string | null
  attachments?: SecondBrainAttachmentMeta[]
}): Promise<{ userMessageId: string; assistantMessageId: string }> {
  const result = await sendSecondBrainMessage({
    session_id: payload.sessionId,
    mode: payload.mode,
    message: payload.message,
    alter_id: payload.alterId ?? undefined,
    attachments: payload.attachments ?? []
  })
  return {
    userMessageId: result.user_message_id,
    assistantMessageId: result.assistant_message_id
  }
}

/**
 * Persists the active Alter selection for a session.
 *
 * This keeps the selected Alter authoritative on the backend so session
 * restore stays deterministic across launches.
 */
export async function setDeliberationSessionAlter(sessionId: string, alterId?: string | null): Promise<string> {
  const result = await setSecondBrainSessionAlter({
    session_id: sessionId,
    alter_id: alterId ?? undefined
  })
  return result.alter_id
}

/**
 * Requests server-side cancellation for an in-flight deliberation stream.
 *
 * The caller is expected to keep track of the optimistic UI state and ignore
 * late stream events for the cancelled message.
 */
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
 * Saves the current draft markdown for a session.
 */
export async function saveSessionDraft(sessionId: string, contentMd: string): Promise<void> {
  await saveSecondBrainDraft({ session_id: sessionId, content_md: contentMd })
}

/**
 * Appends an assistant message into the draft and returns the full text.
 */
export async function appendAssistantMessageToDraft(sessionId: string, messageId: string): Promise<string> {
  return await appendMessageToDraft({ session_id: sessionId, message_id: messageId })
}

/**
 * Publishes the draft into a newly created note.
 *
 * The caller provides the final file name and target directory; the backend is
 * responsible for resolving the note path safely within the workspace.
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
 * Publishes the draft by appending to an existing note.
 */
export async function publishSessionDraftToExistingNote(sessionId: string, targetPath: string): Promise<void> {
  await publishDraftToExistingNote({ session_id: sessionId, target_path: targetPath })
}

/**
 * Links a persisted target note to a session.
 */
export async function linkSessionTargetNote(sessionId: string, targetPath: string): Promise<string> {
  const result = await setSecondBrainSessionTargetNote({ session_id: sessionId, target_path: targetPath })
  return result.target_note_path
}

/**
 * Appends an assistant message into the linked target note.
 */
export async function insertAssistantMessageIntoTarget(sessionId: string, messageId: string): Promise<string> {
  const result = await insertSecondBrainAssistantIntoTargetNote({ session_id: sessionId, message_id: messageId })
  return result.target_note_path
}

/**
 * Exports a session markdown artifact under the internal Second Brain folder.
 */
export async function exportSessionMarkdown(sessionId: string): Promise<string> {
  const result = await exportSecondBrainSessionMarkdown(sessionId)
  return result.path
}

/**
 * Subscribes to a backend streaming channel.
 *
 * The returned unsubscribe callback must be called on teardown to avoid
 * leaking event listeners across view mounts.
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
 * Decodes the backend JSON citations payload into a list.
 *
 * Invalid JSON is treated as an empty citation list so a malformed payload
 * does not break message rendering.
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
