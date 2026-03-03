<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import CosmosSidebarPanel from './CosmosSidebarPanel.vue'
import CosmosView from './CosmosView.vue'
import type { CosmosGraph, CosmosGraphNode } from '../../lib/graphIndex'

const props = defineProps<{
  graph: CosmosGraph
  loading: boolean
  error?: string
  selectedNodeId: string
  focusMode: boolean
  focusDepth: number
  summary: { nodes: number; edges: number }
  query: string
  matches: CosmosGraphNode[]
  showSemanticEdges: boolean
  selectedNode: CosmosGraphNode | null
  selectedLinkCount: number
  preview: string
  previewLoading: boolean
  previewError: string
  outgoingNodes: CosmosGraphNode[]
  incomingNodes: CosmosGraphNode[]
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
  'select-node': [nodeId: string]
}>()

const panelWidth = ref(320)
const dragState = ref<{ startX: number; startWidth: number } | null>(null)
const cosmosViewRef = ref<{ resetView: () => void; focusNodeById: (nodeId: string) => boolean } | null>(null)

const layoutStyle = computed(() => ({
  gridTemplateColumns: `${panelWidth.value}px 6px minmax(0, 1fr)`
}))

function onResizeStart(event: PointerEvent) {
  event.preventDefault()
  dragState.value = {
    startX: event.clientX,
    startWidth: panelWidth.value
  }
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
}

function onResizeMove(event: PointerEvent) {
  const drag = dragState.value
  if (!drag) return
  const next = drag.startWidth + (event.clientX - drag.startX)
  panelWidth.value = Math.max(240, Math.min(560, next))
}

function onResizeEnd() {
  dragState.value = null
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
})

function resetView() {
  cosmosViewRef.value?.resetView()
}

function focusNodeById(nodeId: string): boolean {
  if (!nodeId.trim()) return false
  return cosmosViewRef.value?.focusNodeById(nodeId) ?? false
}

defineExpose({
  resetView,
  focusNodeById
})
</script>

<template>
  <div class="cosmos-pane-surface" :style="layoutStyle">
    <div class="cosmos-pane-sidebar">
      <CosmosSidebarPanel
        :summary="summary"
        :query="query"
        :matches="matches"
        :focus-mode="focusMode"
        :focus-depth="focusDepth"
        :show-semantic-edges="showSemanticEdges"
        :selected-node="selectedNode"
        :selected-link-count="selectedLinkCount"
        :preview="preview"
        :preview-loading="previewLoading"
        :preview-error="previewError"
        :outgoing-nodes="outgoingNodes"
        :incoming-nodes="incomingNodes"
        :loading="loading"
        @update:query="emit('update:query', $event)"
        @search-enter="emit('search-enter')"
        @select-match="emit('select-match', $event)"
        @toggle-focus-mode="emit('toggle-focus-mode', $event)"
        @toggle-semantic-edges="emit('toggle-semantic-edges', $event)"
        @expand-neighborhood="emit('expand-neighborhood')"
        @jump-related="emit('jump-related', $event)"
        @open-selected="emit('open-selected')"
        @locate-selected="emit('locate-selected')"
        @reset-view="emit('reset-view')"
      />
    </div>

    <div class="cosmos-pane-resizer" @pointerdown="onResizeStart"></div>

    <div class="cosmos-pane-main">
      <CosmosView
        ref="cosmosViewRef"
        :graph="graph"
        :loading="loading"
        :error="error"
        :selected-node-id="selectedNodeId"
        :focus-mode="focusMode"
        :focus-depth="focusDepth"
        @select-node="emit('select-node', $event)"
        @toggle-focus-mode="emit('toggle-focus-mode', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.cosmos-pane-surface {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
}

.cosmos-pane-sidebar,
.cosmos-pane-main {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.cosmos-pane-main {
  background: var(--surface-bg);
}

.cosmos-pane-resizer {
  cursor: col-resize;
  background: transparent;
  position: relative;
}

.cosmos-pane-resizer::after {
  content: '';
  position: absolute;
  left: 2px;
  right: 2px;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--ui-border), transparent 20%);
}

.cosmos-pane-resizer:hover::after {
  background: color-mix(in srgb, var(--accent, #4f7a5d) 55%, transparent 20%);
}
</style>
