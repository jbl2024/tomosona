<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import EditorView from '../EditorView.vue'
import {
  createDeliberationSession,
  exportSessionMarkdown,
  fetchSecondBrainConfigStatus,
  fetchSecondBrainSessions,
  insertAssistantMessageIntoTarget,
  linkSessionTargetNote,
  loadDeliberationSession,
  parseMessageCitations,
  replaceSessionContext,
  runDeliberation,
  subscribeSecondBrainStream
} from '../../lib/secondBrainApi'
import { SECOND_BRAIN_MODES } from '../../lib/secondBrainModes'
import type { SecondBrainMessage, SecondBrainSessionSummary } from '../../lib/api'

const props = defineProps<{
  workspacePath: string
  allWorkspaceFiles: string[]
  requestedSessionId: string
  requestedSessionNonce: number
  openFile: (path: string) => Promise<string>
  saveFile: (path: string, text: string, options: { explicit: boolean }) => Promise<{ persisted: boolean }>
  renameFileFromTitle: (path: string, title: string) => Promise<{ path: string; title: string }>
  loadLinkTargets: () => Promise<string[]>
  loadLinkHeadings: (target: string) => Promise<string[]>
  loadPropertyTypeSchema: () => Promise<Record<string, string>>
  savePropertyTypeSchema: (schema: Record<string, string>) => Promise<void>
  openLinkTarget: (target: string) => Promise<boolean>
}>()

const emit = defineEmits<{
  'open-note': [path: string]
}>()

type EditorViewExposed = {
  reloadCurrent: () => Promise<void>
}

const TOKEN_LIMIT = 120000
const modes = SECOND_BRAIN_MODES
const modeById = new Map(modes.map((item) => [item.id, item]))

const configError = ref('')
const loading = ref(false)
const sessionId = ref('')
const sessionTitle = ref('Second Brain Session')
const contextPaths = ref<string[]>([])
const contextTokenEstimate = ref<Record<string, number>>({})
const selectedModeId = ref('freestyle')
const inputMessage = ref('')
const messages = ref<SecondBrainMessage[]>([])
const citationsByMessage = ref<Record<string, string[]>>({})
const streamByMessage = ref<Record<string, string>>({})
const sending = ref(false)
const sendError = ref('')
const targetNotePath = ref('')
const targetPickerVisible = ref(false)
const targetPickerQuery = ref('')
const targetNewName = ref('')
const targetPickerError = ref('')
const sessionsIndex = ref<SecondBrainSessionSummary[]>([])
const editorTargetRef = ref<EditorViewExposed | null>(null)

function fuzzySubsequenceMatch(text: string, query: string): boolean {
  const source = text.toLowerCase()
  const needle = query.toLowerCase().trim()
  if (!needle) return true
  let idx = 0
  for (let i = 0; i < source.length && idx < needle.length; i += 1) {
    if (source[i] === needle[idx]) idx += 1
  }
  return idx === needle.length
}

const candidateNotes = computed(() => {
  const markdown = props.allWorkspaceFiles.filter((path) => /\.(md|markdown)$/i.test(path))
  const q = targetPickerVisible.value
    ? targetPickerQuery.value.trim().toLowerCase()
    : leftSearchQuery.value.trim().toLowerCase()
  if (!q) return markdown
  return markdown.filter((path) => fuzzySubsequenceMatch(path, q))
})

const leftSearchQuery = ref('')

const modeUi = computed(() => {
  const mode = modeById.get(selectedModeId.value)
  const fallback = {
    label: 'Freestyle',
    tone: 'Neutral',
    placeholder: 'Posez une question libre sur votre contexte actif...'
  }
  if (!mode) return fallback

  const mapping: Record<string, { tone: string; placeholder: string }> = {
    freestyle: { tone: 'Libre', placeholder: 'Posez une question libre sur votre contexte actif...' },
    synthese: { tone: 'Synthese', placeholder: 'Demandez une synthese exploitable des notes selectionnees...' },
    plan_action: { tone: 'Action', placeholder: 'Demandez un plan d\'action concret et priorise...' },
    diagnostic: { tone: 'Diagnostic', placeholder: 'Demandez un diagnostic avec hypotheses et validations...' },
    fusion_notes: { tone: 'Fusion', placeholder: 'Demandez une fusion coherente de plusieurs notes...' },
    extraction_concepts: { tone: 'Concepts', placeholder: 'Demandez extraction de concepts, relations, ambiguities...' }
  }

  return {
    label: mode.label,
    tone: mapping[mode.id]?.tone ?? mode.label,
    placeholder: mapping[mode.id]?.placeholder ?? fallback.placeholder
  }
})

