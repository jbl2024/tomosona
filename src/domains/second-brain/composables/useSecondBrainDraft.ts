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

  async function publishToNewNote(payload: {
    sessionId: string
    targetDir: string
    fileName: string
    sources: string[]
  }) {
    draftError.value = ''
    return await publishSessionDraftToNewNote(payload)
  }

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
