<script setup lang="ts">
/**
 * Alters manager surface.
 *
 * Owns the full-width workspace UI for browsing, editing, previewing, and
 * file-backed Alters. Invocation into Second Brain is emitted upward.
 */
import {
  AdjustmentsHorizontalIcon,
  BeakerIcon,
  BookmarkSquareIcon,
  LightBulbIcon,
  SparklesIcon
} from '@heroicons/vue/24/outline'
import { computed, onMounted, ref } from 'vue'
import UiBadge from '../../../shared/components/ui/UiBadge.vue'
import UiButton from '../../../shared/components/ui/UiButton.vue'
import UiCheckbox from '../../../shared/components/ui/UiCheckbox.vue'
import UiField from '../../../shared/components/ui/UiField.vue'
import UiFilterableDropdown, {
  type FilterableDropdownItem
} from '../../../shared/components/ui/UiFilterableDropdown.vue'
import UiInput from '../../../shared/components/ui/UiInput.vue'
import UiModalShell from '../../../shared/components/ui/UiModalShell.vue'
import UiPanel from '../../../shared/components/ui/UiPanel.vue'
import UiSelect from '../../../shared/components/ui/UiSelect.vue'
import UiTextarea from '../../../shared/components/ui/UiTextarea.vue'
import type { AppSettingsAlters } from '../../../shared/api/apiTypes'
import { createAlterDraft, useAlterManager } from '../composables/useAlterManager'
import { QuickStartLibraryItem, builtInAlters } from '../lib/loadBuiltInAlters'

const props = defineProps<{
  workspacePath: string
  settings: AppSettingsAlters
}>()

const emit = defineEmits<{
  'open-second-brain': [alterId: string]
}>()

type StepDefinition = {
  id: number
  label: string
  title: string
  detail: string
  icon: typeof SparklesIcon
}

const stepDefinitions: StepDefinition[] = [
  {
    id: 0,
    label: 'Identity',
    title: 'Identity and framing',
    detail: 'Name the Alter, position it in the workspace, and give it a visual marker.',
    icon: SparklesIcon
  },
  {
    id: 1,
    label: 'Sources',
    title: 'Inspirations and source material',
    detail: 'Attach figures, templates, or notes that shape its point of view.',
    icon: BookmarkSquareIcon
  },
  {
    id: 2,
    label: 'Mission',
    title: 'Mission and operating role',
    detail: 'Define what this Alter should do when invoked in a real conversation.',
    icon: LightBulbIcon
  },
  {
    id: 3,
    label: 'Principles',
    title: 'Principles and reflexes',
    detail: 'Capture what it values, how it reasons, and what it tends to critique.',
    icon: AdjustmentsHorizontalIcon
  },
  {
    id: 4,
    label: 'Behavior',
    title: 'Behavior and response style',
    detail: 'Tune contradiction, exploration, and delivery style.',
    icon: AdjustmentsHorizontalIcon
  },
  {
    id: 5,
    label: 'Test',
    title: 'Sandbox and compiled preview',
    detail: 'Run a quick dry run before saving the Alter as a real workspace entity.',
    icon: BeakerIcon
  }
]

const manager = useAlterManager()
const previewPrompt = ref('Stress-test this plan under uncertainty.')
const quickStartOpen = ref(false)
const quickStartPrompt = ref('')
const quickStartLibraryOpen = ref(false)
const quickStartLibraryQuery = ref('')
const quickStartLibraryActiveIndex = ref(0)
const searchQuery = ref('')
const {
  list,
  activeAlter,
  revisions,
  preview,
  previewRevision,
  generating,
  loading,
  saving,
  error,
  wizardOpen,
  wizardStep,
  wizardMode,
  draft
} = manager

const filteredList = computed(() => {
  if (!searchQuery.value.trim()) return list.value
  const query = searchQuery.value.toLowerCase()
  return list.value.filter(item =>
    item.name.toLowerCase().includes(query) ||
    (item.description?.toLowerCase().includes(query) ?? false) ||
    (item.mission?.toLowerCase().includes(query) ?? false) ||
    (item.category?.toLowerCase().includes(query) ?? false)
  )
})

const activeRevisionLabel = computed(() => {
  const revision = previewRevision.value
  if (!revision) return ''
  return new Date(revision.created_at_ms).toLocaleString()
})

const previewRevisionPrompt = computed(() => previewRevision.value?.alter?.invocation_prompt ?? '')
const currentStep = computed(() => stepDefinitions[wizardStep.value] ?? stepDefinitions[0])
const activeAlterSummary = computed(() => {
  if (!activeAlter.value) return []
  return [
    `${activeAlter.value.inspirations.length} inspiration${activeAlter.value.inspirations.length > 1 ? 's' : ''}`,
    `${activeAlter.value.principles.length} principle${activeAlter.value.principles.length > 1 ? 's' : ''}`,
    `${revisions.value.length} revision${revisions.value.length > 1 ? 's' : ''}`
  ]
})
const canSaveDraft = computed(() => Boolean(draft.value.name.trim()) && Boolean(draft.value.mission.trim()))
const wizardProgressLabel = computed(() => `Step ${wizardStep.value + 1} of ${stepDefinitions.length}`)
const compiledPromptOpen = ref(false)

