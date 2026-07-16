<script setup lang="ts">
/**
 * WorkspaceStatusBar
 *
 * Purpose:
 * - Render document state on the left and navigable editor signals on the right.
 */

import type {
  EditorSignalDirection,
  EditorSignalKind,
  EditorSignalSummary
} from '../../../domains/editor/lib/editorSignals'

defineProps<{
  activeFileLabel: string
  activeStateLabel: string
  indexStateLabel: string
  indexStateClass: string
  signalSummary: EditorSignalSummary
}>()

const emit = defineEmits<{
  'open-index-status': []
  'navigate-signal': [payload: { kind: EditorSignalKind; direction: EditorSignalDirection }]
}>()

function navigateSignal(kind: EditorSignalKind, event: MouseEvent) {
  emit('navigate-signal', { kind, direction: event.shiftKey ? -1 : 1 })
}
</script>

<template>
  <footer class="status-bar">
    <span class="status-item">{{ activeFileLabel }}</span>
    <span class="status-item status-item-state">{{ activeStateLabel }}</span>
    <button type="button" class="status-item status-item-index status-trigger" :class="indexStateClass" @click="emit('open-index-status')">
      <span class="status-dot" :class="indexStateClass"></span>
      <span>index: {{ indexStateLabel }}</span>
    </button>
    <div v-if="signalSummary.path" class="status-signals" aria-label="Document signals">
      <button
        v-if="signalSummary.spellcheckEnabled"
        type="button"
        class="status-signal status-signal--spellcheck"
        title="Next spelling issue (Shift+click: previous)"
        @click="navigateSignal('spellcheck', $event)"
      >
        {{ signalSummary.spellcheckCount }} {{ signalSummary.spellcheckCount === 1 ? 'faute' : 'fautes' }}
      </button>
      <button
        v-if="signalSummary.findActive"
        type="button"
        class="status-signal status-signal--find"
        title="Next search result (Shift+click: previous)"
        @click="navigateSignal('find', $event)"
      >
        {{ signalSummary.findCount }} {{ signalSummary.findCount === 1 ? 'résultat' : 'résultats' }}
      </button>
      <button
        type="button"
        class="status-signal status-signal--link"
        title="Next link (Shift+click: previous)"
        @click="navigateSignal('link', $event)"
      >
        {{ signalSummary.linkCount }} {{ signalSummary.linkCount === 1 ? 'link' : 'links' }}
      </button>
    </div>
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

.status-signals {
  display: flex;
  align-items: center;
  height: 100%;
  margin-left: auto;
  padding: 0 6px;
}

.status-signal {
  height: 100%;
  padding: 0 6px;
  border: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.status-signal:hover {
  background: color-mix(in srgb, currentColor 8%, transparent);
}

.status-signal:focus-visible {
  outline: 1px solid currentColor;
  outline-offset: -2px;
}

.status-signal + .status-signal::before {
  margin-right: 6px;
  color: var(--footer-text);
  content: '·';
}

.status-signal--spellcheck { color: var(--editor-signal-spellcheck); }
.status-signal--find { color: var(--editor-signal-find); }
.status-signal--link { color: var(--editor-signal-link); }

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
