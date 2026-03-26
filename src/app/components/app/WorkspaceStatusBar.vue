<script setup lang="ts">
/**
 * WorkspaceStatusBar
 *
 * Purpose:
 * - Render the compact app status footer, including global app toggles.
 */

import { ShieldCheckIcon } from '@heroicons/vue/24/outline'

defineProps<{
  activeFileLabel: string
  activeStateLabel: string
  indexStateLabel: string
  indexStateClass: string
  workspaceLabel: string
  spellcheckEnabled: boolean
}>()

const emit = defineEmits<{
  'open-index-status': []
  'toggle-spellcheck': []
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
    <button
      type="button"
      class="status-item status-item-spellcheck status-trigger"
      :class="{ 'status-item-spellcheck--on': spellcheckEnabled }"
      :aria-pressed="spellcheckEnabled"
      aria-label="Toggle spellcheck"
      @click="emit('toggle-spellcheck')"
    >
      <ShieldCheckIcon class="status-spellcheck-icon" :class="{ 'status-spellcheck-icon--on': spellcheckEnabled }" aria-hidden="true" />
      <span>spellcheck: {{ spellcheckEnabled ? 'on' : 'off' }}</span>
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

.status-item-spellcheck {
  gap: 6px;
  color: var(--footer-text);
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

.status-spellcheck-icon {
  width: 14px;
  height: 14px;
}

.status-spellcheck-icon--on {
  color: #7cff2b;
  filter: drop-shadow(0 0 4px color-mix(in srgb, #7cff2b 55%, transparent));
  animation: spellcheckPulse 1.4s ease-in-out infinite;
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

@keyframes spellcheckPulse {
  0%,
  100% {
    opacity: 0.7;
    transform: scale(0.95);
  }

  50% {
    opacity: 1;
    transform: scale(1.08);
  }
}
</style>