const quickStartLibraryItems: QuickStartLibraryItem[] = builtInAlters

function splitMultiline(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinMultiline(values: string[]): string {
  return values.join('\n')
}

function formatInspirationMeta(sourceType: string, weight: number | null): string {
  const label = sourceType.replace(/_/g, ' ')
  if (weight == null) return label
  return `${label} · ${weight}`
}

function resetDraft() {
  draft.value = createAlterDraft()
}

function addInspiration() {
  draft.value.inspirations.push({
    id: '',
    label: '',
    source_type: 'reference_figure',
    weight: 1,
    reference_id: null
  })
}

function removeInspiration(index: number) {
  draft.value.inspirations.splice(index, 1)
}

function openWizardStep(stepId: number) {
  wizardStep.value = stepId
}

function closeWizard() {
  wizardOpen.value = false
}

function openQuickStart() {
  quickStartPrompt.value = ''
  quickStartLibraryOpen.value = false
  quickStartLibraryQuery.value = ''
  quickStartLibraryActiveIndex.value = 0
  quickStartOpen.value = true
}

function closeQuickStart() {
  quickStartLibraryOpen.value = false
  quickStartOpen.value = false
}

function applyQuickStartLibraryItem(item: FilterableDropdownItem) {
  quickStartPrompt.value = String((item as QuickStartLibraryItem).prompt ?? '')
  quickStartLibraryOpen.value = false
}

function nextStep() {
  if (wizardStep.value < stepDefinitions.length - 1) {
    wizardStep.value += 1
  }
}

function previousStep() {
  if (wizardStep.value > 0) {
    wizardStep.value -= 1
  }
}

async function submitPreview() {
  await manager.runPreview(previewPrompt.value)
}

async function submitQuickStart() {
  await manager.quickStartCreate(quickStartPrompt.value)
  if (!manager.error.value) {
    quickStartOpen.value = false
  }
}

onMounted(() => {
  void manager.refreshList()
})
</script>

<template>
  <section class="alter-manager">
    <!-- Top Header -->
    <header class="alter-header">
      <div class="alter-header__left">
        <h1 class="alter-header__title">Alters</h1>
        <p class="alter-header__description">
          Configurable lenses for this workspace. They stay local, versioned, and invocable from Second Brain.
        </p>
      </div>
      <div class="alter-header__actions">
        <UiButton size="sm" variant="secondary" @click="openQuickStart()">
          <template #leading>
            <SparklesIcon class="alter-step-button__icon" />
          </template>
          Quick Start
        </UiButton>
        <UiButton size="sm" variant="primary" @click="manager.openCreateWizard()">Create Alter</UiButton>
      </div>
    </header>

    <!-- Two Column Layout -->
    <div class="alter-layout">
      <!-- Master Column (Left) -->
      <aside class="alter-master">
        <div class="alter-master__search">
          <UiInput
            v-model="searchQuery"
            placeholder="Search alters..."
            size="sm"
          />
        </div>

        <div class="alter-master__list">
          <div v-if="loading" class="alter-empty">Loading Alters...</div>
          <div v-else-if="!filteredList.length" class="alter-empty">
            No alters found matching your search.
          </div>
          <div v-else class="alter-list">
            <button
              v-for="item in filteredList"
              :key="item.id"
              type="button"
              class="alter-list-item"
              :class="{ 'alter-list-item--active': activeAlter?.id === item.id }"
              @click="void manager.selectAlter(item.id)"
            >
              <div class="alter-list-item__head">
                <strong>{{ item.name }}</strong>
                <UiBadge :tone="item.is_favorite ? 'accent' : 'neutral'" size="xs">
                  {{ item.is_favorite ? 'Favorite' : item.category || 'Alter' }}
                </UiBadge>
              </div>
              <p>{{ item.description || item.mission }}</p>
            </button>
          </div>
        </div>
      </aside>

      <!-- Detail Column (Right) -->
      <main class="alter-detail">
        <div v-if="error" class="alter-error">{{ error }}</div>

        <template v-if="activeAlter">
          <header class="alter-detail__hero">
            <div class="alter-detail__identity">
              <h2 class="alter-detail__title">{{ activeAlter.name }}</h2>
              <p class="alter-detail__description">{{ activeAlter.description || activeAlter.mission }}</p>
            </div>

            <div class="alter-detail__header-actions">
              <UiButton size="sm" variant="primary" @click="emit('open-second-brain', activeAlter.id)">
                Invoke In Second Brain
              </UiButton>
              <UiButton size="sm" variant="secondary" @click="manager.openEditWizard()">Edit</UiButton>
              <UiButton size="sm" variant="ghost" @click="void manager.duplicateActiveAlter()">Duplicate</UiButton>
              <UiButton size="sm" variant="danger" @click="void manager.deleteActiveAlter()">Delete</UiButton>
            </div>

            <div class="alter-detail__tags">
              <UiBadge v-for="item in activeAlterSummary" :key="item" tone="neutral" size="xs">{{ item }}</UiBadge>
              <UiBadge v-if="activeAlter.category" tone="accent" size="xs">{{ activeAlter.category }}</UiBadge>
            </div>
          </header>

          <section class="alter-detail__body">
            <UiPanel tone="default" class-name="alter-detail__mission-panel">
              <div class="alter-detail__panel-header">
                <span class="alter-detail__label">Mission</span>
                <UiBadge tone="accent" size="sm">{{ activeAlter.style.influence_intensity }}</UiBadge>
              </div>
              <p class="alter-detail__mission-text">{{ activeAlter.mission }}</p>
              <div class="alter-detail__mission-actions">
                <UiButton size="sm" variant="secondary" @click="compiledPromptOpen = true">
                  View compiled prompt
                </UiButton>
              </div>
            </UiPanel>

            <div class="alter-detail__cards">
              <UiPanel
                v-if="activeAlter.principles.length"
                tone="default"
                class-name="alter-detail__panel alter-detail__card"
              >
                <div class="alter-detail__panel-header">
                  <span class="alter-detail__label">Principles</span>
                </div>
                <ul class="alter-detail__logic-list">
                  <li v-for="item in activeAlter.principles" :key="`principle-${item}`">
                    {{ item }}
                  </li>
                </ul>
              </UiPanel>

              <UiPanel
                v-if="activeAlter.reflexes.length"
                tone="default"
                class-name="alter-detail__panel alter-detail__card"
              >
                <div class="alter-detail__panel-header">
                  <span class="alter-detail__label">Reflexes</span>
                </div>
                <ul class="alter-detail__logic-list">
                  <li v-for="item in activeAlter.reflexes" :key="`reflex-${item}`">
                    {{ item }}
                  </li>
                </ul>
              </UiPanel>

              <UiPanel
                v-if="activeAlter.values.length"
                tone="default"
                class-name="alter-detail__panel alter-detail__card"
              >
                <div class="alter-detail__panel-header">
                  <span class="alter-detail__label">Values</span>
                </div>
                <div class="alter-detail__chip-list">
                  <UiBadge v-for="item in activeAlter.values" :key="`value-${item}`" tone="neutral" size="sm">
                    {{ item }}
                  </UiBadge>
                </div>
              </UiPanel>

              <UiPanel
                v-if="activeAlter.critiques.length"
                tone="default"
                class-name="alter-detail__panel alter-detail__card"
              >
                <div class="alter-detail__panel-header">
                  <span class="alter-detail__label">Critiques</span>
                </div>
                <ul class="alter-detail__logic-list">
                  <li v-for="item in activeAlter.critiques" :key="`critique-${item}`">
                    {{ item }}
                  </li>
                </ul>
              </UiPanel>

              <UiPanel
                v-if="activeAlter.blind_spots.length"
                tone="default"
                class-name="alter-detail__panel alter-detail__card"
              >
                <div class="alter-detail__panel-header">
                  <span class="alter-detail__label">Blind Spots</span>
                </div>
                <ul class="alter-detail__logic-list">
                  <li v-for="item in activeAlter.blind_spots" :key="`blind-${item}`">
                    {{ item }}
                  </li>
                </ul>
              </UiPanel>

              <UiPanel
                v-if="activeAlter.inspirations.length"
                tone="default"
                class-name="alter-detail__panel alter-detail__card"
              >
                <div class="alter-detail__panel-header">
                  <span class="alter-detail__label">Inspirations</span>
                </div>
                <div class="alter-detail__source-list">
                  <div
                    v-for="item in activeAlter.inspirations"
                    :key="item.id || `${item.label}-${item.reference_id}`"
                    class="alter-detail__source-row"
                  >
                    <strong>{{ item.label || 'Untitled source' }}</strong>
                    <UiBadge tone="neutral" size="sm">
                      {{ formatInspirationMeta(item.source_type, item.weight) }}
                    </UiBadge>
                  </div>
                </div>
              </UiPanel>

              <UiPanel
                v-if="activeAlter.system_hints.length"
                tone="default"
                class-name="alter-detail__panel alter-detail__card"
              >
                <div class="alter-detail__panel-header">
                  <span class="alter-detail__label">System Hints</span>
                </div>
                <ul class="alter-detail__logic-list">
                  <li v-for="item in activeAlter.system_hints" :key="`hint-${item}`">
                    {{ item }}
                  </li>
                </ul>
              </UiPanel>
            </div>

            <UiPanel tone="default" class-name="alter-detail__panel alter-detail__revision-panel">
              <div class="alter-detail__panel-header">
                <div class="alter-detail__stack">
                  <span class="alter-detail__label">Revision History</span>
                  <p class="alter-detail__hint">File-backed Alters do not keep local revisions yet.</p>
                </div>
              </div>
              <div v-if="revisions.length" class="alter-revision-table">
                <div
                  v-for="item in revisions"
                  :key="item.revision_id"
                  class="alter-revision-row"
                  :class="{ 'alter-revision-row--active': previewRevision?.revision_id === item.revision_id }"
                  @click="void manager.openRevision(item.revision_id)"
                >
                  <span class="alter-revision-date">{{ new Date(item.created_at_ms).toLocaleString() }}</span>
                  <span class="alter-revision-reason">{{ item.reason || 'saved snapshot' }}</span>
                </div>
              </div>
              <p v-else class="alter-empty">No revision snapshots are stored for this Alter.</p>
              <div v-if="previewRevision" class="alter-revision-preview">
                <span class="alter-detail__label">Snapshot: {{ activeRevisionLabel }}</span>
                <pre v-if="previewRevisionPrompt" class="alter-pre">{{ previewRevisionPrompt }}</pre>
                <p v-else class="alter-empty">Revision snapshot unavailable.</p>
              </div>
            </UiPanel>
          </section>
        </template>

        <!-- Empty State -->
        <UiPanel v-else tone="raised" class-name="alter-empty-main">
          <div class="alter-empty-main__content">
            <p class="alter-detail__label">No active Alter</p>
            <h2 class="alter-empty-main__title">Select or create one</h2>
            <p class="alter-empty-main__copy">
              Alters belong to the workspace and stay visible here instead of hiding in Settings.
            </p>
            <div class="alter-empty-main__actions">
              <UiButton size="sm" variant="secondary" @click="openQuickStart()">
                <template #leading>
                  <SparklesIcon class="alter-step-button__icon" />
                </template>
                Quick Start
              </UiButton>
              <UiButton size="sm" variant="primary" @click="manager.openCreateWizard()">Create Alter</UiButton>
            </div>
          </div>
        </UiPanel>
      </main>
    </div>

    <UiModalShell
      :model-value="compiledPromptOpen"
      title="Compiled prompt"
      description="Internal invocation layer generated from this Alter's structured fields."
      width="xl"
      panel-class="alter-compiled-prompt-modal"
      @update:modelValue="compiledPromptOpen = $event"
    >
      <pre v-if="activeAlter" class="alter-pre alter-pre--modal">{{ activeAlter.invocation_prompt }}</pre>

      <template #footer>
        <UiButton size="sm" variant="secondary" @click="compiledPromptOpen = false">Close</UiButton>
      </template>
    </UiModalShell>

    <UiModalShell
      :model-value="quickStartOpen"
      title="Quick Start Alter"
      description="Describe the Alter in plain language. Tomosona will use the active LLM to generate the full structure automatically."
      width="lg"
      panel-class="alter-quickstart-modal"
      @update:modelValue="quickStartOpen = $event"
      @close="closeQuickStart"
    >
      <div class="alter-stack">
        <UiField
          label="Starter library"
          for-id="alter-quick-start-library"
          help="Load a Tomosona starter example, then adapt the prompt before generating."
        >
          <template #default="{ describedBy }">
            <UiFilterableDropdown
              :items="quickStartLibraryItems"
              :model-value="quickStartLibraryOpen"
              :query="quickStartLibraryQuery"
              :active-index="quickStartLibraryActiveIndex"
              filter-placeholder="Find a starter Alter..."
              :max-height="280"
              menu-mode="portal"
              @open-change="quickStartLibraryOpen = $event"
              @query-change="quickStartLibraryQuery = $event"
              @active-index-change="quickStartLibraryActiveIndex = $event"
              @select="applyQuickStartLibraryItem($event)"
            >
              <template #trigger="{ toggleMenu }">
                <UiButton
                  id="alter-quick-start-library"
                  size="sm"
                  variant="secondary"
                  class-name="alter-quickstart-library-trigger"
                  :aria-describedby="describedBy"
                  @click="toggleMenu"
                >
                  <template #leading>
                    <SparklesIcon class="alter-step-button__icon" />
                  </template>
                  Load starter example
                </UiButton>
              </template>
              <template #item="{ item }">
                <div class="alter-dropdown-item">
                  <strong>{{ item.label }}</strong>
                  <span>{{ item.group }}</span>
                </div>
              </template>
            </UiFilterableDropdown>
          </template>
        </UiField>

        <UiField
          label="Prompt"
          for-id="alter-quick-start-prompt"
          help="Describe the Alter you want, or start from the library above and refine the text."
        >
          <template #default="{ describedBy }">
            <UiTextarea
              id="alter-quick-start-prompt"
              v-model="quickStartPrompt"
              :aria-describedby="describedBy"
              :rows="8"
              placeholder="Create an Alter for product strategy that thinks like a pragmatic critic, highlights tradeoffs, names blind spots, and prefers concrete next steps."
            />
          </template>
        </UiField>

        <UiPanel tone="subtle" class-name="alter-wizard__summary">
          <p class="alter-section-kicker">Output</p>
          <p class="alter-sidebar__copy">
            This will generate the name, category, description, mission, inspirations, principles, behavior, and system hints, then create the Alter directly in the workspace.
          </p>
        </UiPanel>
      </div>

      <template #footer>
        <div class="alter-wizard__footer">
          <div class="alter-card-actions">
            <UiButton size="sm" variant="ghost" @click="closeQuickStart()">Cancel</UiButton>
          </div>
          <div class="alter-card-actions">
            <UiButton
              size="sm"
              variant="primary"
              :disabled="generating || !quickStartPrompt.trim()"
              :loading="generating"
              @click="void submitQuickStart()"
            >
              <template #leading>
                <SparklesIcon class="alter-step-button__icon" />
              </template>
              Generate Alter
            </UiButton>
          </div>
        </div>
      </template>
    </UiModalShell>

    <UiModalShell
      :model-value="wizardOpen"
      :title="wizardMode === 'create' ? 'Create Alter' : 'Edit Alter'"
      :description="currentStep.detail"
      width="xl"
      panel-class="alter-wizard-modal"
      @update:modelValue="wizardOpen = $event"
      @close="closeWizard"
    >
      <template #header>
        <UiBadge tone="accent">{{ wizardProgressLabel }}</UiBadge>
      </template>

      <div class="alter-wizard">
        <aside class="alter-wizard__rail">
          <div class="alter-wizard__intro">
            <p class="alter-kicker">Wizard</p>
            <h3>{{ currentStep.title }}</h3>
            <p>{{ currentStep.detail }}</p>
          </div>

          <div class="alter-wizard__steps">
            <UiButton
              v-for="step in stepDefinitions"
              :key="step.id"
              variant="secondary"
              size="sm"
              :active="wizardStep === step.id"
              class-name="alter-step-button"
              @click="openWizardStep(step.id)"
            >
              <template #leading>
                <component :is="step.icon" class="alter-step-button__icon" />
              </template>
              {{ step.label }}
            </UiButton>
          </div>

          <UiPanel tone="subtle" class-name="alter-wizard__summary">
            <p class="alter-section-kicker">Draft summary</p>
            <strong>{{ draft.name || 'Untitled Alter' }}</strong>
            <p>{{ draft.description || 'No description yet.' }}</p>
            <div class="alter-sidebar__meta">
              <UiBadge tone="neutral">{{ draft.style.influence_intensity }}</UiBadge>
              <UiBadge tone="accent">{{ draft.inspirations.length }} sources</UiBadge>
            </div>
          </UiPanel>
        </aside>

        <div class="alter-wizard__content">
          <section v-if="wizardStep === 0" class="alter-form-grid">
            <UiField label="Name" for-id="alter-name" help="Make it concrete and memorable.">
              <template #default="{ describedBy, invalid }">
                <UiInput
                  id="alter-name"
                  v-model="draft.name"
                  :invalid="invalid || !draft.name.trim()"
                  :aria-describedby="describedBy"
                  placeholder="Antifragile strategist"
                />
              </template>
            </UiField>

            <UiField label="Category" for-id="alter-category" help="Optional grouping for the manager view.">
              <template #default="{ describedBy }">
                <UiInput
                  id="alter-category"
                  :model-value="draft.category ?? ''"
                  :aria-describedby="describedBy"
                  placeholder="Strategy"
                  @update:modelValue="draft.category = $event"
                />
              </template>
            </UiField>

            <UiField label="Description" for-id="alter-description" class-name="alter-form-grid__full">
              <template #default="{ describedBy }">
                <UiTextarea
                  id="alter-description"
                  v-model="draft.description"
                  :aria-describedby="describedBy"
                  :rows="4"
                  placeholder="Tests ideas for robustness in uncertain environments."
                />
              </template>
            </UiField>

          </section>

          <section v-else-if="wizardStep === 1" class="alter-stack">
            <div class="alter-section-head">
              <div>
                <p class="alter-section-kicker">Input sources</p>
                <h3>Inspirations</h3>
              </div>
              <UiButton size="sm" variant="secondary" @click="addInspiration()">Add source</UiButton>
            </div>

            <div v-if="!draft.inspirations.length" class="alter-empty">
              No inspirations yet. Add a figure, template, or note to guide the Alter.
            </div>

            <UiPanel
              v-for="(item, index) in draft.inspirations"
              :key="`${index}-${item.id}`"
              tone="subtle"
              class-name="alter-inspiration-card"
            >
              <div class="alter-form-grid">
                <UiField :label="`Source ${index + 1}`" :for-id="`alter-source-label-${index}`">
                  <template #default="{ describedBy }">
                    <UiInput
                      :id="`alter-source-label-${index}`"
                      v-model="item.label"
                      :aria-describedby="describedBy"
                      placeholder="Taleb"
                    />
                  </template>
                </UiField>

                <UiField label="Type" :for-id="`alter-source-type-${index}`">
                  <template #default="{ describedBy }">
                    <UiSelect
                      :id="`alter-source-type-${index}`"
                      v-model="item.source_type"
                      :aria-describedby="describedBy"
                    >
                      <option value="manual">Manual</option>
                      <option value="template">Template</option>
                      <option value="reference_figure">Reference figure</option>
                      <option value="note">Note</option>
                    </UiSelect>
                  </template>
                </UiField>

                <UiField label="Reference" :for-id="`alter-source-ref-${index}`" class-name="alter-form-grid__full">
                  <template #default="{ describedBy }">
                    <UiInput
                      :id="`alter-source-ref-${index}`"
                      :model-value="item.reference_id ?? ''"
                      :aria-describedby="describedBy"
                      placeholder="Optional note path or reference id"
                      @update:modelValue="item.reference_id = $event || null"
                    />
                  </template>
                </UiField>

                <UiField label="Weight" :for-id="`alter-source-weight-${index}`" help="Relative importance from 0 to 10.">
                  <template #default="{ describedBy }">
                    <UiInput
                      :id="`alter-source-weight-${index}`"
                      :model-value="item.weight == null ? '' : String(item.weight)"
                      :aria-describedby="describedBy"
                      placeholder="1"
                      @update:modelValue="item.weight = $event.trim() ? Number($event) : null"
                    />
                  </template>
                </UiField>
              </div>

              <div class="alter-card-actions">
                <UiButton size="sm" variant="ghost" @click="removeInspiration(index)">Remove</UiButton>
              </div>
            </UiPanel>
          </section>

          <section v-else-if="wizardStep === 2" class="alter-stack">
            <UiField
              label="Mission"
              for-id="alter-mission"
              help='Core instruction: "When invoked, this Alter should..."'
            >
              <template #default="{ describedBy, invalid }">
                <UiTextarea
                  id="alter-mission"
                  v-model="draft.mission"
                  :invalid="invalid || !draft.mission.trim()"
                  :aria-describedby="describedBy"
                  :rows="7"
                  placeholder="Challenge plans for fragility, hidden dependencies, and naive assumptions."
                />
              </template>
            </UiField>
          </section>

          <section v-else-if="wizardStep === 3" class="alter-form-grid">
            <UiField label="Principles" for-id="alter-principles" help="One principle per line.">
              <template #default="{ describedBy }">
                <UiTextarea
                  id="alter-principles"
                  :model-value="joinMultiline(draft.principles)"
                  :aria-describedby="describedBy"
                  :rows="8"
                  placeholder="Prefer robustness over optimization"
                  @update:modelValue="draft.principles = splitMultiline($event)"
                />
              </template>
            </UiField>

            <UiField label="Reflexes" for-id="alter-reflexes" help="Analysis moves the Alter should default to.">
              <template #default="{ describedBy }">
                <UiTextarea
                  id="alter-reflexes"
                  :model-value="joinMultiline(draft.reflexes)"
                  :aria-describedby="describedBy"
                  :rows="8"
                  placeholder="Ask what breaks first"
                  @update:modelValue="draft.reflexes = splitMultiline($event)"
                />
              </template>
            </UiField>

            <UiField label="Values" for-id="alter-values" help="What this Alter tends to reward.">
              <template #default="{ describedBy }">
                <UiTextarea
                  id="alter-values"
                  :model-value="joinMultiline(draft.values)"
                  :aria-describedby="describedBy"
                  :rows="6"
                  placeholder="Redundancy"
                  @update:modelValue="draft.values = splitMultiline($event)"
                />
              </template>
            </UiField>

            <UiField label="Critiques" for-id="alter-critiques" help="What it naturally pushes against.">
              <template #default="{ describedBy }">
                <UiTextarea
                  id="alter-critiques"
                  :model-value="joinMultiline(draft.critiques)"
                  :aria-describedby="describedBy"
                  :rows="6"
                  placeholder="Overfit planning"
                  @update:modelValue="draft.critiques = splitMultiline($event)"
                />
              </template>
            </UiField>

            <UiField label="Blind Spots" for-id="alter-blind-spots" help="Known limitations or blind spots of this Alter." class-name="alter-form-grid__full">
              <template #default="{ describedBy }">
                <UiTextarea
                  id="alter-blind-spots"
                  :model-value="joinMultiline(draft.blind_spots)"
                  :aria-describedby="describedBy"
                  :rows="6"
                  placeholder="May undervalue efficiency gains"
                  @update:modelValue="draft.blind_spots = splitMultiline($event)"
                />
              </template>
            </UiField>

            <UiField label="System Hints" for-id="alter-system-hints" help="Implementation hints for the system." class-name="alter-form-grid__full">
              <template #default="{ describedBy }">
                <UiTextarea
                  id="alter-system-hints"
                  :model-value="joinMultiline(draft.system_hints)"
                  :aria-describedby="describedBy"
                  :rows="6"
                  placeholder="Keep responses Tomosona-native rather than direct imitation"
                  @update:modelValue="draft.system_hints = splitMultiline($event)"
                />
              </template>
            </UiField>
          </section>

          <section v-else-if="wizardStep === 4" class="alter-stack">
            <div class="alter-form-grid">
              <UiField label="Tone" for-id="alter-tone">
                <template #default="{ describedBy }">
                  <UiSelect id="alter-tone" v-model="draft.style.tone" :aria-describedby="describedBy">
                    <option value="neutral">neutral</option>
                    <option value="direct">direct</option>
                    <option value="socratic">socratic</option>
                    <option value="strategic">strategic</option>
                    <option value="creative">creative</option>
                  </UiSelect>
                </template>
              </UiField>

              <UiField label="Verbosity" for-id="alter-verbosity">
                <template #default="{ describedBy }">
                  <UiSelect id="alter-verbosity" v-model="draft.style.verbosity" :aria-describedby="describedBy">
                    <option value="short">short</option>
                    <option value="medium">medium</option>
                    <option value="long">long</option>
                  </UiSelect>
                </template>
              </UiField>

              <UiField label="Influence intensity" for-id="alter-intensity">
                <template #default="{ describedBy }">
                  <UiSelect id="alter-intensity" v-model="draft.style.influence_intensity" :aria-describedby="describedBy">
                    <option value="light">light</option>
                    <option value="balanced">balanced</option>
                    <option value="strong">strong</option>
                  </UiSelect>
                </template>
              </UiField>

              <UiField label="Response style" for-id="alter-response-style">
                <template #default="{ describedBy }">
                  <UiSelect id="alter-response-style" v-model="draft.style.response_style" :aria-describedby="describedBy">
                    <option value="concise">concise</option>
                    <option value="analytic">analytic</option>
                    <option value="dialectic">dialectic</option>
                    <option value="frontal">frontal</option>
                  </UiSelect>
                </template>
              </UiField>
            </div>

            <UiPanel tone="subtle" class-name="alter-range-panel">
              <div class="alter-range-grid">
                <label class="alter-range-field">
                  <span>Contradiction level</span>
                  <input v-model.number="draft.style.contradiction_level" class="alter-range-input" type="range" min="0" max="100">
                  <strong>{{ draft.style.contradiction_level }}</strong>
                </label>
                <label class="alter-range-field">
                  <span>Exploration level</span>
                  <input v-model.number="draft.style.exploration_level" class="alter-range-input" type="range" min="0" max="100">
                  <strong>{{ draft.style.exploration_level }}</strong>
                </label>
              </div>

              <div class="alter-checkbox-grid">
                <UiCheckbox v-model="draft.style.cite_hypotheses">Cite hypotheses</UiCheckbox>
                <UiCheckbox v-model="draft.style.signal_biases">Signal biases</UiCheckbox>
              </div>
            </UiPanel>
          </section>

          <section v-else class="alter-stack">
            <UiField label="Test prompt" for-id="alter-preview-prompt" help="Quick sandbox to inspect the compiled prompt before saving.">
              <template #default="{ describedBy }">
                <UiTextarea
                  id="alter-preview-prompt"
                  v-model="previewPrompt"
                  :aria-describedby="describedBy"
                  :rows="5"
                />
              </template>
            </UiField>

            <div class="alter-card-actions">
              <UiButton size="sm" variant="secondary" @click="void submitPreview()">Generate preview</UiButton>
            </div>

            <UiPanel tone="subtle" class-name="alter-preview-panel">
              <p class="alter-section-kicker">Compiled preview</p>
              <pre class="alter-pre">{{ preview?.preview_prompt || 'Run the sandbox to inspect the generated invocation prompt.' }}</pre>
            </UiPanel>
          </section>
        </div>
      </div>

      <template #footer>
        <div class="alter-wizard__footer">
          <div class="alter-card-actions">
            <UiButton size="sm" variant="ghost" @click="resetDraft()">Reset</UiButton>
            <UiButton size="sm" variant="ghost" @click="closeWizard()">Cancel</UiButton>
          </div>

          <div class="alter-card-actions">
            <UiButton size="sm" variant="secondary" :disabled="wizardStep === 0" @click="previousStep()">Back</UiButton>
            <UiButton
              v-if="wizardStep < stepDefinitions.length - 1"
              size="sm"
              variant="primary"
              @click="nextStep()"
            >
              Next
            </UiButton>
            <UiButton
              v-else
              size="sm"
              variant="primary"
              :disabled="saving || !canSaveDraft"
              :loading="saving"
              @click="void manager.saveDraft()"
            >
              Save Alter
            </UiButton>
          </div>
        </div>
      </template>
    </UiModalShell>
  </section>
</template>

<style scoped>
/* ===== Layout Architecture ===== */
.alter-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--accent-soft) 24%, transparent), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--surface-muted) 40%, var(--surface-bg)), var(--surface-bg));
}