const contextCards = computed(() =>
  contextPaths.value.map((path) => {
    const normalized = path.replace(/\\/g, '/')
    const parts = normalized.split('/')
    const name = parts[parts.length - 1]
    const parent = parts.slice(0, -1).join('/') || '.'
    return {
      path,
      name,
      parent,
      tokens: contextTokenEstimate.value[path] ?? 0
    }
  })
)

const totalTokens = computed(() => contextCards.value.reduce((sum, item) => sum + item.tokens, 0))
const tokenProgress = computed(() => Math.min(100, Math.round((totalTokens.value / TOKEN_LIMIT) * 100)))

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
  void syncContextWithBackend()
}

function removeContextPath(path: string) {
  contextPaths.value = contextPaths.value.filter((item) => item !== path)
  void syncContextWithBackend()
}

async function syncContextWithBackend() {
  if (!sessionId.value) return
  try {
    await replaceSessionContext(sessionId.value, contextPaths.value)
    const avg = contextPaths.value.length ? Math.max(1, Math.round(totalTokens.value / contextPaths.value.length)) : 0
    const next: Record<string, number> = {}
    for (const path of contextPaths.value) {
      next[path] = contextTokenEstimate.value[path] ?? avg
    }
    contextTokenEstimate.value = next
  } catch (err) {
    sendError.value = err instanceof Error ? err.message : 'Could not update context.'
  }
}

