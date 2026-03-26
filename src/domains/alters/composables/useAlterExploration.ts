/**
 * Module: useAlterExploration
 *
 * Purpose:
 * - Own the Alter Exploration setup state, session history, and export actions.
 *
 * Boundary:
 * - Keeps IPC transport and markdown/file orchestration out of the view layer.
 * - Exposes a single controller surface for the structured Alter roundtable UI.
 */
import { computed, ref, type Ref } from 'vue'
import type {
  AlterExplorationMode,
  AlterExplorationOutputFormat,
  AlterExplorationRoundResult,
  AlterExplorationSession,
  AlterExplorationSessionSummary,
  AlterExplorationSubject,
  AlterExplorationSubjectType,
  AlterSummary
} from '../../../shared/api/apiTypes'
import { useEchoesPack } from '../../echoes/composables/useEchoesPack'
import { useSecondBrainAtMentions } from '../../second-brain/composables/useSecondBrainAtMentions'
import {
  normalizeWorkspacePath,
  toWorkspacePathKey,
  toWorkspaceRelativePath
} from '../../explorer/lib/workspacePaths'
import {
  cancelWorkspaceAlterExplorationSession,
  createWorkspaceAlterExplorationSession,
  fetchAlterExplorationSessions,
  loadWorkspaceAlterExplorationSession,
  runWorkspaceAlterExplorationSession
} from '../lib/alterExplorationApi'
import { pathExists, readTextFile, writeTextFile } from '../../../shared/api/workspaceApi'

