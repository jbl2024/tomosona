<script setup lang="ts">
/**
 * Root render shell for the Second Brain chat surface.
 *
 * This component owns layout and event wiring only; the actual session,
 * stream, and composer behavior live in the domain composables.
 */
import { computed, ref, watch } from 'vue'
import { ClipboardDocumentIcon, PaperAirplaneIcon, PlusIcon, SparklesIcon } from '@heroicons/vue/24/outline'
import type { AppSettingsAlters } from '../../../shared/api/apiTypes'
import UiIconButton from '../../../shared/components/ui/UiIconButton.vue'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../../../shared/components/ui/UiFilterableDropdown.vue'
import SecondBrainAtMentionsMenu from './SecondBrainAtMentionsMenu.vue'
import SecondBrainEchoesPanel from './SecondBrainEchoesPanel.vue'
import SecondBrainSessionDropdown from './SecondBrainSessionDropdown.vue'
import { useSecondBrainViewState } from '../composables/useSecondBrainViewState'

const props = withDefaults(defineProps<{
  workspacePath: string
  allWorkspaceFiles: string[]
  requestedSessionId: string
  requestedSessionNonce: number
  requestedPrompt: string
  requestedPromptNonce: number
  requestedAlterId?: string
  requestedAlterNonce?: number
  activeNotePath?: string
  echoesRefreshToken?: number
  settings?: AppSettingsAlters
}>(), {
  requestedAlterId: '',
  requestedAlterNonce: 0,
  settings: () => ({
    default_mode: 'neutral',
    show_badge_in_chat: true,
    default_influence_intensity: 'balanced'
  })
})

const emit = defineEmits<{
  'open-note': [path: string]
  'context-changed': [paths: string[]]
  'session-changed': [sessionId: string]
}>()

const {
  activeAlterLabel,
  activePulseAction,
  addEchoesSuggestion,
  applyMentionSuggestion,
  applySelectedAlter,
  availableAlters,
  canCopyConversation,
  composerRef,
  configError,
  contextCards,
  contextPaths,
  copiedByMessageId,
  copyToast,
  creatingSession,
  displayMessage,
  echoes,
  echoesItems,
  inputMessage,
  isPathInContext,
  loadSession,
  loading,
  mentionInfo,
  mentions,
  messages,
  onComposerInput,
  onComposerKeydown,
  onCopyAssistantMessage,
  onCopyConversation,
  onCreateSession,
  onDeleteSession,
  onPulseDropdownSelect,
  onSendMessage,
  onStopStreaming,
  onThreadScroll,
  openContextNote,
  pulseDropdownActiveIndex,
  pulseDropdownItems,
  pulseDropdownMatcher,
  pulseDropdownOpen,
  pulseDropdownQuery,
  removeContextPath,
  renderAssistantMarkdown,
  requestInFlight,
  selectedAlterId,
  selectedEchoesContextPath,
  sessionLoadError,
  sendError,
  sending,
  sessionId,
  sessionTitle,
  sessionsIndex,
  showEchoesPanel,
  threadBottomSentinel,
  threadRef,
  toRelativePath,
  toggleEchoesAnchor,
  updateMentionTriggerFromComposer
} = useSecondBrainViewState({
  workspacePath: computed(() => props.workspacePath),
  allWorkspaceFiles: computed(() => props.allWorkspaceFiles),
  requestedSessionId: computed(() => props.requestedSessionId),
  requestedSessionNonce: computed(() => props.requestedSessionNonce),
  requestedPrompt: computed(() => props.requestedPrompt),
  requestedPromptNonce: computed(() => props.requestedPromptNonce),
  requestedAlterId: computed(() => props.requestedAlterId ?? ''),
  requestedAlterNonce: computed(() => props.requestedAlterNonce ?? 0),
  echoesRefreshToken: computed(() => props.echoesRefreshToken ?? 0),
  settings: computed(() => props.settings ?? {
    default_mode: 'neutral',
    show_badge_in_chat: true,
    default_influence_intensity: 'balanced'
  }),
  emitContextChanged: (paths) => emit('context-changed', paths),
  emitSessionChanged: (nextSessionId) => emit('session-changed', nextSessionId),
  emitOpenNote: (path) => emit('open-note', path)
})

type AlterDropdownItem = FilterableDropdownItem & {
  alterId: string
}

const alterDropdownOpen = ref(false)
const alterDropdownQuery = ref('')
const alterDropdownActiveIndex = ref(0)

