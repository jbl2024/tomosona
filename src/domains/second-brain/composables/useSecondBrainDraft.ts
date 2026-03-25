/**
 * Draft persistence helper for Second Brain outputs.
 *
 * Keep draft save/publish behavior isolated from the message stream so the UI
 * can treat output publishing as a separate workflow from live chat.
 */
import { ref } from 'vue'
import {
  appendAssistantMessageToDraft,
  publishSessionDraftToExistingNote,
  publishSessionDraftToNewNote,
  saveSessionDraft
} from '../lib/secondBrainApi'

export function useSecondBrainDraft() {
  const draftContent = ref('')
  const draftSaving = ref(false)
  const draftError = ref('')

  /**
   * Saves the current draft content for the active session.
   *
   * The local draft copy is updated only after the backend accepts the write,
   * which keeps the UI from drifting from persisted state.
   */
  async function saveDraft(sessionId: string, content: string) {
    draftSaving.value = true
    draftError.value = ''
    try {
      await saveSessionDraft(sessionId, content)
      draftContent.value = content
    } catch (err) {
      draftError.value = err instanceof Error ? err.message : 'Could not save draft.'
      throw err
    } finally {
      draftSaving.value = false
    }
  }

  /**
   * Appends an assistant message into the draft and refreshes the local copy.
   */
  async function appendMessage(sessionId: string, messageId: string) {
    draftSaving.value = true
    draftError.value = ''
    try {
      draftContent.value = await appendAssistantMessageToDraft(sessionId, messageId)
      return draftContent.value
    } catch (err) {
      draftError.value = err instanceof Error ? err.message : 'Could not append output.'
      throw err
    } finally {
      draftSaving.value = false
    }
  }

  /**
   * Publishes the draft into a newly created note.
   *
   * The backend handles filesystem safety and note creation.
   */
  async function publishToNewNote(payload: {
    sessionId: string
    targetDir: string
    fileName: string
    sources: string[]
  }) {
    draftError.value = ''
    return await publishSessionDraftToNewNote(payload)
  }

  /**
   * Appends the current draft into an existing note.
   */
  async function publishToExistingNote(sessionId: string, targetPath: string) {
    draftError.value = ''
    await publishSessionDraftToExistingNote(sessionId, targetPath)
  }

  return {
    draftContent,
    draftSaving,
    draftError,
    saveDraft,
    appendMessage,
    publishToNewNote,
    publishToExistingNote
  }
}
