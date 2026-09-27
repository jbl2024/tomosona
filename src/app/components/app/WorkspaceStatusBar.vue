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
import { XMarkIcon } from '@heroicons/vue/24/outline'

defineProps<{
  activeFileLabel: string
  activeStateLabel: string
  indexStateLabel: string
  indexStateClass: string
  signalSummary: EditorSignalSummary
  spellcheckEnabled: boolean
}>()

const emit = defineEmits<{
  'open-index-status': []
  'navigate-signal': [payload: { kind: EditorSignalKind; direction: EditorSignalDirection }]
  'toggle-spellcheck': []
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
        type="button"
        class="status-signal status-signal--spellcheck"
        :class="{ 'status-signal--disabled': !spellcheckEnabled }"
        :title="spellcheckEnabled ? 'Next spelling issue (Shift+click: previous)' : 'Enable spellcheck'"
        @click="spellcheckEnabled ? navigateSignal('spellcheck', $event) : emit('toggle-spellcheck')"
      >
        {{ spellcheckEnabled ? `${signalSummary.spellcheckCount} ${signalSummary.spellcheckCount === 1 ? 'faute' : 'fautes'}` : 'spellcheck off' }}
      </button>
      <button
        v-if="spellcheckEnabled"
        type="button"
        class="status-signal-dismiss"
        title="Disable spellcheck"
        aria-label="Disable spellcheck"
        @click.stop="emit('toggle-spellcheck')"
      >
        <XMarkIcon aria-hidden="true" />
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
        v-if="signalSummary.linkCount > 0"
        class="status-signal status-signal--link"
        title="Next link (Shift+click: previous)"
        @click="navigateSignal('link', $event)"
      >
        {{ signalSummary.linkCount }} {{ signalSummary.linkCount <= 1 ? 'link' : 'links' }}
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
.status-signal--disabled { color: var(--footer-text); }
.status-signal--find { color: var(--editor-signal-find); }
.status-signal--link { color: var(--editor-signal-link); }

.status-signal-dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 100%;
  margin-left: -6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--editor-signal-spellcheck);
  cursor: pointer;
}

.status-signal-dismiss:hover {
  background: color-mix(in srgb, currentColor 8%, transparent);
}

.status-signal-dismiss :deep(svg) {
  width: 0.75rem;
  height: 0.75rem;
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
