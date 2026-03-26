<script setup lang="ts">
/**
 * Structured Alter Exploration surface.
 *
 * This panel owns the setup form, the round-by-round exploration timeline, and
 * the final synthesis actions. It intentionally renders structured output
 * instead of a free-form chat log.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { DocumentTextIcon, PencilSquareIcon, PlusIcon } from '@heroicons/vue/24/outline'
import UiBadge from '../../../shared/components/ui/UiBadge.vue'
import UiButton from '../../../shared/components/ui/UiButton.vue'
import UiField from '../../../shared/components/ui/UiField.vue'
import UiIconButton from '../../../shared/components/ui/UiIconButton.vue'
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
  notify: [payload: { tone: 'info' | 'success' | 'error'; message: string }]
}>()

const exploration = useAlterExploration({
  workspacePath: computed(() => props.workspacePath),
  availableAlters: computed(() => props.availableAlters),
  allWorkspaceFiles: computed(() => props.allWorkspaceFiles),
  activeNotePath: computed(() => props.activeNotePath),
  emitOpenNote: (path) => emit('open-note', path),
  notify: (payload) => emit('notify', payload)
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

type ExplorationSection = 'synthesis' | number

const setupExpanded = ref(true)
const activeSection = ref<ExplorationSection>('synthesis')
const hasSession = computed(() => Boolean(session.value))
const activeRoundNumber = computed(() => {
  if (typeof activeSection.value === 'number') return activeSection.value
  return roundNumbers.value[0] ?? 1
})
const activeRoundResults = computed(() => splitRoundResults(activeRoundNumber.value))
const activeRoundCountLabel = computed(() => `${activeRoundResults.value.length} response${activeRoundResults.value.length === 1 ? '' : 's'}`)
const activeSectionLabel = computed(() => {
  if (!session.value) return 'Reader'
  if (activeSection.value === 'synthesis') return 'Final synthesis'
  return `Round ${activeSection.value}`
})
const activeSectionSubtitle = computed(() => session.value?.subject.text?.trim() || 'Start an exploration to review the structured rounds here.')
const activeSectionMetaLabel = computed(() => {
  if (!session.value) return 'draft'
  if (activeSection.value === 'synthesis') return session.value.output_format
  return `${activeRoundResults.value.length} response${activeRoundResults.value.length === 1 ? '' : 's'}`
})
const setupSummaryLabel = computed(() => {
  const altersLabel = `${selectedAlterIds.value.length} alters`
  const modeLabel = session.value?.mode ?? mode.value
  const roundsLabel = `${session.value?.rounds ?? rounds.value} rounds`
  const formatLabel = session.value?.output_format ?? outputFormat.value
  const notesLabel = `${selectedPromptPaths.value.length} notes`
  return [altersLabel, modeLabel, roundsLabel, formatLabel, notesLabel].join(' · ')
})
const setupSummaryTitle = computed(() => session.value?.subject.text?.trim() || subjectText.value.trim() || 'Untitled prompt')
const readerSectionItems = computed(() => {
  if (!session.value) return []
  return [
    ...roundNumbers.value.map((roundNumber) => ({
      id: roundNumber,
      label: `Round ${roundNumber}`,
      details: `${splitRoundResults(roundNumber).length} response${splitRoundResults(roundNumber).length === 1 ? '' : 's'}`
    })),
    {
      id: 'synthesis' as const,
      label: 'Synthesis',
      details: session.value.final_synthesis?.trim() ? 'Final artifact' : 'Draft'
    }
  ]
})

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

function selectReaderSection(section: ExplorationSection) {
  activeSection.value = section
}

function toggleSetupDetails() {
  setupExpanded.value = !setupExpanded.value
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

watch(
  session,
  (next) => {
    if (next) {
      activeSection.value = 'synthesis'
      setupExpanded.value = false
      return
    }
    activeSection.value = 'synthesis'
    setupExpanded.value = true
  },
  { immediate: true }
)

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
  setupExpanded.value = true
  activeSection.value = 'synthesis'
}

function rerunWithDifferentAlters() {
  selectedAlterIds.value = []
  resetSession()
  setupExpanded.value = true
  activeSection.value = 'synthesis'
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
          <UiIconButton
            variant="secondary"
            size="sm"
            :disabled="running"
            title="New exploration"
            aria-label="New exploration"
            @click="resetSetupAndSession()"
          >
            <PlusIcon class="alter-exploration__icon" />
          </UiIconButton>
        </div>
      </header>

      <div class="alter-exploration__workspace">
        <div class="alter-exploration__scroll">
          <section class="alter-exploration__context-strip">
            <UiBadge tone="neutral" size="sm">{{ session?.state ?? 'draft' }}</UiBadge>
            <UiBadge tone="neutral" size="sm">{{ selectedCountLabel }}</UiBadge>
            <UiBadge tone="neutral" size="sm">{{ session?.mode ?? mode }}</UiBadge>
            <UiBadge tone="neutral" size="sm">{{ `${session?.rounds ?? rounds} rounds` }}</UiBadge>
            <UiBadge tone="neutral" size="sm">{{ session?.output_format ?? outputFormat }}</UiBadge>
          </section>

          <section class="alter-exploration__card alter-exploration__setup-card">
            <div class="alter-exploration__section-head">
              <div class="alter-exploration__section-copy">
                <p class="alter-exploration__kicker">Setup</p>
                <h4 class="alter-exploration__section-title">Alters and execution mode</h4>
                <p v-if="session" class="alter-exploration__copy">{{ session.subject.text }}</p>
                <p v-else class="alter-exploration__copy">Prepare the prompt, attach notes, and choose the alters that should take part.</p>
              </div>
              <div class="alter-exploration__section-head-actions">
                <UiBadge tone="neutral" size="sm">{{ selectedCountLabel }}</UiBadge>
                <UiButton v-if="hasSession" size="sm" variant="ghost" @click="toggleSetupDetails()">
                  {{ setupExpanded ? 'Hide setup' : 'Show setup' }}
                </UiButton>
              </div>
            </div>

            <template v-if="setupExpanded || !hasSession">
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
            </template>

            <template v-else>
              <div class="alter-exploration__setup-summary">
                <p class="alter-exploration__setup-summary-title">{{ setupSummaryTitle }}</p>
                <p class="alter-exploration__setup-summary-line">{{ setupSummaryLabel }}</p>
                <div class="alter-exploration__subject-meta">
                  <UiBadge v-for="item in selectedAlters" :key="item.id" tone="neutral" size="xs">
                    {{ item.name }}
                  </UiBadge>
                </div>
              </div>
            </template>
          </section>

          <section class="alter-exploration__card alter-exploration__reader-card">
            <div class="alter-exploration__section-head">
              <div class="alter-exploration__section-copy">
                <p class="alter-exploration__kicker">Reader</p>
                <h4 class="alter-exploration__section-title">{{ activeSectionLabel }}</h4>
                <p class="alter-exploration__copy">{{ activeSectionSubtitle }}</p>
              </div>
              <UiBadge tone="neutral" size="sm">{{ activeSectionMetaLabel }}</UiBadge>
            </div>

            <div v-if="!session" class="alter-exploration__empty alter-exploration__reader-empty">
              Start an exploration to review the structured rounds and final synthesis here.
            </div>

            <template v-else>
              <nav class="alter-exploration__reader-nav" aria-label="Exploration rounds">
                <button
                  v-for="item in readerSectionItems"
                  :key="String(item.id)"
                  type="button"
                  class="alter-exploration__reader-nav-btn"
                  :class="{ 'alter-exploration__reader-nav-btn--active': activeSection === item.id }"
                  @click="selectReaderSection(item.id)"
                >
                  <strong>{{ item.label }}</strong>
                  <span>{{ item.details }}</span>
                </button>
              </nav>

              <section v-if="activeSection === 'synthesis'" class="alter-exploration__reader-content">
                <div v-if="!session.final_synthesis?.trim()" class="alter-exploration__empty">
                  No synthesis available yet.
                </div>
                <template v-else>
                  <div class="alter-exploration__final-head">
                    <UiBadge tone="accent" size="sm">{{ session.output_format }}</UiBadge>
                    <UiBadge tone="neutral" size="sm">{{ session.alter_ids.length }} alters</UiBadge>
                  </div>
                  <div class="alter-exploration__synthesis">
                    <div class="alter-exploration__markdown-frame">
                      <div
                        class="alter-exploration__markdown"
                        v-html="renderFinalSynthesis(session.final_synthesis || 'No synthesis available yet.')"
                      ></div>
                    </div>
                  </div>

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
                </template>
              </section>

              <section v-else class="alter-exploration__reader-content">
                <div class="alter-exploration__round-summary">
                  <UiBadge tone="neutral" size="sm">{{ activeRoundCountLabel }}</UiBadge>
                </div>
                <div v-if="!activeRoundResults.length" class="alter-exploration__empty">
                  No responses available for this round yet.
                </div>
                <div v-else class="alter-exploration__response-stack">
                  <article
                    v-for="result in activeRoundResults"
                    :key="`${result.round_number}-${result.alter_id}`"
                    class="alter-exploration__response-card"
                  >
                    <div class="alter-exploration__result-head">
                      <div class="alter-exploration__response-title">
                        <strong>{{ result.alter_name ?? resolveAlterName(result.alter_id) }}</strong>
                        <span>{{ result.references_alter_ids.length ? result.references_alter_ids.map(resolveAlterName).join(', ') : 'open' }}</span>
                      </div>
                      <UiBadge tone="neutral" size="xs">
                        {{ result.references_alter_ids.length ? `${result.references_alter_ids.length} refs` : 'open' }}
                      </UiBadge>
                    </div>
                    <div class="alter-exploration__markdown-frame">
                      <div class="alter-exploration__markdown" v-html="renderRoundContent(result.content)"></div>
                    </div>
                  </article>
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

.alter-exploration__context-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  padding-bottom: 0.1rem;
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

.alter-exploration__section-head-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.alter-exploration__section-head--composer {
  padding-bottom: 0.15rem;
}

.alter-exploration__section-title {
  margin: 0;
}

.alter-exploration__section-copy {
  min-width: 0;
  display: grid;
  gap: 0.2rem;
}

.alter-exploration__copy {
  margin: 0;
  color: var(--sb-text-dim);
  font-size: 0.86rem;
  line-height: 1.45;
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

.alter-exploration__setup-card,
.alter-exploration__reader-card {
  display: grid;
  gap: 0.9rem;
}

.alter-exploration__setup-summary {
  display: grid;
  gap: 0.55rem;
}

.alter-exploration__setup-summary-title {
  margin: 0;
  font-weight: 600;
  line-height: 1.4;
}

.alter-exploration__setup-summary-line {
  margin: 0;
  color: var(--sb-text-muted);
  font-size: 0.9rem;
}

.alter-exploration__reader-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  overflow-x: auto;
  padding-bottom: 0.05rem;
}

.alter-exploration__reader-nav-btn {
  min-width: 0;
  flex: 0 0 auto;
  display: grid;
  gap: 0.1rem;
  text-align: left;
  border: 1px solid var(--sb-border);
  border-radius: 999px;
  padding: 0.55rem 0.8rem;
  background: var(--sb-thread-bg);
  color: var(--sb-text);
}

.alter-exploration__reader-nav-btn strong,
.alter-exploration__reader-nav-btn span {
  display: block;
}

.alter-exploration__reader-nav-btn strong {
  font-size: 0.8rem;
}

.alter-exploration__reader-nav-btn span {
  color: var(--sb-text-dim);
  font-size: 0.72rem;
}

.alter-exploration__reader-nav-btn--active {
  border-color: var(--sb-active-border);
  background: var(--sb-assistant-bg);
  color: var(--sb-active-text);
}

.alter-exploration__reader-content {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.alter-exploration__round-summary {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.alter-exploration__response-stack {
  display: grid;
  gap: 0.75rem;
}

.alter-exploration__response-card {
  display: grid;
  gap: 0.7rem;
  border: 1px solid var(--sb-border);
  border-radius: 1rem;
  padding: 0.85rem;
  background: var(--sb-assistant-bg);
  min-width: 0;
}

.alter-exploration__response-title {
  min-width: 0;
  display: grid;
  gap: 0.15rem;
}

.alter-exploration__response-title strong {
  font-size: 0.92rem;
}

.alter-exploration__response-title span {
  color: var(--sb-text-dim);
  font-size: 0.76rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alter-exploration__final-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.alter-exploration__reader-empty {
  min-height: 11rem;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
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
  min-width: 0;
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
  table-layout: fixed;
}

.alter-exploration__markdown th,
.alter-exploration__markdown td {
  border: 1px solid var(--sb-input-border);
  padding: 4px 8px;
  vertical-align: top;
  text-align: left;
  overflow-wrap: anywhere;
  word-break: break-word;
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
  min-width: 0;
}

.alter-exploration__markdown-frame {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
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
