import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  SecondBrainAttachmentMeta,
  SecondBrainConfigStatus,
  SecondBrainSessionPayload,
  SecondBrainSessionSummary,
  SecondBrainStreamEvent
} from './apiTypes'

/**
 * Frontend IPC wrappers for Second Brain transport. This module stays
 * transport-only; user-facing orchestration belongs in higher-level services.
 */

function normalizeInvokeError(err: unknown): Error {
  if (err instanceof Error) {
    return err
  }
  if (typeof err === 'string' && err.trim()) {
    return new Error(err.trim())
  }
  try {
    const serialized = JSON.stringify(err)
    if (serialized && serialized !== '{}' && serialized !== 'null') {
      return new Error(serialized)
    }
  } catch {
    // Ignore serialization failures and fall through to the generic IPC error.
  }
  return new Error('Second Brain IPC request failed.')
}

async function invokeSecondBrain<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (err) {
    throw normalizeInvokeError(err)
  }
}

/** Reads current Second Brain configuration status without exposing secrets. */
export async function readSecondBrainConfigStatus(): Promise<SecondBrainConfigStatus> {
  return await invokeSecondBrain('read_second_brain_config_status')
}

/** Persists the raw Second Brain global configuration JSON. */
export async function writeSecondBrainGlobalConfig(contentJson: string): Promise<{ path: string }> {
  return await invokeSecondBrain('write_second_brain_global_config', { payload: { content_json: contentJson } })
}

/** Lists persisted Second Brain sessions sorted by most recent activity. */
export async function listSecondBrainSessions(limit = 80): Promise<SecondBrainSessionSummary[]> {
  return await invokeSecondBrain('list_second_brain_sessions', { limit })
}

/** Creates a persisted Second Brain session with an initial context set. */
export async function createSecondBrainSession(payload: {
  title?: string
  context_paths: string[]
}): Promise<{ session_id: string; created_at_ms: number }> {
  return await invokeSecondBrain('create_second_brain_session', { payload })
}

/** Loads a full Second Brain session payload. */
export async function loadSecondBrainSession(sessionId: string): Promise<SecondBrainSessionPayload> {
  return await invokeSecondBrain('load_second_brain_session', { sessionId })
}

/** Deletes a persisted Second Brain session. */
export async function deleteSecondBrainSession(sessionId: string): Promise<void> {
  await invokeSecondBrain('delete_second_brain_session', { sessionId })
}

/** Replaces the context paths for an existing session. */
export async function updateSecondBrainContext(payload: {
  session_id: string
  context_paths: string[]
}): Promise<{ token_estimate: number }> {
  return await invokeSecondBrain('update_second_brain_context', { payload })
}

/** Cancels the active assistant stream for a session. */
export async function cancelSecondBrainStream(payload: {
  session_id: string
  message_id?: string
}): Promise<void> {
  await invokeSecondBrain('cancel_second_brain_stream', { payload })
}

/** Sends a user message into the Second Brain orchestration pipeline. */
export async function sendSecondBrainMessage(payload: {
  session_id: string
  mode: string
  message: string
  attachments?: SecondBrainAttachmentMeta[]
}): Promise<{ user_message_id: string; assistant_message_id: string }> {
  return await invokeSecondBrain('send_second_brain_message', { payload })
}

/** Saves the current draft markdown for a session. */
export async function saveSecondBrainDraft(payload: {
  session_id: string
  content_md: string
}): Promise<void> {
  await invokeSecondBrain('save_second_brain_draft', { payload })
}

/** Appends a stored assistant message into the session draft. */
export async function appendMessageToDraft(payload: {
  session_id: string
  message_id: string
}): Promise<string> {
  return await invokeSecondBrain('append_message_to_second_brain_draft', { payload })
}

/** Publishes a draft into a new note. */
export async function publishDraftToNewNote(payload: {
  session_id: string
  target_dir: string
  file_name: string
  sources: string[]
}): Promise<{ path: string }> {
  return await invokeSecondBrain('publish_second_brain_draft_to_new_note', { payload })
}

/** Publishes a draft into an existing note. */
export async function publishDraftToExistingNote(payload: {
  session_id: string
  target_path: string
}): Promise<void> {
  await invokeSecondBrain('publish_second_brain_draft_to_existing_note', { payload })
}

/** Sets the linked target note for a session. */
export async function setSecondBrainSessionTargetNote(payload: {
  session_id: string
  target_path: string
}): Promise<{ target_note_path: string }> {
  return await invokeSecondBrain('set_second_brain_session_target_note', { payload })
}

/** Inserts an assistant message into the linked target note. */
export async function insertSecondBrainAssistantIntoTargetNote(payload: {
  session_id: string
  message_id: string
}): Promise<{ target_note_path: string }> {
  return await invokeSecondBrain('insert_second_brain_assistant_into_target_note', { payload })
}

/** Exports a session as markdown under the internal workspace storage. */
export async function exportSecondBrainSessionMarkdown(sessionId: string): Promise<{ path: string }> {
  return await invokeSecondBrain('export_second_brain_session_markdown', { sessionId })
}

/** Subscribes to streamed Second Brain assistant events. */
export async function listenSecondBrainStream(
  eventName:
    | 'second-brain://assistant-start'
    | 'second-brain://assistant-delta'
    | 'second-brain://assistant-complete'
    | 'second-brain://assistant-error',
  handler: (payload: SecondBrainStreamEvent) => void
): Promise<UnlistenFn> {
  return await listen<SecondBrainStreamEvent>(eventName, (event) => {
    handler(event.payload)
  })
}