/* ===== Top Header ===== */
.alter-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--panel-border);
  background: color-mix(in srgb, var(--panel-bg) 80%, transparent);
  flex-shrink: 0;
}

.alter-header__left {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.alter-header__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.2;
  color: var(--text-base);
}

.alter-header__description {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.alter-header__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.25rem;
}

.alter-header__actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

/* ===== Two Column Layout ===== */
.alter-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ===== Master Column (Left) ===== */
.alter-master {
  width: 32%;
  min-width: 280px;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--panel-border);
  background: color-mix(in srgb, var(--panel-bg) 60%, transparent);
  overflow: hidden;
}

.alter-master__search {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--panel-border);
  flex-shrink: 0;
}

.alter-master__list {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
}

.alter-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.alter-list-item {
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--panel-bg) 92%, transparent);
  padding: 0.75rem 1rem;
  text-align: left;
  transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
  cursor: pointer;
}

.alter-list-item:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--panel-border));
  background: color-mix(in srgb, var(--accent-soft) 26%, var(--panel-bg));
}

.alter-list-item--active {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--panel-border));
  background: color-mix(in srgb, var(--accent-soft) 34%, var(--panel-bg));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
}

.alter-list-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.alter-list-item p {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.4;
  font-size: 0.7125rem;
  display: -webkit-box;
  line-clamp: 2;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ===== Detail Column (Right) ===== */
.alter-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* Detail Header */
.alter-detail__hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--panel-border);
  background: color-mix(in srgb, var(--panel-bg) 40%, transparent);
  flex-shrink: 0;
}

