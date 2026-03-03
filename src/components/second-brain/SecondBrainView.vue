<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ClipboardDocumentIcon, PaperAirplaneIcon } from '@heroicons/vue/24/outline'
import SecondBrainSessionsList from './SecondBrainSessionsList.vue'
import {
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
import type { SecondBrainMessage, SecondBrainSessionSummary } from '../../lib/api'

const props = defineProps<{
  workspacePath: string
  allWorkspaceFiles: string[]
  requestedSessionId: string
  requestedSessionNonce: number
  requestedContextTogglePath: string
  requestedContextToggleNonce: number
}>()

const emit = defineEmits<{
  'open-note': [path: string]
  'context-changed': [paths: string[]]
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
const sending = ref(false)
const sendError = ref('')
const sessionsIndex = ref<SecondBrainSessionSummary[]>([])
const rightPanelWidth = ref(360)
const resizing = ref(false)
const resizeState = ref<{ startX: number; startWidth: number } | null>(null)
const streamUnsubscribers: Array<() => void> = []

function toRelativePath(path: string): string {
  const value = path.replace(/\\/g, '/')
  const root = props.workspacePath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!root) return value
  if (value === root) return '.'
  if (value.startsWith(`${root}/`)) return value.slice(root.length + 1)
  return value
}

const contextCards = computed(() =>
  contextPaths.value.map((path) => {
    const normalized = toRelativePath(path)
    const parts = normalized.split('/')
    const name = parts[parts.length - 1]
    const parent = parts.slice(0, -1).join('/') || '.'
    return {
      path,
      name,
      parent
    }
  })
)

function isInContext(path: string): boolean {
  return contextPaths.value.includes(path)
}

function toggleContextPath(path: string) {
  if (!sessionId.value) return
  if (isInContext(path)) {
    contextPaths.value = contextPaths.value.filter((item) => item !== path)
  } else {
    contextPaths.value = [...contextPaths.value, path]
  }
  emit('context-changed', contextPaths.value)
  void syncContextWithBackend()
}

function removeContextPath(path: string) {
  contextPaths.value = contextPaths.value.filter((item) => item !== path)
  emit('context-changed', contextPaths.value)
  void syncContextWithBackend()
}

async function syncContextWithBackend() {
  if (!sessionId.value) return
  try {
    await replaceSessionContext(sessionId.value, contextPaths.value)
    const next: Record<string, number> = {}
    for (const path of contextPaths.value) {
      next[path] = contextTokenEstimate.value[path] ?? 0
    }
    contextTokenEstimate.value = next
  } catch (err) {
    sendError.value = err instanceof Error ? err.message : 'Could not update context.'
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
  try {
    const payload = await loadDeliberationSession(nextSessionId)
    sessionId.value = payload.session_id
    sessionTitle.value = payload.title || 'Second Brain Session'
    contextPaths.value = payload.context_items.map((item) => asAbsolute(item.path))

    const nextTokens: Record<string, number> = {}
    for (const item of payload.context_items) {
      nextTokens[asAbsolute(item.path)] = item.token_estimate
    }
    contextTokenEstimate.value = nextTokens

    messages.value = payload.messages
    emit('context-changed', contextPaths.value)
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
  const seed = contextPaths.value[0] || props.allWorkspaceFiles.find((path) => /\.(md|markdown)$/i.test(path))
  if (!seed) {
    sendError.value = 'No markdown note found to seed a new session.'
    return
  }
  const created = await createDeliberationSession({ contextPaths: [seed], title: '' })
  sessionId.value = created.sessionId
  sessionTitle.value = 'Second Brain Session'
  contextPaths.value = [seed]
  contextTokenEstimate.value = { [seed]: Math.max(1, Math.round((seed.length + 400) / 4)) }
  messages.value = []
  streamByMessage.value = {}
  emit('context-changed', contextPaths.value)
  await refreshSessionsIndex()
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
  sessionTitle.value = 'Second Brain Session'
  contextPaths.value = []
  contextTokenEstimate.value = {}
  messages.value = []
  streamByMessage.value = {}
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

async function onSendMessage() {
  if (!sessionId.value || !inputMessage.value.trim()) return
  sending.value = true
  sendError.value = ''
  const outgoing = inputMessage.value.trim()
  const tempUserId = `temp-user-${Date.now()}`
  inputMessage.value = ''

  messages.value = [...messages.value, {
    id: tempUserId,
    role: 'user',
    mode: 'freestyle',
    content_md: outgoing,
    citations_json: '[]',
    attachments_json: '[]',
    created_at_ms: Date.now()
  }]

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
    }

    await refreshSessionsIndex()
    const updated = sessionsIndex.value.find((item) => item.session_id === sessionId.value)
    if (updated?.title) {
      sessionTitle.value = updated.title
    }
  } catch (err) {
    sendError.value = err instanceof Error ? err.message : 'Could not send message.'
  } finally {
    sending.value = false
  }
}

async function onCopyAssistantMessage(message: SecondBrainMessage) {
  if (message.role !== 'assistant') return
  const content = displayMessage(message).trim()
  if (!content) return

  try {
    await navigator.clipboard.writeText(content)
  } catch (err) {
    sendError.value = err instanceof Error ? err.message : 'Could not copy assistant response.'
  }
}

function openContextNote(path: string) {
  emit('open-note', path)
}

function beginResize(event: MouseEvent) {
  event.preventDefault()
  resizeState.value = {
    startX: event.clientX,
    startWidth: rightPanelWidth.value
  }
  resizing.value = true
}

function onPointerMove(event: MouseEvent) {
  if (!resizeState.value) return
  const delta = resizeState.value.startX - event.clientX
  rightPanelWidth.value = Math.max(320, Math.min(760, resizeState.value.startWidth + delta))
}

function stopResize() {
  resizing.value = false
  resizeState.value = null
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
    }
  }))
  streamUnsubscribers.push(await subscribeSecondBrainStream('second-brain://assistant-delta', (payload) => {
    if (payload.session_id !== sessionId.value) return
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
  }))
  streamUnsubscribers.push(await subscribeSecondBrainStream('second-brain://assistant-complete', (payload) => {
    if (payload.session_id !== sessionId.value) return
    streamByMessage.value = {
      ...streamByMessage.value,
      [payload.message_id]: payload.chunk
    }
    sending.value = false
  }))
  streamUnsubscribers.push(await subscribeSecondBrainStream('second-brain://assistant-error', (payload) => {
    if (payload.session_id !== sessionId.value) return
    sending.value = false
    sendError.value = payload.error || 'Assistant stream failed.'
  }))
  window.addEventListener('mousemove', onPointerMove)
  window.addEventListener('mouseup', stopResize)
})

