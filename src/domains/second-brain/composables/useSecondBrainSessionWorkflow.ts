/**
 * Session and explicit-context workflow for the Second Brain view.
 *
 * This module owns the state that must survive across view interactions:
 * selected session, context chips, Alter selection, Echoes anchor, and session
 * list refreshes. Keeping that logic here prevents the composer and stream
 * runtimes from learning persistence details.
 */
import { computed, onMounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import type {
  AlterSummary,
  AppSettingsAlters,
  SecondBrainMessage,
  SecondBrainSessionSummary
} from '../../../shared/api/apiTypes'
import { fetchAlterList } from '../../alters/lib/altersApi'
import { useEchoesPack } from '../../echoes/composables/useEchoesPack'
import type { EchoesItem } from '../../echoes/lib/echoes'
import {
  createDeliberationSession,
  fetchSecondBrainConfigStatus,
  fetchSecondBrainSessions,
  loadDeliberationSession,
  removeDeliberationSession,
  replaceSessionContext,
  setDeliberationSessionAlter
} from '../lib/secondBrainApi'
import { normalizeContextPathsForUpdate, toAbsoluteWorkspacePath } from '../lib/secondBrainContextPaths'

const DEFAULT_ALTER_SETTINGS: AppSettingsAlters = {
  default_mode: 'neutral',
  show_badge_in_chat: true,
  default_influence_intensity: 'balanced'
}

export type UseSecondBrainSessionWorkflowOptions = {
  workspacePath: Ref<string>
  allWorkspaceFiles: Ref<string[]>
  requestedSessionId: Ref<string>
  requestedSessionNonce: Ref<number>
  requestedAlterId: Ref<string>
  requestedAlterNonce: Ref<number>
  echoesRefreshToken: Ref<number>
  settings: ComputedRef<AppSettingsAlters>
  emitContextChanged: (paths: string[]) => void
  emitSessionChanged: (sessionId: string) => void
  emitOpenNote: (path: string) => void
}

type LoadSyncResult = { ok: true } | { ok: false; error: string }
type ReplaceContextOptions = {
  revertOnFailure?: boolean
}

/**
 * Owns the session-and-context workflow for the Second Brain view.
 *
 * This composable keeps the session lifecycle, explicit context state, Alter
 * selection, and Echoes anchors together so `SecondBrainView.vue` can stay a
 * render shell and the conversation runtime can consume a stable session API.
 */
export function useSecondBrainSessionWorkflow(options: UseSecondBrainSessionWorkflowOptions) {
  const configError = ref('')
  const loading = ref(false)
  const creatingSession = ref(false)
  const sessionId = ref('')
  const sessionTitle = ref('Second Brain Session')
  const sessionLoadError = ref('')
  const scrollRequestNonce = ref(0)
  const contextPaths = ref<string[]>([])
  const contextTokenEstimate = ref<Record<string, number>>({})
  const messages = ref<SecondBrainMessage[]>([])
  const streamByMessage = ref<Record<string, string>>({})
  const mentionInfo = ref('')
  const composerContextPaths = ref<string[]>([])
  const sessionsIndex = ref<SecondBrainSessionSummary[]>([])
  const availableAlters = ref<AlterSummary[]>([])
  const selectedAlterId = ref('')
  const selectedEchoesContextPath = ref('')

  const alterSettings = computed<AppSettingsAlters>(() => options.settings.value ?? DEFAULT_ALTER_SETTINGS)

  /**
   * Converts a workspace path to a display-friendly relative path.
   *
   * This is used in chips, copy messages, and error text so user-facing paths
   * stay stable across absolute workspace locations.
   */
  function toRelativePath(path: string): string {
    const value = path.replace(/\\/g, '/')
    const root = options.workspacePath.value.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!root) return value
    if (value === root) return '.'
    if (value.startsWith(`${root}/`)) return value.slice(root.length + 1)
    return value
  }

  /**
   * Produces a normalized key for comparing document identity across inputs.
   *
   * The key intentionally collapses separator differences and casing so the UI
   * can deduplicate context chips and Echoes anchors reliably.
   */
  function canonicalWorkspaceDocumentKey(path: string): string {
    const absolute = toAbsoluteWorkspacePath(options.workspacePath.value, path)
    const relative = toRelativePath(absolute)
    return relative
      .normalize('NFC')
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .replace(/\/+/g, '/')
      .trim()
      .toLocaleLowerCase()
  }

  const contextCards = computed(() =>
    contextPaths.value.map((path) => {
      const relativePath = toRelativePath(path)
      const parts = relativePath.split('/')
      return {
        path,
        name: parts[parts.length - 1],
        parent: parts.slice(0, -1).join('/') || '.'
      }
    })
  )

  const contextPathSet = computed(() => new Set(
    contextPaths.value
      .map((path) => canonicalWorkspaceDocumentKey(path))
      .filter(Boolean)
  ))

  const echoesAnchorPath = computed(() => {
    const selectedPath = selectedEchoesContextPath.value.trim()
    if (selectedPath && contextPathSet.value.has(canonicalWorkspaceDocumentKey(selectedPath))) return selectedPath
    return ''
  })

  const showEchoesPanel = computed(() => echoesAnchorPath.value.trim().length > 0)

  const echoes = useEchoesPack(echoesAnchorPath, {
    limit: 5,
    refreshKey: () => options.echoesRefreshToken.value
  })

  const echoesItems = computed<EchoesItem[]>(() => {
    const deduped: EchoesItem[] = []
    const seen = new Set<string>()

    for (const item of echoes.items.value) {
      const normalizedPath = toAbsoluteWorkspacePath(options.workspacePath.value, item.path)
      const identityKey = canonicalWorkspaceDocumentKey(item.path)
      if (!normalizedPath || !identityKey || seen.has(identityKey)) continue
      seen.add(identityKey)
      deduped.push({
        ...item,
        path: normalizedPath
      })
    }

    return deduped
  })

  const activeAlterLabel = computed(() => {
    if (!selectedAlterId.value) return 'Neutral'
    return availableAlters.value.find((item) => item.id === selectedAlterId.value)?.name ?? 'Neutral'
  })

  /**
   * Returns whether a path is already part of the active session context.
   */
  function isPathInContext(path: string): boolean {
    return contextPathSet.value.has(canonicalWorkspaceDocumentKey(path))
  }

  /**
   * Merges new paths into the current context without duplicating entries.
   */
  function mergeContextPaths(nextPaths: string[]): string[] {
    const merged = new Set(contextPaths.value)
    for (const path of nextPaths) {
      merged.add(path)
    }
    return Array.from(merged)
  }

  /**
   * Resets the session-scoped UI state back to the empty shell state.
   *
   * This is used when a session is deleted or when the view first opens
   * without a requested session id.
   */
  function resetConversationState(config: { emitSessionChange?: boolean } = {}) {
    sessionId.value = ''
    if (config.emitSessionChange ?? true) {
      options.emitSessionChanged('')
    }
    sessionTitle.value = 'Second Brain Session'
    contextPaths.value = []
    contextTokenEstimate.value = {}
    messages.value = []
    streamByMessage.value = {}
    composerContextPaths.value = []
    selectedAlterId.value = alterSettings.value.default_mode === 'last_used' ? selectedAlterId.value : ''
    mentionInfo.value = ''
    options.emitContextChanged([])
  }

  /**
   * Persists the current context list and reconciles local token estimates.
   *
   * Returning a tagged result keeps the caller in charge of rollback and user
   * messaging so failure handling stays explicit at the workflow boundary.
   */
  async function syncContextWithBackend(): Promise<LoadSyncResult> {
    if (!sessionId.value) return { ok: true }
    try {
      const normalized = normalizeContextPathsForUpdate(options.workspacePath.value, contextPaths.value)
      await replaceSessionContext(sessionId.value, normalized)
      contextPaths.value = normalized
      const next: Record<string, number> = {}
      for (const path of normalized) {
        next[path] = contextTokenEstimate.value[path] ?? 0
      }
      contextTokenEstimate.value = next
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update context.'
      return { ok: false, error: message }
    }
  }

  /**
   * Replaces the active context list and optionally rolls back on failure.
   */
  async function replaceContextPaths(nextPaths: string[], config: ReplaceContextOptions = {}): Promise<LoadSyncResult> {
    const previousContextPaths = [...contextPaths.value]
    contextPaths.value = nextPaths
    options.emitContextChanged(contextPaths.value)

    const sync = await syncContextWithBackend()
    if (!sync.ok && (config.revertOnFailure ?? true)) {
      contextPaths.value = previousContextPaths
      options.emitContextChanged(contextPaths.value)
    }

    return sync
  }

  /**
   * Removes one context chip and syncs the new list back to the backend.
   */
  async function removeContextPath(path: string) {
    const previousContextPaths = [...contextPaths.value]
    const previousComposerPaths = [...composerContextPaths.value]
    contextPaths.value = contextPaths.value.filter((item) => item !== path)
    composerContextPaths.value = composerContextPaths.value.filter((item) => item !== path)
    options.emitContextChanged(contextPaths.value)

    const sync = await syncContextWithBackend()
    if (!sync.ok) {
      contextPaths.value = previousContextPaths
      composerContextPaths.value = previousComposerPaths
      options.emitContextChanged(contextPaths.value)
      mentionInfo.value = `Could not remove ${toRelativePath(path)} from Second Brain context: ${sync.error}`
      return
    }

    mentionInfo.value = ''
  }

  /**
   * Adds a path to the context list and keeps the rollback path explicit.
   */
  async function addPathToContext(path: string): Promise<boolean> {
    if (!path.trim()) return false
    const previousContextPaths = [...contextPaths.value]
    contextPaths.value = mergeContextPaths([path])
    options.emitContextChanged(contextPaths.value)

    const sync = await syncContextWithBackend()
    if (!sync.ok) {
      contextPaths.value = previousContextPaths
      options.emitContextChanged(contextPaths.value)
      mentionInfo.value = `Could not add ${toRelativePath(path)} to Second Brain context: ${sync.error}`
      return false
    }

    mentionInfo.value = ''
    return true
  }

  /**
   * Loads a persisted session into the current session shell.
   *
   * The load step is where persisted messages, title, Alter selection, and
   * context chips re-enter the local state.
   */
  async function loadSession(nextSessionId: string) {
    if (!nextSessionId.trim()) return
    loading.value = true
    sessionLoadError.value = ''
    mentionInfo.value = ''
    composerContextPaths.value = []
    try {
      const payload = await loadDeliberationSession(nextSessionId.trim())
      sessionId.value = payload.session_id
      options.emitSessionChanged(sessionId.value)
      sessionTitle.value = payload.title || 'Second Brain Session'
      selectedAlterId.value = payload.alter_id || ''
      contextPaths.value = payload.context_items.map((item) => toAbsoluteWorkspacePath(options.workspacePath.value, item.path))

      const nextTokens: Record<string, number> = {}
      for (const item of payload.context_items) {
        nextTokens[toAbsoluteWorkspacePath(options.workspacePath.value, item.path)] = item.token_estimate
      }
      contextTokenEstimate.value = nextTokens

      messages.value = payload.messages
      options.emitContextChanged(contextPaths.value)
      scrollRequestNonce.value += 1
    } catch (err) {
      sessionLoadError.value = err instanceof Error ? err.message : 'Could not load session.'
    } finally {
      loading.value = false
    }
  }

  /**
   * Refreshes the session dropdown index.
   */
  async function refreshSessionsIndex() {
    try {
      sessionsIndex.value = await fetchSecondBrainSessions(120)
    } catch {
      sessionsIndex.value = []
    }
  }

  /**
   * Refreshes the available Alter list for the header selector.
   */
  async function refreshAlterList() {
    try {
      availableAlters.value = await fetchAlterList()
    } catch {
      availableAlters.value = []
    }
  }

  /**
   * Persists the selected Alter for the active session.
   */
  async function applySelectedAlter(alterId: string) {
    const normalized = (alterId ?? '').trim()
    selectedAlterId.value = normalized
    if (!sessionId.value) return
    try {
      await setDeliberationSessionAlter(sessionId.value, normalized || null)
    } catch (err) {
      mentionInfo.value = err instanceof Error ? err.message : 'Could not update Alter.'
    }
  }

  /**
   * Creates a new blank session and makes it the active session.
   */
  async function onCreateSession() {
    if (creatingSession.value) return
    creatingSession.value = true
    try {
      const created = await createDeliberationSession(
        selectedAlterId.value
          ? { contextPaths: [], title: '', alterId: selectedAlterId.value }
          : { contextPaths: [], title: '' }
      )
      sessionId.value = created.sessionId
      options.emitSessionChanged(sessionId.value)
      sessionTitle.value = 'Second Brain Session'
      contextPaths.value = []
      contextTokenEstimate.value = {}
      messages.value = []
      streamByMessage.value = {}
      composerContextPaths.value = []
      mentionInfo.value = ''
      options.emitContextChanged(contextPaths.value)
      await refreshSessionsIndex()
      scrollRequestNonce.value += 1
    } finally {
      creatingSession.value = false
    }
  }

  /**
   * Deletes a persisted session and resets the shell if it was active.
   */
  async function onDeleteSession(sessionToDelete: string) {
    if (!sessionToDelete.trim()) return
    await removeDeliberationSession(sessionToDelete)
    await refreshSessionsIndex()

    if (sessionId.value !== sessionToDelete) return

    resetConversationState()
  }

  /**
   * Resolves the initial session state the first time the view opens.
   *
   * The order is deliberate: refresh metadata first, then load the requested
   * session if one was supplied, otherwise open the shell in a clean state.
   */
  async function initializeSessionOnFirstOpen() {
    if (sessionId.value) return

    void refreshAlterList()
    await refreshSessionsIndex()
    if (sessionId.value) return

    if (options.requestedSessionId.value.trim()) {
      await loadSession(options.requestedSessionId.value.trim())
    } else {
      selectedAlterId.value = alterSettings.value.default_mode === 'last_used'
        ? options.requestedAlterId.value.trim()
        : ''
      resetConversationState({ emitSessionChange: false })
    }
  }

  /**
   * Emits the open-note event for a context chip.
   */
  function openContextNote(path: string) {
    options.emitOpenNote(path)
  }

  /**
   * Toggles which context chip feeds the Echoes suggestions panel.
   */
  function toggleEchoesAnchor(path: string) {
    if (selectedEchoesContextPath.value === path) {
      selectedEchoesContextPath.value = ''
      return
    }

    selectedEchoesContextPath.value = path
  }

  /**
   * Adds an Echoes suggestion to the active context list.
   */
  async function addEchoesSuggestion(path: string) {
    await addPathToContext(path)
  }

  onMounted(async () => {
    await refreshAlterList()
    try {
      const status = await fetchSecondBrainConfigStatus()
      if (!status.configured) {
        configError.value = status.error || 'Second Brain config is missing.'
      }
    } catch (err) {
      configError.value = err instanceof Error ? err.message : 'Could not read config status.'
    }

    await initializeSessionOnFirstOpen()
  })

  watch(
    () => `${options.requestedSessionNonce.value}::${options.requestedSessionId.value}`,
    (value) => {
      const [nonce, id] = value.split('::')
      if (!nonce.trim() || !id.trim()) return
      void loadSession(id)
    }
  )

  watch(
    () => `${options.requestedAlterNonce.value}::${options.requestedAlterId.value}`,
    (value) => {
      const [nonce] = value.split('::')
      if (!nonce.trim()) return
      void applySelectedAlter(options.requestedAlterId.value)
    },
    { immediate: true }
  )

  return {
    activeAlterLabel,
    addEchoesSuggestion,
    addPathToContext,
    alterSettings,
    applySelectedAlter,
    availableAlters,
    configError,
    contextCards,
    contextPaths,
    contextTokenEstimate,
    creatingSession,
    composerContextPaths,
    echoes,
    echoesItems,
    initializeSessionOnFirstOpen,
    isPathInContext,
    loading,
    loadSession,
    mentionInfo,
    messages,
    mergeContextPaths,
    onCreateSession,
    onDeleteSession,
    openContextNote,
    refreshAlterList,
    refreshSessionsIndex,
    removeContextPath,
    replaceContextPaths,
    resetConversationState,
    selectedAlterId,
    selectedEchoesContextPath,
    sessionId,
    sessionTitle,
    sessionLoadError,
    scrollRequestNonce,
    sessionsIndex,
    showEchoesPanel,
    streamByMessage,
    toRelativePath,
    toggleEchoesAnchor
  }
}
