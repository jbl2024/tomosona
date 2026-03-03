<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import ExplorerTree from '../explorer/ExplorerTree.vue'
import SecondBrainView from './SecondBrainView.vue'

const props = defineProps<{
  workspacePath: string
  activePath: string
  allWorkspaceFiles: string[]
  requestedSessionId: string
  requestedSessionNonce: number
  requestedContextTogglePath: string
  requestedContextToggleNonce: number
  contextPaths: string[]
}>()

const emit = defineEmits<{
  'open-note': [path: string]
  'context-changed': [paths: string[]]
  'toggle-context': [path: string]
  'error': [message: string]
  'path-renamed': [payload: { from: string; to: string }]
  'request-create': [payload: { parentPath: string; entryKind: 'file' | 'folder' }]
  'select': [paths: string[]]
}>()

const panelWidth = ref(300)
const dragState = ref<{ startX: number; startWidth: number } | null>(null)

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
  panelWidth.value = Math.max(220, Math.min(540, next))
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
</script>

<template>
  <div class="sb-pane-surface" :style="layoutStyle">
    <div class="sb-pane-sidebar">
      <ExplorerTree
        v-if="workspacePath"
        :folder-path="workspacePath"
        :active-path="activePath"
        :context-paths="contextPaths"
        row-action-mode="context-toggle"
        @open="emit('open-note', $event)"
        @toggle-context="emit('toggle-context', $event)"
        @path-renamed="emit('path-renamed', $event)"
        @request-create="emit('request-create', $event)"
        @select="emit('select', $event)"
        @error="emit('error', $event)"
      />
      <div v-else class="sb-pane-empty">No workspace selected.</div>
    </div>

    <div class="sb-pane-resizer" @pointerdown="onResizeStart"></div>

    <div class="sb-pane-main">
      <SecondBrainView
        :workspace-path="workspacePath"
        :all-workspace-files="allWorkspaceFiles"
        :requested-session-id="requestedSessionId"
        :requested-session-nonce="requestedSessionNonce"
        :requested-context-toggle-path="requestedContextTogglePath"
        :requested-context-toggle-nonce="requestedContextToggleNonce"
        @open-note="emit('open-note', $event)"
        @context-changed="emit('context-changed', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.sb-pane-surface {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
}

.sb-pane-sidebar,
.sb-pane-main {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.sb-pane-resizer {
  cursor: col-resize;
  background: transparent;
  position: relative;
}

.sb-pane-resizer::after {
  content: '';
  position: absolute;
  left: 2px;
  right: 2px;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--ui-border), transparent 20%);
}

.sb-pane-resizer:hover::after {
  background: color-mix(in srgb, var(--accent, #4f7a5d) 55%, transparent 20%);
}

.sb-pane-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: 0.84rem;
}
</style>
