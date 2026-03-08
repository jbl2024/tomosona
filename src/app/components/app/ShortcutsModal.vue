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
  max-height: min(740px, calc(100vh - 120px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

.shortcuts-filter-input {
  flex: 0 0 auto;
}

.shortcuts-sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
  margin-top: 2px;
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
  padding-right: 4px;
}

.shortcuts-section {
  border: 1px solid var(--shortcuts-section-border);
  border-radius: 8px;
  padding: 10px;
  min-width: 0;
}

.shortcuts-title {
  margin: 0 0 8px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--shortcuts-title);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.shortcuts-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 12px;
  align-items: center;
}

.shortcut-keys {
  font-family: var(--font-code);
  font-size: 0.8rem;
  color: var(--shortcuts-keys-text);
  background: var(--shortcuts-keys-bg);
  border: 1px solid var(--shortcuts-keys-border);
  border-radius: 6px;
  padding: 4px 8px;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  min-height: 2.25rem;
}

.shortcut-action {
  font-size: 0.87rem;
  line-height: 1.3;
  font-weight: 500;
  color: var(--shortcuts-action);
  align-self: center;
}
</style>