const alterDropdownItems = computed<AlterDropdownItem[]>(() => [
  {
    id: '',
    label: 'Neutral',
    alterId: ''
  },
  ...availableAlters.value.map((item) => ({
    id: item.id,
    label: item.name,
    alterId: item.id
  }))
])

function selectedAlterIndex(): number {
  if (!selectedAlterId.value) return 0
  const index = alterDropdownItems.value.findIndex((item) => item.alterId === selectedAlterId.value)
  return index >= 0 ? index : 0
}

function syncAlterDropdownActiveIndex() {
  alterDropdownActiveIndex.value = selectedAlterIndex()
}

function onAlterDropdownOpenChange(value: boolean) {
  alterDropdownOpen.value = value
  if (value) {
    syncAlterDropdownActiveIndex()
  }
}

function onAlterDropdownSelect(item: AlterDropdownItem) {
  void applySelectedAlter(item.alterId)
  alterDropdownOpen.value = false
  alterDropdownQuery.value = ''
}

watch(selectedAlterId, () => {
  syncAlterDropdownActiveIndex()
}, { immediate: true })

void composerRef
void threadBottomSentinel
void threadRef
</script>

<template>
  <div class="sb-layout">
    <section class="sb-center">
      <header class="sb-center-head">
        <div class="sb-center-head-main">
          <h2>{{ sessionTitle }}</h2>
        </div>
        <div class="sb-session-actions">
          <UiIconButton
            v-if="sessionId"
            class="sb-session-copy-btn"
            aria-label="Copy conversation"
            title="Copy conversation"
            :disabled="!canCopyConversation"
            @click="void onCopyConversation()"
          >
            <ClipboardDocumentIcon class="h-4 w-4" />
          </UiIconButton>
          <UiFilterableDropdown
            class="sb-alter-dropdown"
            :items="alterDropdownItems"
            :model-value="alterDropdownOpen"
            :query="alterDropdownQuery"
            :active-index="alterDropdownActiveIndex"
            filter-placeholder="Filter alters..."
            :show-filter="true"
            :close-on-select="true"
            :menu-mode="'overlay'"
            :menu-class="'sb-alter-dropdown-menu'"
            :disabled="loading || creatingSession"
            @open-change="onAlterDropdownOpenChange"
            @query-change="alterDropdownQuery = $event"
            @active-index-change="alterDropdownActiveIndex = $event"
            @select="onAlterDropdownSelect($event as AlterDropdownItem)"
          >
            <template #trigger="{ toggleMenu }">
              <button
                type="button"
                class="sb-toolbar-btn sb-alter-trigger"
                title="Change alter"
                aria-label="Change alter"
                :disabled="loading || creatingSession"
                @click="toggleMenu"
              >
                <span class="sb-alter-trigger-label">{{ activeAlterLabel }}</span>
                <span class="sb-alter-trigger-caret" aria-hidden="true">▾</span>
              </button>
            </template>
          </UiFilterableDropdown>
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
      <p v-if="configError || sessionLoadError" class="sb-error">{{ configError || sessionLoadError }}</p>

      <section ref="threadRef" class="sb-thread" @scroll.passive="onThreadScroll">
        <div v-if="!sessionId && !loading" class="sb-empty-state">
          <strong>No session selected</strong>
          <p>Start a new session or reopen one from the session menu. No previous session is resumed automatically.</p>
          <button type="button" class="sb-empty-create-btn" :disabled="creatingSession" @click="onCreateSession">
            New session
          </button>
        </div>
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
        <div ref="threadBottomSentinel" class="sb-thread-bottom-sentinel" aria-hidden="true"></div>

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

          <div class="sb-pulse-bar">
            <div class="sb-pulse-bar-head">
              <SparklesIcon class="h-4 w-4" />
              <span>Pulse</span>
            </div>
            <UiFilterableDropdown
              class="sb-pulse-dropdown"
              :items="pulseDropdownItems"
              :model-value="pulseDropdownOpen"
              :query="pulseDropdownQuery"
              :active-index="pulseDropdownActiveIndex"
              :matcher="pulseDropdownMatcher"
              :show-filter="true"
              :close-on-select="true"
              :menu-mode="'portal'"
              :disabled="!contextPaths.length || requestInFlight"
              filter-placeholder="Filter Pulse actions..."
              @open-change="pulseDropdownOpen = $event"
              @query-change="pulseDropdownQuery = $event"
              @active-index-change="pulseDropdownActiveIndex = $event"
              @select="onPulseDropdownSelect($event)"
            >
              <template #trigger="{ toggleMenu }">
                <button
                  type="button"
                  class="sb-pulse-trigger"
                  :disabled="!contextPaths.length || requestInFlight"
                  @click="toggleMenu"
                >
                  {{ activePulseAction?.label || 'Choose action' }}
                </button>
              </template>
            </UiFilterableDropdown>
          </div>

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
            rows="1"
            :placeholder="`Ask a question, or guide Pulse before clicking ${activePulseAction?.label || 'an action'}...`"
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
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.sb-center-head-main {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1 1 auto;
  white-space: nowrap;
}

