<script setup lang="ts">
import UiButton from '../ui/UiButton.vue'

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
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div
      class="modal shortcuts-modal"
      data-modal="shortcuts"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      aria-describedby="shortcuts-description"
      tabindex="-1"
    >
      <h3 id="shortcuts-title" class="confirm-title">Keyboard Shortcuts</h3>
      <p id="shortcuts-description" class="sr-only">Browse and filter keyboard shortcuts.</p>
      <input
        :value="filterQuery"
        data-shortcuts-filter="true"
        class="tool-input shortcuts-filter-input"
        placeholder="Filter shortcuts (ex: zoom, save, Ctrl+P)"
        @input="emit('update:filterQuery', ($event.target as HTMLInputElement).value)"
      />
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
      <div class="confirm-actions">
        <UiButton size="sm" @click="emit('close')">Close</UiButton>
      </div>
    </div>
  </div>
</template>
