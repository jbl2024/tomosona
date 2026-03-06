<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ClipboardDocumentIcon, PaperAirplaneIcon, PlusIcon } from '@heroicons/vue/24/outline'
import {
  cancelDeliberationStream,
  createDeliberationSession,
  fetchSecondBrainConfigStatus,
  fetchSecondBrainSessions,
  loadDeliberationSession,
  removeDeliberationSession,
  replaceSessionContext,
  runDeliberation,
  subscribeSecondBrainStream
} from '../../lib/secondBrainApi'
import { sanitizeHtmlForPreview } from '../../lib/htmlSanitizer'
import { inlineTextToHtml } from '../../lib/markdownBlocks'
import { normalizeContextPathsForUpdate, toAbsoluteWorkspacePath } from '../../lib/secondBrainContextPaths'
import type { SecondBrainMessage, SecondBrainSessionSummary } from '../../lib/api'
import { useEchoesPack } from '../../composables/useEchoesPack'
import { useSecondBrainAtMentions, type SecondBrainAtMentionItem } from '../../composables/useSecondBrainAtMentions'
import SecondBrainAtMentionsMenu from './SecondBrainAtMentionsMenu.vue'
import SecondBrainEchoesPanel from './SecondBrainEchoesPanel.vue'
import SecondBrainSessionDropdown from './SecondBrainSessionDropdown.vue'
import type { EchoesItem } from '../../lib/echoes'

const props = defineProps<{
  workspacePath: string
  allWorkspaceFiles: string[]
  requestedSessionId: string
  requestedSessionNonce: number
  activeNotePath?: string
}>()

const emit = defineEmits<{
  'open-note': [path: string]
  'context-changed': [paths: string[]]
  'session-changed': [sessionId: string]
}>()

const configError = ref('')
const loading = ref(false)
const sessionId = ref('')
const sessionTitle = ref('Second Brain Session')
const contextPaths = ref<string[]>([])
const contextTokenEstimate = ref<Record<string, number>>({})
const inputMessage = ref('')
const messages = ref<SecondBrainMessage[]>([])
const streamByMessage = ref<Record<string, string>>({})
const copiedByMessageId = ref<Record<string, boolean>>({})
const sending = ref(false)
const requestInFlight = ref(false)
const sendError = ref('')
const suppressCancellationError = ref(false)
const creatingSession = ref(false)
const sessionsIndex = ref<SecondBrainSessionSummary[]>([])
const mentionInfo = ref('')
const copyToast = ref<{ visible: boolean; kind: 'success' | 'error'; message: string }>({
  visible: false,
  kind: 'success',
  message: ''
})
const composerContextPaths = ref<string[]>([])
const selectedEchoesContextPath = ref('')
const composerRef = ref<HTMLTextAreaElement | null>(null)
const threadRef = ref<HTMLElement | null>(null)
const activeAssistantStreamMessageId = ref<string | null>(null)
const streamUnsubscribers: Array<() => void> = []
const ignoredAssistantMessageIds = new Set<string>()
let copyToastTimer: ReturnType<typeof setTimeout> | null = null
const copyFeedbackTimers: Record<string, ReturnType<typeof setTimeout>> = {}
const COPY_FEEDBACK_MS = 1300
const COPY_TOAST_MS = 2000

const workspacePathRef = computed(() => props.workspacePath)
const allWorkspaceFilesRef = computed(() => props.allWorkspaceFiles)

const mentions = useSecondBrainAtMentions({
  workspacePath: workspacePathRef,
  allWorkspaceFiles: allWorkspaceFilesRef
})

function toRelativePath(path: string): string {
  const value = path.replace(/\\/g, '/')
  const root = props.workspacePath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!root) return value
  if (value === root) return '.'
  if (value.startsWith(`${root}/`)) return value.slice(root.length + 1)
  return value
}

function canonicalWorkspaceDocumentKey(path: string): string {
  const absolute = toAbsoluteWorkspacePath(props.workspacePath, path)
  const relative = toRelativePath(absolute)
  return relative
    .normalize('NFC')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')
    .trim()
    .toLocaleLowerCase()
}

