<script setup lang="ts">
import UiButton from '../../../shared/components/ui/UiButton.vue'
import UiInput from '../../../shared/components/ui/UiInput.vue'
import UiModalShell from '../../../shared/components/ui/UiModalShell.vue'

/**
 * ShortcutsModal
 *
 * Purpose:
 * - Render filterable keyboard shortcut documentation.
 */

type ShortcutSection = {
  title: string
  items: Array<{ keys: string; action: string }>
}

defineProps<{
  visible: boolean
  filterQuery: string
  sections: ShortcutSection[]
}>()

const emit = defineEmits<{
  close: []
  'update:filterQuery': [value: string]
}>()

function handleVisibilityChange(value: boolean) {
  if (!value) {
    emit('close')
  }
}
</script>

<template>
  <UiModalShell
    :model-value="visible"
    title="Keyboard Shortcuts"
    description="Browse and filter keyboard shortcuts."
    labelledby="shortcuts-title"
    describedby="shortcuts-description"
    width="xl"
    panel-class="shortcuts-modal"
    @update:model-value="handleVisibilityChange"
    @close="emit('close')"
  >
    <UiInput
      :model-value="filterQuery"
      data-shortcuts-filter="true"
      size="sm"
      class-name="shortcuts-filter-input"
      placeholder="Filter shortcuts (ex: zoom, save, Ctrl+P)"
      @update:model-value="emit('update:filterQuery', $event)"
    />
    <div data-modal="shortcuts" class="sr-only" aria-hidden="true"></div>
    <div class="shortcuts-sections">
      <section v-for="section in sections" :key="section.title" class="shortcuts-section">
        <h4 class="shortcuts-title">{{ section.title }}</h4>
        <div class="shortcuts-grid">
          <template v-for="item in section.items" :key="`${section.title}-${item.keys}-${item.action}`">
            <span class="shortcut-keys">{{ item.keys }}</span>
            <span class="shortcut-action">{{ item.action }}</span>
          </template>
        </div>
      </section>
      <div v-if="!sections.length" class="placeholder">No matching shortcuts</div>
    </div>
    <template #footer>
      <UiButton size="sm" variant="ghost" @click="emit('close')">Close</UiButton>
    </template>
  </UiModalShell>
</template>

<style scoped>
.shortcuts-modal {
  max-height: min(680px, calc(100vh - 96px));
}

:global(.ui-modal-shell__panel--xl.shortcuts-modal) {
  max-width: 75rem;
}

.shortcuts-modal :deep(.ui-modal-shell__header),
.shortcuts-modal :deep(.ui-modal-shell__body),
.shortcuts-modal :deep(.ui-modal-shell__footer) {
  padding: 0.75rem 0.875rem;
}

.shortcuts-modal :deep(.ui-modal-shell__header) {
  gap: 0.75rem;
}

.shortcuts-modal :deep(.ui-modal-shell__body) {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.shortcuts-modal :deep(.ui-modal-shell__title) {
  font-size: 0.94rem;
  line-height: 1.2;
}

.shortcuts-modal :deep(.ui-modal-shell__description) {
  font-size: 0.76rem;
  line-height: 1.25;
}

.shortcuts-filter-input {
  flex: 0 0 auto;
}

.shortcuts-sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(275px, 1fr));
  gap: 10px;
  margin-top: 0;
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
  padding-right: 2px;
}

.shortcuts-section {
  border: 1px solid var(--shortcuts-section-border);
  border-radius: 7px;
  padding: 8px;
  min-width: 0;
}

.shortcuts-title {
  margin: 0 0 6px;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--shortcuts-title);
  text-transform: uppercase;
  letter-spacing: 0.045em;
}

.shortcuts-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 10px;
  align-items: center;
}

.shortcut-keys {
  font-family: var(--font-code);
  font-size: 0.72rem;
  color: var(--shortcuts-keys-text);
  background: var(--shortcuts-keys-bg);
  border: 1px solid var(--shortcuts-keys-border);
  border-radius: 5px;
  padding: 3px 7px;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  min-height: 1.9rem;
}

.shortcut-action {
  font-size: 0.78rem;
  line-height: 1.2;
  font-weight: 500;
  color: var(--shortcuts-action);
  align-self: center;
}
</style>