onBeforeUnmount(() => {
  for (const unsubscribe of streamUnsubscribers) {
    unsubscribe()
  }
  window.removeEventListener('mousemove', onPointerMove)
  window.removeEventListener('mouseup', stopResize)
})

watch(
  () => `${props.requestedSessionId}::${props.requestedSessionNonce}`,
  (value) => {
    const [id] = value.split('::')
    if (!id.trim()) return
    void loadSession(id)
  }
)

watch(
  () => `${props.requestedContextTogglePath}::${props.requestedContextToggleNonce}`,
  (value) => {
    const [path] = value.split('::')
    if (!path.trim()) return
    toggleContextPath(path)
  }
)
</script>

<template>
  <div class="sb-layout">
    <section class="sb-col sb-center">
      <header class="sb-center-head">
        <div>
          <h2>{{ sessionTitle }}</h2>
          <p v-if="configError" class="sb-error">{{ configError }}</p>
        </div>
      </header>

      <section class="sb-context-summary">
        <div class="cards">
          <article v-for="card in contextCards" :key="card.path" class="card">
            <div class="meta" @click="openContextNote(card.path)">
              <strong>{{ card.name }}</strong>
              <span>{{ card.parent }}</span>
            </div>
            <button type="button" class="x" @click="removeContextPath(card.path)">×</button>
          </article>
        </div>
      </section>

      <section class="sb-thread">
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
              title="Copy to clipboard"
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
          <textarea
            v-model="inputMessage"
            class="sb-textarea"
            placeholder="Posez une question sur votre contexte actif..."
          ></textarea>
          <div class="composer-action">
            <span v-if="sending" class="sb-loader" aria-label="Thinking"></span>
            <button v-else type="button" class="send-icon-btn" :disabled="!sessionId || !inputMessage.trim()" @click="onSendMessage">
              <PaperAirplaneIcon class="h-4 w-4" />
            </button>
          </div>
        </div>
        <div v-if="loading || sendError" class="actions">
          <span v-if="loading" class="hint">Loading...</span>
          <span v-if="sendError" class="sb-error">{{ sendError }}</span>
        </div>
      </footer>
    </section>
    <div class="sb-splitter" :class="{ active: resizing }" @mousedown="beginResize"></div>
    <aside class="sb-col sb-right">
      <div class="sb-right-inner" :style="{ width: `${rightPanelWidth}px` }">
      <header class="sb-right-head">
        <h3>Sessions</h3>
      </header>
      <SecondBrainSessionsList
        :sessions="sessionsIndex"
        :active-session-id="sessionId"
        :loading="loading"
        @select="loadSession"
        @create="onCreateSession"
        @delete="onDeleteSession"
      />
      </div>
    </aside>
  </div>
