import { ref } from 'vue'

/**
 * useEditorSessionLifecycle
 *
 * Purpose:
 * - Manage save/load lifecycle primitives for path-scoped editor sessions.
 *
 * Responsibilities:
 * - Track request ids to drop stale async loads.
 * - Emit status snapshots for dirty/saving/error transitions.
 * - Provide autosave scheduling with virtual-title retry semantics.
 *
 * Boundaries:
 * - Does not parse editor documents or perform file IO itself.
 */
export type SessionStatus = {
  dirty: boolean
  saving: boolean
  saveError: string
}

/**
 * Dependencies used to coordinate status emits and autosave scheduling.
 *
 * Parameter semantics:
 * - `saveCurrentFile(false)` is invoked for autosave.
 * - `isEditingVirtualTitle()` controls autosave deferral windows.
 */
export type UseEditorSessionLifecycleOptions = {
  emitStatus: (payload: { path: string; dirty: boolean; saving: boolean; saveError: string }) => void
  saveCurrentFile: (manual?: boolean) => Promise<void>
  isEditingVirtualTitle: () => boolean
  autosaveIdleMs?: number
  autosaveTitleIdleMs?: number
  autosaveTitleRetryMs?: number
}

/**
 * Creates request-token/status/autosave lifecycle helpers.
 *
 * Side effects:
 * - Emits status snapshots when `patchStatus` is called.
 * - Schedules timer-driven autosave callbacks.
 */
export function useEditorSessionLifecycle(options: UseEditorSessionLifecycleOptions) {
  const requestToken = ref(0)
  const statusByPath = ref<Record<string, SessionStatus>>({})
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null

  const autosaveIdleMs = options.autosaveIdleMs ?? 1800
  const autosaveTitleIdleMs = options.autosaveTitleIdleMs ?? 5000
  const autosaveTitleRetryMs = options.autosaveTitleRetryMs ?? 1200

  function nextRequestId() {
    requestToken.value += 1
    return requestToken.value
  }

  function isCurrentRequest(requestId: number) {
    return requestId === requestToken.value
  }

  function emit(path: string) {
    const status = statusByPath.value[path] ?? { dirty: false, saving: false, saveError: '' }
    options.emitStatus({ path, dirty: status.dirty, saving: status.saving, saveError: status.saveError })
  }

  function patchStatus(path: string, patch: Partial<SessionStatus>) {
    statusByPath.value = {
      ...statusByPath.value,
      [path]: {
        dirty: patch.dirty ?? statusByPath.value[path]?.dirty ?? false,
        saving: patch.saving ?? statusByPath.value[path]?.saving ?? false,
        saveError: patch.saveError ?? statusByPath.value[path]?.saveError ?? ''
      }
    }
    emit(path)
  }

  function movePathState(from: string, to: string) {
    if (!from || !to || from === to || !statusByPath.value[from]) return
    const next = { ...statusByPath.value }
    next[to] = next[from]
    delete next[from]
    statusByPath.value = next
  }

  function clearAutosaveTimer() {
    if (!autosaveTimer) return
    clearTimeout(autosaveTimer)
    autosaveTimer = null
  }

  /**
   * Schedules autosave and defers once while virtual title is actively edited.
   */
  function scheduleAutosave() {
    clearAutosaveTimer()
    const idleMs = options.isEditingVirtualTitle() ? autosaveTitleIdleMs : autosaveIdleMs
    autosaveTimer = setTimeout(() => {
      // Keep one retry buffer to avoid save/rename races during title edits.
      if (options.isEditingVirtualTitle()) {
        autosaveTimer = setTimeout(() => {
          void options.saveCurrentFile(false)
        }, autosaveTitleRetryMs)
        return
      }
      void options.saveCurrentFile(false)
    }, idleMs)
  }

  return {
    statusByPath,
    nextRequestId,
    isCurrentRequest,
    patchStatus,
    movePathState,
    clearAutosaveTimer,
    scheduleAutosave
  }
}
