<script setup lang="ts">
/**
 * Sidebar controls and context cards for Cosmos graph exploration.
 *
 * The component owns panel layout/scroll behavior while remaining stateless
 * regarding graph business logic.
 */
import { computed, nextTick, ref } from 'vue'
import type { CosmosGraphNode } from '../../lib/graphIndex'
import { XMarkIcon, MapPinIcon } from '@heroicons/vue/24/outline'
import { applySearchMode, detectSearchMode, type SearchMode } from '../../lib/searchMode'

type GraphSummary = {
  nodes: number
  edges: number
}

const props = defineProps<{
  summary: GraphSummary
  query: string
  matches: CosmosGraphNode[]
  focusMode: boolean
  focusDepth: number
  showSemanticEdges: boolean
  selectedNode: CosmosGraphNode | null
  selectedLinkCount: number
  preview: string
  previewLoading: boolean
  previewError: string
  outgoingNodes: CosmosGraphNode[]
  incomingNodes: CosmosGraphNode[]
  loading: boolean
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  'search-enter': []
  'select-match': [nodeId: string]
  'toggle-focus-mode': [value: boolean]
  'toggle-semantic-edges': [value: boolean]
  'expand-neighborhood': []
  'jump-related': [nodeId: string]
  'open-selected': []
  'locate-selected': []
  'reset-view': []
}>()

const searchInputEl = ref<HTMLInputElement | null>(null)
const activeSearchMode = computed<SearchMode>(() => detectSearchMode(props.query))
const searchModeOptions: Array<{ mode: SearchMode; label: string }> = [
  { mode: 'hybrid', label: 'Hybrid' },
  { mode: 'semantic', label: 'Semantic' },
  { mode: 'lexical', label: 'Lexical' }
]

/** Emits query updates without mutating parent-owned state directly. */
function onQueryInput(event: Event) {
  const target = event.target as HTMLInputElement | null
  emit('update:query', target?.value ?? '')
}

/** Emits focus mode checkbox state for parent-side controller updates. */
function onFocusModeChange(event: Event) {
  const target = event.target as HTMLInputElement | null
  emit('toggle-focus-mode', Boolean(target?.checked))
}

function onSemanticEdgesChange(event: Event) {
  const target = event.target as HTMLInputElement | null
  emit('toggle-semantic-edges', Boolean(target?.checked))
}

/** Clears the search query and keeps keyboard focus in the input. */
function onClearQuery() {
  emit('update:query', '')
  searchInputEl.value?.focus()
}

function onSearchModeSelect(mode: SearchMode) {
  const next = applySearchMode(props.query, mode)
  emit('update:query', next.value)
  void nextTick(() => {
    const input = searchInputEl.value
    if (!input) return
    input.focus()
    input.setSelectionRange(next.caret, next.caret)
  })
}
</script>

