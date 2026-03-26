/**
 * Composer workflow for the Second Brain chat surface.
 *
 * This module owns user input, mention resolution, Pulse prompt prep, and
 * clipboard/export helpers. It deliberately does not own stream lifecycle,
 * which stays in the sibling stream runtime.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { FilterableDropdownItem } from '../../../shared/components/ui/UiFilterableDropdown.vue'
import type { PulseActionId, SecondBrainMessage, SecondBrainSessionSummary } from '../../../shared/api/apiTypes'
import { writeClipboardText } from '../../../shared/api/clipboardApi'
import { readTextFile } from '../../../shared/api/workspaceApi'
import { PULSE_ACTIONS_BY_SOURCE, getPulseDropdownItems } from '../../pulse/lib/pulse'
import { runDeliberation } from '../lib/secondBrainApi'
import { useSecondBrainAtMentions, type SecondBrainAtMentionItem } from './useSecondBrainAtMentions'

type CopyToast = {
  visible: boolean
  kind: 'success' | 'error'
  message: string
}

type ContextSyncResult = { ok: true } | { ok: false; error: string }

export type UseSecondBrainConversationRuntimeOptions = {
  workspacePath: Ref<string>
  allWorkspaceFiles: Ref<string[]>
  contextPaths: Ref<string[]>
  messages: Ref<SecondBrainMessage[]>
  mentionInfo: Ref<string>
  composerContextPaths: Ref<string[]>
  sessionId: Ref<string>
  sessionTitle: Ref<string>
  selectedAlterId: Ref<string>
  sessionsIndex: Ref<SecondBrainSessionSummary[]>
  requestInFlight: Ref<boolean>
  sending: Ref<boolean>
  sendError: Ref<string>
  activeAssistantStreamMessageId: Ref<string | null>
  suppressCancellationError: Ref<boolean>
  displayMessage: (message: SecondBrainMessage) => string
  scrollThreadToBottom: (config?: { force?: boolean }) => Promise<void>
  mergeContextPaths: (nextPaths: string[]) => string[]
  replaceContextPaths: (nextPaths: string[], config?: { revertOnFailure?: boolean }) => Promise<ContextSyncResult>
  refreshSessionsIndex: () => Promise<void>
  requestedPrompt: Ref<string>
  requestedPromptNonce: Ref<number>
}

/**
 * Owns the Second Brain composer surface.
 *
 * This composable keeps prompt input, mention resolution, Pulse presets, and
 * clipboard/export helpers together. Streaming state is owned by the sibling
 * stream runtime.
 */
