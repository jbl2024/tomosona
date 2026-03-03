<script setup lang="ts">
import { computed } from 'vue'
import { ShareIcon, SparklesIcon } from '@heroicons/vue/24/outline'
import type { PaneState, PaneTab } from '../../composables/useMultiPaneWorkspaceState'

export type FileEditorStatus = {
  dirty: boolean
  saving: boolean
  saveError: string
}

const props = defineProps<{
  pane: PaneState
  isActivePane: boolean
  getStatus: (path: string) => FileEditorStatus
}>()

const emit = defineEmits<{
  'pane-focus': [payload: { paneId: string }]
  'tab-click': [payload: { paneId: string; tabId: string }]
  'tab-close': [payload: { paneId: string; tabId: string }]
  'tab-close-others': [payload: { paneId: string; tabId: string }]
  'tab-close-all': [payload: { paneId: string }]
  'request-move-tab': [payload: { paneId: string; direction: 'next' | 'previous' }]
}>()

const tabs = computed(() => props.pane.openTabs.map((tab) => {
  const status = tab.type === 'document'
    ? props.getStatus(tab.path)
    : { dirty: false, saving: false, saveError: '' }
  return {
    ...tab,
    title: tabTitle(tab),
    icon: tabIcon(tab),
    dirty: status.dirty,
    saving: status.saving
  }
}))

function fileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

function tabTitle(tab: PaneTab): string {
  if (tab.type === 'document') return fileName(tab.path)
  if (tab.type === 'cosmos') return 'Cosmos'
  return 'Second Brain'
}

function tabIcon(tab: PaneTab): string {
  if (tab.type === 'cosmos') return ''
  if (tab.type === 'second-brain-chat') return ''
  return ''
}
</script>

<template>
  <div class="pane-tabs" @mousedown="emit('pane-focus', { paneId: pane.id })">
    <div class="pane-tabs-scroll">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        role="button"
        tabindex="0"
        class="pane-tab-item"
        :class="{
          active: pane.activeTabId === tab.id,
          'active-pane': pane.activeTabId === tab.id && isActivePane
        }"
        @click="emit('tab-click', { paneId: pane.id, tabId: tab.id })"
        @keydown.enter.prevent="emit('tab-click', { paneId: pane.id, tabId: tab.id })"
        @keydown.space.prevent="emit('tab-click', { paneId: pane.id, tabId: tab.id })"
      >
        <span v-if="tab.type === 'cosmos'" class="pane-tab-icon pane-tab-icon--hero">
          <ShareIcon />
        </span>
        <span v-else-if="tab.type === 'second-brain-chat'" class="pane-tab-icon pane-tab-icon--hero">
          <SparklesIcon />
        </span>
        <span v-else-if="tab.icon" class="pane-tab-icon">{{ tab.icon }}</span>
        <span class="pane-tab-name">{{ tab.title }}</span>
        <span v-if="tab.saving" class="pane-tab-state" title="Saving">~</span>
        <span v-else-if="tab.dirty" class="pane-tab-state" title="Unsaved">•</span>
        <button
          type="button"
          class="pane-tab-close"
          aria-label="Close tab"
          @click.stop="emit('tab-close', { paneId: pane.id, tabId: tab.id })"
        >
          x
        </button>
      </div>
      <div v-if="!tabs.length" class="pane-tab-empty">No open files</div>
    </div>
    <div class="pane-tabs-actions">
      <button type="button" class="pane-tab-action" @click="emit('request-move-tab', { paneId: pane.id, direction: 'previous' })" title="Move active tab to previous pane">←</button>
      <button type="button" class="pane-tab-action" @click="emit('request-move-tab', { paneId: pane.id, direction: 'next' })" title="Move active tab to next pane">→</button>
      <button
        type="button"
        class="pane-tab-action"
        :disabled="!pane.activeTabId"
        @click="emit('tab-close-others', { paneId: pane.id, tabId: pane.activeTabId })"
        title="Close other tabs"
      >
        O
      </button>
      <button
        type="button"
        class="pane-tab-action"
        @click="emit('tab-close-all', { paneId: pane.id })"
        title="Close all tabs"
      >
        A
      </button>
    </div>
  </div>
</template>

<style scoped>
.pane-tabs {
  display: flex;
  align-items: stretch;
  min-height: 32px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--panel-bg);
  font-size: 0.84rem;
}

.pane-tabs-scroll {
  flex: 1;
  display: flex;
  align-items: stretch;
  gap: 0;
  overflow-x: auto;
}

.pane-tab-item {
  max-width: 220px;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.28rem 0.52rem;
  border: 0;
  background: transparent;
  color: var(--text-soft);
  cursor: pointer;
  position: relative;
}

.pane-tab-item::after {
  content: '';
  position: absolute;
  right: 0;
  top: 6px;
  bottom: 6px;
  width: 1px;
  background: color-mix(in srgb, var(--ui-border), transparent 5%);
}

.pane-tab-item.active {
  background: color-mix(in srgb, var(--panel-soft-bg), white 20%);
  color: var(--text-main);
}

.pane-tab-item.active-pane {
  background: var(--panel-soft-bg);
  box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--accent, #4f7a5d) 70%, transparent);
}

.pane-tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.pane-tab-icon {
  font-size: 0.7rem;
  opacity: 0.78;
}

.pane-tab-icon--hero {
  width: 0.95rem;
  height: 0.95rem;
  opacity: 0.9;
}

.pane-tab-state {
  font-size: 0.7rem;
  opacity: 0.75;
}

.pane-tab-close {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 0.72rem;
  cursor: pointer;
  line-height: 1;
}

.pane-tabs-actions {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0 0.3rem;
  border-left: 1px solid var(--ui-border);
}

.pane-tab-action {
  border: 1px solid var(--ui-border);
  background: var(--surface-bg);
  color: var(--text-soft);
  padding: 0.12rem 0.32rem;
  border-radius: 4px;
  font-size: 0.68rem;
  cursor: pointer;
}

.pane-tab-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pane-tab-empty {
  display: inline-flex;
  align-items: center;
  color: var(--text-dim);
  padding: 0.32rem 0.56rem;
  font-size: 0.76rem;
}
</style>
