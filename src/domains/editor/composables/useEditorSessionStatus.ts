import type { DocumentSession } from './useDocumentEditorSessions'

/**
 * Module: useEditorSessionStatus
 *
 * Owns status mutation helpers for path-scoped editor sessions.
 */

/**
 * Dependencies required by {@link useEditorSessionStatus}.
 */
export type UseEditorSessionStatusOptions = {
  getSession: (path: string) => DocumentSession | null
  ensureSession: (path: string) => DocumentSession
  patchStatus: (path: string, patch: { dirty?: boolean; saving?: boolean; saveError?: string }) => void
  clearAutosaveTimer: () => void
  scheduleAutosave: () => void
}

/**
 * Creates session status helpers used by EditorView orchestration.
 *
 * Responsibilities:
 * - Keep `DocumentSession` status fields synchronized with emitted lifecycle status snapshots.
 * - Route autosave timer controls through lifecycle owner.
 *
 * Failure behavior:
 * - No-ops when path has no session.
 */
export function useEditorSessionStatus(options: UseEditorSessionStatusOptions) {
  function setDirty(path: string, dirty: boolean) {
    const session = options.getSession(path)
    if (!session) return
    session.dirty = dirty
    options.patchStatus(path, { dirty })
  }

  function setSaving(path: string, saving: boolean) {
    const session = options.getSession(path)
    if (!session) return
    session.saving = saving
    options.patchStatus(path, { saving })
  }

  function setSaveError(path: string, message: string) {
    const session = options.getSession(path)
    if (!session) return
    session.saveError = message
    options.patchStatus(path, { saveError: message })
  }

  function clearAutosaveTimer() {
    options.clearAutosaveTimer()
  }

  /**
   * Schedules autosave only when the target path has a live session.
   */
  function scheduleAutosave(path: string) {
    if (!options.getSession(path)) return
    options.scheduleAutosave()
  }

  return {
    getSession: options.getSession,
    ensureSession: options.ensureSession,
    setDirty,
    setSaving,
    setSaveError,
    clearAutosaveTimer,
    scheduleAutosave
  }
}
