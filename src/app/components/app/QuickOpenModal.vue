<script setup lang="ts">
import type { PaletteAction, QuickOpenBrowseAction, QuickOpenResult } from '../../composables/useAppQuickOpen'

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
  hasTextQuery: boolean
  actionResults: PaletteAction[]
  recentResults: QuickOpenResult[]
  browseActionResults: QuickOpenBrowseAction[]
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

function quickOpenItemKey(item: QuickOpenResult): string {
  if (item.kind === 'daily') return `daily-${item.date}`
  if (item.kind === 'recent') return `recent-${item.path}`
  return item.path
}
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
        <template v-if="isActionMode">
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
        </template>
        <template v-else-if="hasTextQuery">
          <button
            v-for="(item, index) in fileResults"
            :key="quickOpenItemKey(item)"
            type="button"
            class="modal-item"
            :class="{ active: activeIndex === index }"
            @click="emit('select-result', item)"
            @mousemove="emit('set-active-index', index)"
          >
            {{ item.label }}
          </button>
        </template>
        <template v-else>
          <section v-if="recentResults.length" class="modal-section">
            <p class="modal-section-title">Recent notes</p>
            <button
              v-for="(item, index) in recentResults"
              :key="quickOpenItemKey(item)"
              type="button"
              class="modal-item modal-item-browse"
              :class="{ active: activeIndex === index }"
              @click="emit('select-result', item)"
              @mousemove="emit('set-active-index', index)"
            >
              <span class="modal-item-main">{{ item.label }}</span>
              <span v-if="item.kind === 'recent'" class="modal-item-meta">{{ item.recencyLabel }}</span>
            </button>
          </section>
          <section v-if="browseActionResults.length" class="modal-section">
            <p class="modal-section-title">Quick actions</p>
            <button
              v-for="(item, index) in browseActionResults"
              :key="item.id"
              type="button"
              class="modal-item modal-item-browse"
              :class="{ active: activeIndex === recentResults.length + index }"
              @click="emit('select-action', item.id)"
              @mousemove="emit('set-active-index', recentResults.length + index)"
            >
              <span class="modal-item-main">{{ item.label }}</span>
            </button>
          </section>
        </template>
        <div v-if="isActionMode && !actionResults.length" class="placeholder">No matching actions</div>
        <div v-else-if="hasTextQuery && !fileResults.length" class="placeholder">No matching files</div>
        <div v-else-if="!isActionMode && !hasTextQuery && !recentResults.length && !browseActionResults.length" class="placeholder">
          No recent notes yet
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

.modal-item-browse {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.modal-item.active {
  border-color: var(--command-palette-item-active-border);
  background: var(--command-palette-item-active-bg);
  color: var(--command-palette-item-active-text);
}

.modal-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.modal-section + .modal-section {
  margin-top: 8px;
}

.modal-section-title {
  margin: 4px 2px 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.modal-item-main {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-item-meta {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-dim);
}
</style>