.sb-session-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sb-session-copy-btn {
  color: var(--sb-button-text);
}

.sb-alter-dropdown {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.sb-alter-dropdown :deep(.ui-filterable-dropdown-menu) {
  position: absolute !important;
  top: calc(100% + 6px);
  left: 0;
  width: min(280px, calc(100vw - 36px));
  max-width: min(280px, calc(100vw - 36px));
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

.sb-session-copy-btn:disabled,
.sb-session-create-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.sb-center-head h2 {
  margin: 0;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sb-center-head .sb-error {
  margin: 0 0 0 12px;
}

.sb-toolbar-btn {
  min-width: 0;
  height: 32px;
  border: 1px solid var(--sb-button-border);
  border-radius: 10px;
  background: var(--sb-button-bg);
  color: var(--sb-button-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
}

.sb-alter-trigger {
  min-width: 0;
}

.sb-alter-trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 16ch;
}

.sb-alter-trigger-caret {
  font-size: 10px;
  line-height: 1;
  color: var(--sb-text-dim);
}

.sb-alter-dropdown :deep(.ui-filterable-dropdown-option[data-active='true']) {
  color: var(--sb-active-text);
}

.sb-alter-dropdown-menu {
  min-width: 180px;
}

.sb-thread {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--sb-border);
  border-radius: 10px;
  background: var(--sb-thread-bg);
  color: var(--sb-text);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sb-thread-bottom-sentinel {
  width: 100%;
  height: 1px;
  flex: 0 0 auto;
}

.sb-empty-state {
  margin: auto;
  max-width: 360px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  color: var(--sb-text-muted);
}

.sb-empty-state strong {
  color: var(--sb-text);
  font-size: 0.98rem;
}

.sb-empty-state p {
  margin: 0;
  line-height: 1.45;
  font-size: 0.86rem;
}

.sb-empty-create-btn {
  min-width: 132px;
  padding: 9px 14px;
  border: 1px solid var(--sb-button-border);
  border-radius: 10px;
  background: var(--sb-button-bg);
  color: var(--sb-button-text);
}

.msg {
  border: 1px solid var(--sb-border);
  border-radius: 12px;
  padding: 10px 12px;
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
  font-family: var(--font-code);
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

.assistant-markdown table {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12px;
}

.assistant-markdown th,
.assistant-markdown td {
  border: 1px solid var(--sb-input-border);
  padding: 4px 8px;
}

.assistant-markdown th {
  background: var(--sb-code-bg);
  font-weight: 600;
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
  gap: 6px;
  margin-top: auto;
  position: sticky;
  bottom: 0;
  background: linear-gradient(to top, var(--sb-center-bg) 75%, transparent);
  padding-top: 10px;
}

.sb-composer {
  position: relative;
  width: 100%;
  border: 1px solid var(--sb-input-border);
  border-radius: 16px;
  background: var(--sb-input-bg);
  padding: 10px;
  box-shadow: var(--sb-composer-shadow);
}

.sb-pulse-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.sb-pulse-bar-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--sb-text);
}

.sb-pulse-trigger {
  border: 1px solid var(--sb-button-border);
  background: var(--sb-button-bg);
  color: var(--sb-button-text);
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  padding: 7px 10px;
}

.sb-pulse-dropdown {
  min-width: 0;
}

.sb-pulse-dropdown :deep(.ui-filterable-dropdown-menu) {
  --ui-dropdown-bg: var(--sb-input-bg);
  --ui-dropdown-border: var(--sb-border);
  --ui-dropdown-text: var(--sb-text);
  --ui-dropdown-muted: var(--sb-text-dim);
  --ui-dropdown-hover: var(--sb-assistant-bg);
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

.sb-composer .sb-textarea {
  width: 100%;
  min-height: 34px;
  max-height: 120px;
  padding: 8px 42px 8px 8px;
  resize: none;
  overflow-y: hidden;
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
  box-shadow: var(--sb-toast-shadow);
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
