<script setup lang="ts">
/**
 * WorkspaceStatusBar
 *
 * Purpose:
 * - Render the compact app status footer.
 */

defineProps<{
  activeFileLabel: string
  activeStateLabel: string
  indexStateLabel: string
  indexStateClass: string
  workspaceLabel: string
}>()

const emit = defineEmits<{
  'open-index-status': []
}>()
</script>

<template>
  <footer class="status-bar">
    <span class="status-item">{{ activeFileLabel }}</span>
    <span class="status-item status-item-state">{{ activeStateLabel }}</span>
    <button type="button" class="status-item status-item-index status-trigger" :class="indexStateClass" @click="emit('open-index-status')">
      <span class="status-dot" :class="indexStateClass"></span>
      <span>index: {{ indexStateLabel }}</span>
    </button>
    <span class="status-item">workspace: {{ workspaceLabel }}</span>
  </footer>
</template>

<style scoped>
.status-bar {
  height: 22px;
  border-top: 1px solid var(--footer-border);
  background: var(--footer-bg);
  font-size: var(--font-size-sm);
  font-family: var(--font-code);
  color: var(--footer-text);
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0;
  overflow-x: auto;
}

.status-item {
  display: inline-flex;
  align-items: center;
  height: 100%;
  padding: 0 8px;
  white-space: nowrap;
}

.status-trigger {
  border: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.status-trigger:hover {
  filter: brightness(0.94);
}

.status-item-state {
  width: 10ch;
  justify-content: center;
}

.status-item-index {
  gap: 6px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  display: inline-block;
  background: var(--text-faint);
}

.status-dot.status-item-indexing {
  background: var(--editor-progress-fill);
  animation: statusPulse 1.2s ease-in-out infinite;
}

.status-dot.status-item-indexed {
  background: var(--success);
}

.status-dot.status-item-out-of-sync {
  background: var(--warning);
}

.status-item + .status-item {
  border-left: 1px solid var(--footer-divider);
}

@keyframes statusPulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.9);
  }

  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}
</style>
