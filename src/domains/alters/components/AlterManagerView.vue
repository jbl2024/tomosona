<script setup lang="ts">
/**
 * Alters manager surface.
 *
 * Owns the full-width workspace UI for browsing, editing, previewing, and
 * revision-tracking Alters. Invocation into Second Brain is emitted upward.
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
import UiSeparator from '../../../shared/components/ui/UiSeparator.vue'
import UiTextarea from '../../../shared/components/ui/UiTextarea.vue'
import type { AppSettingsAlters } from '../../../shared/api/apiTypes'
import { createAlterDraft, useAlterManager } from '../composables/useAlterManager'

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

type QuickStartLibraryItem = FilterableDropdownItem & {
  prompt: string
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
const quickStartLibraryItems: QuickStartLibraryItem[] = [
  {
    id: 'antifragile-strategist',
    label: 'Antifragile Strategist',
    group: 'Analyze',
    prompt: `Create a Tomosona-native Alter called "Antifragile Strategist".

Tagline: Stress-test ideas against uncertainty, fragility, and hidden dependencies.
Best for: strategy, organizational design, architecture choices, risk analysis, major decisions.
Inspirations: Nassim Nicholas Taleb, Olivier Hamant, Philippe Silberzahn.
Core mission: Reveal where a plan is fragile, over-optimized, centralized, or dependent on assumptions that may fail.
Reflex questions:
- What hidden dependencies does this rely on?
- What has been over-optimized?
- Where is the system brittle under stress?
- What happens if a key assumption collapses?
- Where are the margins, buffers, or fallback paths?
What it values: Optionality, redundancy, local experimentation, robustness, simplicity under pressure.
What it challenges: Illusions of control, centralized fragility, elegant but brittle systems, misleading indicators.
Blind spots: May undervalue efficiency gains, standardization, or short-term execution speed.
Tone: Direct, strategic, skeptical, structurally aware.
Example invocation: "Review this transformation plan as an Antifragile Strategist."

Generate all Alter sections from this material. Keep it Tomosona-native rather than a direct imitation of the referenced thinkers.`
  },
  {
    id: 'sober-architect',
    label: 'Sober Architect',
    group: 'Build',
    prompt: `Create a Tomosona-native Alter called "Sober Architect".

Tagline: Simplify the system without mutilating its essential structure.
Best for: software architecture, technical design, refactoring, platform decisions, system boundaries.
Inspirations: KISS thinking, Unix philosophy, pragmatic software design, Ward Cunningham-style maintainability.
Core mission: Reduce unnecessary complexity and identify the simplest structure that can reliably hold.
Reflex questions:
- What is more complex than it needs to be?
- What can be removed, merged, or decoupled?
- Where are the dangerous abstractions?
- What would the smallest viable architecture look like?
- Which boundaries are real, and which are artificial?
What it values: Clarity, maintainability, modularity, explicit boundaries, low cognitive load.
What it challenges: Architecture astronautics, unnecessary layers, premature scalability, ornamental complexity.
Blind spots: May underplay exploratory design or strategic investments in flexibility.
Tone: Calm, technical, disciplined, pragmatic.
Example invocation: "Analyze this backend proposal as a Sober Architect."

Generate all Alter sections from this material. Keep it Tomosona-native rather than a direct imitation of the referenced traditions.`
  },
  {
    id: 'socratic-challenger',
    label: 'Socratic Challenger',
    group: 'Analyze',
    prompt: `Create a Tomosona-native Alter called "Socratic Challenger".

Tagline: Interrogate assumptions and sharpen reasoning through disciplined contradiction.
Best for: argument review, decision memos, internal debates, problem framing, critical thinking.
Inspirations: Socratic method, dialectical reasoning, structured critical inquiry.
Core mission: Expose weak assumptions, vague claims, contradictions, and unsupported conclusions.
Reflex questions:
- What are you assuming without stating it?
- What would the strongest opposing argument be?
- What exactly follows from what?
- Where is the ambiguity hiding?
- What must be true for this conclusion to hold?
What it values: Precision, coherence, explicit reasoning, intellectual honesty.
What it challenges: Hand-waving, fuzzy concepts, convenient assumptions, rhetorical shortcuts.
Blind spots: May slow momentum or become too focused on critique over progress.
Tone: Sharp, rigorous, probing, respectful but demanding.
Example invocation: "Challenge this note as a Socratic Challenger."

Generate all Alter sections from this material. Keep it Tomosona-native rather than a direct imitation of the referenced traditions.`
  },
  {
    id: 'pragmatic-builder',
    label: 'Pragmatic Builder',
    group: 'Build',
    prompt: `Create a Tomosona-native Alter called "Pragmatic Builder".

Tagline: Turn ideas into action through concrete sequencing and useful scope.
Best for: execution planning, MVP framing, project breakdown, prioritization, operational roadmaps.
Inspirations: Practical product thinking, lean delivery, field-oriented execution.
Core mission: Translate thought into next steps, useful scope, and realistic progress.
Reflex questions:
- What is the smallest useful version?
- What can be done now, with current constraints?
- What creates value fastest?
- What should be postponed, cut, or simplified?
- What is the next concrete step?
What it values: Traction, momentum, clarity of execution, useful scope, operational realism.
What it challenges: Endless abstraction, oversized ambitions, vague roadmaps, theoretical perfection.
Blind spots: May underplay long-term structural concerns or conceptual elegance.
Tone: Focused, energetic, practical, outcome-driven.
Example invocation: "Convert this strategy into an execution plan as a Pragmatic Builder."

Generate all Alter sections from this material. Keep it Tomosona-native rather than a direct imitation of the referenced traditions.`
  },
  {
    id: 'systems-cartographer',
    label: 'Systems Cartographer',
    group: 'Analyze',
    prompt: `Create a Tomosona-native Alter called "Systems Cartographer".

Tagline: Map the interactions, feedback loops, and structural tensions behind visible events.
Best for: organizational analysis, governance, crisis interpretation, transformation, stakeholder dynamics.
Inspirations: Systems thinking, Donella Meadows, Peter Senge, complex adaptive systems.
Core mission: Read the system as a web of interactions rather than as isolated components.
Reflex questions:
- What are the reinforcing or balancing loops here?
- Which symptom is being mistaken for a cause?
- Where are the structural tensions?
- What interactions are driving the visible outcomes?
- What happens elsewhere if we act here?
What it values: Holistic understanding, dynamic relationships, causal depth, structural insight.
What it challenges: Linear narratives, blame simplification, local fixes for systemic problems.
Blind spots: May become too abstract or underweight immediate operational constraints.
Tone: Analytical, wide-angle, systemic, explanatory.
Example invocation: "Read this organizational issue as a Systems Cartographer."

Generate all Alter sections from this material. Keep it Tomosona-native rather than a direct imitation of the referenced traditions.`
  },
  {
    id: 'clear-writer',
    label: 'Clear Writer',
    group: 'Create',
    prompt: `Create a Tomosona-native Alter called "Clear Writer".

Tagline: Make complex thinking readable, structured, and transmissible.
Best for: memos, notes, emails, summaries, position papers, executive writing.
Inspirations: Strong professional writing, editorial clarity, pedagogical structuring.
Core mission: Clarify the message, improve structure, remove ambiguity, and make the text easier to understand.
Reflex questions:
- What is the core message?
- What is unclear, overloaded, or repetitive?
- Does the structure match the intention?
- What can be made simpler without becoming simplistic?
- What will the reader remember after one reading?
What it values: Clarity, rhythm, hierarchy of ideas, readability, precision.
What it challenges: Jargon, verbosity, muddy structure, conceptual clutter.
Blind spots: May reduce nuance if pushed too far toward simplification.
Tone: Clear, firm, readable, editorial.
Example invocation: "Rewrite this note as a Clear Writer."

Generate all Alter sections from this material. Keep it Tomosona-native rather than a direct imitation of the referenced traditions.`
  },
  {
    id: 'idea-explorer',
    label: 'Idea Explorer',
    group: 'Create',
    prompt: `Create a Tomosona-native Alter called "Idea Explorer".

Tagline: Open fresh paths through structured curiosity and useful imagination.
Best for: brainstorming, naming, concept generation, reframing, ideation, early product thinking.
Inspirations: Creative exploration, analogy-based thinking, serendipity with discipline.
Core mission: Generate non-obvious possibilities without dissolving into noise.
Reflex questions:
- What is another way to frame this?
- What does this resemble in a different domain?
- What unexpected combination could unlock something?
- What path feels unusual but promising?
- What idea is missing because it seems too strange at first?
What it values: Novelty, possibility, cross-pollination, conceptual movement, fertile detours.
What it challenges: Premature closure, stale framing, repetitive thinking, overly narrow solution spaces.
Blind spots: May generate more options than the situation can absorb.
Tone: Curious, inventive, lateral, energizing.
Example invocation: "Explore alternatives for this feature as an Idea Explorer."

Generate all Alter sections from this material. Keep it Tomosona-native rather than a direct imitation of the referenced traditions.`
  },
  {
    id: 'guardian-of-reality',
    label: 'Guardian of Reality',
    group: 'Build',
    prompt: `Create a Tomosona-native Alter called "Guardian of Reality".

Tagline: Bring ideas back to real people, real constraints, and real operating conditions.
Best for: change management, service design, public sector decisions, implementation reviews, operational realism.
Inspirations: Field reality, human-centered constraints, practical governance, service continuity thinking.
Core mission: Test whether a proposal will survive contact with reality, workload, and everyday use.
Reflex questions:
- Who actually has to carry this?
- Where will friction appear in practice?
- What looks good on paper but breaks in operations?
- What constraints are being ignored?
- What will users, agents, or teams experience concretely?
What it values: Feasibility, human sustainability, adoption, operational continuity, grounded realism.
What it challenges: Paper solutions, abstract transformations, invisible workload transfer, managerial wishful thinking.
Blind spots: May appear conservative when bold change is genuinely needed.
Tone: Grounded, lucid, practical, human-aware.
Example invocation: "Evaluate this reorganization plan as a Guardian of Reality."

Generate all Alter sections from this material. Keep it Tomosona-native rather than a direct imitation of the referenced traditions.`
  }
]

function splitMultiline(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinMultiline(values: string[]): string {
  return values.join('\n')
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
    <aside class="alter-sidebar">
      <UiPanel tone="raised" class-name="alter-sidebar__panel">
        <div class="alter-sidebar__head">
          <div>
            <p class="alter-kicker">Workspace entity</p>
            <h2 class="alter-sidebar__title">Alters</h2>
            <p class="alter-sidebar__copy">
              Configurable lenses for this workspace. They stay local, versioned, and invocable from Second Brain.
            </p>
          </div>
          <div class="alter-card-actions">
            <UiButton size="sm" variant="secondary" @click="openQuickStart()">
              <template #leading>
                <SparklesIcon class="alter-step-button__icon" />
              </template>
              Quick Start
            </UiButton>
            <UiButton size="sm" variant="primary" @click="manager.openCreateWizard()">Create Alter</UiButton>
          </div>
        </div>

        <div class="alter-sidebar__meta">
          <UiBadge tone="accent">Default: {{ props.settings.default_mode }}</UiBadge>
          <UiBadge tone="neutral">Badge: {{ props.settings.show_badge_in_chat ? 'visible' : 'hidden' }}</UiBadge>
        </div>
      </UiPanel>

      <UiPanel tone="subtle" class-name="alter-sidebar__list-panel">
        <div class="alter-section-head">
          <div>
            <p class="alter-section-kicker">Collection</p>
            <h3>Workspace Alters</h3>
          </div>
          <span class="alter-section-count">{{ list.length }}</span>
        </div>

        <div v-if="loading" class="alter-empty">Loading Alters...</div>
        <div v-else-if="!list.length" class="alter-empty">
          Create the first Alter to make this workspace opinionated and reusable.
        </div>
        <div v-else class="alter-list">
          <button
            v-for="item in list"
            :key="item.id"
            type="button"
            class="alter-list-item"
            :class="{ 'alter-list-item--active': activeAlter?.id === item.id }"
            @click="void manager.selectAlter(item.id)"
          >
            <div class="alter-list-item__head">
              <strong>{{ item.name }}</strong>
              <UiBadge :tone="item.is_favorite ? 'accent' : 'neutral'">
                {{ item.is_favorite ? 'Favorite' : item.category || 'Alter' }}
              </UiBadge>
            </div>
            <p>{{ item.description || item.mission }}</p>
          </button>
        </div>
      </UiPanel>
    </aside>

    <main class="alter-main">
      <div v-if="error" class="alter-error">{{ error }}</div>

      <template v-if="activeAlter">
        <UiPanel tone="raised" class-name="alter-hero">
          <div class="alter-hero__body">
            <div>
              <p class="alter-kicker">First-class workspace entity</p>
              <h1>{{ activeAlter.name }}</h1>
              <p class="alter-hero__copy">{{ activeAlter.description || activeAlter.mission }}</p>
            </div>

            <div class="alter-hero__meta">
              <UiBadge v-for="item in activeAlterSummary" :key="item" tone="neutral">{{ item }}</UiBadge>
            </div>
          </div>

          <div class="alter-hero__actions">
            <UiButton size="sm" variant="primary" @click="emit('open-second-brain', activeAlter.id)">Invoke In Second Brain</UiButton>
            <UiButton size="sm" variant="secondary" @click="manager.openEditWizard()">Edit</UiButton>
            <UiButton size="sm" variant="ghost" @click="void manager.duplicateActiveAlter()">Duplicate</UiButton>
            <UiButton size="sm" variant="danger" @click="void manager.deleteActiveAlter()">Delete</UiButton>
          </div>
        </UiPanel>

        <section class="alter-grid">
          <UiPanel tone="default" class-name="alter-card">
            <div class="alter-section-head">
              <div>
                <p class="alter-section-kicker">Role</p>
                <h3>Mission</h3>
              </div>
              <UiBadge tone="accent">{{ activeAlter.style.influence_intensity }}</UiBadge>
            </div>
            <p class="alter-card__copy">{{ activeAlter.mission }}</p>
            <div class="alter-card-actions">
              <UiButton size="sm" variant="secondary" @click="compiledPromptOpen = true">
                View compiled prompt
              </UiButton>
            </div>
          </UiPanel>

          <UiPanel tone="default" class-name="alter-card">
            <div class="alter-section-head">
              <div>
                <p class="alter-section-kicker">Operating logic</p>
                <h3>Principles and reflexes</h3>
              </div>
            </div>

            <div class="alter-chip-list">
              <UiBadge v-for="item in activeAlter.principles" :key="`principle-${item}`" tone="neutral">
                {{ item }}
              </UiBadge>
            </div>

            <UiSeparator />

            <div class="alter-chip-list">
              <UiBadge v-for="item in activeAlter.reflexes" :key="`reflex-${item}`" tone="accent">
                {{ item }}
              </UiBadge>
            </div>
          </UiPanel>

          <UiPanel tone="default" class-name="alter-card">
            <div class="alter-section-head">
              <div>
                <p class="alter-section-kicker">Versioning</p>
                <h3>Revision history</h3>
              </div>
            </div>

            <div class="alter-revision-list">
              <button
                v-for="item in revisions"
                :key="item.revision_id"
                type="button"
                class="alter-revision-item"
                @click="void manager.openRevision(item.revision_id)"
              >
                <strong>{{ new Date(item.created_at_ms).toLocaleString() }}</strong>
                <span>{{ item.reason || 'saved snapshot' }}</span>
              </button>
            </div>

            <div v-if="previewRevision" class="alter-revision-preview">
              <p class="alter-section-kicker">Snapshot</p>
              <strong>{{ activeRevisionLabel }}</strong>
              <pre v-if="previewRevisionPrompt" class="alter-pre">{{ previewRevisionPrompt }}</pre>
              <p v-else class="alter-empty">Revision snapshot unavailable.</p>
            </div>
          </UiPanel>
        </section>

      </template>

      <UiPanel v-else tone="raised" class-name="alter-empty-main">
        <p class="alter-kicker">No active Alter</p>
        <h2>Select or create one</h2>
        <p class="alter-empty-main__copy">
          Alters belong to the workspace and stay visible here instead of hiding in Settings.
        </p>
        <div class="alter-card-actions">
          <UiButton size="sm" variant="secondary" @click="openQuickStart()">
            <template #leading>
              <SparklesIcon class="alter-step-button__icon" />
            </template>
            Quick Start
          </UiButton>
          <UiButton size="sm" variant="primary" @click="manager.openCreateWizard()">Create Alter</UiButton>
        </div>
      </UiPanel>
    </main>

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

            <UiField label="Color" for-id="alter-color" help="Used as a quick visual accent.">
              <template #default="{ describedBy }">
                <UiInput
                  id="alter-color"
                  :model-value="draft.color ?? ''"
                  :aria-describedby="describedBy"
                  placeholder="#8d6e63"
                  @update:modelValue="draft.color = $event"
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
.alter-manager {
  display: grid;
  grid-template-columns: 20rem minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  gap: 0.75rem;
  padding: 0.75rem;
  overflow: auto;
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--accent-soft) 24%, transparent), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--surface-muted) 40%, var(--surface-bg)), var(--surface-bg));
}

.alter-sidebar,
.alter-main {
  min-width: 0;
  min-height: 0;
}

.alter-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  overflow: auto;
  padding-right: 0.15rem;
}

.alter-sidebar__panel,
.alter-sidebar__list-panel,
.alter-hero,
.alter-card,
.alter-empty-main {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.alter-sidebar__head,
.alter-section-head,
.alter-hero,
.alter-hero__actions,
.alter-card-actions,
.alter-revision-item,
.alter-wizard__footer {
  display: flex;
  gap: 0.5rem;
}

.alter-sidebar__head,
.alter-section-head,
.alter-hero,
.alter-wizard__footer {
  justify-content: space-between;
  align-items: flex-start;
}

.alter-sidebar__title,
.alter-hero h1,
.alter-empty-main h2,
.alter-wizard__intro h3 {
  margin: 0;
}

.alter-sidebar__title {
  font-size: 0.92rem;
  line-height: 1.15;
  font-weight: 600;
}

.alter-kicker,
.alter-section-kicker {
  margin: 0 0 0.2rem;
  font-size: 0.64rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.alter-sidebar__copy,
.alter-hero__copy,
.alter-card__copy,
.alter-empty-main__copy,
.alter-wizard__intro p {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.3;
  font-size: 0.84rem;
}

.alter-sidebar__meta,
.alter-hero__meta,
.alter-chip-list,
.alter-checkbox-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.alter-section-count {
  color: var(--text-dim);
  font-size: 0.76rem;
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
  padding: 0.7rem 0.8rem;
  text-align: left;
  transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
}

.alter-list-item:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--panel-border));
  background: color-mix(in srgb, var(--accent-soft) 26%, var(--panel-bg));
  transform: translateY(-1px);
}

.alter-list-item--active {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--panel-border));
  background: color-mix(in srgb, var(--accent-soft) 34%, var(--panel-bg));
}

.alter-list-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.alter-list-item p {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.35;
  font-size: 0.84rem;
}

.alter-main {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  overflow: auto;
  padding-right: 0.15rem;
}

.alter-hero__body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.alter-hero h1 {
  font-size: 1.15rem;
  line-height: 1.1;
}

.alter-hero__actions,
.alter-card-actions {
  flex-wrap: wrap;
  align-items: center;
}

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

.alter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.alter-pre {
  margin: 0;
  padding: 0.7rem 0.8rem;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface-muted) 84%, var(--panel-bg));
  color: var(--text-base);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.45;
  font-size: 0.8rem;
}

.alter-pre--scrollable {
  max-height: 16rem;
  overflow: auto;
}

.alter-revision-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.alter-revision-item {
  justify-content: space-between;
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface-muted) 55%, var(--panel-bg));
  padding: 0.65rem 0.75rem;
  text-align: left;
}

.alter-revision-item span {
  color: var(--text-muted);
}

.alter-revision-preview {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

:deep(.alter-compiled-prompt-modal) {
  max-width: min(72rem, calc(100vw - 2rem));
}

.alter-pre--modal {
  max-height: min(70vh, 42rem);
  overflow: auto;
}

.alter-empty,
.alter-error {
  border-radius: var(--radius-lg);
  padding: 0.8rem;
}

.alter-empty {
  background: color-mix(in srgb, var(--surface-muted) 60%, transparent);
  color: var(--text-muted);
}

.alter-error {
  border: 1px solid var(--badge-danger-bg);
  background: color-mix(in srgb, var(--badge-danger-bg) 20%, transparent);
  color: var(--badge-danger-text);
}

.alter-empty-main {
  align-items: flex-start;
  justify-content: center;
  min-height: 18rem;
}

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

.alter-sidebar :deep(.ui-panel),
.alter-main :deep(.ui-panel) {
  padding: 0.85rem;
}

.alter-sidebar strong,
.alter-main strong,
.alter-main h3,
.alter-sidebar h3 {
  line-height: 1.2;
  font-size: 0.88rem;
}

@media (max-width: 1180px) {
  .alter-manager,
  .alter-wizard,
  .alter-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .alter-manager {
    padding: 0.75rem;
  }

  .alter-form-grid,
  .alter-range-grid {
    grid-template-columns: 1fr;
  }
}
</style>