function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = `${now.getMonth() + 1}`.padStart(2, '0')
  const d = `${now.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

function defaultNewTargetPath() {
  const root = props.workspacePath || ''
  if (!root) return ''
  return `${root}/Untitled_${todayIso()}.md`
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
    const nextCitations: Record<string, string[]> = {}
    for (const msg of payload.messages) {
      nextCitations[msg.id] = parseMessageCitations(msg)
    }
    citationsByMessage.value = nextCitations

    targetNotePath.value = payload.target_note_path ? asAbsolute(payload.target_note_path) : ''
    if (!targetNotePath.value) {
      targetNewName.value = defaultNewTargetPath()
      targetPickerVisible.value = true
    }
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

function displayMessage(message: SecondBrainMessage): string {
  if (message.role === 'assistant') {
    return streamByMessage.value[message.id] ?? message.content_md
  }
  return message.content_md
}

async function onSendMessage() {
  if (!sessionId.value || !inputMessage.value.trim()) return
  sending.value = true
  sendError.value = ''
  const outgoing = inputMessage.value.trim()
  inputMessage.value = ''

  messages.value = [...messages.value, {
    id: `temp-user-${Date.now()}`,
    role: 'user',
    mode: selectedModeId.value,
    content_md: outgoing,
    citations_json: '[]',
    attachments_json: '[]',
    created_at_ms: Date.now()
  }]

  try {
    const result = await runDeliberation({
      sessionId: sessionId.value,
      mode: selectedModeId.value,
      message: outgoing
    })

    messages.value = [...messages.value, {
      id: result.assistantMessageId,
      role: 'assistant',
      mode: selectedModeId.value,
      content_md: '',
      citations_json: JSON.stringify(contextPaths.value.map((path) => path.replace(`${props.workspacePath}/`, ''))),
      attachments_json: '[]',
      created_at_ms: Date.now()
    }]

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

async function onInsertIntoTarget(message: SecondBrainMessage) {
  if (!sessionId.value) return
  if (message.role !== 'assistant') return
  if (!targetNotePath.value) {
    targetPickerVisible.value = true
    targetPickerError.value = 'Choose a target note first.'
    return
  }

  try {
    await insertAssistantMessageIntoTarget(sessionId.value, message.id)
    await editorTargetRef.value?.reloadCurrent()
  } catch (err) {
    sendError.value = err instanceof Error ? err.message : 'Could not insert into target note.'
  }
}

async function linkTargetPath(absolutePath: string) {
  if (!sessionId.value) return
  const linkedRelative = await linkSessionTargetNote(sessionId.value, absolutePath)
  targetNotePath.value = asAbsolute(linkedRelative)
}

async function chooseExistingTarget(path: string) {
  try {
    targetPickerError.value = ''
    await linkTargetPath(path)
    targetPickerVisible.value = false
  } catch (err) {
    targetPickerError.value = err instanceof Error ? err.message : 'Could not set target note.'
  }
}

async function createAndChooseTarget() {
  const nextPath = targetNewName.value.trim() || defaultNewTargetPath()
  if (!nextPath) return
  try {
    targetPickerError.value = ''
    await props.saveFile(nextPath, '# Untitled\n', { explicit: true })
    await linkTargetPath(nextPath)
    targetPickerVisible.value = false
  } catch (err) {
    targetPickerError.value = err instanceof Error ? err.message : 'Could not create target note.'
  }
}

function openContextNote(path: string) {
  emit('open-note', path)
}

async function onExportSession() {
  if (!sessionId.value) return
  try {
    const outPath = await exportSessionMarkdown(sessionId.value)
    sendError.value = ''
    emit('open-note', outPath)
  } catch (err) {
    sendError.value = err instanceof Error ? err.message : 'Could not export session.'
  }
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

  await refreshSessionsIndex()
  await ensureSession()

  await subscribeSecondBrainStream('second-brain://assistant-start', (payload) => {
    streamByMessage.value = {
      ...streamByMessage.value,
      [payload.message_id]: ''
    }
  })
  await subscribeSecondBrainStream('second-brain://assistant-delta', (payload) => {
    const current = streamByMessage.value[payload.message_id] ?? ''
    streamByMessage.value = {
      ...streamByMessage.value,
      [payload.message_id]: `${current}${payload.chunk}`
    }
  })
  await subscribeSecondBrainStream('second-brain://assistant-complete', (payload) => {
    streamByMessage.value = {
      ...streamByMessage.value,
      [payload.message_id]: payload.chunk
    }
  })
})

watch(
  () => `${props.requestedSessionId}::${props.requestedSessionNonce}`,
  (value) => {
    const [id] = value.split('::')
    if (!id.trim()) return
    void loadSession(id)
  }
)
</script>

<template>
  <div class="sb-layout">
    <aside class="sb-col sb-left">
      <header class="sb-left-head">
        <h3>Pick notes</h3>
      </header>
      <input v-model="leftSearchQuery" class="sb-input" type="text" placeholder="Search notes (fuzzy)">
      <div class="sb-note-list">
        <button
          v-for="path in candidateNotes"
          :key="path"
          type="button"
          class="sb-note-item"
          :class="{ inctx: isInContext(path) }"
          @click="toggleContextPath(path)"
        >
          <span class="dot" :class="{ inctx: isInContext(path) }"></span>
          <span class="name">{{ path.split('/').pop() }}</span>
          <span class="parent">{{ path.replace(/\\/g, '/').split('/').slice(0, -1).join('/') || '.' }}</span>
        </button>
      </div>
    </aside>

    <section class="sb-col sb-center">
      <header class="sb-center-head">
        <div>
          <h2>{{ sessionTitle }}</h2>
          <p class="tone">Mode {{ modeUi.label }} · Tone {{ modeUi.tone }}</p>
          <p v-if="configError" class="sb-error">{{ configError }}</p>
        </div>
        <button type="button" class="sb-btn" :disabled="!sessionId" @click="onExportSession">Export session .md</button>
      </header>

      <section class="sb-context-summary">
        <div class="row">
          <strong>Context</strong>
          <span>{{ totalTokens }} / {{ TOKEN_LIMIT }} tokens</span>
        </div>
        <div class="progress">
          <div class="fill" :style="{ width: `${tokenProgress}%` }"></div>
        </div>
        <div class="cards">
          <article v-for="card in contextCards" :key="card.path" class="card">
            <div class="meta" @click="openContextNote(card.path)">
              <strong>{{ card.name }}</strong>
              <span>{{ card.parent }}</span>
            </div>
            <button type="button" class="x" @click="removeContextPath(card.path)">×</button>
          </article>
        </div>
        <details class="sb-v2-hint">
          <summary>Voir les notes proches (V2)</summary>
          <p>Suggestions semantiques a venir.</p>
        </details>
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
              @click="onInsertIntoTarget(message)"
            >
              → Inserer dans la note
            </button>
          </header>
          <pre>{{ displayMessage(message) }}</pre>
        </article>
      </section>

      <footer class="sb-input-row">
        <select v-model="selectedModeId" class="sb-mode">
          <option v-for="mode in modes" :key="mode.id" :value="mode.id">{{ mode.label }}</option>
        </select>
        <textarea
          v-model="inputMessage"
          class="sb-textarea"
          :placeholder="modeUi.placeholder"
        ></textarea>
        <div class="actions">
          <button type="button" class="sb-btn" :disabled="sending || !sessionId" @click="onSendMessage">
            {{ sending ? 'Thinking...' : 'Send' }}
          </button>
          <span v-if="loading" class="hint">Loading...</span>
          <span v-if="sendError" class="sb-error">{{ sendError }}</span>
        </div>
      </footer>
    </section>

    <aside class="sb-col sb-right">
      <header class="sb-right-head">
        <h3>Target note</h3>
        <button type="button" class="sb-btn secondary" @click="targetPickerVisible = true">Change target</button>
      </header>

      <div v-if="!targetNotePath" class="target-empty">
        <p>No target note linked.</p>
        <button type="button" class="sb-btn" @click="targetPickerVisible = true">Choose target note</button>
      </div>

      <EditorView
        v-else
        ref="editorTargetRef"
        :path="targetNotePath"
        :open-paths="[targetNotePath]"
        :open-file="props.openFile"
        :save-file="props.saveFile"
        :rename-file-from-title="props.renameFileFromTitle"
        :load-link-targets="props.loadLinkTargets"
        :load-link-headings="props.loadLinkHeadings"
        :load-property-type-schema="props.loadPropertyTypeSchema"
        :save-property-type-schema="props.savePropertyTypeSchema"
        :open-link-target="props.openLinkTarget"
      />
    </aside>

    <div v-if="targetPickerVisible" class="modal-overlay" @click.self="targetPickerVisible = false">
      <div class="modal sb-target-modal" role="dialog" aria-modal="true">
        <h3>Quelle note editez-vous ?</h3>
        <input v-model="targetPickerQuery" class="sb-input" placeholder="Choose existing note...">
        <div class="existing-list">
          <button
            v-for="path in candidateNotes"
            :key="`target-${path}`"
            type="button"
            class="existing-item"
            @click="chooseExistingTarget(path)"
          >
            {{ path }}
          </button>
        </div>

        <p class="create-label">Ou creer une nouvelle note</p>
        <input v-model="targetNewName" class="sb-input" :placeholder="defaultNewTargetPath()">

        <p v-if="targetPickerError" class="sb-error">{{ targetPickerError }}</p>
        <div class="modal-actions">
          <button type="button" class="sb-btn secondary" @click="targetPickerVisible = false">Cancel</button>
          <button type="button" class="sb-btn" @click="createAndChooseTarget">Create + link</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sb-layout {
  display: grid;
  grid-template-columns: 300px 1fr 420px;
  gap: 10px;
  min-height: 0;
  height: 100%;
  padding: 10px;
  background: linear-gradient(135deg, #f8fafc, #eef2ff 45%, #f1f5f9);
}
.sb-col {
  min-height: 0;
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  background: rgb(255 255 255 / 90%);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.sb-left,
.sb-right { padding: 10px; }
.sb-left-head,
.sb-right-head,
.sb-center-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.sb-left-head h3,
.sb-right-head h3,
.sb-center-head h2,
.tone,
.row,
.create-label { margin: 0; }
.tone { font-size: 12px; color: #64748b; }
.sb-link { border: 0; background: transparent; color: #2563eb; font-size: 12px; }
.sb-input,
.sb-textarea,
.sb-mode,
.sb-btn {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: #0f172a;
  font-size: 12px;
}
.sb-input, .sb-mode { height: 32px; padding: 0 8px; }
.sb-textarea { min-height: 92px; padding: 8px; resize: vertical; }
.sb-btn { height: 32px; padding: 0 10px; }
.sb-btn.secondary { background: #f8fafc; }
.sb-note-list { margin-top: 8px; overflow: auto; min-height: 0; display: flex; flex-direction: column; gap: 4px; }
.sb-note-item { display: grid; grid-template-columns: 10px minmax(0,1fr); gap: 6px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; padding: 6px; text-align: left; }
.sb-note-item .name { font-size: 12px; }
.sb-note-item .parent { font-size: 11px; color: #64748b; display: block; }
.dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; background: #cbd5e1; }
.dot.inctx { background: #2563eb; }
.sb-note-item.inctx { border-color: #2563eb; background: #eff6ff; }
.sb-center { padding: 10px; gap: 8px; }
.sb-context-summary { border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px; background: #fff; }
.sb-context-summary .row { display: flex; justify-content: space-between; font-size: 12px; }
.progress { margin-top: 6px; height: 7px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
.fill { height: 100%; background: linear-gradient(90deg, #2563eb, #38bdf8); }
.cards { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.card { display: flex; align-items: center; gap: 8px; border: 1px solid #dbeafe; background: #f8fbff; border-radius: 8px; padding: 4px 6px; }
.card .meta { cursor: pointer; }
.card strong { display: block; font-size: 12px; }
.card span { display: block; color: #64748b; font-size: 11px; }
.card .x { border: 0; background: transparent; font-size: 16px; line-height: 1; color: #64748b; }
.sb-v2-hint { margin-top: 6px; font-size: 12px; color: #64748b; }
.sb-thread { flex: 1; min-height: 0; overflow: auto; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.msg { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; }
.msg.user { background: #f8fafc; }
.msg.assistant { background: #eff6ff; }
.msg header { display: flex; justify-content: space-between; gap: 8px; }
.msg pre { white-space: pre-wrap; margin: 8px 0 0; font-size: 12px; }
.insert { border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font-size: 11px; padding: 3px 8px; }
.sb-input-row { display: grid; grid-template-columns: 180px 1fr; gap: 8px; }
.sb-input-row .actions { grid-column: 1 / span 2; display: flex; align-items: center; gap: 10px; }
.sb-error { color: #b91c1c; font-size: 12px; }
.hint { color: #64748b; font-size: 12px; }
.target-empty { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; justify-content: center; height: 100%; color: #64748b; font-size: 12px; }
.sb-target-modal { width: min(780px, calc(100vw - 30px)); max-height: calc(100vh - 50px); overflow: auto; }
.existing-list { max-height: 240px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 8px; margin-top: 8px; }
.existing-item { width: 100%; border: 0; border-bottom: 1px solid #e2e8f0; background: #fff; padding: 8px; text-align: left; font-size: 12px; }
.existing-item:last-child { border-bottom: 0; }
.create-label { margin-top: 10px; font-size: 12px; color: #475569; }
.modal-actions { margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px; }

@media (max-width: 1320px) {
  .sb-layout {
    grid-template-columns: 260px 1fr;
    grid-template-rows: 1fr 340px;
  }
  .sb-right { grid-column: 1 / span 2; }
}

:global(.ide-root.dark) .sb-layout {
  background: linear-gradient(140deg, #020617, #0f172a 40%, #082f49);
}
:global(.ide-root.dark) .sb-col,
:global(.ide-root.dark) .sb-thread,
:global(.ide-root.dark) .sb-context-summary,
:global(.ide-root.dark) .sb-note-item,
:global(.ide-root.dark) .card,
:global(.ide-root.dark) .msg,
:global(.ide-root.dark) .insert,
:global(.ide-root.dark) .sb-input,
:global(.ide-root.dark) .sb-textarea,
:global(.ide-root.dark) .sb-mode,
:global(.ide-root.dark) .sb-btn,
:global(.ide-root.dark) .existing-list,
:global(.ide-root.dark) .existing-item {
  border-color: #334155;
  background: #0f172a;
  color: #e2e8f0;
}
:global(.ide-root.dark) .msg.assistant,
:global(.ide-root.dark) .sb-note-item.inctx { background: #082f49; }
:global(.ide-root.dark) .msg.user { background: #111827; }
:global(.ide-root.dark) .tone,
:global(.ide-root.dark) .card span,
:global(.ide-root.dark) .sb-v2-hint,
:global(.ide-root.dark) .hint,
:global(.ide-root.dark) .target-empty,
:global(.ide-root.dark) .create-label,
:global(.ide-root.dark) .sb-note-item .parent { color: #94a3b8; }
</style>