.alter-detail__identity {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.45rem;
}

.alter-detail__title {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 600;
  line-height: 1.2;
  color: var(--text-base);
}

.alter-detail__description {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-muted);
  line-height: 1.38;
  max-width: 52rem;
}

.alter-detail__tags {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.28rem;
  grid-column: 1 / -1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.alter-detail__tags::-webkit-scrollbar {
  display: none;
}

.alter-detail__header-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
  justify-content: flex-end;
  flex-wrap: wrap;
}

/* Detail Body */
.alter-detail__body {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.25rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.alter-detail__panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.alter-detail__panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.alter-detail__label {
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.alter-detail__mission-text {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.55;
  color: var(--text-base);
}

.alter-detail__mission-panel {
  gap: 0.65rem;
}

.alter-detail__mission-actions {
  display: flex;
  justify-content: flex-start;
}

.alter-detail__cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}

.alter-detail__card {
  min-width: 0;
}

.alter-detail__chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.alter-detail__source-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.alter-detail__source-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-top: 1px solid color-mix(in srgb, var(--panel-border) 68%, transparent);
}

.alter-detail__source-row:first-child {
  border-top: 0;
  padding-top: 0;
}

.alter-detail__source-row strong {
  font-size: 0.84rem;
  line-height: 1.3;
}

