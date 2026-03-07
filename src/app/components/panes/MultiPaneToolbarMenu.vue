<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  canSplit: boolean
  paneCount: number
}>()

const emit = defineEmits<{
  'split-right': []
  'split-down': []
  'focus-pane': [payload: { index: number }]
  'focus-next': []
  'move-tab-next': []
  'close-pane': []
  'join-panes': []
  'reset-layout': []
}>()

const open = ref(false)

const paneIndices = computed(() => [1, 2, 3, 4])

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
}

function run(action: () => void) {
  action()
  close()
}
</script>

<template>
  <div class="multi-pane-menu" @keydown.esc.stop="close">
    <button
      type="button"
      class="toolbar-icon-btn"
      title="Multi-pane layout"
      aria-label="Multi-pane layout"
      :aria-expanded="open"
      @click="toggle"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" ry="1.5" />
        <line x1="8" y1="2.5" x2="8" y2="13.5" />
        <line x1="1.5" y1="8" x2="14.5" y2="8" />
      </svg>
    </button>

    <div v-if="open" class="multi-pane-dropdown">
      <button type="button" class="multi-pane-item" :disabled="!canSplit" @click="run(() => emit('split-right'))">Split Right</button>
      <button type="button" class="multi-pane-item" :disabled="!canSplit" @click="run(() => emit('split-down'))">Split Down</button>
      <button type="button" class="multi-pane-item" :disabled="paneCount < 2" @click="run(() => emit('focus-next'))">Focus Next Pane</button>
      <button type="button" class="multi-pane-item" :disabled="paneCount < 2" @click="run(() => emit('move-tab-next'))">Move Tab to Next Pane</button>
      <div class="multi-pane-divider"></div>
      <button
        v-for="index in paneIndices"
        :key="`pane-${index}`"
        type="button"
        class="multi-pane-item"
        :disabled="index > paneCount"
        @click="run(() => emit('focus-pane', { index }))"
      >
        Focus Pane {{ index }}
      </button>
      <div class="multi-pane-divider"></div>
      <button type="button" class="multi-pane-item" :disabled="paneCount <= 1" @click="run(() => emit('close-pane'))">Close Active Pane</button>
      <button type="button" class="multi-pane-item" :disabled="paneCount <= 1" @click="run(() => emit('join-panes'))">Join Panes</button>
      <button type="button" class="multi-pane-item" :disabled="paneCount <= 1" @click="run(() => emit('reset-layout'))">Reset Pane Layout</button>
    </div>
  </div>
</template>

<style scoped>
.multi-pane-menu {
  position: relative;
}

.multi-pane-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  width: 220px;
  z-index: 40;
  border: 1px solid var(--menu-border);
  border-radius: 12px;
  background: var(--menu-bg);
  box-shadow: var(--menu-shadow);
  padding: 6px;
}

.multi-pane-item {
  width: 100%;
  border: 0;
  border-radius: 8px;
  text-align: left;
  padding: 7px 10px;
  background: transparent;
  color: var(--menu-text);
  font-size: 12px;
  cursor: pointer;
}

.multi-pane-item:hover:not(:disabled) {
  background: var(--menu-hover-bg);
  color: var(--menu-text-strong);
}

.multi-pane-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.multi-pane-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--menu-divider);
}
</style>
