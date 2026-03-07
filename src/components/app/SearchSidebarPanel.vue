<script setup lang="ts">
import type { SearchMode } from '../../lib/searchMode'

/**
 * SearchSidebarPanel
 *
 * Purpose:
 * - Render the search sidebar controls and grouped search results.
 */

type SearchHit = { path: string; snippet: string; score: number }
type SearchResultGroup = { path: string; items: SearchHit[] }

defineProps<{
  disabled: boolean
  query: string
  mode: SearchMode
  modeOptions: Array<{ mode: SearchMode; label: string }>
  showSearchScore: boolean
  hasSearched: boolean
  searchLoading: boolean
  groupedResults: SearchResultGroup[]
  toRelativePath: (path: string) => string
  formatSearchScore: (value: number) => string
  snippetParts: (snippet: string) => Array<{ text: string; highlighted: boolean }>
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  enter: []
  'select-mode': [mode: SearchMode]
  'open-result': [hit: SearchHit]
}>()
</script>

<template>
  <div class="panel-fill search-panel">
    <div class="search-controls">
      <input
        :value="query"
        data-search-input="true"
        :disabled="disabled"
        class="tool-input"
        placeholder="Search content (e.g. tags:dev has:deadline deadline>=2026-03-01)"
        @input="emit('update:query', ($event.target as HTMLInputElement).value)"
        @keydown.enter.prevent="emit('enter')"
      />
    </div>
    <div class="search-mode-controls">
      <button
        v-for="option in modeOptions"
        :key="option.mode"
        type="button"
        class="search-mode-chip"
        :class="{ active: mode === option.mode }"
        :disabled="disabled"
        @click="emit('select-mode', option.mode)"
      >
        {{ option.label }}
      </button>
    </div>
    <p class="search-mode-hint">Hint: <code>semantic:</code> concept | <code>lexical:</code> exact term</p>

    <div class="results-list">
      <div v-if="hasSearched && !searchLoading && !groupedResults.length" class="placeholder">No results</div>
      <section v-for="group in groupedResults" :key="group.path" class="result-group">
        <h3 class="result-file">{{ toRelativePath(group.path) }}</h3>
        <button
          v-for="item in group.items"
          :key="`${group.path}-${item.score}-${item.snippet}`"
          type="button"
          class="result-item"
          @click="emit('open-result', item)"
        >
          <p v-if="showSearchScore" class="result-score">score: {{ formatSearchScore(item.score) }}</p>
          <div class="result-snippet">
            <template v-for="(part, idx) in snippetParts(item.snippet)" :key="`${idx}-${part.text}`">
              <strong v-if="part.highlighted">{{ part.text }}</strong>
              <span v-else>{{ part.text }}</span>
            </template>
          </div>
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.search-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-controls {
  display: flex;
  gap: 6px;
}

.search-mode-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.search-mode-chip {
  border: 1px solid var(--search-chip-border);
  border-radius: 999px;
  background: var(--search-chip-bg);
  color: var(--search-chip-text);
  padding: 2px 9px;
  font-size: var(--font-size-xs);
  line-height: 1.4;
}

.search-mode-chip.active {
  border-color: var(--search-chip-active-border);
  color: var(--search-chip-active-text);
  background: var(--search-chip-active-bg);
}

.search-mode-chip:disabled {
  opacity: 0.5;
}

.search-mode-hint {
  margin: -2px 0 0;
  font-size: var(--font-size-xs);
  color: var(--text-dim);
}

.search-mode-hint code {
  font-family: var(--font-code);
  font-size: inherit;
}

.results-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.result-group {
  margin-bottom: 12px;
}

.result-file {
  margin: 0 0 4px;
  font-size: var(--font-size-sm);
  color: var(--search-result-title);
}

.result-item {
  width: 100%;
  text-align: left;
  border: 1px solid var(--search-result-border);
  background: var(--search-result-bg);
  border-radius: 4px;
  padding: 6px;
  margin-bottom: 6px;
  font-size: var(--font-size-md);
  color: var(--text-main);
}

.result-score {
  margin: 0 0 4px;
  font-size: var(--font-size-xs);
  color: var(--search-result-score);
  font-family: var(--font-code);
}

.result-snippet :deep(strong) {
  font-weight: 700;
}
</style>
