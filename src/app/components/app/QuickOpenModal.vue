<script setup lang="ts">
import type { PaletteAction, QuickOpenResult } from '../../composables/useAppQuickOpen'

/**
 * QuickOpenModal
 *
 * Purpose:
 * - Render file quick-open and command-palette results.
 *
 * Boundaries:
 * - Stateless presentational component.
 * - Parent owns query state, keyboard handling, and command execution.
 */

defineProps<{
  visible: boolean
  query: string
  isActionMode: boolean
  actionResults: PaletteAction[]
  fileResults: QuickOpenResult[]
  activeIndex: number
}>()

const emit = defineEmits<{
  close: []
  'update:query': [value: string]
  keydown: [event: KeyboardEvent]
  'select-action': [id: string]
  'select-result': [item: QuickOpenResult]
  'set-active-index': [index: number]
}>()
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div
      class="modal quick-open"
      data-modal="quick-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-open-title"
      aria-describedby="quick-open-description"
      tabindex="-1"
    >
      <h3 id="quick-open-title" class="sr-only">Quick open</h3>
      <p id="quick-open-description" class="sr-only">Type a file name, or start with greater-than for actions.</p>
      <input
        :value="query"
        data-quick-open-input="true"
        class="tool-input"
        placeholder="Type file name, or start with > for actions"
        @input="emit('update:query', ($event.target as HTMLInputElement).value)"
        @keydown="emit('keydown', $event)"
      />
      <div class="modal-list">
        <button
          v-for="(item, index) in actionResults"
          :key="item.id"
          type="button"
          class="modal-item"
          :class="{ active: activeIndex === index }"
          @click="emit('select-action', item.id)"
          @mousemove="emit('set-active-index', index)"
        >
          {{ item.label }}
        </button>
        <button
          v-for="(item, index) in fileResults"
          :key="item.kind === 'file' ? item.path : `daily-${item.date}`"
          type="button"
          class="modal-item"
          :class="{ active: activeIndex === index }"
          @click="emit('select-result', item)"
          @mousemove="emit('set-active-index', index)"
        >
          {{ item.label }}
        </button>
        <div v-if="isActionMode && !actionResults.length" class="placeholder">No matching actions</div>
        <div v-else-if="!isActionMode && !fileResults.length" class="placeholder">
          {{ query.trim() ? 'No matching files' : 'Type to search files' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.quick-open {
  border-color: var(--command-palette-border);
  background: var(--command-palette-bg);
}

.modal-list {
  margin-top: 8px;
  max-height: 360px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.modal-item {
  border: 1px solid var(--command-palette-item-border);
  background: var(--command-palette-item-bg);
  border-radius: 4px;
  padding: 6px;
  text-align: left;
  font-size: 12px;
  color: var(--command-palette-item-text);
}

.modal-item.active {
  border-color: var(--command-palette-item-active-border);
  background: var(--command-palette-item-active-bg);
  color: var(--command-palette-item-active-text);
}
</style>