<template>
  <section class="cosmos-sidebar-panel">
    <div class="cosmos-panel-controls">
      <p class="cosmos-panel-meta">{{ summary.nodes }} nodes · {{ summary.edges }} edges</p>
      <p class="cosmos-panel-help">Click a node to select it. Double-click to focus. Drag to pan, scroll to zoom, Esc to return.</p>
      <div class="cosmos-search-wrap">
        <input
          ref="searchInputEl"
          :value="query"
          class="cosmos-search-input"
          type="text"
          placeholder="Search node path..."
          autocomplete="new-password"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          @input="onQueryInput"
          @keydown.enter.prevent="emit('search-enter')"
        >
        <button
          v-if="query.trim()"
          type="button"
          class="cosmos-search-clear-btn"
          aria-label="Clear search"
          title="Clear search"
          @click="onClearQuery"
        >
          <XMarkIcon />
        </button>
      </div>
      <div class="cosmos-search-modes">
        <button
          v-for="option in searchModeOptions"
          :key="option.mode"
          type="button"
          class="cosmos-search-mode-chip"
          :class="{ active: activeSearchMode === option.mode }"
          @click="onSearchModeSelect(option.mode)"
        >
          {{ option.label }}
        </button>
      </div>
      <p class="cosmos-search-hint">Hint: <code>semantic:</code> concept | <code>lexical:</code> exact term</p>
      <div v-if="query.trim()" class="cosmos-match-list">
        <button
          v-for="match in matches"
          :key="match.id"
          type="button"
          class="cosmos-match-item"
          @click="emit('select-match', match.id)"
        >
          {{ match.label }}
        </button>
        <p v-if="!matches.length" class="cosmos-match-empty">No matches.</p>
      </div>
      <button
        type="button"
        class="cosmos-reset-btn"
        :disabled="loading || !summary.nodes"
        @click="emit('reset-view')"
      >
        Reset view
      </button>
    </div>

    <div class="cosmos-panel-content">
      <div class="cosmos-focus-controls">
        <label class="cosmos-toggle">
          <input :checked="focusMode" :disabled="!selectedNode" type="checkbox" @change="onFocusModeChange">
          <span>Focus mode (selected + neighbors)</span>
        </label>
        <label class="cosmos-toggle">
          <input :checked="showSemanticEdges" type="checkbox" @change="onSemanticEdgesChange">
          <span>Show semantic links</span>
        </label>
        <p v-if="focusMode && selectedNode" class="cosmos-focus-depth">Depth: {{ focusDepth }}</p>
        <button
          type="button"
          class="cosmos-reset-btn"
          :disabled="!selectedNode"
          @click="emit('expand-neighborhood')"
        >
          Expand neighborhood
        </button>
      </div>

      <div v-if="selectedNode" class="cosmos-node-stats">
        <div class="cosmos-node-head">
          <button type="button" class="cosmos-node-title-link" @click="emit('open-selected')">
            {{ selectedNode.displayLabel || selectedNode.label }}
          </button>
          <button type="button" class="cosmos-locate-btn" title="Locate selected node" aria-label="Locate selected node" @click="emit('locate-selected')">
            <MapPinIcon />
          </button>
        </div>
        <p class="cosmos-node-meta">Degree: {{ selectedNode.degree }} · Cluster: {{ selectedNode.cluster }}</p>
        <p class="cosmos-node-meta">Visible links: {{ selectedLinkCount }}</p>
        <p v-if="previewLoading" class="cosmos-node-preview">Loading preview...</p>
        <p v-else-if="previewError" class="cosmos-node-preview cosmos-node-preview-error">{{ previewError }}</p>
        <pre v-else class="cosmos-node-preview">{{ preview || 'No preview content.' }}</pre>
      </div>

      <div v-if="selectedNode" class="cosmos-links-card">
        <p class="cosmos-links-title">From this note ({{ outgoingNodes.length }})</p>
        <div v-if="!outgoingNodes.length" class="cosmos-links-empty">No outgoing links.</div>
        <div v-else class="cosmos-links-list">
          <button
            v-for="node in outgoingNodes"
            :key="`out-${node.id}`"
            type="button"
            class="cosmos-links-item"
            @click="emit('jump-related', node.id)"
          >
            {{ node.label }}
          </button>
        </div>

        <p class="cosmos-links-title">Backlinks ({{ incomingNodes.length }})</p>
        <div v-if="!incomingNodes.length" class="cosmos-links-empty">No backlinks.</div>
        <div v-else class="cosmos-links-list">
          <button
            v-for="node in incomingNodes"
            :key="`in-${node.id}`"
            type="button"
            class="cosmos-links-item"
            @click="emit('jump-related', node.id)"
          >
            {{ node.label }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cosmos-sidebar-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  background: var(--cosmos-panel-bg);
  color: var(--cosmos-text-primary);
}

.cosmos-panel-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--cosmos-panel-bg);
  padding: 8px 4px 4px;
  position: sticky;
  top: 0;
  z-index: 1;
}

.cosmos-panel-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 4px 8px;
}

.cosmos-focus-controls {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cosmos-panel-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--cosmos-text-primary);
}

.cosmos-panel-meta {
  margin: 0;
  color: var(--cosmos-text-secondary);
  font-size: 12px;
}

.cosmos-panel-help {
  margin: 0;
  color: var(--cosmos-text-muted);
  font-size: 12px;
  line-height: 1.4;
}

.cosmos-search-input {
  width: 100%;
  height: 30px;
  border: 1px solid var(--cosmos-border);
  border-radius: 8px;
  padding: 0 8px;
  font-size: 12px;
  background: var(--cosmos-input-bg);
  color: var(--cosmos-input-text);
}

.cosmos-search-wrap {
  position: relative;
}

.cosmos-search-wrap .cosmos-search-input {
  padding-right: 30px;
}