.alter-detail__stack {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.alter-detail__hint {
  margin: 0;
  font-size: 0.76rem;
  color: var(--text-muted);
}

.alter-detail__logic-section {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.alter-detail__logic-label {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.alter-detail__logic-list {
  margin: 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.32rem;
}

.alter-detail__logic-list li {
  font-size: 0.84rem;
  line-height: 1.45;
  color: var(--text-base);
}

.alter-detail__revision-panel {
  min-width: 0;
}

.alter-revision-table {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.alter-revision-row {
  display: flex;
  gap: 0.75rem;
  padding: 0.48rem 0.65rem;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.12s ease;
  align-items: baseline;
}

.alter-revision-row:hover {
  background: color-mix(in srgb, var(--accent-soft) 20%, transparent);
}

.alter-revision-row--active {
  background: color-mix(in srgb, var(--accent-soft) 30%, transparent);
}

.alter-revision-date {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-base);
  min-width: 8.5rem;
}

.alter-revision-reason {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.alter-revision-preview {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--panel-border);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* ===== Empty States ===== */
.alter-empty-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.alter-empty-main__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.75rem;
  max-width: 400px;
}

.alter-empty-main__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.alter-empty-main__copy {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.5;
}

.alter-empty-main__actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.alter-empty {
  padding: 1rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.alter-error {
  margin: 1rem 1.5rem;
  padding: 0.875rem 1rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--badge-danger-bg);
  background: color-mix(in srgb, var(--badge-danger-bg) 15%, transparent);
  color: var(--badge-danger-text);
  font-size: 0.875rem;
}

/* ===== Utility Components ===== */
.alter-pre {
  margin: 0;
  padding: 0.875rem 1rem;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface-muted) 90%, var(--panel-bg));
  color: var(--text-base);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.5;
  font-size: 0.8125rem;
  max-height: 200px;
  overflow-y: auto;
}

:deep(.alter-compiled-prompt-modal) {
  max-width: min(72rem, calc(100vw - 2rem));
}

.alter-pre--modal {
  max-height: min(70vh, 42rem);
  overflow: auto;
}

/* ===== Wizard Styles ===== */
:deep(.alter-wizard-modal) {
  max-width: min(74rem, calc(100vw - 2rem));
}

.alter-wizard {
  display: grid;
  grid-template-columns: 18rem minmax(0, 1fr);
  gap: 0.75rem;
  min-height: 30rem;
}

.alter-wizard__rail,
.alter-wizard__content,
.alter-stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.alter-wizard__steps {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.alter-step-button {
  justify-content: flex-start;
  width: 100%;
}

.alter-step-button__icon {
  width: 1rem;
  height: 1rem;
}

.alter-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.alter-form-grid__full {
  grid-column: 1 / -1;
}

.alter-inspiration-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.alter-range-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.alter-range-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.alter-range-field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  color: var(--field-label);
  font-size: 0.78rem;
  font-weight: 600;
}

.alter-range-input {
  width: 100%;
  accent-color: var(--accent);
}

.alter-wizard__summary {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.alter-wizard__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

/* ===== Dropdown & Misc ===== */
.alter-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
}

.alter-dropdown-item strong {
  font-size: 0.88rem;
}

.alter-dropdown-item span {
  color: var(--text-muted);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.alter-quickstart-library-trigger {
  width: 100%;
  justify-content: flex-start;
}

/* ===== Responsive ===== */
@media (max-width: 1180px) {
  .alter-wizard {
    grid-template-columns: 1fr;
  }

  .alter-detail__cards {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 960px) {
  .alter-master {
    width: 260px;
    min-width: 260px;
  }

  .alter-detail__hero {
    grid-template-columns: 1fr;
  }

  .alter-detail__header-actions {
    width: 100%;
    justify-content: flex-start;
  }
}

@media (max-width: 760px) {
  .alter-layout {
    flex-direction: column;
  }

  .alter-master {
    width: 100%;
    max-width: none;
    border-right: none;
    border-bottom: 1px solid var(--panel-border);
    max-height: 40vh;
  }

  .alter-header {
    flex-direction: column;
    gap: 0.75rem;
  }

  .alter-header__actions {
    width: 100%;
    justify-content: flex-start;
  }

  .alter-form-grid,
  .alter-range-grid {
    grid-template-columns: 1fr;
  }
}
</style>
