<script setup lang="ts">
import { computed, ref } from 'vue'
import { ExclamationTriangleIcon, LockClosedIcon, StarIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import type { FavoriteEntry } from '../../../shared/api/apiTypes'
import UiInput from '../../../shared/components/ui/UiInput.vue'
import { usePageProtectionBadges } from '../../../shared/composables/usePageProtectionBadges'

/**
 * FavoritesListPanel
 *
 * Purpose:
 * - Render a flat favorites list with missing-entry cleanup controls.
 */

const props = defineProps<{
  items: FavoriteEntry[]
  activePath: string
  loading: boolean
  toRelativePath: (path: string) => string
}>()

const emit = defineEmits<{
  open: [path: string]
  remove: [path: string]
}>()

const filterQuery = ref('')
const protectedPaths = usePageProtectionBadges(() => props.items.filter((item) => item.exists).map((item) => item.path))
const filteredItems = computed(() => {
  const query = filterQuery.value.trim().toLowerCase()
  if (!query) return props.items
  return props.items.filter((item) => props.toRelativePath(item.path).toLowerCase().includes(query))
})
</script>

<template>
  <div class="favorites-panel panel-fill">
    <div class="favorites-toolbar">
      <UiInput
        v-model="filterQuery"
        size="sm"
        placeholder="Filter favorites"
        class-name="favorites-filter-input"
      />
    </div>
    <div v-if="loading" class="placeholder">Loading favorites…</div>
    <div v-else-if="!items.length" class="placeholder">
      No favorites yet. Use the command palette to add the active note.
    </div>
    <div v-else-if="!filteredItems.length" class="placeholder">No matching favorites</div>
    <ul v-else class="favorites-list" aria-label="Favorites list">
      <li v-for="item in filteredItems" :key="item.path" class="favorites-row-wrapper">
        <button
          type="button"
          class="favorites-row"
          :class="{
            'favorites-row--active': activePath === item.path,
            'favorites-row--missing': !item.exists
          }"
          :disabled="!item.exists"
          @click="item.exists ? emit('open', item.path) : undefined"
        >
          <span class="favorites-row-indicator" aria-hidden="true"></span>
          <span class="favorites-row-icon" aria-hidden="true">
            <StarIcon v-if="item.exists" />
            <ExclamationTriangleIcon v-else />
          </span>
          <span class="favorites-row-content">
            <span class="favorites-row-label">{{ toRelativePath(item.path) }}</span>
            <span v-if="protectedPaths.has(item.path)" title="Password protected" aria-label="Password protected"><LockClosedIcon class="h-4 w-4" /></span>
            <span v-if="!item.exists" class="favorites-row-meta">Missing</span>
          </span>
        </button>
        <button
          v-if="!item.exists"
          type="button"
          class="favorites-row-remove"
          :aria-label="`Remove favorite ${toRelativePath(item.path)}`"
          @click="emit('remove', item.path)"
        >
          <XMarkIcon />
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.favorites-panel {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.favorites-toolbar {
  padding: 0 0 8px;
}

.favorites-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: auto;
}

.favorites-row-wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
}

.favorites-row {
  position: relative;
  flex: 1;
  min-width: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--explorer-row-text);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  text-align: left;
  font-size: 13px;
  line-height: 1.35;
}

.favorites-row:hover:not(:disabled) {
  background: var(--explorer-row-hover-bg);
  color: var(--explorer-row-hover-text);
}

.favorites-row:disabled {
  cursor: default;
}

.favorites-row--active {
  background: var(--explorer-row-active-bg);
  color: var(--explorer-row-active-text);
  font-weight: 500;
}

.favorites-row--missing {
  color: var(--text-dim);
  background: color-mix(in srgb, var(--shell-chrome-bg) 92%, var(--danger, #c2410c) 8%);
}

.favorites-row-indicator {
  width: 3px;
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  border-radius: 999px;
  background: transparent;
}

.favorites-row--active .favorites-row-indicator {
  background: var(--explorer-row-indicator);
}

.favorites-row-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
}

.favorites-row-icon :deep(svg) {
  width: 16px;
  height: 16px;
  stroke-width: 1.6;
}

.favorites-row-content {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.favorites-row-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.favorites-row-meta {
  border: 1px solid var(--shell-chrome-border);
  border-radius: 999px;
  padding: 1px 6px;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.favorites-row-remove {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.favorites-row-remove:hover {
  background: var(--explorer-row-hover-bg);
  color: var(--explorer-row-hover-text);
}

.favorites-row-remove :deep(svg) {
  width: 14px;
  height: 14px;
  stroke-width: 1.8;
}

.favorites-filter-input {
  border-radius: 8px;
}
</style>
