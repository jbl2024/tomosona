import { ref, watch, type Ref } from 'vue'

/**
 * Module: useAppSecondBrainBridge
 *
 * Purpose:
 * - Own Second Brain session persistence and context synchronization for the
 *   app shell.
 */

/** Declares the services and state required to bridge the shell with Second Brain sessions. */
export type UseAppSecondBrainBridgeOptions = {
  workingFolderPath: Readonly<Ref<string>>
  activeFilePath: Readonly<Ref<string>>
  errorMessage: Ref<string>
  notifySuccess: (message: string) => void
  storageKeyForWorkspace: (workspacePath: string) => string
  toAbsoluteWorkspacePath: (workspacePath: string, path: string) => string | null
  normalizeContextPathsForUpdate: (workspacePath: string, paths: string[]) => string[]
  createDeliberationSession: (payload: { contextPaths: string[]; title: string }) => Promise<{ sessionId: string }>
  loadDeliberationSession: (sessionId: string) => Promise<{
    session_id: string
    context_items: Array<{ path?: unknown }>
  }>
  replaceSessionContext: (sessionId: string, paths: string[]) => Promise<unknown>
}

/** Owns requested session persistence and context updates for the shell Second Brain surface. */
export function useAppSecondBrainBridge(options: UseAppSecondBrainBridgeOptions) {
  const secondBrainRequestedSessionId = ref('')
  const secondBrainRequestedSessionNonce = ref(0)
  const secondBrainRequestedPrompt = ref('')
  const secondBrainRequestedPromptNonce = ref(0)

  /** Persists the requested session id for the currently open workspace. */
  function persistSecondBrainSessionId(sessionId: string) {
    const workspacePath = options.workingFolderPath.value.trim()
    if (!workspacePath) return
    const storageKey = options.storageKeyForWorkspace(workspacePath)
    const normalized = sessionId.trim()
    if (!normalized) {
      window.localStorage.removeItem(storageKey)
      return
    }
    window.localStorage.setItem(storageKey, normalized)
  }

  /** Reads the persisted session id for a workspace path. */
  function readPersistedSecondBrainSessionId(workspacePath: string): string {
    const normalizedPath = workspacePath.trim()
    if (!normalizedPath) return ''
    const storageKey = options.storageKeyForWorkspace(normalizedPath)
    return window.localStorage.getItem(storageKey)?.trim() ?? ''
  }

  /** Updates the requested session id and optionally bumps the nonce consumed by the surface. */
  function setSecondBrainSessionId(sessionId: string, optionsArg?: { bumpNonce?: boolean }) {
    const normalized = sessionId.trim()
    secondBrainRequestedSessionId.value = normalized
    persistSecondBrainSessionId(normalized)
    if (optionsArg?.bumpNonce) {
      secondBrainRequestedSessionNonce.value += 1
    }
  }

  function setSecondBrainPrompt(prompt: string, optionsArg?: { bumpNonce?: boolean }) {
    secondBrainRequestedPrompt.value = prompt
    if (optionsArg?.bumpNonce) {
      secondBrainRequestedPromptNonce.value += 1
    }
  }

  /** Resolves an existing session for the active note or creates a new one when needed. */
  async function resolveSecondBrainSessionForPath(seedPath: string): Promise<string> {
    const workspacePath = options.workingFolderPath.value.trim()
    const normalizedSeedPath = options.toAbsoluteWorkspacePath(workspacePath, seedPath)
    if (!normalizedSeedPath) {
      throw new Error('Could not resolve active note path for Second Brain.')
    }

    const requestedId = secondBrainRequestedSessionId.value.trim() || readPersistedSecondBrainSessionId(workspacePath)
    if (requestedId) {
      try {
        const existing = await options.loadDeliberationSession(requestedId)
        if (existing.session_id.trim()) return existing.session_id.trim()
      } catch {
        // Session may have been deleted; create a fresh one for this workspace.
      }
    }

    const created = await options.createDeliberationSession({ contextPaths: [normalizedSeedPath], title: '' })
    return created.sessionId.trim()
  }

  /** Ensures a path is present in the requested session context without duplicating existing items. */
  async function ensurePathInSecondBrainSession(sessionId: string, path: string) {
    const workspacePath = options.workingFolderPath.value.trim()
    const payload = await options.loadDeliberationSession(sessionId)
    const merged = options.normalizeContextPathsForUpdate(workspacePath, [
      ...payload.context_items.map((item) => String(item.path ?? '')),
      path
    ])
    await options.replaceSessionContext(sessionId, merged)
  }

  /** Adds the active note to the requested session context, creating a session when needed. */
  async function addActiveNoteToSecondBrain() {
    const workspacePath = options.workingFolderPath.value.trim()
    if (!workspacePath) {
      options.errorMessage.value = 'Open a workspace first.'
      return false
    }

    const activePath = options.activeFilePath.value.trim()
    if (!activePath) {
      options.errorMessage.value = 'No active note to add to Second Brain.'
      return false
    }

    try {
      const normalizedActivePath = options.toAbsoluteWorkspacePath(workspacePath, activePath)
      if (!normalizedActivePath) {
        throw new Error('Could not resolve active note path for Second Brain.')
      }
      const sessionId = await resolveSecondBrainSessionForPath(normalizedActivePath)
      await ensurePathInSecondBrainSession(sessionId, normalizedActivePath)
      setSecondBrainSessionId(sessionId, { bumpNonce: true })
      options.notifySuccess('Active note added to Second Brain context.')
      return true
    } catch (err) {
      options.errorMessage.value = err instanceof Error ? err.message : 'Could not update Second Brain context.'
      return false
    }
  }

  /** Accepts context-change events from the surface. Reserved for future sync behavior. */
  function onSecondBrainContextChanged(_paths: string[]) {}

  /** Accepts session-change events from the surface and persists the requested id. */
  function onSecondBrainSessionChanged(sessionId: string) {
    setSecondBrainSessionId(sessionId)
  }

  watch(
    () => options.workingFolderPath.value,
    () => {
      secondBrainRequestedSessionId.value = ''
      secondBrainRequestedSessionNonce.value += 1
    },
    { immediate: true }
  )

  return {
    secondBrainRequestedSessionId,
    secondBrainRequestedSessionNonce,
    secondBrainRequestedPrompt,
    secondBrainRequestedPromptNonce,
    readPersistedSecondBrainSessionId,
    setSecondBrainSessionId,
    setSecondBrainPrompt,
    resolveSecondBrainSessionForPath,
    ensurePathInSecondBrainSession,
    addActiveNoteToSecondBrain,
    onSecondBrainContextChanged,
    onSecondBrainSessionChanged
  }
}