function isPathInContext(path: string): boolean {
  return contextPathSet.value.has(canonicalWorkspaceDocumentKey(path))
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
const echoes = useEchoesPack(echoesAnchorPath, { limit: 5 })
const echoesItems = computed<EchoesItem[]>(() => {
  const deduped: EchoesItem[] = []
  const seen = new Set<string>()

  for (const item of echoes.items.value) {
    const normalizedPath = toAbsoluteWorkspacePath(props.workspacePath, item.path)
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

function mergeContextPaths(nextPaths: string[]): string[] {
  const merged = new Set(contextPaths.value)
  for (const path of nextPaths) {
    merged.add(path)
  }
  return Array.from(merged)
}

function addComposerContextPath(path: string) {
  if (!path.trim()) return
  const merged = new Set(composerContextPaths.value)
  merged.add(path)
  composerContextPaths.value = Array.from(merged)
}

async function removeContextPath(path: string) {
  const previousContextPaths = [...contextPaths.value]
  const previousComposerPaths = [...composerContextPaths.value]
  contextPaths.value = contextPaths.value.filter((item) => item !== path)
  composerContextPaths.value = composerContextPaths.value.filter((item) => item !== path)
  emit('context-changed', contextPaths.value)

  const sync = await syncContextWithBackend()
  if (!sync.ok) {
    contextPaths.value = previousContextPaths
    composerContextPaths.value = previousComposerPaths
    emit('context-changed', contextPaths.value)
    mentionInfo.value = `Could not remove ${toRelativePath(path)} from Second Brain context: ${sync.error}`
    return
  }

  mentionInfo.value = ''
}

async function addPathToContext(path: string): Promise<boolean> {
  if (!path.trim()) return false
  const previousContextPaths = [...contextPaths.value]
  contextPaths.value = mergeContextPaths([path])
  emit('context-changed', contextPaths.value)

  const sync = await syncContextWithBackend()
  if (!sync.ok) {
    contextPaths.value = previousContextPaths
    emit('context-changed', contextPaths.value)
    mentionInfo.value = `Could not add ${toRelativePath(path)} to Second Brain context: ${sync.error}`
    return false
  }

  mentionInfo.value = ''
  return true
}

async function syncContextWithBackend(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!sessionId.value) return { ok: true }
  try {
    const normalized = normalizeContextPathsForUpdate(props.workspacePath, contextPaths.value)
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
    sendError.value = message
    return { ok: false, error: message }
  }
}

function asAbsolute(pathRelativeOrAbs: string): string {
  if (!pathRelativeOrAbs) return ''
  if (pathRelativeOrAbs.startsWith('/')) return pathRelativeOrAbs
  if (!props.workspacePath) return pathRelativeOrAbs
  return `${props.workspacePath}/${pathRelativeOrAbs}`
}

async function ensureSession(seedPath?: string) {
  if (sessionId.value) return
  const seed = seedPath || props.allWorkspaceFiles.find((path) => /\.(md|markdown)$/i.test(path))
  if (!seed) return
  loading.value = true
  try {
    const created = await createDeliberationSession({ contextPaths: [seed], title: '' })
    sessionId.value = created.sessionId
    emit('session-changed', sessionId.value)
    contextPaths.value = [seed]
    contextTokenEstimate.value = { [seed]: Math.max(1, Math.round((seed.length + 400) / 4)) }
    emit('context-changed', contextPaths.value)
    await refreshSessionsIndex()
  } finally {
    loading.value = false
  }
}

async function loadSession(nextSessionId: string) {
  if (!nextSessionId.trim()) return
  loading.value = true
  sendError.value = ''
  mentionInfo.value = ''
  composerContextPaths.value = []
  try {
    const payload = await loadDeliberationSession(nextSessionId.trim())
    sessionId.value = payload.session_id
    emit('session-changed', sessionId.value)
    sessionTitle.value = payload.title || 'Second Brain Session'
    contextPaths.value = payload.context_items.map((item) => asAbsolute(item.path))

    const nextTokens: Record<string, number> = {}
    for (const item of payload.context_items) {
      nextTokens[asAbsolute(item.path)] = item.token_estimate
    }
    contextTokenEstimate.value = nextTokens

    messages.value = payload.messages
    emit('context-changed', contextPaths.value)
    await scrollThreadToBottom()
  } catch (err) {
    sendError.value = err instanceof Error ? err.message : 'Could not load session.'
  } finally {
    loading.value = false
  }
}

async function refreshSessionsIndex() {
  try {
    sessionsIndex.value = await fetchSecondBrainSessions(120)
  } catch {
    sessionsIndex.value = []
  }
}

async function onCreateSession() {
  if (sessionId.value && messages.value.length === 0) {
    mentionInfo.value = 'Current session is empty. Reuse it instead of creating another one.'
    return
  }

  if (creatingSession.value) return
  const seed = contextPaths.value[0] || props.allWorkspaceFiles.find((path) => /\.(md|markdown)$/i.test(path))
  if (!seed) {
    sendError.value = 'No markdown note found to seed a new session.'
    return
  }
  creatingSession.value = true
  try {
    const created = await createDeliberationSession({ contextPaths: [seed], title: '' })
    sessionId.value = created.sessionId
    emit('session-changed', sessionId.value)
    sessionTitle.value = 'Second Brain Session'
    contextPaths.value = [seed]
    contextTokenEstimate.value = { [seed]: Math.max(1, Math.round((seed.length + 400) / 4)) }
    messages.value = []
    streamByMessage.value = {}
    composerContextPaths.value = []
    mentionInfo.value = ''
    emit('context-changed', contextPaths.value)
    await scrollThreadToBottom()
    await refreshSessionsIndex()
  } finally {
    creatingSession.value = false
  }
}

async function onDeleteSession(sessionToDelete: string) {
  if (!sessionToDelete.trim()) return
  await removeDeliberationSession(sessionToDelete)
  await refreshSessionsIndex()

  if (sessionId.value !== sessionToDelete) return

  const next = sessionsIndex.value[0]
  if (next?.session_id) {
    await loadSession(next.session_id)
    return
  }

  sessionId.value = ''
  emit('session-changed', '')
  sessionTitle.value = 'Second Brain Session'
  contextPaths.value = []
  contextTokenEstimate.value = {}
  messages.value = []
  streamByMessage.value = {}
  composerContextPaths.value = []
  emit('context-changed', [])
}

async function initializeSessionOnFirstOpen() {
  if (sessionId.value) return

  await refreshSessionsIndex()

  if (props.requestedSessionId.trim()) {
    await loadSession(props.requestedSessionId.trim())
    return
  }

  const latest = sessionsIndex.value[0]
  if (latest?.session_id) {
    await loadSession(latest.session_id)
    return
  }

  await ensureSession()
}

function displayMessage(message: SecondBrainMessage): string {
  if (message.role === 'assistant') {
    return streamByMessage.value[message.id] ?? message.content_md
  }
  return message.content_md
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderAssistantMarkdown(message: SecondBrainMessage): string {
  const source = displayMessage(message).replace(/\r\n?/g, '\n')
  const lines = source.split('\n')
  const htmlParts: string[] = []
  let paragraph: string[] = []
  let listItems: string[] = []
  let listKind: 'ul' | 'ol' | null = null
  let blockquote: string[] = []
  let inCode = false
  let codeLang = ''
  let codeLines: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    htmlParts.push(`<p>${inlineTextToHtml(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  const flushList = () => {
    if (!listKind || !listItems.length) return
    htmlParts.push(`<${listKind}>${listItems.join('')}</${listKind}>`)
    listKind = null
    listItems = []
  }

  const flushBlockquote = () => {
    if (!blockquote.length) return
    htmlParts.push(`<blockquote><p>${inlineTextToHtml(blockquote.join('<br>'))}</p></blockquote>`)
    blockquote = []
  }

  const flushCode = () => {
    if (!inCode) return
    const langClass = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''
    htmlParts.push(`<pre><code${langClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    inCode = false
    codeLang = ''
    codeLines = []
  }

  for (const line of lines) {
    const fence = line.match(/^```([A-Za-z0-9_-]*)\s*$/)
    if (fence) {
      if (inCode) {
        flushCode()
      } else {
        flushParagraph()
        flushList()
        flushBlockquote()
        inCode = true
        codeLang = fence[1] ?? ''
      }
      continue
    }

    if (inCode) {
      codeLines.push(line)
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      flushBlockquote()
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      flushBlockquote()
      const level = heading[1].length
      htmlParts.push(`<h${level}>${inlineTextToHtml(heading[2])}</h${level}>`)
      continue
    }

    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      blockquote.push(quote[1] ?? '')
      continue
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/)
    if (unordered) {
      flushParagraph()
      flushBlockquote()
      if (listKind !== 'ul') {
        flushList()
        listKind = 'ul'
      }
      listItems.push(`<li>${inlineTextToHtml(unordered[1])}</li>`)
      continue
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/)
    if (ordered) {
      flushParagraph()
      flushBlockquote()
      if (listKind !== 'ol') {
        flushList()
        listKind = 'ol'
      }
      listItems.push(`<li>${inlineTextToHtml(ordered[1])}</li>`)
      continue
    }

    flushList()
    flushBlockquote()
    paragraph.push(line.trim())
  }

  flushParagraph()
  flushList()
  flushBlockquote()
  flushCode()

  const html = htmlParts.join('')
  return sanitizeHtmlForPreview(html || `<p>${inlineTextToHtml(source)}</p>`)
}

async function applyMentionSuggestion(item: SecondBrainAtMentionItem) {
  const trigger = mentions.trigger.value
  const previousComposerPaths = [...composerContextPaths.value]
  if (trigger) {
    inputMessage.value = `${inputMessage.value.slice(0, trigger.start)}${inputMessage.value.slice(trigger.end)}`
  }
  addComposerContextPath(item.absolutePath)
  const added = await addPathToContext(item.absolutePath)
  if (!added) {
    composerContextPaths.value = previousComposerPaths
    return
  }

  mentionInfo.value = ''
  mentions.close()

  void nextTick(() => {
    composerRef.value?.focus()
    const caret = trigger?.start ?? composerRef.value?.value.length ?? 0
    composerRef.value?.setSelectionRange(caret, caret)
  })
}

function updateMentionTriggerFromComposer() {
  mentions.updateTrigger(inputMessage.value, composerRef.value?.selectionStart ?? null)
}

function onComposerInput(event: Event) {
  inputMessage.value = (event.target as HTMLTextAreaElement).value
  updateMentionTriggerFromComposer()
}

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

async function scrollThreadToBottom() {
  await nextTick()
  const thread = threadRef.value
  if (!thread) return
  thread.scrollTop = thread.scrollHeight
}

async function onSendMessage() {
  if (!sessionId.value || !inputMessage.value.trim() || requestInFlight.value) return
  requestInFlight.value = true
  sending.value = true
  sendError.value = ''
  mentionInfo.value = ''
  activeAssistantStreamMessageId.value = null
  const outgoing = inputMessage.value.trim()

  const mentionResolution = mentions.resolveMentionedPaths(outgoing)
  const mergedMentionPaths = Array.from(new Set([
    ...composerContextPaths.value,
    ...mentionResolution.resolvedPaths
  ]))

  if (mergedMentionPaths.length > 0) {
    contextPaths.value = mergeContextPaths(mergedMentionPaths)
    emit('context-changed', contextPaths.value)
    const sync = await syncContextWithBackend()
    if (!sync.ok) {
      mentionInfo.value = `Could not update Second Brain context: ${sync.error}`
    }
  }
  if (mentionResolution.unresolved.length > 0) {
    mentionInfo.value = `Ignored unresolved mentions: ${mentionResolution.unresolved.map((item) => `@${item}`).join(', ')}`
  }

  const tempUserId = `temp-user-${Date.now()}`
  inputMessage.value = ''
  composerContextPaths.value = []
  mentions.close()

  messages.value = [...messages.value, {
    id: tempUserId,
    role: 'user',
    mode: 'freestyle',
    content_md: outgoing,
    citations_json: '[]',
    attachments_json: '[]',
    created_at_ms: Date.now()
  }]
  void scrollThreadToBottom()

  try {
    const result = await runDeliberation({
      sessionId: sessionId.value,
      mode: 'freestyle',
      message: outgoing
    })

    messages.value = messages.value.map((message) =>
      message.id === tempUserId ? { ...message, id: result.userMessageId } : message
    )

    if (!messages.value.some((message) => message.id === result.assistantMessageId)) {
      messages.value = [...messages.value, {
        id: result.assistantMessageId,
        role: 'assistant',
        mode: 'freestyle',
        content_md: streamByMessage.value[result.assistantMessageId] ?? '',
        citations_json: JSON.stringify(contextPaths.value.map((path) => path.replace(`${props.workspacePath}/`, ''))),
        attachments_json: '[]',
        created_at_ms: Date.now()
      }]
      void scrollThreadToBottom()
    }

    await refreshSessionsIndex()
    const updated = sessionsIndex.value.find((item) => item.session_id === sessionId.value)
    if (updated?.title) {
      sessionTitle.value = updated.title
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not send message.'
    if (suppressCancellationError.value && /cancel/i.test(message)) {
      sendError.value = ''
    } else {
      sendError.value = message
    }
  } finally {
    sending.value = false
    requestInFlight.value = false
    activeAssistantStreamMessageId.value = null
    suppressCancellationError.value = false
  }
}

async function onStopStreaming() {
  if (!requestInFlight.value || !sending.value) return
  sending.value = false
  suppressCancellationError.value = true
  const activeId = activeAssistantStreamMessageId.value
  if (activeId) {
    ignoredAssistantMessageIds.add(activeId)
  }
  if (!sessionId.value) return
  try {
    await cancelDeliberationStream({
      sessionId: sessionId.value,
      messageId: activeId
    })
  } catch (err) {
    suppressCancellationError.value = false
    sendError.value = err instanceof Error ? err.message : 'Could not stop generation.'
  }
}

async function onCopyAssistantMessage(message: SecondBrainMessage) {
  if (message.role !== 'assistant') return
  const content = displayMessage(message).trim()
  if (!content) return

  try {
    await navigator.clipboard.writeText(content)
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
    }, COPY_FEEDBACK_MS)

    if (copyToastTimer) clearTimeout(copyToastTimer)
    copyToast.value = {
      visible: true,
      kind: 'success',
      message: 'Copied to clipboard.'
    }
    copyToastTimer = setTimeout(() => {
      copyToast.value.visible = false
      copyToastTimer = null
    }, COPY_TOAST_MS)
  } catch (err) {
    if (copyToastTimer) clearTimeout(copyToastTimer)
    copyToast.value = {
      visible: true,
      kind: 'error',
      message: err instanceof Error ? err.message : 'Could not copy assistant response.'
    }
    copyToastTimer = setTimeout(() => {
      copyToast.value.visible = false
      copyToastTimer = null
    }, COPY_TOAST_MS + 700)
  }
}

function openContextNote(path: string) {
  emit('open-note', path)
}

function toggleEchoesAnchor(path: string) {
  if (selectedEchoesContextPath.value === path) {
    selectedEchoesContextPath.value = ''
    return
  }

  selectedEchoesContextPath.value = path
}

async function addEchoesSuggestion(path: string) {
  await addPathToContext(path)
}

onMounted(async () => {
  try {
    const status = await fetchSecondBrainConfigStatus()
    if (!status.configured) {
      configError.value = status.error || 'Second Brain config is missing.'
    }
  } catch (err) {
    configError.value = err instanceof Error ? err.message : 'Could not read config status.'
  }

  await initializeSessionOnFirstOpen()

  streamUnsubscribers.push(await subscribeSecondBrainStream('second-brain://assistant-start', (payload) => {
    if (payload.session_id !== sessionId.value) return
    activeAssistantStreamMessageId.value = payload.message_id
    if (ignoredAssistantMessageIds.has(payload.message_id)) return
    streamByMessage.value = {
      ...streamByMessage.value,
      [payload.message_id]: ''
    }
    if (!messages.value.some((message) => message.id === payload.message_id)) {
      messages.value = [...messages.value, {
        id: payload.message_id,
        role: 'assistant',
        mode: 'freestyle',
        content_md: '',
        citations_json: JSON.stringify(contextPaths.value.map((path) => path.replace(`${props.workspacePath}/`, ''))),
        attachments_json: '[]',
        created_at_ms: Date.now()
      }]
      void scrollThreadToBottom()
    }
  }))

  streamUnsubscribers.push(await subscribeSecondBrainStream('second-brain://assistant-delta', (payload) => {
    if (payload.session_id !== sessionId.value) return
    if (ignoredAssistantMessageIds.has(payload.message_id)) return
    const current = streamByMessage.value[payload.message_id] ?? ''
    streamByMessage.value = {
      ...streamByMessage.value,
      [payload.message_id]: `${current}${payload.chunk}`
    }
    if (!messages.value.some((message) => message.id === payload.message_id)) {
      messages.value = [...messages.value, {
        id: payload.message_id,
        role: 'assistant',
        mode: 'freestyle',
        content_md: '',
        citations_json: JSON.stringify(contextPaths.value.map((path) => path.replace(`${props.workspacePath}/`, ''))),
        attachments_json: '[]',
        created_at_ms: Date.now()
      }]
    }
    void scrollThreadToBottom()
  }))

  streamUnsubscribers.push(await subscribeSecondBrainStream('second-brain://assistant-complete', (payload) => {
    if (payload.session_id !== sessionId.value) return
    if (ignoredAssistantMessageIds.has(payload.message_id)) {
      ignoredAssistantMessageIds.delete(payload.message_id)
      if (activeAssistantStreamMessageId.value === payload.message_id) {
        activeAssistantStreamMessageId.value = null
      }
      return
    }
    streamByMessage.value = {
      ...streamByMessage.value,
      [payload.message_id]: payload.chunk
    }
    if (activeAssistantStreamMessageId.value === payload.message_id) {
      activeAssistantStreamMessageId.value = null
    }
    sending.value = false
  }))

  streamUnsubscribers.push(await subscribeSecondBrainStream('second-brain://assistant-error', (payload) => {
    if (payload.session_id !== sessionId.value) return
    if (ignoredAssistantMessageIds.has(payload.message_id)) {
      ignoredAssistantMessageIds.delete(payload.message_id)
      if (activeAssistantStreamMessageId.value === payload.message_id) {
        activeAssistantStreamMessageId.value = null
      }
      return
    }
    if (activeAssistantStreamMessageId.value === payload.message_id) {
      activeAssistantStreamMessageId.value = null
    }
    sending.value = false
    sendError.value = payload.error || 'Assistant stream failed.'
  }))
})

onBeforeUnmount(() => {
  if (copyToastTimer) {
    clearTimeout(copyToastTimer)
    copyToastTimer = null
  }
  for (const timer of Object.values(copyFeedbackTimers)) {
    clearTimeout(timer)
  }
  for (const unsubscribe of streamUnsubscribers) {
    unsubscribe()
  }
})

watch(
  () => `${props.requestedSessionId}::${props.requestedSessionNonce}`,
  (value) => {
    const [id] = value.split('::')
    if (!id.trim()) return
    void loadSession(id)
  }
)

watch(contextPaths, (paths) => {
  if (!selectedEchoesContextPath.value) return
  if (!paths.includes(selectedEchoesContextPath.value)) {
    selectedEchoesContextPath.value = ''
  }
})
</script>

<template>
  <div class="sb-layout">
    <section class="sb-center">
      <header class="sb-center-head">
        <div class="title-wrap">
          <h2>{{ sessionTitle }}</h2>
          <p v-if="configError" class="sb-error">{{ configError }}</p>
        </div>
        <div class="sb-session-actions">
          <button
            type="button"
            class="sb-session-create-btn"
            title="New session"
            aria-label="New session"
            :disabled="loading || creatingSession"
            @click="onCreateSession"
          >
            <PlusIcon class="h-4 w-4" />
          </button>
          <SecondBrainSessionDropdown
            :sessions="sessionsIndex"
            :active-session-id="sessionId"
            :loading="loading || creatingSession"
            @select="loadSession"
            @delete="onDeleteSession"
          />
        </div>
      </header>

      <section ref="threadRef" class="sb-thread">
        <article
          v-for="message in messages"
          :key="message.id"
          class="msg"
          :class="message.role === 'assistant' ? 'assistant' : 'user'"
        >
          <header>
            <strong>{{ message.role === 'assistant' ? 'Assistant' : 'You' }}</strong>
            <button
              v-if="message.role === 'assistant'"
              type="button"
              class="insert"
              :class="{ copied: copiedByMessageId[message.id] }"
              :title="copiedByMessageId[message.id] ? 'Copied' : 'Copy to clipboard'"
              @click="onCopyAssistantMessage(message)"
            >
              <ClipboardDocumentIcon class="h-4 w-4" />
            </button>
          </header>
          <div v-if="message.role === 'assistant'" class="assistant-markdown" v-html="renderAssistantMarkdown(message)"></div>
          <pre v-else>{{ displayMessage(message) }}</pre>
        </article>
      </section>

      <footer class="sb-input-row">
        <div class="sb-composer">
          <transition name="sb-echoes-panel">
            <SecondBrainEchoesPanel
              v-if="showEchoesPanel"
              :items="echoesItems"
              :loading="echoes.loading.value"
              :error="echoes.error.value"
              :is-in-context="isPathInContext"
              :to-relative-path="toRelativePath"
              @open="openContextNote"
              @add="void addEchoesSuggestion($event)"
            />
          </transition>

          <SecondBrainAtMentionsMenu
            :open="mentions.isOpen.value"
            :suggestions="mentions.suggestions.value"
            :active-index="mentions.activeIndex.value"
            @select="void applyMentionSuggestion($event)"
            @update:active-index="mentions.setActiveIndex"
          />

          <div v-if="contextCards.length" class="sb-chip-row">
            <article v-for="chip in contextCards" :key="chip.path" class="sb-chip">
              <button
                type="button"
                class="sb-chip-main"
                :class="{ active: selectedEchoesContextPath === chip.path }"
                :title="`Use ${chip.name} for Echoes suggestions`"
                :aria-pressed="selectedEchoesContextPath === chip.path"
                @click="toggleEchoesAnchor(chip.path)"
              >
                <strong>{{ chip.name }}</strong>
                <span>{{ chip.parent }}</span>
              </button>
              <button
                type="button"
                class="sb-chip-open"
                :title="`Open ${chip.name}`"
                :aria-label="`Open ${chip.name}`"
                @click="openContextNote(chip.path)"
              >
                Open
              </button>
              <button type="button" class="sb-chip-remove" @click="void removeContextPath(chip.path)">×</button>
            </article>
          </div>

          <textarea
            ref="composerRef"
            :value="inputMessage"
            class="sb-textarea"
            placeholder="Posez une question. Tapez @ pour ajouter des notes au contexte..."
            @input="onComposerInput"
            @keydown="onComposerKeydown"
            @click="updateMentionTriggerFromComposer"
            @keyup="updateMentionTriggerFromComposer"
          ></textarea>

          <div class="composer-action">
            <button
              v-if="sending"
              type="button"
              class="send-icon-btn send-icon-btn-stop"
              :disabled="!requestInFlight"
              title="Stop generation"
              aria-label="Stop generation"
              @click="onStopStreaming"
            >
              <span class="sb-loader" aria-label="Thinking"></span>
            </button>
            <button v-else type="button" class="send-icon-btn" :disabled="!sessionId || !inputMessage.trim() || requestInFlight" @click="onSendMessage">
              <PaperAirplaneIcon class="h-4 w-4" />
            </button>
          </div>
        </div>

        <div v-if="loading || sendError || mentionInfo" class="actions">
          <span v-if="loading" class="hint">Loading...</span>
          <span v-if="mentionInfo" class="hint">{{ mentionInfo }}</span>
          <span v-if="sendError" class="sb-error">{{ sendError }}</span>
        </div>
      </footer>

      <transition name="sb-toast-fade">
        <div
          v-if="copyToast.visible"
          class="sb-toast"
          :class="copyToast.kind === 'error' ? 'error' : 'success'"
          role="status"
          aria-live="polite"
        >
          {{ copyToast.message }}
        </div>
      </transition>
    </section>
  </div>
</template>

<style>
.sb-layout {
  min-height: 0;
  height: 100%;
  padding: 6px;
  background: var(--sb-layout-bg);
}

.sb-center {
  min-height: 0;
  height: 100%;
  border-radius: 12px;
  background: var(--sb-center-bg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 6px;
}

.sb-center-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.sb-session-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sb-session-create-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--sb-button-border);
  border-radius: 10px;
  background: var(--sb-button-bg);
  color: var(--sb-button-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sb-session-create-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.title-wrap {
  min-width: 0;
}

.sb-center-head h2 {
  margin: 0;
}

.sb-error {
  margin: 4px 0 0;
  color: var(--sb-danger-text);
  font-size: 12px;
}

.sb-thread {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--sb-border);
  border-radius: 10px;
  background: var(--sb-thread-bg);
  color: var(--sb-text);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.msg {
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  padding: 6px;
}

.msg.user {
  background: var(--sb-user-bg);
}

.msg.assistant {
  background: var(--sb-assistant-bg);
}

.msg header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.msg pre {
  white-space: pre-wrap;
  margin: 8px 0 0;
  font-size: 12px;
}

.assistant-markdown {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.5;
}

.assistant-markdown p {
  margin: 0 0 6px;
}

.assistant-markdown p:last-child {
  margin-bottom: 0;
}

.assistant-markdown h1,
.assistant-markdown h2,
.assistant-markdown h3,
.assistant-markdown h4,
.assistant-markdown h5,
.assistant-markdown h6 {
  margin: 8px 0 5px;
  line-height: 1.3;
  font-weight: 700;
}

.assistant-markdown ul,
.assistant-markdown ol {
  margin: 5px 0 6px;
  padding-left: 18px;
}

.assistant-markdown ul {
  list-style: disc outside;
}

.assistant-markdown ol {
  list-style: decimal outside;
}

.assistant-markdown li {
  margin: 1px 0;
}

.assistant-markdown ul ul {
  list-style-type: circle;
}

.assistant-markdown ol ol {
  list-style-type: lower-alpha;
}

.assistant-markdown blockquote {
  margin: 5px 0 6px;
  border-left: 3px solid var(--sb-blockquote-border);
  padding: 2px 0 2px 10px;
  color: var(--sb-text-soft);
}

.assistant-markdown code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  background: var(--sb-code-bg);
  border-radius: 4px;
  padding: 1px 4px;
}

.assistant-markdown pre {
  margin: 6px 0;
  background: var(--sb-code-bg);
  border: 1px solid var(--sb-input-border);
  border-radius: 8px;
  padding: 6px;
  overflow: auto;
}

.assistant-markdown pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
}

.assistant-markdown a {
  color: var(--sb-active-text);
  text-decoration: underline;
}

.insert {
  border: 1px solid var(--sb-button-border);
  border-radius: 8px;
  background: var(--sb-button-bg);
  font-size: 11px;
  padding: 3px 8px;
  color: var(--sb-button-text);
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
  transition: opacity 140ms ease, transform 140ms ease;
}

.msg.assistant:hover .insert,
.msg.assistant:focus-within .insert {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.insert.copied {
  border-color: var(--sb-status-success-border);
  background: var(--sb-status-success-bg);
  color: var(--sb-status-success-text);
}

.sb-input-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: auto;
}

.sb-composer {
  position: relative;
  width: 100%;
  border: 1px solid var(--sb-input-border);
  border-radius: 10px;
  background: var(--sb-input-bg);
  padding: 6px;
}

.sb-chip-row {
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  -webkit-overflow-scrolling: touch;
  gap: 5px;
  margin-bottom: 6px;
  padding-bottom: 2px;
}

.sb-chip {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--sb-chip-border);
  background: var(--sb-chip-bg);
  border-radius: 8px;
  padding: 3px 5px;
}

.sb-chip-main {
  border: 0;
  background: transparent;
  min-width: 0;
  display: flex;
  flex-direction: column;
  text-align: left;
  padding: 0;
}

.sb-chip-main.active strong {
  color: var(--sb-active-text);
}

.sb-chip-main.active span {
  color: var(--sb-active-text);
}

.sb-chip-main strong {
  display: block;
  font-size: 11px;
  white-space: nowrap;
}

.sb-chip-main span {
  display: block;
  color: var(--sb-chip-meta);
  font-size: 10px;
  white-space: nowrap;
}

.sb-chip-open {
  border: 1px solid var(--sb-button-border);
  background: var(--sb-button-bg);
  color: var(--sb-button-text);
  border-radius: 999px;
  font-size: 10px;
  line-height: 1;
  font-weight: 600;
  padding: 4px 8px;
}

.sb-chip-remove {
  border: 0;
  background: transparent;
  font-size: 14px;
  line-height: 1;
  color: var(--sb-text-dim);
}

.sb-textarea {
  width: 100%;
  min-height: 84px;
  padding: 8px 42px 8px 8px;
  resize: vertical;
  box-sizing: border-box;
  display: block;
  border: 1px solid var(--sb-input-border);
  border-radius: 10px;
  background: var(--sb-input-bg);
  color: var(--sb-button-text);
  font-size: 12px;
}

.composer-action {
  position: absolute;
  right: 12px;
  bottom: 12px;
}

.send-icon-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--sb-button-border);
  border-radius: 999px;
  background: var(--sb-button-bg);
  color: var(--sb-button-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sb-loader {
  width: 18px;
  height: 18px;
  border: 2px solid var(--sb-spinner-track);
  border-top-color: var(--sb-spinner-head);
  border-radius: 999px;
  animation: sb-spin 0.8s linear infinite;
  display: inline-block;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hint {
  font-size: 12px;
  color: var(--sb-text-dim);
}

.sb-toast {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 35;
  border: 1px solid var(--sb-status-success-border);
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--sb-status-success-bg);
  color: var(--sb-status-success-text);
  font-size: 12px;
  box-shadow: 0 10px 28px rgb(15 23 42 / 22%);
}

.sb-toast.error {
  border-color: var(--sb-danger-border);
  background: var(--sb-danger-bg);
  color: var(--sb-danger-text);
}

.sb-toast-fade-enter-active,
.sb-toast-fade-leave-active {
  transition: opacity 140ms ease, transform 140ms ease;
}

.sb-toast-fade-enter-from,
.sb-toast-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.sb-echoes-panel-enter-active,
.sb-echoes-panel-leave-active {
  transition: opacity 180ms ease, transform 220ms ease, max-height 220ms ease;
  overflow: hidden;
}

.sb-echoes-panel-enter-from,
.sb-echoes-panel-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.985);
  max-height: 0;
}

.sb-echoes-panel-enter-to,
.sb-echoes-panel-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  max-height: 420px;
}

@keyframes sb-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

</style>
