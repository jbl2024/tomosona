<script setup lang="ts">
/**
 * Structured Alter Exploration surface.
 *
 * This panel owns the setup form, the round-by-round exploration timeline, and
 * the final synthesis actions. It intentionally renders structured output
 * instead of a free-form chat log.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowPathIcon, DocumentTextIcon, PencilSquareIcon } from '@heroicons/vue/24/outline'
import UiBadge from '../../../shared/components/ui/UiBadge.vue'
import UiButton from '../../../shared/components/ui/UiButton.vue'
import UiField from '../../../shared/components/ui/UiField.vue'
import UiPanel from '../../../shared/components/ui/UiPanel.vue'
import UiSelect from '../../../shared/components/ui/UiSelect.vue'
import WorkspaceComposerActionButton from '../../../shared/components/workspace/WorkspaceComposerActionButton.vue'
import WorkspaceContextChips from '../../../shared/components/workspace/WorkspaceContextChips.vue'
import WorkspaceSessionDropdown, { type WorkspaceSessionDropdownItem } from '../../../shared/components/workspace/WorkspaceSessionDropdown.vue'
import { toWorkspaceRelativePath } from '../../explorer/lib/workspacePaths'
import SecondBrainAtMentionsMenu from '../../second-brain/components/SecondBrainAtMentionsMenu.vue'
import SecondBrainEchoesPanel from '../../second-brain/components/SecondBrainEchoesPanel.vue'
import { useSecondBrainAtMentions } from '../../second-brain/composables/useSecondBrainAtMentions'
import { renderSecondBrainMarkdownPreview } from '../../second-brain/lib/secondBrainMarkdownPreview'
import type { AlterExplorationRoundResult, AlterSummary } from '../../../shared/api/apiTypes'
import { useAlterExploration } from '../composables/useAlterExploration'

const props = defineProps<{
  workspacePath: string
  allWorkspaceFiles: string[]
  activeNotePath: string
  availableAlters: AlterSummary[]
  initialSubject?: string
}>()

const emit = defineEmits<{
  'open-note': [path: string]
}>()

const exploration = useAlterExploration({
  workspacePath: computed(() => props.workspacePath),
  availableAlters: computed(() => props.availableAlters),
  allWorkspaceFiles: computed(() => props.allWorkspaceFiles),
  activeNotePath: computed(() => props.activeNotePath),
  emitOpenNote: (path) => emit('open-note', path)
})

const {
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
  selectedCountLabel,
  selectionLimitReached,
  hasMinimumAlters,
  canStart,
  session,
  sessions,
  loadingSessions,
  running,
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
  resetSession,
  refreshSessions,
  showSession,
  startExploration,
  cancelExploration,
  saveSynthesisAsNote,
  insertSynthesisIntoActiveNote,
  promoteSynthesisToDraft,
  convertSynthesisToPlan
} = exploration

const roundNumbers = computed<number[]>(() => roundGroups.value.map((group) => group.roundNumber))
const selectedPromptCountLabel = computed(() => {
  const count = selectedPromptPaths.value.length
  if (!count) return 'No context notes selected'
  return `${count} context note${count > 1 ? 's' : ''}`
})
const PROMPT_MIN_HEIGHT_PX = 34
const PROMPT_MAX_HEIGHT_PX = 120
const subjectTextareaRef = ref<HTMLTextAreaElement | null>(null)
const mentions = useSecondBrainAtMentions({
  workspacePath: computed(() => props.workspacePath),
  allWorkspaceFiles: computed(() => props.allWorkspaceFiles)
})

const sessionDropdownItems = computed<WorkspaceSessionDropdownItem[]>(() =>
  sessions.value.map((item) => ({
    id: item.id,
    label: item.subject_preview,
    sessionId: item.id,
    title: item.subject_preview,
    updatedAtMs: item.updated_at_ms,
    details: `${item.mode} · ${item.alter_count} Alters · ${item.state}`
  }))
)

function toRelativePath(path: string): string {
  return toWorkspaceRelativePath(props.workspacePath, path)
}

function splitRoundResults(roundNumber: number): AlterExplorationRoundResult[] {
  return roundGroups.value.find((group) => group.roundNumber === roundNumber)?.results ?? []
}

function renderRoundContent(content: string): string {
  return renderSecondBrainMarkdownPreview(content)
}

function renderFinalSynthesis(content: string | null | undefined): string {
  return renderSecondBrainMarkdownPreview(content ?? '')
}

function getPromptEchoesItems() {
  return promptEchoes.items.value
}

function getPromptEchoesLoading() {
  return promptEchoes.loading.value
}

function getPromptEchoesError() {
  return promptEchoes.error.value
}

watch(
  () => props.availableAlters,
  (alters) => {
    if (!selectedAlterIds.value.length && alters.length) {
      selectedAlterIds.value = alters.slice(0, 3).map((item) => item.id)
    }
  },
  { immediate: true, deep: true }
)

watch(
  () => props.initialSubject,
  (next) => {
    const value = next?.trim()
    if (value) {
      subjectText.value = value
      queueMentionUpdate()
    }
  },
  { immediate: true }
)

onMounted(() => {
  void refreshSessions()
  void nextTick(syncPromptHeight)
})

function queueMentionUpdate() {
  mentions.updateTrigger(subjectText.value, subjectTextareaRef.value?.selectionStart ?? null)
}

function syncPromptHeight() {
  const textarea = subjectTextareaRef.value
  if (!textarea) return

  textarea.style.height = 'auto'
  const nextHeight = Math.min(Math.max(textarea.scrollHeight, PROMPT_MIN_HEIGHT_PX), PROMPT_MAX_HEIGHT_PX)
  textarea.style.height = `${nextHeight}px`
  textarea.style.overflowY = textarea.scrollHeight > PROMPT_MAX_HEIGHT_PX ? 'auto' : 'hidden'
}

watch(
  subjectText,
  () => {
    void nextTick(syncPromptHeight)
  },
  { immediate: true }
)

function applyMention(item: Parameters<typeof mentions.applySuggestion>[1]) {
  const trigger = mentions.trigger.value
  const previousText = subjectText.value
  if (trigger) {
    subjectText.value = `${previousText.slice(0, trigger.start)}${previousText.slice(trigger.end)}`
  }
  addPromptContextPath(item.absolutePath)
  queueMentionUpdate()
  mentions.close()
  requestAnimationFrame(() => {
    if (!subjectTextareaRef.value) return
    syncPromptHeight()
    const caret = trigger?.start ?? subjectTextareaRef.value.value.length
    subjectTextareaRef.value.selectionStart = caret
    subjectTextareaRef.value.selectionEnd = caret
    subjectTextareaRef.value.focus()
  })
}

function onSubjectKeydown(event: KeyboardEvent) {
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
  if (event.key === 'Enter' && !event.shiftKey) {
    const next = mentions.suggestions.value[mentions.activeIndex.value]
    if (next) {
      event.preventDefault()
      applyMention(next)
    }
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    mentions.close()
  }
}

function resetSetupAndSession() {
  subjectText.value = ''
  subjectType.value = 'prompt'
  mode.value = 'challenge'
  rounds.value = 2
  outputFormat.value = 'summary'
  selectedAlterIds.value = []
  replacePromptContextPaths([])
  selectedPromptAnchorPath.value = ''
  mentions.close()
  resetSession()
}

function rerunWithDifferentAlters() {
  selectedAlterIds.value = []
  resetSession()
}

async function saveArtifactAndOpen(action: () => Promise<string | null>) {
  const path = await action()
  if (path) {
    emit('open-note', path)
  }
}

const modeOptions = [
  { value: 'challenge', label: 'Challenge' },
  { value: 'explore', label: 'Explore' },
  { value: 'decide', label: 'Decide' },
  { value: 'refine', label: 'Refine' }
] as const

const formatOptions = [
  { value: 'summary', label: 'Summary' },
  { value: 'tension_map', label: 'Tension map' },
  { value: 'decision_brief', label: 'Decision brief' },
  { value: 'refined_proposal', label: 'Refined proposal' }
] as const
</script>

<template>
  <section class="alter-exploration">
    <UiPanel tone="raised" class-name="alter-exploration__shell">
      <header class="alter-exploration__header">
        <div class="alter-exploration__header-copy">
          <h3 class="alter-exploration__title">Alter Exploration</h3>
        </div>
        <div class="alter-exploration__header-actions">
          <WorkspaceSessionDropdown
            :sessions="sessionDropdownItems"
            :active-session-id="session?.id ?? ''"
            :loading="loadingSessions"
            button-title="Manage exploration sessions"
            button-aria-label="Manage exploration sessions"
            filter-placeholder="Search explorations..."
            empty-label="No exploration sessions yet"
            :show-delete="false"
            @select="void showSession($event)"
          />
          <UiButton size="sm" variant="secondary" :disabled="running" @click="resetSetupAndSession()">
            <template #leading>
              <ArrowPathIcon class="alter-exploration__icon" />
            </template>
            Reset setup
          </UiButton>
        </div>
      </header>

      <div v-if="error" class="alter-exploration__error">
        {{ error }}
      </div>

      <div v-if="notice" class="alter-exploration__notice">
        {{ notice }}
      </div>

      <div class="alter-exploration__workspace">
        <div class="alter-exploration__scroll">
          <section class="alter-exploration__card">
            <div class="alter-exploration__section-head">
              <div>
                <p class="alter-exploration__kicker">Setup</p>
                <h4 class="alter-exploration__section-title">Alters and execution mode</h4>
              </div>
              <UiBadge tone="neutral" size="sm">{{ selectedCountLabel }}</UiBadge>
            </div>

            <UiField label="Selected Alters" for-id="alter-exploration-alters">
              <template #default>
                <div class="alter-exploration__alters">
                  <button
                    v-for="item in props.availableAlters"
                    :key="item.id"
                    type="button"
                    class="alter-exploration__alter-chip"
                    :class="{ 'alter-exploration__alter-chip--active': selectedAlterIds.includes(item.id) }"
                    @click="toggleAlterSelection(item.id)"
                  >
                    <span>{{ item.name }}</span>
                    <small>{{ item.mission }}</small>
                  </button>
                </div>
                <p class="alter-exploration__hint">{{ selectedCountLabel }}</p>
                <p v-if="selectionLimitReached" class="alter-exploration__hint">
                  Selection limit reached.
                </p>
                <p v-else-if="hasMinimumAlters" class="alter-exploration__hint">
                  Ready to start.
                </p>
              </template>
            </UiField>

            <div class="alter-exploration__grid">
              <UiField label="Mode" for-id="alter-exploration-mode">
                <template #default>
                  <UiSelect id="alter-exploration-mode" v-model="mode">
                    <option v-for="option in modeOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </UiSelect>
                </template>
              </UiField>

              <UiField label="Rounds" for-id="alter-exploration-rounds">
                <template #default>
                  <UiSelect
                    id="alter-exploration-rounds"
                    :model-value="String(rounds)"
                    @update:modelValue="rounds = Number.parseInt($event, 10) || 2"
                  >
                    <option value="2">2 rounds</option>
                    <option value="3">3 rounds</option>
                  </UiSelect>
                </template>
              </UiField>

              <UiField label="Output format" for-id="alter-exploration-format">
                <template #default>
                  <UiSelect id="alter-exploration-format" v-model="outputFormat">
                    <option v-for="option in formatOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </UiSelect>
                </template>
              </UiField>
            </div>
          </section>

          <section class="alter-exploration__card">
            <div class="alter-exploration__section-head">
              <div>
                <p class="alter-exploration__kicker">Prompt</p>
                <h4 class="alter-exploration__section-title">Round-by-round output</h4>
              </div>
              <UiBadge tone="neutral" size="sm">
                {{ session?.state ?? 'draft' }}
              </UiBadge>
            </div>

            <div v-if="!session" class="alter-exploration__empty">
              Start an exploration to see the structured rounds and synthesis here.
            </div>

            <template v-else>
              <section class="alter-exploration__subject">
                <h4>{{ session.subject.text }}</h4>
                <p class="alter-exploration__copy">
                  {{ session.mode }} · {{ session.rounds }} rounds · {{ session.output_format }}
                </p>
                <div class="alter-exploration__subject-meta">
                  <UiBadge v-for="item in selectedAlters" :key="item.id" tone="neutral" size="xs">
                    {{ item.name }}
                  </UiBadge>
                </div>
              </section>

              <section v-for="roundNumber in roundNumbers" :key="roundNumber" class="alter-exploration__round">
                <div class="alter-exploration__round-header">
                  <h4>Round {{ roundNumber }}</h4>
                  <span>{{ splitRoundResults(roundNumber).length }} responses</span>
                </div>
                <div class="alter-exploration__round-grid">
                  <article
                    v-for="result in splitRoundResults(roundNumber)"
                    :key="`${result.round_number}-${result.alter_id}`"
                    class="alter-exploration__result-card"
                  >
                    <div class="alter-exploration__result-head">
                      <strong>{{ result.alter_name ?? resolveAlterName(result.alter_id) }}</strong>
                      <UiBadge tone="neutral" size="xs">
                        {{ result.references_alter_ids.length ? result.references_alter_ids.map(resolveAlterName).join(', ') : 'open' }}
                      </UiBadge>
                    </div>
                    <div class="alter-exploration__markdown" v-html="renderRoundContent(result.content)"></div>
                  </article>
                </div>
              </section>

              <section class="alter-exploration__final">
                <div class="alter-exploration__round-header">
                  <h4>Final synthesis</h4>
                  <UiBadge tone="accent" size="sm">{{ session.output_format }}</UiBadge>
                </div>
                <div
                  class="alter-exploration__synthesis alter-exploration__markdown"
                  v-html="renderFinalSynthesis(session.final_synthesis || 'No synthesis available yet.')"
                ></div>

                <div class="alter-exploration__final-actions">
                  <UiButton
                    size="sm"
                    variant="secondary"
                    :disabled="saving || !session?.final_synthesis"
                    :loading="saving"
                    @click="void saveArtifactAndOpen(saveSynthesisAsNote)"
                  >
                    <template #leading>
                      <DocumentTextIcon class="alter-exploration__icon" />
                    </template>
                    Save as note
                  </UiButton>
                  <UiButton
                    size="sm"
                    variant="secondary"
                    :disabled="saving || !session?.final_synthesis || !props.activeNotePath.trim()"
                    :loading="saving"
                    @click="void insertSynthesisIntoActiveNote()"
                  >
                    Insert into active note
                  </UiButton>
                  <UiButton
                    size="sm"
                    variant="secondary"
                    :disabled="saving || !session?.final_synthesis"
                    :loading="saving"
                    @click="void saveArtifactAndOpen(convertSynthesisToPlan)"
                  >
                    Convert to plan
                  </UiButton>
                  <UiButton
                    size="sm"
                    variant="secondary"
                    :disabled="saving || !session?.final_synthesis"
                    :loading="saving"
                    @click="void saveArtifactAndOpen(promoteSynthesisToDraft)"
                  >
                    Promote to draft
                  </UiButton>
                  <UiButton size="sm" variant="ghost" :disabled="running" @click="rerunWithDifferentAlters()">
                    <template #leading>
                      <PencilSquareIcon class="alter-exploration__icon" />
                    </template>
                    Rerun with different Alters
                  </UiButton>
                </div>
              </section>
            </template>
          </section>
        </div>

        <footer class="alter-exploration__composer">
          <div class="alter-exploration__section-head alter-exploration__section-head--composer">
            <div>
              <p class="alter-exploration__kicker">Prompt composer</p>
              <h4 class="alter-exploration__section-title">Write the prompt, attach notes, then launch</h4>
            </div>
            <UiBadge tone="neutral" size="sm">{{ selectedPromptCountLabel }}</UiBadge>
          </div>

          <div v-if="selectedPromptAnchorPath" class="alter-exploration__echoes">
            <SecondBrainEchoesPanel
              :items="getPromptEchoesItems()"
              :loading="getPromptEchoesLoading()"
              :error="getPromptEchoesError()"
              :is-in-context="isPromptPathInContext"
              :to-relative-path="toRelativePath"
              @open="openPromptContextNote"
              @add="addPromptContextPath"
            />
          </div>

          <WorkspaceContextChips
            :chips="promptContextCards"
            :active-path="selectedPromptAnchorPath"
            active-label="Use this note for Echoes suggestions"
            @toggle="togglePromptEchoesAnchor"
            @open="openPromptContextNote"
            @remove="removePromptContextPath"
          />

          <div class="alter-exploration__prompt-input-wrap">
            <textarea
              id="alter-exploration-subject"
              ref="subjectTextareaRef"
              v-model="subjectText"
              :rows="1"
              class="alter-exploration__subject-input"
              placeholder="Should Tomosona support executable runtime note blocks? Type @ to add workspace notes."
              @input="queueMentionUpdate"
              @keyup="queueMentionUpdate"
              @click="queueMentionUpdate"
              @keydown="onSubjectKeydown"
            ></textarea>
            <SecondBrainAtMentionsMenu
              :open="mentions.isOpen.value"
              :suggestions="mentions.suggestions.value"
              :active-index="mentions.activeIndex.value"
              @select="applyMention($event)"
              @update:active-index="mentions.setActiveIndex"
            />
          </div>

          <WorkspaceComposerActionButton
            :running="running"
            :start-disabled="!canStart || running"
            :stop-disabled="!session"
            start-title="Start exploration"
            start-aria-label="Start exploration"
            stop-title="Stop exploration"
            stop-aria-label="Stop exploration"
            @start="void startExploration()"
            @stop="void cancelExploration()"
          />
        </footer>
      </div>
    </UiPanel>
  </section>
</template>

<style>
.alter-exploration {
  display: flex;
  min-height: 0;
  height: 100%;
  background: var(--sb-layout-bg);
  color: var(--sb-text);
}

.alter-exploration__shell {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  width: 100%;
  gap: 0.85rem;
  overflow: hidden;
  border: 1px solid var(--sb-border);
  border-radius: 12px;
  background: var(--sb-center-bg);
  box-shadow: none;
  padding: 8px;
}

.alter-exploration__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex: 0 0 auto;
  flex-wrap: nowrap;
}

.alter-exploration__title {
  margin: 0;
}

.alter-exploration__hint,
.alter-exploration__empty {
  margin: 0;
  opacity: 0.82;
}

.alter-exploration__header-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.75rem;
  justify-content: flex-end;
}

.alter-exploration__final-actions,
.alter-exploration__composer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: flex-end;
}

.alter-exploration__composer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: auto;
  position: sticky;
  bottom: 0;
  z-index: 1;
  padding: 10px;
  border: 1px solid var(--sb-input-border);
  border-radius: 16px;
  background: var(--sb-input-bg);
  box-shadow: var(--sb-composer-shadow);
}

.alter-exploration__notice {
  padding: 0.75rem 0.9rem;
  border-radius: 0.75rem;
  background: var(--sb-active-bg);
  color: var(--sb-active-text);
}

.alter-exploration__error {
  padding: 0.75rem 0.9rem;
  border-radius: 0.75rem;
  background: var(--sb-danger-bg);
  color: var(--sb-danger-text);
}

.alter-exploration__workspace {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
  gap: 0.85rem;
}

.alter-exploration__scroll {
  display: grid;
  gap: 0.85rem;
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
  padding-right: 0.1rem;
}

.alter-exploration__card {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border-radius: 1rem;
  border: 1px solid var(--sb-border);
  background: var(--sb-thread-bg);
}

.alter-exploration__section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.alter-exploration__section-head--composer {
  padding-bottom: 0.15rem;
}

.alter-exploration__section-title {
  margin: 0;
}

.alter-exploration__subject {
  display: grid;
  gap: 0.5rem;
}

.alter-exploration__subject h4 {
  margin: 0;
}

.alter-exploration__subject-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.alter-exploration__prompt-input-wrap {
  position: relative;
}

.alter-exploration__subject-input {
  width: 100%;
  border: 1px solid var(--sb-input-border);
  border-radius: 10px;
  padding: 8px 42px 8px 8px;
  background: var(--sb-input-bg);
  color: var(--sb-button-text);
  resize: none;
  min-height: 34px;
  max-height: 120px;
  overflow-y: hidden;
  box-sizing: border-box;
  display: block;
  font-size: 12px;
}

.alter-exploration__subject-input:focus {
  outline: none;
  border-color: var(--sb-input-border);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--sb-input-border) 26%, transparent);
}

.alter-exploration__echoes {
  margin-bottom: 0.2rem;
  max-height: 11rem;
  overflow: auto;
  padding-right: 0.1rem;
}

.alter-exploration__alters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.alter-exploration__alter-chip {
  display: grid;
  gap: 0.2rem;
  border: 1px solid var(--sb-border);
  border-radius: 0.9rem;
  padding: 0.75rem 0.85rem;
  background: var(--sb-thread-bg);
  text-align: left;
  min-width: 11rem;
  color: var(--sb-text);
}

.alter-exploration__alter-chip--active {
  border-color: var(--sb-active-border);
  background: var(--sb-assistant-bg);
}

.alter-exploration__alter-chip small {
  color: var(--sb-text-dim);
}

.alter-exploration__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.85rem;
}

.alter-exploration__round,
.alter-exploration__final {
  display: grid;
  gap: 0.75rem;
}

.alter-exploration__round-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
}

.alter-exploration__round-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 0.75rem;
}

.alter-exploration__result-card {
  border-radius: 1rem;
  padding: 0.85rem;
  background: var(--sb-assistant-bg);
  border: 1px solid var(--sb-border);
}

.alter-exploration__result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.alter-exploration__markdown {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.5;
}

.alter-exploration__markdown p {
  margin: 0 0 6px;
}

.alter-exploration__markdown p:last-child {
  margin-bottom: 0;
}

.alter-exploration__markdown h1,
.alter-exploration__markdown h2,
.alter-exploration__markdown h3,
.alter-exploration__markdown h4,
.alter-exploration__markdown h5,
.alter-exploration__markdown h6 {
  margin: 8px 0 5px;
  line-height: 1.3;
  font-weight: 700;
}

.alter-exploration__markdown ul,
.alter-exploration__markdown ol {
  margin: 5px 0 6px;
  padding-left: 18px;
}

.alter-exploration__markdown ul {
  list-style: disc outside;
}

.alter-exploration__markdown ol {
  list-style: decimal outside;
}

.alter-exploration__markdown li {
  margin: 1px 0;
}

.alter-exploration__markdown ul ul {
  list-style-type: circle;
}

.alter-exploration__markdown ol ol {
  list-style-type: lower-alpha;
}

.alter-exploration__markdown blockquote {
  margin: 5px 0 6px;
  border-left: 3px solid var(--sb-blockquote-border);
  padding: 2px 0 2px 10px;
  color: var(--sb-text-soft);
}

.alter-exploration__markdown code {
  font-family: var(--font-code);
  background: var(--sb-code-bg);
  border-radius: 4px;
  padding: 1px 4px;
}

.alter-exploration__markdown pre {
  margin: 6px 0;
  background: var(--sb-code-bg);
  border: 1px solid var(--sb-input-border);
  border-radius: 8px;
  padding: 6px;
  overflow: auto;
}

.alter-exploration__markdown pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
}

.alter-exploration__markdown a {
  color: var(--sb-active-text);
  text-decoration: underline;
}

.alter-exploration__markdown table {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12px;
  width: 100%;
  border: 1px solid var(--sb-input-border);
}

.alter-exploration__markdown th,
.alter-exploration__markdown td {
  border: 1px solid var(--sb-input-border);
  padding: 4px 8px;
  vertical-align: top;
  text-align: left;
}

.alter-exploration__markdown th {
  background: var(--sb-code-bg);
  font-weight: 600;
}

.alter-exploration__markdown thead th {
  background: var(--sb-code-bg);
}

.alter-exploration__synthesis {
  padding: 1rem;
  border-radius: 1rem;
  border: 1px solid var(--sb-input-border);
  background: var(--sb-input-bg);
  color: var(--sb-text);
}

.alter-exploration__history {
  display: grid;
  gap: 0.5rem;
}

.alter-exploration__history-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.8rem 0.9rem;
  border-radius: 0.85rem;
  border: 1px solid var(--sb-border);
  background: var(--sb-thread-bg);
  text-align: left;
}

.alter-exploration__icon {
  width: 1rem;
  height: 1rem;
}

@media (max-width: 1120px) {
  .alter-exploration__grid {
    grid-template-columns: 1fr;
  }
}
</style>