</template>

<style scoped>
.sb-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 8px auto;
  gap: 0;
  min-height: 0;
  height: 100%;
  padding: 10px 10px 10px 0;
  background: linear-gradient(135deg, #f8fafc, #eef2ff 45%, #f1f5f9);
}
.sb-col {
  min-height: 0;
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  background: #f8fafc;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.sb-right { padding: 10px; }
.sb-right-head,
.sb-center-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.sb-right-head h3,
.sb-center-head h2 { margin: 0; }
.sb-input,
.sb-textarea,
.sb-btn {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: #0f172a;
  font-size: 12px;
}
.sb-input { height: 32px; padding: 0 8px; }
.sb-textarea {
  width: 100%;
  min-height: 92px;
  padding: 10px 44px 10px 10px;
  resize: vertical;
  box-sizing: border-box;
  display: block;
}
.sb-btn { height: 32px; padding: 0 10px; }
.sb-btn.secondary { background: #f8fafc; }
.sb-center { padding: 10px; gap: 8px; }
.sb-context-summary { border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px; background: #fff; }
.cards {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  margin-top: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
}
.card {
  flex: 0 0 auto;
  width: 240px;
  min-width: 240px;
  max-width: 240px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #dbeafe;
  background: #f8fbff;
  border-radius: 8px;
  padding: 4px 6px;
}
.card .meta { min-width: 0; flex: 1; cursor: pointer; }
.card strong {
  display: block;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card span {
  display: block;
  color: #64748b;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card .x { border: 0; background: transparent; font-size: 16px; line-height: 1; color: #64748b; }
.sb-thread { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.msg { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; }
.msg.user { background: #f8fafc; }
.msg.assistant { background: #eff6ff; }
.msg header { display: flex; justify-content: space-between; gap: 8px; }
.msg pre { white-space: pre-wrap; margin: 8px 0 0; font-size: 12px; }
.assistant-markdown { margin-top: 8px; font-size: 12px; line-height: 1.5; }
.assistant-markdown :deep(p) { margin: 0 0 8px; }
.assistant-markdown :deep(p:last-child) { margin-bottom: 0; }
.assistant-markdown :deep(h1),
.assistant-markdown :deep(h2),
.assistant-markdown :deep(h3),
.assistant-markdown :deep(h4),
.assistant-markdown :deep(h5),
.assistant-markdown :deep(h6) { margin: 10px 0 6px; line-height: 1.3; font-weight: 700; }
.assistant-markdown :deep(ul),
.assistant-markdown :deep(ol) { margin: 6px 0 8px 18px; padding: 0; }
.assistant-markdown :deep(blockquote) {
  margin: 6px 0 8px;
  border-left: 3px solid #cbd5e1;
  padding: 2px 0 2px 10px;
  color: #475569;
}
.assistant-markdown :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  background: #e2e8f0;
  border-radius: 4px;
  padding: 1px 4px;
}
.assistant-markdown :deep(pre) {
  margin: 8px 0;
  background: #e2e8f0;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 8px;
  overflow: auto;
}
.assistant-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
  border-radius: 0;
}
.assistant-markdown :deep(a) { color: #2563eb; text-decoration: underline; }
.insert { border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font-size: 11px; padding: 3px 8px; }
.sb-input-row { display: flex; flex-direction: column; gap: 6px; margin-top: auto; }
.sb-composer { position: relative; width: 100%; }
.composer-action {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.send-icon-btn {
  width: 28px;
  height: 28px;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  background: #fff;
  color: #334155;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.send-icon-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.sb-loader {
  width: 16px;
  height: 16px;
  border: 2px solid #93c5fd;
  border-top-color: #2563eb;
  border-radius: 999px;
  animation: sb-spin 0.75s linear infinite;
}
.sb-input-row .actions { display: flex; align-items: center; gap: 10px; }
.sb-error { color: #b91c1c; font-size: 12px; }
.hint { color: #64748b; font-size: 12px; }
.sb-right-inner { width: 360px; min-width: 0; height: 100%; display: flex; flex-direction: column; }
.sb-splitter {
  width: 8px;
  cursor: col-resize;
  background: linear-gradient(180deg, transparent, #cbd5e1 30%, #cbd5e1 70%, transparent);
  border-radius: 999px;
  margin: 12px 0;
}
.sb-splitter.active {
  background: linear-gradient(180deg, transparent, #2563eb 30%, #2563eb 70%, transparent);
}

@media (max-width: 1320px) {
  .sb-layout {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr 340px;
    gap: 8px;
    padding: 10px;
  }
  .sb-right {
    padding: 10px;
  }
  .sb-right-inner {
    width: 100% !important;
  }
  .sb-splitter {
    display: none;
  }
}

:global(.ide-root.dark) .sb-layout {
  background: linear-gradient(145deg, #1f232b, #20252f 45%, #252b36);
}
:global(.ide-root.dark) .sb-col,
:global(.ide-root.dark) .sb-thread,
:global(.ide-root.dark) .sb-context-summary,
:global(.ide-root.dark) .card,
:global(.ide-root.dark) .msg,
:global(.ide-root.dark) .insert,
:global(.ide-root.dark) .send-icon-btn,
:global(.ide-root.dark) .sb-input,
:global(.ide-root.dark) .sb-textarea,
:global(.ide-root.dark) .sb-btn {
  border-color: #3e4451;
  background: #21252b;
  color: #abb2bf;
}
:global(.ide-root.dark) .msg.assistant { background: #2c313c; }
:global(.ide-root.dark) .msg.user { background: #21252b; }
:global(.ide-root.dark) .assistant-markdown :deep(blockquote) {
  border-left-color: #4b5563;
  color: #9ca3af;
}
:global(.ide-root.dark) .assistant-markdown :deep(code),
:global(.ide-root.dark) .assistant-markdown :deep(pre) {
  background: #2f3540;
  border-color: #3e4451;
}
:global(.ide-root.dark) .assistant-markdown :deep(a) { color: #61afef; }
:global(.ide-root.dark) .card span,
:global(.ide-root.dark) .hint { color: #94a3b8; }
:global(.ide-root.dark) .sb-error { color: #e06c75; }
:global(.ide-root.dark) .sb-loader {
  border-color: #475569;
  border-top-color: #61afef;
}
:global(.ide-root.dark) .sb-splitter {
  background: linear-gradient(180deg, transparent, #3e4451 30%, #3e4451 70%, transparent);
}
:global(.ide-root.dark) .sb-splitter.active {
  background: linear-gradient(180deg, transparent, #61afef 30%, #61afef 70%, transparent);
}
@keyframes sb-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