.cosmos-search-clear-btn {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--cosmos-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.cosmos-search-clear-btn:hover {
  background: rgb(148 163 184 / 14%);
  color: var(--cosmos-text-secondary);
}

.cosmos-search-clear-btn :deep(svg) {
  width: 12px;
  height: 12px;
}

.cosmos-search-input::placeholder {
  color: var(--cosmos-text-muted);
}

.cosmos-search-modes {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.cosmos-search-mode-chip {
  border: 1px solid var(--cosmos-border);
  border-radius: 999px;
  background: var(--cosmos-input-bg);
  color: var(--cosmos-text-secondary);
  padding: 2px 8px;
  font-size: 10px;
  line-height: 1.4;
}

.cosmos-search-mode-chip.active {
  border-color: var(--cosmos-link-accent);
  color: var(--cosmos-link-accent);
  background: var(--cosmos-chip-active-bg);
}

.cosmos-search-hint {
  margin: -2px 0 0;
  color: var(--cosmos-text-muted);
  font-size: 10px;
}

.cosmos-search-hint code {
  font-family: var(--font-code);
  font-size: inherit;
}

.cosmos-match-list {
  max-height: 132px;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cosmos-match-item {
  border: 0;
  background: var(--cosmos-card-bg);
  color: var(--cosmos-text-primary);
  border-radius: 6px;
  padding: 4px 6px;
  text-align: left;
  font-size: 11px;
}

.cosmos-match-item:hover {
  background: var(--cosmos-button-hover);
}

.cosmos-match-empty {
  margin: 0;
  font-size: 11px;
  color: var(--cosmos-text-muted);
}

.cosmos-toggle {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: var(--cosmos-text-secondary);
}

.cosmos-focus-depth {
  margin: 0;
  font-size: 11px;
  color: var(--cosmos-text-muted);
}

.cosmos-reset-btn {
  border: 1px solid var(--cosmos-border);
  background: var(--cosmos-button-bg);
  color: var(--cosmos-text-primary);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 10px;
}

.cosmos-reset-btn:hover:not(:disabled) {
  background: var(--cosmos-button-hover);
}

.cosmos-reset-btn:disabled {
  opacity: 0.55;
}

.cosmos-node-stats {
  padding: 8px;
  border-radius: 8px;
  background: var(--cosmos-card-bg);
  display: flex;
  flex-direction: column;
}

.cosmos-node-title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--cosmos-text-primary);
}

.cosmos-node-title-link {
  border: 0;
  background: transparent;
  margin: 0;
  padding: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--cosmos-link-accent);
  text-align: left;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.cosmos-node-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cosmos-locate-btn {
  border: 1px solid var(--cosmos-border);
  background: var(--cosmos-button-bg);
  color: var(--cosmos-text-secondary);
  border-radius: 999px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.cosmos-locate-btn:hover {
  background: var(--cosmos-button-hover);
  color: var(--cosmos-text-primary);
}

.cosmos-locate-btn :deep(svg) {
  width: 14px;
  height: 14px;
}

.cosmos-node-path,
.cosmos-node-meta {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--cosmos-text-secondary);
}

.cosmos-node-preview {
  margin: 8px 0 0;
  white-space: pre-wrap;
  font-size: 11px;
  line-height: 1.35;
  color: var(--cosmos-text-primary);
  min-height: calc(10 * 1.35em + 20px);
  max-height: calc(10 * 1.35em + 20px);
  overflow: auto;
  flex: 0 0 auto;
  background: var(--cosmos-preview-bg);
  border-radius: 6px;
  padding: 10px;
}

.cosmos-node-preview-error {
  color: var(--cosmos-error);
}

.cosmos-links-card {
  padding: 8px;
  border-radius: 8px;
  background: var(--cosmos-card-bg);
}

.cosmos-links-title {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--cosmos-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.cosmos-links-empty {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--cosmos-text-secondary);
}

.cosmos-links-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 140px;
  overflow: auto;
  margin-bottom: 8px;
}

.cosmos-links-item {
  border: 0;
  border-radius: 6px;
  text-align: left;
  font-size: 11px;
  color: var(--cosmos-text-primary);
  background: var(--cosmos-chip-bg);
  padding: 4px 6px;
}

.cosmos-links-item:hover {
  background: var(--cosmos-button-hover);
}
</style>
