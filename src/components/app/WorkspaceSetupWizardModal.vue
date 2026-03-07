<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import UiButton from '../ui/UiButton.vue'
import {
  buildWorkspaceSetupPlan,
  recommendedOptionsForUseCase,
  type WorkspaceSetupOption,
  type WorkspaceSetupUseCase
} from '../../lib/workspaceSetupWizard'

const props = defineProps<{
  visible: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  cancel: []
  submit: [payload: { useCase: WorkspaceSetupUseCase; options: WorkspaceSetupOption[] }]
}>()

const step = ref(0)
const useCase = ref<WorkspaceSetupUseCase>('knowledge-base')
const selectedOptions = ref<WorkspaceSetupOption[]>(recommendedOptionsForUseCase('knowledge-base'))

watch(() => props.visible, (visible) => {
  if (!visible) return
  step.value = 0
  useCase.value = 'knowledge-base'
  selectedOptions.value = recommendedOptionsForUseCase('knowledge-base')
})

watch(useCase, (next) => {
  selectedOptions.value = recommendedOptionsForUseCase(next)
})

const plan = computed(() => buildWorkspaceSetupPlan(useCase.value, selectedOptions.value))

function toggleOption(option: WorkspaceSetupOption) {
  if (selectedOptions.value.includes(option)) {
    selectedOptions.value = selectedOptions.value.filter((item) => item !== option)
    return
  }
  selectedOptions.value = [...selectedOptions.value, option]
}

function goPrevious() {
  step.value = Math.max(0, step.value - 1)
}

function goNext() {
  step.value = Math.min(2, step.value + 1)
}

function submit() {
  emit('submit', {
    useCase: useCase.value,
    options: [...selectedOptions.value]
  })
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('cancel')">
    <div
      class="modal wizard-modal"
      data-modal="workspace-setup-wizard"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-setup-title"
      tabindex="-1"
    >
      <div class="wizard-head">
        <div>
          <h3 id="workspace-setup-title" class="confirm-title">Setup wizard</h3>
          <p class="confirm-text">Create a lightweight starting structure without locking yourself into a rigid system.</p>
        </div>
        <span class="wizard-step">Step {{ step + 1 }} / 3</span>
      </div>

      <div v-if="step === 0" class="wizard-section">
        <h4>How do you plan to use this workspace?</h4>
        <label class="wizard-choice">
          <input v-model="useCase" type="radio" value="knowledge-base">
          <span>
            <strong>Personal knowledge base</strong>
            <small>Inbox, notes, projects, and daily notes.</small>
          </span>
        </label>
        <label class="wizard-choice">
          <input v-model="useCase" type="radio" value="journal">
          <span>
            <strong>Daily notes / journal</strong>
            <small>Daily and monthly structure for reflection and logs.</small>
          </span>
        </label>
        <label class="wizard-choice">
          <input v-model="useCase" type="radio" value="projects">
          <span>
            <strong>Projects and research</strong>
            <small>Projects, sources, and notes for focused work.</small>
          </span>
        </label>
      </div>

      <div v-else-if="step === 1" class="wizard-section">
        <h4>What would you like to start with?</h4>
        <label class="wizard-choice">
          <input
            :checked="selectedOptions.includes('daily-notes')"
            type="checkbox"
            @change="toggleOption('daily-notes')"
          >
          <span><strong>Daily notes</strong><small>Create `Daily/` and `Monthly/`.</small></span>
        </label>
        <label class="wizard-choice">
          <input
            :checked="selectedOptions.includes('inbox')"
            type="checkbox"
            @change="toggleOption('inbox')"
          >
          <span><strong>Inbox</strong><small>Add an `Inbox/` folder and a quick capture entry point.</small></span>
        </label>
        <label class="wizard-choice">
          <input
            :checked="selectedOptions.includes('projects-folder')"
            type="checkbox"
            @change="toggleOption('projects-folder')"
          >
          <span><strong>Projects folder</strong><small>Create `Projects/`.</small></span>
        </label>
        <label class="wizard-choice">
          <input
            :checked="selectedOptions.includes('areas-folder')"
            type="checkbox"
            @change="toggleOption('areas-folder')"
          >
          <span><strong>Areas folder</strong><small>Create `Areas/` for long-lived topics.</small></span>
        </label>
        <label class="wizard-choice">
          <input
            :checked="selectedOptions.includes('references-folder')"
            type="checkbox"
            @change="toggleOption('references-folder')"
          >
          <span><strong>References folder</strong><small>Create `References/` and `Sources/`.</small></span>
        </label>
      </div>

      <div v-else class="wizard-section">
        <h4>Review setup</h4>
        <p class="confirm-text">The wizard will create the following folders and empty notes.</p>
        <div class="wizard-review-list">
          <div v-for="entry in plan" :key="`${entry.kind}:${entry.path}`" class="wizard-review-item">
            <strong>{{ entry.kind === 'folder' ? 'Folder' : 'Note' }}</strong>
            <span>{{ entry.path }}</span>
          </div>
        </div>
      </div>

      <div class="confirm-actions">
        <UiButton size="sm" variant="ghost" :disabled="busy" @click="emit('cancel')">Cancel</UiButton>
        <UiButton v-if="step > 0" size="sm" variant="ghost" :disabled="busy" @click="goPrevious">Back</UiButton>
        <UiButton v-if="step < 2" size="sm" :disabled="busy" @click="goNext">Next</UiButton>
        <UiButton v-else size="sm" variant="primary" :disabled="busy" @click="submit">Create setup</UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wizard-modal {
  width: min(760px, calc(100vw - 32px));
  max-height: calc(100vh - 88px);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wizard-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.wizard-step {
  flex: 0 0 auto;
  align-self: flex-start;
  border: 1px solid var(--button-secondary-border);
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-dim);
}

.wizard-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
}

.wizard-section h4 {
  margin: 0;
}

.wizard-choice {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: flex-start;
  padding: 12px;
  border: 1px solid var(--button-secondary-border);
  border-radius: 12px;
  background: var(--button-secondary-bg);
}

.wizard-choice strong,
.wizard-review-item strong {
  display: block;
  color: var(--text-main);
}

.wizard-choice small,
.wizard-review-item span {
  color: var(--text-dim);
}

.wizard-review-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wizard-review-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--button-secondary-border);
  border-radius: 12px;
}
</style>