const MIN_ALTERS = 2
const MAX_ALTERS = 4
const DEFAULT_ROUNDS = 2
const MAX_ROUNDS = 3
const MAX_HISTORY_ITEMS = 40
const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const FORBIDDEN_FILE_CHARS_RE = /[<>:"/\\|?*\u0000-\u001f]/g
const MAX_FILE_STEM_LENGTH = 120

export type AlterExplorationRoundGroup = {
  roundNumber: number
  results: AlterExplorationRoundResult[]
}

export type AlterExplorationPromptContextCard = {
  path: string
  name: string
  parent: string
  relativePath: string
}

export type UseAlterExplorationOptions = {
  workspacePath: Ref<string>
  availableAlters: Ref<AlterSummary[]>
  allWorkspaceFiles?: Ref<string[]>
  activeNotePath?: Ref<string | undefined>
  emitOpenNote?: (path: string) => void
}

/**
 * Owns the structured Alter exploration workflow and the file actions that
 * turn a completed session into a reusable note artifact.
 */
export function useAlterExploration(options?: UseAlterExplorationOptions) {
  const workspacePath = options?.workspacePath ?? ref('')
  const availableAlters = options?.availableAlters ?? ref<AlterSummary[]>([])
  const allWorkspaceFiles = options?.allWorkspaceFiles ?? ref<string[]>([])
  const activeNotePath = options?.activeNotePath ?? ref<string | undefined>(undefined)
  const mentionResolver = useSecondBrainAtMentions({
    workspacePath,
    allWorkspaceFiles
  })
  const subjectText = ref('')
  const subjectType = ref<AlterExplorationSubjectType>('prompt')
  const selectedPromptPaths = ref<string[]>([])
  const selectedPromptAnchorPath = ref('')
  const mode = ref<AlterExplorationMode>('challenge')
  const rounds = ref(DEFAULT_ROUNDS)
  const outputFormat = ref<AlterExplorationOutputFormat>('summary')
  const selectedAlterIds = ref<string[]>([])
  const session = ref<AlterExplorationSession | null>(null)
  const sessions = ref<AlterExplorationSessionSummary[]>([])
  const loadingSessions = ref(false)
  const running = ref(false)
  const saving = ref(false)
  const error = ref('')
  const notice = ref('')

  const selectedAlters = computed(() => {
    const byId = new Map(availableAlters.value.map((item) => [item.id, item]))
    return selectedAlterIds.value
      .map((alterId) => byId.get(alterId))
      .filter((alter): alter is AlterSummary => Boolean(alter))
  })

  const promptContextCards = computed<AlterExplorationPromptContextCard[]>(() =>
    selectedPromptPaths.value.map((path) => {
      const absolutePath = normalizeWorkspacePath(path)
      const relativePath = toWorkspaceRelativePath(workspacePath.value, absolutePath)
      const parts = relativePath.split('/')
      return {
        path: absolutePath,
        name: parts.length ? parts[parts.length - 1] : (relativePath || absolutePath),
        parent: parts.slice(0, -1).join('/') || '.',
        relativePath
      }
    })
  )

  const promptContextSet = computed(() => {
    const set = new Set<string>()
    for (const path of selectedPromptPaths.value) {
      set.add(toWorkspacePathKey(path))
    }
    return set
  })

  const promptEchoesAnchor = computed(() => {
    const selectedPath = normalizeWorkspacePath(selectedPromptAnchorPath.value)
    if (!selectedPath) return ''
    return promptContextSet.value.has(toWorkspacePathKey(selectedPath)) ? selectedPath : ''
  })

  const promptEchoes = useEchoesPack(promptEchoesAnchor, {
    limit: 5
  })

  const selectedCountLabel = computed(() => {
    const count = selectedAlterIds.value.length
    return `${count} selected · min ${MIN_ALTERS} · max ${MAX_ALTERS}`
  })

  const selectionLimitReached = computed(() => selectedAlterIds.value.length >= MAX_ALTERS)
  const hasMinimumAlters = computed(() => selectedAlterIds.value.length >= MIN_ALTERS)
  const canStart = computed(() => Boolean(subjectText.value.trim()) && hasMinimumAlters.value && !running.value)

  const roundGroups = computed<AlterExplorationRoundGroup[]>(() => {
    if (!session.value) return []
    const buckets = new Map<number, AlterExplorationRoundResult[]>()
    for (const result of session.value.round_results) {
      const bucket = buckets.get(result.round_number) ?? []
      bucket.push(result)
      buckets.set(result.round_number, bucket)
    }
    return Array.from(buckets.entries())
      .sort(([left], [right]) => left - right)
      .map(([roundNumber, results]) => ({
        roundNumber,
        results: [...results]
      }))
  })

  function normalizeRounds(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_ROUNDS
    return Math.min(Math.max(Math.round(value), DEFAULT_ROUNDS), MAX_ROUNDS)
  }

  function resetSession() {
    session.value = null
    error.value = ''
    notice.value = ''
  }

  function setDefaultAlters(alters: AlterSummary[] = availableAlters.value) {
    if (selectedAlterIds.value.length) return
    const defaults = alters.slice(0, 3).map((item) => item.id)
    selectedAlterIds.value = defaults
  }

  function normalizeContextPaths(paths: string[]): string[] {
    const deduped: string[] = []
    const seen = new Set<string>()
    for (const path of paths) {
      const normalized = normalizeWorkspacePath(path)
      if (!normalized) continue
      const key = toWorkspacePathKey(normalized)
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(normalized)
    }
    return deduped
  }

  function toggleAlterSelection(alterId: string) {
    error.value = ''
    notice.value = ''
    if (selectedAlterIds.value.includes(alterId)) {
      selectedAlterIds.value = selectedAlterIds.value.filter((id) => id !== alterId)
      return
    }
    if (selectedAlterIds.value.length >= MAX_ALTERS) {
      error.value = `Select up to ${MAX_ALTERS} Alters.`
      return
    }
    selectedAlterIds.value = [...selectedAlterIds.value, alterId]
  }

  function replacePromptContextPaths(paths: string[]) {
    selectedPromptPaths.value = normalizeContextPaths(paths)
    if (selectedPromptAnchorPath.value && !isPromptPathInContext(selectedPromptAnchorPath.value)) {
      selectedPromptAnchorPath.value = ''
    }
  }

  function addPromptContextPath(path: string): boolean {
    const normalized = normalizeWorkspacePath(path)
    if (!normalized) return false
    const next = normalizeContextPaths([...selectedPromptPaths.value, normalized])
    selectedPromptPaths.value = next
    return true
  }

  function removePromptContextPath(path: string) {
    const normalized = normalizeWorkspacePath(path)
    if (!normalized) return
    selectedPromptPaths.value = selectedPromptPaths.value.filter((item) => toWorkspacePathKey(item) !== toWorkspacePathKey(normalized))
    if (toWorkspacePathKey(selectedPromptAnchorPath.value) === toWorkspacePathKey(normalized)) {
      selectedPromptAnchorPath.value = ''
    }
  }

  function isPromptPathInContext(path: string): boolean {
    return promptContextSet.value.has(toWorkspacePathKey(path))
  }

  function togglePromptEchoesAnchor(path: string) {
    const normalized = normalizeWorkspacePath(path)
    if (!normalized || !isPromptPathInContext(normalized)) return
    if (toWorkspacePathKey(selectedPromptAnchorPath.value) === toWorkspacePathKey(normalized)) {
      selectedPromptAnchorPath.value = ''
      return
    }
    selectedPromptAnchorPath.value = normalized
  }

  function openPromptContextNote(path: string) {
    const normalized = normalizeWorkspacePath(path)
    if (!normalized) return
    options?.emitOpenNote?.(normalized)
  }

  function resolveAlterName(alterId: string): string {
    const sessionAlter = session.value?.alters?.find((item) => item.id === alterId)
    if (sessionAlter?.name) return sessionAlter.name
    const available = availableAlters.value.find((item) => item.id === alterId)
    return available?.name ?? alterId
  }

  function buildSubject(): AlterExplorationSubject {
    const text = subjectText.value.trim()
    const resolvedMentions = mentionResolver.resolveMentionedPaths(text)
    const contextPaths = normalizeContextPaths([
      ...selectedPromptPaths.value,
      ...resolvedMentions.resolvedPaths
    ])
    return {
      subject_type: subjectType.value,
      text,
      source_id: contextPaths.length ? contextPaths.join('\n') : null
    }
  }

  function buildRoundSummaryMarkdown(): string {
    if (!session.value) return ''
    const lines: string[] = []
    for (const group of roundGroups.value) {
      lines.push(`## Round ${group.roundNumber}`)
      lines.push('')
      for (const result of group.results) {
        lines.push(`### ${resolveAlterName(result.alter_id)}`)
        if (result.references_alter_ids.length) {
          lines.push(`References: ${result.references_alter_ids.map((alterId) => resolveAlterName(alterId)).join(', ')}`)
          lines.push('')
        }
        lines.push(result.content.trim())
        lines.push('')
      }
    }
    return lines.join('\n').trim()
  }

  function buildSessionMarkdown(kind: 'summary' | 'draft' | 'plan'): string {
    if (!session.value) return ''
    const subject = session.value.subject.text.trim()
    const alterNames = selectedAlters.value.map((item) => item.name).join(', ')
    const finalSynthesis = session.value.final_synthesis?.trim() || 'No synthesis available yet.'
    const contextNotes = session.value.subject.source_id
      ? session.value.subject.source_id
          .split(/\r?\n|,/)
          .map((item) => item.trim())
          .filter(Boolean)
      : []

    const headingByKind = {
      summary: 'Alter Exploration Summary',
      draft: 'Alter Exploration Draft',
      plan: 'Alter Exploration Plan'
    } as const

    const bodyByKind = {
      summary: '## Final synthesis',
      draft: '## Draft synthesis',
      plan: '## Decision brief'
    } as const

    const lines = [
      `# ${headingByKind[kind]}: ${subject}`,
      '',
      `- Mode: ${session.value.mode}`,
      `- Rounds: ${session.value.rounds}`,
      `- Output format: ${session.value.output_format}`,
      `- Alters: ${alterNames || session.value.alter_ids.map((alterId) => resolveAlterName(alterId)).join(', ')}`,
      '',
      bodyByKind[kind],
      '',
      finalSynthesis
    ]

    const roundSummary = buildRoundSummaryMarkdown()
    if (roundSummary) {
      lines.push('', '## Round detail', '', roundSummary)
    }

    if (contextNotes.length) {
      lines.push('', '## Context notes', '')
      for (const note of contextNotes) {
        lines.push(`- ${note}`)
      }
    }

    return lines.join('\n').trim() + '\n'
  }

  function sanitizeTitleForFileName(raw: string): string {
    const cleaned = raw
      .replace(FORBIDDEN_FILE_CHARS_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '')

    const base = cleaned.slice(0, MAX_FILE_STEM_LENGTH).trim()
    if (!base) return 'Untitled'
    if (base === '.' || base === '..') return 'Untitled'
    if (WINDOWS_RESERVED_NAME_RE.test(base)) return `${base}-note`
    return base
  }

  async function chooseUniqueWorkspaceNotePath(title: string): Promise<string> {
    const root = workspacePath.value.trim().replace(/\/+$/, '')
    if (!root) {
      throw new Error('Workspace path is not set.')
    }

    const stem = sanitizeTitleForFileName(title)
    let candidate = `${root}/${stem}.md`
    let suffix = 2
    while (await pathExists(candidate)) {
      candidate = `${root}/${stem} (${suffix}).md`
      suffix += 1
      if (suffix > 9_999) {
        throw new Error('Could not choose a unique note name.')
      }
    }
    return candidate
  }

  async function writeSessionArtifact(kind: 'summary' | 'draft' | 'plan'): Promise<string | null> {
    if (!session.value || !session.value.final_synthesis?.trim()) {
      error.value = 'No completed synthesis is available yet.'
      return null
    }

    saving.value = true
    error.value = ''
    notice.value = ''
    try {
      const label = `${kind === 'summary' ? 'Summary' : kind === 'draft' ? 'Draft' : 'Plan'} - ${session.value.subject.text}`
      const path = await chooseUniqueWorkspaceNotePath(label)
      await writeTextFile(path, buildSessionMarkdown(kind))
      notice.value = `Saved exploration artifact to ${path}.`
      return path
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Could not save the exploration artifact.'
      return null
    } finally {
      saving.value = false
    }
  }

  async function refreshSessions() {
    loadingSessions.value = true
    error.value = ''
    try {
      sessions.value = await fetchAlterExplorationSessions(MAX_HISTORY_ITEMS)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Could not load exploration sessions.'
    } finally {
      loadingSessions.value = false
    }
  }

  async function showSession(sessionId: string) {
    if (!sessionId.trim()) return
    error.value = ''
    notice.value = ''
    try {
      session.value = await loadWorkspaceAlterExplorationSession(sessionId)
      selectedAlterIds.value = [...session.value.alter_ids]
      subjectText.value = session.value.subject.text
      subjectType.value = session.value.subject.subject_type
      replacePromptContextPaths(
        session.value.subject.source_id
          ? session.value.subject.source_id.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
          : []
      )
      mode.value = session.value.mode
      rounds.value = session.value.rounds
      outputFormat.value = session.value.output_format
      notice.value = 'Loaded exploration session.'
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Could not load exploration session.'
    }
  }

  async function startExploration(): Promise<boolean> {
    error.value = ''
    notice.value = ''
    rounds.value = normalizeRounds(rounds.value)

    if (!subjectText.value.trim()) {
      error.value = 'Subject is required.'
      return false
    }

    if (selectedAlterIds.value.length < MIN_ALTERS) {
      setDefaultAlters()
    }

    if (selectedAlterIds.value.length < MIN_ALTERS) {
      error.value = `Select at least ${MIN_ALTERS} Alters.`
      return false
    }
    if (selectedAlterIds.value.length > MAX_ALTERS) {
      error.value = `Select no more than ${MAX_ALTERS} Alters.`
      return false
    }

    running.value = true
    try {
      const created = await createWorkspaceAlterExplorationSession({
        subject: buildSubject(),
        alter_ids: selectedAlterIds.value,
        mode: mode.value,
        rounds: rounds.value,
        output_format: outputFormat.value
      })
      session.value = await runWorkspaceAlterExplorationSession({ session_id: created.id })
      selectedAlterIds.value = [...session.value.alter_ids]
      notice.value = 'Alter exploration completed.'
      await refreshSessions()
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Alter exploration failed.'
      return false
    } finally {
      running.value = false
    }
  }

  async function cancelExploration(): Promise<boolean> {
    if (!session.value) return false
    error.value = ''
    notice.value = ''
    try {
      await cancelWorkspaceAlterExplorationSession({ session_id: session.value.id })
      notice.value = 'Cancellation requested.'
      await refreshSessions()
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Could not cancel exploration.'
      return false
    }
  }

  async function saveSynthesisAsNote(): Promise<string | null> {
    return await writeSessionArtifact('summary')
  }

  async function insertSynthesisIntoActiveNote(): Promise<boolean> {
    const activeNotePathValue = activeNotePath.value?.trim()
    if (!activeNotePathValue) {
      error.value = 'No active note is open.'
      return false
    }
    if (!session.value?.final_synthesis?.trim()) {
      error.value = 'No completed synthesis is available yet.'
      return false
    }

    saving.value = true
    error.value = ''
    notice.value = ''
    try {
      let current = ''
      try {
        current = await readTextFile(activeNotePathValue)
      } catch {
        current = ''
      }
      const insertion = `\n\n## Alter Exploration\n\n${buildSessionMarkdown('summary').trim()}\n`
      const nextContent = current.trimEnd() ? `${current.trimEnd()}${insertion}` : insertion.trimStart()
      await writeTextFile(activeNotePathValue, nextContent)
      notice.value = `Inserted exploration synthesis into ${activeNotePathValue}.`
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Could not update the active note.'
      return false
    } finally {
      saving.value = false
    }
  }

  async function promoteSynthesisToDraft(): Promise<string | null> {
    return await writeSessionArtifact('draft')
  }

  async function convertSynthesisToPlan(): Promise<string | null> {
    return await writeSessionArtifact('plan')
  }

  return {
    subjectText,
    subjectType,
    mode,
    rounds,
    outputFormat,
    selectedAlterIds,
    selectedAlters,
    promptContextCards,
    selectedPromptPaths,
    selectedPromptAnchorPath,
    promptEchoes,
    promptEchoesAnchor,
    selectedCountLabel,
    selectionLimitReached,
    hasMinimumAlters,
    canStart,
    session,
    activeSession: session,
    sessions,
    loadingSessions,
    running,
    runningSession: running,
    saving,
    error,
    notice,
    roundGroups,
    addPromptContextPath,
    isPromptPathInContext,
    openPromptContextNote,
    resolveAlterName,
    removePromptContextPath,
    replacePromptContextPaths,
    togglePromptEchoesAnchor,
    toggleAlterSelection,
    toggleAlter: toggleAlterSelection,
    resetSession,
    clearSetup: () => {
      subjectText.value = ''
      subjectType.value = 'prompt'
      selectedPromptPaths.value = []
      selectedPromptAnchorPath.value = ''
      mode.value = 'challenge'
      rounds.value = DEFAULT_ROUNDS
      outputFormat.value = 'summary'
      selectedAlterIds.value = []
      resetSession()
    },
    refreshSessions,
    showSession,
    startExploration,
    startSession: startExploration,
    cancelExploration,
    cancelActiveSession: cancelExploration,
    saveSynthesisAsNote,
    insertSynthesisIntoActiveNote,
    promoteSynthesisToDraft,
    convertSynthesisToPlan,
    setDefaultAlters
  }
}
