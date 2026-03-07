<script setup lang="ts">
import { computed } from 'vue'
import type { PulseActionSpec, PulseApplyMode } from '../lib/pulse'
import { PULSE_APPLY_LABELS } from '../lib/pulse'

const props = defineProps<{
  title: string
  sourceLabel: string
  actionId: string
  actions: PulseActionSpec[]
  instruction: string
  previewMarkdown: string
  provenancePaths: string[]
  running: boolean
  error: string
  applyModes: PulseApplyMode[]
}>()

const emit = defineEmits<{
  'update:actionId': [value: string]
  'update:instruction': [value: string]
  run: []
  cancel: []
  close: []
  apply: [mode: PulseApplyMode]
}>()

const canRun = computed(() => Boolean(props.actionId))
const hasPreview = computed(() => props.previewMarkdown.trim().length > 0)
</script>

<template>
  <section class="pulse-panel">
    <header class="pulse-panel-head">
      <div>
        <h3>{{ title }}</h3>
        <p>{{ sourceLabel }}</p>
      </div>
      <button type="button" class="pulse-close-btn" @click="emit('close')">Close</button>
    </header>

    <label class="pulse-field">
      <span>Action</span>
      <select
        class="pulse-select"
        :value="actionId"
        @change="emit('update:actionId', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="action in actions" :key="action.id" :value="action.id">
          {{ action.label }}
        </option>
      </select>
    </label>

    <p v-if="actions.length" class="pulse-help">
      {{ actions.find((item) => item.id === actionId)?.description }}
    </p>

    <label class="pulse-field">
      <span>Instruction</span>
      <textarea
        class="pulse-textarea"
        :value="instruction"
        placeholder="Optional guidance for Pulse..."
        @input="emit('update:instruction', ($event.target as HTMLTextAreaElement).value)"
      ></textarea>
    </label>

    <div class="pulse-actions">
      <button type="button" class="pulse-btn pulse-btn-strong" :disabled="running || !canRun" @click="emit('run')">
        {{ running ? 'Generating...' : 'Generate preview' }}
      </button>
      <button v-if="running" type="button" class="pulse-btn" @click="emit('cancel')">Stop</button>
    </div>

    <p v-if="error" class="pulse-error">{{ error }}</p>

    <div class="pulse-preview">
      <div class="pulse-preview-head">
        <strong>Preview</strong>
        <span v-if="provenancePaths.length">{{ provenancePaths.length }} sources</span>
      </div>
      <pre>{{ previewMarkdown || 'No preview yet.' }}</pre>
    </div>

    <div v-if="provenancePaths.length" class="pulse-provenance">
      <strong>Sources</strong>
      <ul>
        <li v-for="path in provenancePaths" :key="path">{{ path }}</li>
      </ul>
    </div>

    <div class="pulse-apply">
      <button
        v-for="mode in applyModes"
        :key="mode"
        type="button"
        class="pulse-btn"
        :disabled="!hasPreview"
        @click="emit('apply', mode)"
      >
        {{ PULSE_APPLY_LABELS[mode] }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.pulse-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--surface-raised, var(--surface-bg));
  color: var(--text-primary);
  padding: 12px;
}

.pulse-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.pulse-panel-head h3,
.pulse-panel-head p {
  margin: 0;
}

.pulse-panel-head p,
.pulse-help,
.pulse-error,
.pulse-preview-head span {
  font-size: 12px;
  color: var(--text-dim);
}

.pulse-close-btn,
.pulse-btn,
.pulse-select,
.pulse-textarea {
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--surface-bg);
  color: var(--text-primary);
}

.pulse-close-btn,
.pulse-btn {
  padding: 7px 10px;
}

.pulse-btn-strong {
  background: color-mix(in srgb, var(--accent, #4f7a5d) 20%, var(--surface-bg));
}

.pulse-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pulse-select,
.pulse-textarea {
  width: 100%;
  padding: 8px 10px;
}

.pulse-textarea {
  min-height: 72px;
  resize: vertical;
}

.pulse-actions,
.pulse-apply {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pulse-preview {
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--surface-bg);
  overflow: hidden;
}

.pulse-preview-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px 0;
}

.pulse-preview pre {
  margin: 0;
  padding: 10px;
  white-space: pre-wrap;
  font-size: 12px;
  max-height: 220px;
  overflow: auto;
}

.pulse-provenance ul {
  margin: 6px 0 0;
  padding-left: 18px;
}

.pulse-error {
  color: var(--danger-text, #b91c1c);
}
</style>
