import { ref, watch, type Ref } from 'vue'

/**
 * Module: useAppSecondBrainBridge
 *
 * Purpose:
 * - Own Second Brain session persistence and context synchronization for the
 *   app shell.
 */

/** Groups the shell refs that define the current workspace and active note. */
export type AppSecondBrainWorkspacePort = {
  workingFolderPath: Readonly<Ref<string>>
  activeFilePath: Readonly<Ref<string>>
}

/** Groups the path helpers used to persist and normalize Second Brain context. */
export type AppSecondBrainContextPort = {
  storageKeyForWorkspace: (workspacePath: string) => string
  toAbsoluteWorkspacePath: (workspacePath: string, path: string) => string | null
  normalizeContextPathsForUpdate: (workspacePath: string, paths: string[]) => string[]
}

/** Groups the session API calls used by the shell bridge. */
export type AppSecondBrainSessionPort = {
  createDeliberationSession: (payload: { contextPaths: string[]; title: string }) => Promise<{ sessionId: string }>
  loadDeliberationSession: (sessionId: string) => Promise<{
    session_id: string
    context_items: Array<{ path?: unknown }>
  }>
  replaceSessionContext: (sessionId: string, paths: string[]) => Promise<unknown>
}

/** Groups UI-facing effects while keeping storage responsibility local to the bridge. */
export type AppSecondBrainUiEffectsPort = {
  errorMessage: Ref<string>
  notifySuccess: (message: string) => void
}

/**
 * Declares the grouped dependencies required by the shell Second Brain bridge.
 *
 * Ports keep workspace, context, session API, and UI effects readable without
 * pushing localStorage persistence out of the shell boundary.
 */
export type UseAppSecondBrainBridgeOptions = {
  secondBrainWorkspacePort: AppSecondBrainWorkspacePort
  secondBrainContextPort: AppSecondBrainContextPort
  secondBrainSessionPort: AppSecondBrainSessionPort
  secondBrainUiEffectsPort: AppSecondBrainUiEffectsPort
}

/** Owns requested session persistence and context updates for the shell Second Brain surface. */
export function useAppSecondBrainBridge(options: UseAppSecondBrainBridgeOptions) {
  const {
    secondBrainWorkspacePort,
    secondBrainContextPort,
    secondBrainSessionPort,
    secondBrainUiEffectsPort
  } = options
  const secondBrainRequestedSessionId = ref('')
  const secondBrainRequestedSessionNonce = ref(0)
  const secondBrainRequestedPrompt = ref('')
  const secondBrainRequestedPromptNonce = ref(0)

  function currentWorkspacePath() {
    return secondBrainWorkspacePort.workingFolderPath.value.trim()
  }

  /** Persists the requested session id for the currently open workspace. */
  function persistSecondBrainSessionId(sessionId: string) {
    const workspacePath = currentWorkspacePath()
    if (!workspacePath) return
    const storageKey = secondBrainContextPort.storageKeyForWorkspace(workspacePath)
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
    const storageKey = secondBrainContextPort.storageKeyForWorkspace(normalizedPath)
    return window.localStorage.getItem(storageKey)?.trim() ?? ''
  }

  /**
   * Restores a persisted session request when the user explicitly opens Second Brain.
   *
   * This keeps the add-to-second-brain flow sticky without changing workspace-change
   * behavior or auto-resuming sessions on shell startup.
   */
  function primeRequestedSecondBrainSessionFromStorage(): string {
    const currentRequestedId = secondBrainRequestedSessionId.value.trim()
    if (currentRequestedId) return currentRequestedId

    const workspacePath = currentWorkspacePath()
    const persistedSessionId = readPersistedSecondBrainSessionId(workspacePath)
    if (!persistedSessionId) return ''

    setSecondBrainSessionId(persistedSessionId, { bumpNonce: true })
    return persistedSessionId
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
    const workspacePath = currentWorkspacePath()
    const normalizedSeedPath = secondBrainContextPort.toAbsoluteWorkspacePath(workspacePath, seedPath)
    if (!normalizedSeedPath) {
      throw new Error('Could not resolve active note path for Second Brain.')
    }

    const requestedId = secondBrainRequestedSessionId.value.trim() || readPersistedSecondBrainSessionId(workspacePath)
    if (requestedId) {
      try {
        const existing = await secondBrainSessionPort.loadDeliberationSession(requestedId)
        if (existing.session_id.trim()) return existing.session_id.trim()
      } catch {
        // Session may have been deleted; create a fresh one for this workspace.
      }
    }

    const created = await secondBrainSessionPort.createDeliberationSession({
      contextPaths: [normalizedSeedPath],
      title: ''
    })
    return created.sessionId.trim()
  }

  /** Ensures a path is present in the requested session context without duplicating existing items. */
  async function ensurePathInSecondBrainSession(sessionId: string, path: string) {
    const workspacePath = currentWorkspacePath()
    const payload = await secondBrainSessionPort.loadDeliberationSession(sessionId)
    const merged = secondBrainContextPort.normalizeContextPathsForUpdate(workspacePath, [
      ...payload.context_items.map((item) => String(item.path ?? '')),
      path
    ])
    await secondBrainSessionPort.replaceSessionContext(sessionId, merged)
  }

  /** Adds the active note to the requested session context, creating a session when needed. */
  async function addActiveNoteToSecondBrain() {
    const workspacePath = currentWorkspacePath()
    if (!workspacePath) {
      secondBrainUiEffectsPort.errorMessage.value = 'Open a workspace first.'
      return false
    }

    const activePath = secondBrainWorkspacePort.activeFilePath.value.trim()
    if (!activePath) {
      secondBrainUiEffectsPort.errorMessage.value = 'No active note to add to Second Brain.'
      return false
    }

    try {
      const normalizedActivePath = secondBrainContextPort.toAbsoluteWorkspacePath(workspacePath, activePath)
      if (!normalizedActivePath) {
        throw new Error('Could not resolve active note path for Second Brain.')
      }
      const sessionId = await resolveSecondBrainSessionForPath(normalizedActivePath)
      await ensurePathInSecondBrainSession(sessionId, normalizedActivePath)
      setSecondBrainSessionId(sessionId, { bumpNonce: true })
      secondBrainUiEffectsPort.notifySuccess('Active note added to Second Brain context.')
      return true
    } catch (err) {
      secondBrainUiEffectsPort.errorMessage.value =
        err instanceof Error ? err.message : 'Could not update Second Brain context.'
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
    () => secondBrainWorkspacePort.workingFolderPath.value,
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
    primeRequestedSecondBrainSessionFromStorage,
    resolveSecondBrainSessionForPath,
    ensurePathInSecondBrainSession,
    addActiveNoteToSecondBrain,
    onSecondBrainContextChanged,
    onSecondBrainSessionChanged
  }
}
