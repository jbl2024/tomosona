<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PulseActionSpec, PulseApplyMode } from '../lib/pulse'
import { PULSE_APPLY_LABELS } from '../lib/pulse'
import { ChevronDownIcon } from '@heroicons/vue/24/outline'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../shared/components/ui/UiFilterableDropdown.vue'

const props = defineProps<{
  title?: string
  sourceLabel?: string
  actionId: string
  actions: PulseActionSpec[]
  instruction: string
  previewMarkdown: string
  provenancePaths: string[]
  running: boolean
  error: string
  applyModes: PulseApplyMode[]
  compact?: boolean
}>()

const emit = defineEmits<{
  'update:actionId': [value: string]
  'update:instruction': [value: string]
  run: []
  'quick-run': [value: string]
  cancel: []
  close: []
  apply: [mode: PulseApplyMode]
}>()

const canRun = computed(() => Boolean(props.actionId))
const hasPreview = computed(() => props.previewMarkdown.trim().length > 0)
const activeAction = computed(() => props.actions.find((item) => item.id === props.actionId) ?? props.actions[0])
const compactMenuOpen = ref(false)
const compactQuery = ref('')
const compactActiveIndex = ref(0)
const compactItems = computed<FilterableDropdownItem[]>(() =>
  props.actions.map((action) => ({
    id: action.id,
    label: action.label,
    description: action.description,
    aliases: [action.label, action.description, ...action.keywords]
  }))
)

function compactMatcher(item: FilterableDropdownItem, query: string): boolean {
  const tokens = Array.isArray(item.aliases) ? item.aliases.map((entry) => String(entry).toLowerCase()) : []
  return tokens.some((token) => token.includes(query))
}

function onCompactSelect(item: FilterableDropdownItem) {
  emit('update:actionId', item.id)
  emit('quick-run', item.id)
}
</script>

<template>
  <section class="pulse-panel" :class="{ compact }">
    <header v-if="!compact" class="pulse-panel-head">
      <div>
        <h3 v-if="title">{{ title }}</h3>
        <p v-if="sourceLabel">{{ sourceLabel }}</p>
      </div>
      <button type="button" class="pulse-close-btn" @click="emit('close')">Close</button>
    </header>

    <div v-if="compact" class="pulse-compact-bar">
      <UiFilterableDropdown
        class="pulse-compact-dropdown"
        :items="compactItems"
        :model-value="compactMenuOpen"
        :query="compactQuery"
        :active-index="compactActiveIndex"
        :matcher="compactMatcher"
        :show-filter="true"
        :close-on-select="true"
        :menu-mode="'portal'"
        filter-placeholder="Filter Pulse actions..."
        @open-change="compactMenuOpen = $event"
        @query-change="compactQuery = $event"
        @active-index-change="compactActiveIndex = $event"
        @select="onCompactSelect($event)"
      >
        <template #trigger="{ toggleMenu, activeItem }">
          <button
            type="button"
            class="pulse-compact-trigger"
            :title="activeAction?.description"
            @click="toggleMenu"
          >
            <span>{{ activeItem?.label || activeAction?.label || 'Action' }}</span>
            <ChevronDownIcon class="h-4 w-4" />
          </button>
        </template>
      </UiFilterableDropdown>

      <input
        class="pulse-input"
        :value="instruction"
        type="text"
        placeholder="Ask Pulse..."
        @input="emit('update:instruction', ($event.target as HTMLInputElement).value)"
      >
    </div>

    <label v-else class="pulse-field">
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
      {{ activeAction?.description }}
    </p>

    <label v-if="!compact" class="pulse-field">
      <span>Instruction</span>
      <textarea
        class="pulse-textarea"
        :value="instruction"
        placeholder="Optional guidance for Pulse..."
        @input="emit('update:instruction', ($event.target as HTMLTextAreaElement).value)"
      ></textarea>
    </label>

    <div class="pulse-actions">
      <button v-if="!compact" type="button" class="pulse-btn pulse-btn-strong" :disabled="running || !canRun" @click="emit('run')">
        {{ running ? 'Generating...' : 'Generate preview' }}
      </button>
      <button v-if="running" type="button" class="pulse-btn" @click="emit('cancel')">Stop</button>
    </div>

    <p v-if="error" class="pulse-error">{{ error }}</p>

    <div class="pulse-preview">
      <div v-if="!compact" class="pulse-preview-head">
        <strong>Preview</strong>
        <span v-if="provenancePaths.length">{{ provenancePaths.length }} sources</span>
      </div>
      <pre>{{ previewMarkdown || 'No preview yet.' }}</pre>
    </div>

    <div v-if="provenancePaths.length && !compact" class="pulse-provenance">
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
  border: 1px solid color-mix(in srgb, var(--ui-border) 58%, white 42%);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface-raised, var(--surface-bg)) 90%, transparent);
  color: var(--text-primary);
  padding: 12px;
  backdrop-filter: blur(12px);
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 6%),
    0 22px 52px rgb(15 23 42 / 32%),
    0 10px 22px rgb(15 23 42 / 18%);
}

.pulse-panel.compact {
  gap: 8px;
  padding: 10px;
  border-color: color-mix(in srgb, var(--accent, #4f7a5d) 22%, var(--ui-border));
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 8%),
    0 26px 60px rgb(15 23 42 / 36%),
    0 12px 24px rgb(15 23 42 / 22%);
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
.pulse-input,
.pulse-chip-btn,
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

.pulse-compact-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.pulse-compact-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 148px;
  padding: 7px 10px;
  font-size: 12px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--surface-bg);
  color: var(--text-primary);
  text-align: left;
}

.pulse-input {
  flex: 1 1 160px;
  min-width: 0;
  padding: 8px 10px;
}

.pulse-compact-dropdown :deep(.ui-filterable-dropdown-menu) {
  --ui-dropdown-bg: var(--surface-bg);
  --ui-dropdown-border: var(--ui-border);
  --ui-dropdown-hover: color-mix(in srgb, var(--accent, #4f7a5d) 12%, var(--surface-bg));
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

.pulse-panel.compact .pulse-preview pre {
  font-size: 11px;
  color: var(--text-dim);
}

.pulse-provenance ul {
  margin: 6px 0 0;
  padding-left: 18px;
}

.pulse-error {
  color: var(--danger-text, #b91c1c);
}
</style>