export function useSecondBrainConversationRuntime(options: UseSecondBrainConversationRuntimeOptions) {
  const COMPOSER_MIN_HEIGHT_PX = 34
  const COMPOSER_MAX_HEIGHT_PX = 120

  const inputMessage = ref('')
  const copiedByMessageId = ref<Record<string, boolean>>({})
  const copyToast = ref<CopyToast>({
    visible: false,
    kind: 'success',
    message: ''
  })
  const composerRef = ref<HTMLTextAreaElement | null>(null)
  const pulseActionId = ref<PulseActionId>('synthesize')
  const pulseDropdownOpen = ref(false)
  const pulseDropdownQuery = ref('')
  const pulseDropdownActiveIndex = ref(0)

  const copyFeedbackTimers: Record<string, ReturnType<typeof setTimeout>> = {}
  let copyToastTimer: ReturnType<typeof setTimeout> | null = null

  const mentions = useSecondBrainAtMentions({
    workspacePath: options.workspacePath,
    allWorkspaceFiles: options.allWorkspaceFiles
  })

  const pulseActions = computed(() => PULSE_ACTIONS_BY_SOURCE.second_brain_context)
  const pulseDropdownItems = computed(() => getPulseDropdownItems('second_brain_context', { grouped: true }))
  const activePulseAction = computed(
    () => pulseActions.value.find((item) => item.id === pulseActionId.value) ?? pulseActions.value[0]
  )

  const canCopyConversation = computed(() =>
    Boolean(options.sessionId.value && !options.requestInFlight.value && (options.contextPaths.value.length > 0 || options.messages.value.length > 0))
  )

  /**
   * Keeps the composer textarea collapsed to one line until content needs more space.
   *
   * The height is clamped so the input grows naturally but never exceeds the
   * current visual cap used by the surrounding layout.
   */
  function syncComposerHeight() {
    const composer = composerRef.value
    if (!composer) return

    composer.style.height = 'auto'
    const nextHeight = Math.min(Math.max(composer.scrollHeight, COMPOSER_MIN_HEIGHT_PX), COMPOSER_MAX_HEIGHT_PX)
    composer.style.height = `${nextHeight}px`
    composer.style.overflowY = composer.scrollHeight > COMPOSER_MAX_HEIGHT_PX ? 'auto' : 'hidden'
  }

  /**
   * Formats a workspace path for user-facing text and export output.
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
   * Displays a transient clipboard feedback toast.
   *
   * The timeout is reset on every call so rapid repeat copies do not leave
   * stale toast state behind.
   */
  function showCopyToast(kind: 'success' | 'error', message: string, durationMs = 2000) {
    if (copyToastTimer) clearTimeout(copyToastTimer)
    copyToast.value = {
      visible: true,
      kind,
      message
    }
    copyToastTimer = setTimeout(() => {
      copyToast.value.visible = false
      copyToastTimer = null
    }, durationMs)
  }

  /**
   * Builds the markdown export for the current session.
   *
   * This export is intentionally explicit: context first, then conversation,
   * so the output is stable and readable when copied or saved elsewhere.
   */
  function buildConversationMarkdown(contextEntries: Array<{ path: string; content: string }>): string {
    const lines: string[] = [`# ${options.sessionTitle.value || 'Second Brain Session'}`, '', '## Context', '']

    for (const entry of contextEntries) {
      lines.push(`### ${toRelativePath(entry.path)}`, '', entry.content.trimEnd(), '')
    }

    lines.push('## Conversation', '')
    for (const message of options.messages.value) {
      lines.push(`### ${message.role === 'assistant' ? 'Assistant' : 'You'}`, '')
      lines.push(options.displayMessage(message).trimEnd(), '')
    }

    return lines.join('\n').trim()
  }

  /**
   * Writes text to the clipboard, falling back to the native Tauri helper.
   *
   * The browser clipboard is tried first so the webview path stays fast when
   * permissions allow it, but desktop fallback keeps the action reliable.
   */
  async function writeTextToClipboard(text: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return
      }
    } catch {
      // Fall back to the native Tauri clipboard helper when the web clipboard is unavailable.
    }
    await writeClipboardText(text)
  }

  /**
   * Copies the full conversation and explicit context to the clipboard.
   */
  async function onCopyConversation() {
    if (!canCopyConversation.value) return

    try {
      const contextEntries = await Promise.all(options.contextPaths.value.map(async (path) => ({
        path,
        content: await readTextFile(path)
      })))
      const markdown = buildConversationMarkdown(contextEntries)
      await writeTextToClipboard(markdown)
      showCopyToast('success', 'Conversation copied to clipboard.')
    } catch (err) {
      showCopyToast(
        'error',
        err instanceof Error ? err.message : 'Could not copy conversation.',
        2700
      )
    }
  }

  /**
   * Copies the currently visible assistant text to the clipboard.
   */
  async function onCopyAssistantMessage(message: SecondBrainMessage) {
    if (message.role !== 'assistant') return
    const content = options.displayMessage(message).trim()
    if (!content) return

    try {
      await writeTextToClipboard(content)
      copiedByMessageId.value = {
        ...copiedByMessageId.value,
        [message.id]: true
      }
      if (copyFeedbackTimers[message.id]) {
        clearTimeout(copyFeedbackTimers[message.id])
      }
      copyFeedbackTimers[message.id] = setTimeout(() => {
        const next = { ...copiedByMessageId.value }
        delete next[message.id]
        copiedByMessageId.value = next
        delete copyFeedbackTimers[message.id]
      }, 1300)
      showCopyToast('success', 'Copied to clipboard.')
    } catch (err) {
      showCopyToast(
        'error',
        err instanceof Error ? err.message : 'Could not copy assistant response.',
        2700
      )
    }
  }

  /**
   * Recomputes the current `@` trigger from the composer caret position.
   */
  function updateMentionTriggerFromComposer() {
    mentions.updateTrigger(inputMessage.value, composerRef.value?.selectionStart ?? null)
  }

  /**
   * Syncs the textarea input into the reactive composer state.
   */
  function onComposerInput(event: Event) {
    inputMessage.value = (event.target as HTMLTextAreaElement).value
    updateMentionTriggerFromComposer()
    void nextTick(syncComposerHeight)
  }

  /**
   * Applies a mention suggestion and persists the resolved path.
   *
   * The local composer path list is restored if backend sync fails so the user
   * does not lose what they just selected.
   */
  async function applyMentionSuggestion(item: SecondBrainAtMentionItem) {
    const trigger = mentions.trigger.value
    const previousComposerPaths = [...options.composerContextPaths.value]
    if (trigger) {
      inputMessage.value = `${inputMessage.value.slice(0, trigger.start)}${inputMessage.value.slice(trigger.end)}`
    }
    options.composerContextPaths.value = Array.from(new Set([
      ...options.composerContextPaths.value,
      item.absolutePath
    ]))
    const added = await addPathToContext(item.absolutePath)
    if (!added) {
      options.composerContextPaths.value = previousComposerPaths
      return
    }

    options.mentionInfo.value = ''
    mentions.close()

    void nextTick(() => {
      composerRef.value?.focus()
      const caret = trigger?.start ?? composerRef.value?.value.length ?? 0
      composerRef.value?.setSelectionRange(caret, caret)
    })
  }

  /**
   * Handles send shortcut and mention-menu navigation in the composer.
   */
  function onComposerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void onSendMessage()
      return
    }

    if (!mentions.isOpen.value) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      mentions.moveActive(1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      mentions.moveActive(-1)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const next = mentions.suggestions.value[mentions.activeIndex.value]
      if (next) {
        void applyMentionSuggestion(next)
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      mentions.close()
    }
  }

  /**
   * Matches dropdown aliases against the search query.
   */
  function pulseDropdownMatcher(item: FilterableDropdownItem, query: string): boolean {
    const aliases = Array.isArray(item.aliases) ? item.aliases.map((entry) => String(entry).toLowerCase()) : []
    return aliases.some((token) => token.includes(query))
  }

  /**
   * Rewrites the composer into a Pulse prompt for the current context.
   *
   * The goal is to help the user steer the next generation without forcing a
   * modal flow or losing any extra guidance already typed.
   */
  async function runPulseFromSecondBrain() {
    if (!options.contextPaths.value.length) {
      options.mentionInfo.value = 'Add note context before using Pulse.'
      return
    }
    const nextInstruction = inputMessage.value.trim()
    const pulsePrompts: Partial<Record<PulseActionId, string>> = {
      rewrite: 'Rewrite the current context into a clearer version while preserving meaning.',
      condense: 'Condense the current context into a shorter version that keeps the key information.',
      expand: 'Expand the current context into a fuller draft with clearer structure and supporting detail.',
      change_tone: 'Rewrite the current context in a different tone while keeping the substance intact.',
      synthesize: 'Synthesize the current context into a concise, structured summary. Highlight key themes and uncertainties.',
      outline: 'Turn the current context into a clear outline with sections and logical progression.',
      brief: 'Draft a working brief from the current context, including objective, key points, and open questions.',
      extract_themes: 'Extract the dominant themes from the current context and explain how they relate.',
      identify_tensions: 'Identify tensions, contradictions, or open questions in the current context.'
    }
    const basePrompt = pulsePrompts[pulseActionId.value] ?? 'Transform the current context into a useful written output.'
    inputMessage.value = nextInstruction ? `${basePrompt}\n\nAdditional guidance: ${nextInstruction}` : basePrompt
    void nextTick(() => composerRef.value?.focus())
  }

  /**
   * Selects a Pulse action and injects its prompt into the composer.
   */
  async function onPulseAction(actionId: PulseActionId) {
    pulseActionId.value = actionId
    await runPulseFromSecondBrain()
  }

  /**
   * Translates dropdown selection into a Pulse action selection.
   */
  function onPulseDropdownSelect(item: FilterableDropdownItem) {
    void onPulseAction(item.id as PulseActionId)
  }

  /**
   * Adds a path to the current session context while keeping rollback explicit.
   */
  async function addPathToContext(path: string): Promise<boolean> {
    const next = options.mergeContextPaths([path])
    const sync = await options.replaceContextPaths(next, { revertOnFailure: true })
    if (!sync.ok) {
      options.mentionInfo.value = `Could not add ${toRelativePath(path)} to Second Brain context: ${sync.error}`
      return false
    }

    options.mentionInfo.value = ''
    return true
  }

  /**
   * Sends the composer text to the backend after resolving explicit mentions.
   *
   * Optimistic message insertion, stream lifecycle, and scroll handling stay in
   * the stream runtime; this function only prepares the user-facing payload.
   */
  async function onSendMessage() {
    if (!options.sessionId.value || !inputMessage.value.trim() || options.requestInFlight.value) return
    options.requestInFlight.value = true
    options.sending.value = true
    options.sendError.value = ''
    options.mentionInfo.value = ''
    options.activeAssistantStreamMessageId.value = null
    const outgoing = inputMessage.value.trim()

    const mentionResolution = mentions.resolveMentionedPaths(outgoing)
    const mergedMentionPaths = Array.from(new Set([
      ...options.composerContextPaths.value,
      ...mentionResolution.resolvedPaths
    ]))

    if (mergedMentionPaths.length > 0) {
      const sync = await options.replaceContextPaths(options.mergeContextPaths(mergedMentionPaths), { revertOnFailure: false })
      if (!sync.ok) {
        options.mentionInfo.value = `Could not update Second Brain context: ${sync.error}`
      }
    }
    if (mentionResolution.unresolved.length > 0) {
      options.mentionInfo.value = `Ignored unresolved mentions: ${mentionResolution.unresolved.map((item) => `@${item}`).join(', ')}`
    }

    const tempUserId = `temp-user-${Date.now()}`
    inputMessage.value = ''
    options.composerContextPaths.value = []
    mentions.close()

    options.messages.value = [...options.messages.value, {
      id: tempUserId,
      role: 'user',
      mode: 'freestyle',
      content_md: outgoing,
      citations_json: '[]',
      attachments_json: '[]',
      created_at_ms: Date.now()
    }]
    void options.scrollThreadToBottom({ force: true })

    try {
      const result = await runDeliberation(
        options.selectedAlterId.value
          ? {
              sessionId: options.sessionId.value,
              mode: 'freestyle',
              message: outgoing,
              alterId: options.selectedAlterId.value
            }
          : {
              sessionId: options.sessionId.value,
              mode: 'freestyle',
              message: outgoing
            }
      )

      options.messages.value = options.messages.value.map((message) =>
        message.id === tempUserId ? { ...message, id: result.userMessageId } : message
      )

      if (!options.messages.value.some((message) => message.id === result.assistantMessageId)) {
        options.messages.value = [...options.messages.value, {
          id: result.assistantMessageId,
          role: 'assistant',
          mode: 'freestyle',
          content_md: '',
          citations_json: JSON.stringify(options.contextPaths.value.map((path) => path.replace(`${options.workspacePath.value}/`, ''))),
          attachments_json: '[]',
          created_at_ms: Date.now()
        }]
        void options.scrollThreadToBottom({ force: true })
      }

      await options.refreshSessionsIndex()
      const updated = options.sessionsIndex.value.find((item) => item.session_id === options.sessionId.value)
      if (updated?.title) {
        options.sessionTitle.value = updated.title
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send message.'
      if (options.suppressCancellationError.value && /cancel/i.test(message)) {
        options.sendError.value = ''
      } else {
        options.sendError.value = message
      }
    } finally {
      options.sending.value = false
      options.requestInFlight.value = false
      options.activeAssistantStreamMessageId.value = null
      options.suppressCancellationError.value = false
    }
  }

  watch(
    () => `${options.requestedPromptNonce.value}::${options.requestedPrompt.value}`,
    (value) => {
      const [nonce] = value.split('::')
      if (!nonce.trim()) return
      inputMessage.value = options.requestedPrompt.value
      void nextTick(() => composerRef.value?.focus())
    },
    { immediate: true }
  )

  watch(
    [composerRef, inputMessage],
    () => {
      void nextTick(syncComposerHeight)
    },
    { immediate: true, flush: 'post' }
  )

  onBeforeUnmount(() => {
    if (copyToastTimer) {
      clearTimeout(copyToastTimer)
      copyToastTimer = null
    }
    for (const timer of Object.values(copyFeedbackTimers)) {
      clearTimeout(timer)
    }
  })

  return {
    activePulseAction,
    applyMentionSuggestion,
    canCopyConversation,
    composerRef,
    copiedByMessageId,
    copyToast,
    inputMessage,
    mentionInfo: options.mentionInfo,
    mentions,
    messages: options.messages,
    onComposerInput,
    onComposerKeydown,
    onCopyAssistantMessage,
    onCopyConversation,
    onPulseAction,
    onPulseDropdownSelect,
    onSendMessage,
    pulseDropdownActiveIndex,
    pulseDropdownItems,
    pulseDropdownMatcher,
    pulseDropdownOpen,
    pulseDropdownQuery,
    updateMentionTriggerFromComposer
  }
}
