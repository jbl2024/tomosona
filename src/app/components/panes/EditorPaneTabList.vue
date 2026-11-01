<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { BookmarkIcon } from '@heroicons/vue/24/outline'
import type { PaneState } from '../../composables/useMultiPaneWorkspaceState'
import { hasHomonym, tabFolder, tabLabel } from './tabLabels'

/**
 * Module: EditorPaneTabList
 *
 * Purpose:
 * - Show every open tab of one pane with its full title, in visual order, so a
 *   crowded strip never hides a document.
 *
 * Boundaries:
 * - Owns only the filter text and the highlighted row.
 * - Emits intents; the shell owns every tab mutation.
 */

const props = defineProps<{
  pane: PaneState
}>()

const emit = defineEmits<{
  'tab-click': [payload: { tabId: string }]
  'tab-close': [payload: { tabId: string }]
  'close-others': [payload: { tabId: string }]
  'close-right': [payload: { tabId: string }]
  'close-unpinned': []
  'close-all': []
  dismiss: []
}>()

const query = ref('')
const activeIndex = ref(0)
const searchRef = ref<HTMLInputElement | null>(null)

const entries = computed(() => {
  const labels = props.pane.openTabs.map((tab) => tabLabel(tab))
  return props.pane.openTabs.map((tab, index) => ({
    id: tab.id,
    label: labels[index],
    folder: hasHomonym(labels[index], labels) ? tabFolder(tab) : '',
    pinned: tab.pinned,
    active: tab.id === props.pane.activeTabId
  }))
})

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return entries.value
  return entries.value.filter((entry) =>
    entry.label.toLowerCase().includes(needle) || entry.folder.toLowerCase().includes(needle)
  )
})

const activeEntry = computed(() => entries.value.find((entry) => entry.active) ?? null)
const canCloseRight = computed(() => {
  const index = entries.value.findIndex((entry) => entry.active)
  return index >= 0 && index < entries.value.length - 1
})
const canCloseOthers = computed(() => entries.value.length > 1)
const canCloseUnpinned = computed(() => entries.value.some((entry) => !entry.pinned))

watch(filtered, () => { activeIndex.value = 0 })

function focusSearch() {
  void nextTick(() => searchRef.value?.focus())
}

function moveHighlight(direction: 'next' | 'previous') {
  const count = filtered.value.length
  if (!count) return
  const step = direction === 'next' ? 1 : -1
  activeIndex.value = (activeIndex.value + step + count) % count
}

function activateHighlighted() {
  const entry = filtered.value[activeIndex.value]
  if (!entry) return
  emit('tab-click', { tabId: entry.id })
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveHighlight('next')
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveHighlight('previous')
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    activateHighlighted()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('dismiss')
  }
}

function closeOthers() {
  const entry = activeEntry.value
  if (!entry) return
  emit('close-others', { tabId: entry.id })
}

function closeRight() {
  const entry = activeEntry.value
  if (!entry) return
  emit('close-right', { tabId: entry.id })
}

focusSearch()
</script>

<template>
  <div class="pane-tab-list" role="dialog" aria-label="Open tabs">
    <input
      ref="searchRef"
      v-model="query"
      type="search"
      class="pane-tab-list-search"
      placeholder="Search a tab…"
      aria-label="Search a tab"
      @keydown="onSearchKeydown"
    >
    <ul class="pane-tab-list-items" role="listbox" aria-label="Open tabs">
      <li v-for="(entry, index) in filtered" :key="entry.id">
        <button
          type="button"
          role="option"
          class="pane-tab-list-item"
          :class="{ active: entry.active, highlighted: index === activeIndex }"
          :aria-selected="entry.active ? 'true' : 'false'"
          :data-tab-id="entry.id"
          @mouseenter="activeIndex = index"
          @click="emit('tab-click', { tabId: entry.id })"
        >
          <span v-if="entry.pinned" class="pane-tab-list-pin" title="Pinned" aria-label="Pinned">
            <BookmarkIcon class="h-4 w-4" />
          </span>
          <span class="pane-tab-list-label">{{ entry.label }}</span>
          <span v-if="entry.folder" class="pane-tab-list-folder">{{ entry.folder }}</span>
        </button>
      </li>
      <li v-if="!filtered.length" class="pane-tab-list-empty">No matching tab</li>
    </ul>
    <div class="pane-tab-list-actions">
      <button type="button" class="pane-tab-list-action" :disabled="!canCloseOthers" @click="closeOthers">
        Close other tabs
      </button>
      <button type="button" class="pane-tab-list-action" :disabled="!canCloseRight" @click="closeRight">
        Close tabs to the right
      </button>
      <button type="button" class="pane-tab-list-action" :disabled="!canCloseUnpinned" @click="emit('close-unpinned')">
        Close all unpinned tabs
      </button>
      <button type="button" class="pane-tab-list-action" :disabled="!entries.length" @click="emit('close-all')">
        Close all tabs
      </button>
    </div>
  </div>
</template>

<style scoped>
.pane-tab-list {
  display: flex;
  flex-direction: column;
  min-width: 260px;
  max-width: 340px;
  padding: 0.35rem;
  gap: 0.3rem;
}

.pane-tab-list-search {
  width: 100%;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--tabbar-action-border);
  border-radius: 4px;
  background: var(--tabbar-action-bg);
  color: var(--tabbar-action-text);
  font-size: 0.78rem;
}

.pane-tab-list-items {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 320px;
  overflow-y: auto;
}

.pane-tab-list-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  padding: 0.22rem 0.4rem;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--tabbar-tab-text);
  font-size: 0.8rem;
  text-align: left;
  cursor: pointer;
}

.pane-tab-list-item.highlighted {
  background: var(--tabbar-action-bg);
}

.pane-tab-list-item.active {
  color: var(--tabbar-tab-text-active);
  font-weight: 600;
}

.pane-tab-list-pin {
  display: inline-flex;
  flex: none;
  opacity: 0.9;
}

.pane-tab-list-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-tab-list-folder {
  flex: none;
  font-size: 0.72rem;
  opacity: 0.65;
}

.pane-tab-list-empty {
  padding: 0.3rem 0.4rem;
  font-size: 0.78rem;
  color: var(--tabbar-empty);
}

.pane-tab-list-actions {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding-top: 0.3rem;
  border-top: 1px solid var(--tabbar-border);
}

.pane-tab-list-action {
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--tabbar-action-text);
  padding: 0.22rem 0.4rem;
  font-size: 0.78rem;
  text-align: left;
  cursor: pointer;
}

.pane-tab-list-action:hover:not(:disabled) {
  background: var(--tabbar-action-bg);
}

.pane-tab-list-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
