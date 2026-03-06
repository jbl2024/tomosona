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
