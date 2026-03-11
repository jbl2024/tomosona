<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  BoltIcon,
  CalendarDaysIcon,
  CommandLineIcon,
  DocumentPlusIcon,
  DocumentTextIcon,
  QuestionMarkCircleIcon,
  RocketLaunchIcon
} from '@heroicons/vue/24/outline'
import UiButton from '../../../shared/components/ui/UiButton.vue'

type RecentWorkspaceCard = {
  path: string
  label: string
  subtitle: string
  recencyLabel: string
}

type RecentNoteCard = {
  path: string
  title: string
  relativePath: string
  recencyLabel: string
}

const props = defineProps<{
  mode: 'no-workspace' | 'workspace-launchpad'
  workspaceLabel: string
  recentWorkspaces: RecentWorkspaceCard[]
  recentViewedNotes: RecentNoteCard[]
  recentUpdatedNotes: RecentNoteCard[]
  showWizardAction: boolean
}>()

const activeRecentTab = ref<'viewed' | 'updated'>('viewed')
const activeRecentNotes = computed(() =>
  activeRecentTab.value === 'viewed'
    ? props.recentViewedNotes
    : props.recentUpdatedNotes
)
const activeRecentEmptyTitle = computed(() =>
  activeRecentTab.value === 'viewed'
    ? 'No recently viewed notes yet'
    : 'No recently updated notes yet'
)
const activeRecentEmptyCopy = computed(() =>
  activeRecentTab.value === 'viewed'
    ? 'Open a note to keep your working context handy.'
    : 'Edit a note to populate recent activity.'
)

const emit = defineEmits<{
  openWorkspace: []
  openWizard: []
  openCommandPalette: []
  openShortcuts: []
  openRecentWorkspace: [path: string]
  openToday: []
  openQuickOpen: []
  createNote: []
  openRecentNote: [path: string]
  quickStart: [kind: 'today' | 'second-brain' | 'cosmos' | 'command-palette']
}>()

function noteLocationLabel(path: string): string {
  const normalized = path.replace(/\\/g, '/').trim()
  if (!normalized || !normalized.includes('/')) return '/'
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 1) return '/'
  return parts.slice(0, -1).join(' / ')
}

function noteLooksLikeDaily(path: string, title: string): boolean {
  const target = `${path} ${title}`
  return /\b\d{4}-\d{2}-\d{2}\b/.test(target)
}

function shortUpdatedLabel(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^(updated|opened)\s+/, '')
  if (normalized.startsWith('yesterday')) return 'Yesterday'
  const hoursMatch = normalized.match(/^(\d+)\s+hours?\s+ago$/)
  if (hoursMatch) return `${hoursMatch[1]}h ago`
  const minutesMatch = normalized.match(/^(\d+)\s+minutes?\s+ago$/)
  if (minutesMatch) return `${minutesMatch[1]}m ago`
  const daysMatch = normalized.match(/^(\d+)\s+days?\s+ago$/)
  if (daysMatch) return `${daysMatch[1]}d ago`
  const weeksMatch = normalized.match(/^(\d+)\s+weeks?\s+ago$/)
  if (weeksMatch) return `${weeksMatch[1]}w ago`
  const monthsMatch = normalized.match(/^(\d+)\s+months?\s+ago$/)
  if (monthsMatch) return `${monthsMatch[1]}mo ago`
  const yearsMatch = normalized.match(/^(\d+)\s+years?\s+ago$/)
  if (yearsMatch) return `${yearsMatch[1]}y ago`
  return value.replace(/^updated\s+/i, '')
}
</script>

<template>
  <section class="launchpad-shell" :data-launchpad-mode="mode">
    <div class="launchpad-head">
      <div>
        <p class="launchpad-eyebrow">Home</p>
        <h2 class="launchpad-title">{{ mode === 'no-workspace' ? 'Workspace entry' : workspaceLabel || 'Workspace' }}</h2>
      </div>
    </div>

    <div class="launchpad-toolbar">
      <button
        v-if="mode === 'no-workspace'"
        type="button"
        class="launchpad-chip launchpad-chip-primary"
        @click="emit('openWorkspace')"
      >
        <BoltIcon />
        <span>Open folder</span>
      </button>
      <button
        v-else
        type="button"
        class="launchpad-chip launchpad-chip-primary"
        @click="emit('createNote')"
      >
        <DocumentPlusIcon />
        <span>New note</span>
      </button>
      <button
        v-if="mode === 'workspace-launchpad'"
        type="button"
        class="launchpad-chip"
        @click="emit('openToday')"
      >
        <CalendarDaysIcon />
        <span>Open today</span>
      </button>
      <button type="button" class="launchpad-chip" @click="emit('openQuickOpen')">
        <CommandLineIcon />
        <span>Quick open</span>
      </button>
      <button type="button" class="launchpad-chip" @click="emit('openShortcuts')">
        <QuestionMarkCircleIcon />
        <span>Shortcuts</span>
      </button>
      <button
        v-if="showWizardAction"
        type="button"
        class="launchpad-chip"
        @click="emit('openWizard')"
      >
        <RocketLaunchIcon />
        <span>Setup wizard</span>
      </button>
      <button
        v-if="mode === 'no-workspace'"
        type="button"
        class="launchpad-chip"
        @click="emit('openCommandPalette')"
      >
        <CommandLineIcon />
        <span>Command palette</span>
      </button>
    </div>

    <div v-if="mode === 'no-workspace'" class="launchpad-grid">
      <article class="launchpad-card launchpad-card-wide">
        <div class="launchpad-section-head">
          <h3>Recent workspaces</h3>
          <span v-if="recentWorkspaces.length" class="launchpad-card-meta">{{ recentWorkspaces.length }}</span>
        </div>
        <div v-if="recentWorkspaces.length" class="launchpad-table launchpad-table-scroll">
          <button
            v-for="workspace in recentWorkspaces"
            :key="workspace.path"
            type="button"
            class="launchpad-rich-row"
            @click="emit('openRecentWorkspace', workspace.path)"
          >
            <div class="launchpad-rich-row-main">
              <span class="launchpad-cell launchpad-cell-title launchpad-cell-title-wrap">
                <span class="launchpad-row-icon">
                  <BoltIcon />
                </span>
                <span class="launchpad-cell-title-text">{{ workspace.label }}</span>
              </span>
              <span class="launchpad-rich-row-time">{{ shortUpdatedLabel(workspace.recencyLabel) }}</span>
            </div>
            <div class="launchpad-rich-row-sub">
              <span class="launchpad-rich-row-location">
                <span class="launchpad-rich-row-arrow">↳</span>
                <span class="launchpad-cell launchpad-cell-path">{{ workspace.subtitle }}</span>
              </span>
            </div>
          </button>
        </div>
        <div v-else class="launchpad-empty-block">
          <p class="launchpad-empty-title">No recent workspaces yet</p>
          <p class="launchpad-empty">Open a folder to start a local Markdown workspace.</p>
        </div>
      </article>

      <article class="launchpad-card launchpad-card-panel launchpad-quick-panel">
        <div class="launchpad-section-head">
          <h3>Get started</h3>
        </div>
        <div class="launchpad-action-list">
          <button type="button" class="launchpad-action-row" @click="emit('openWorkspace')">
            <span class="launchpad-action-icon launchpad-action-icon-daily"><BoltIcon /></span>
            <span class="launchpad-action-copy">
              <strong>Open folder</strong>
              <span>Choose a local Markdown workspace</span>
            </span>
          </button>
          <button v-if="showWizardAction" type="button" class="launchpad-action-row" @click="emit('openWizard')">
            <span class="launchpad-action-icon launchpad-action-icon-project"><RocketLaunchIcon /></span>
            <span class="launchpad-action-copy">
              <strong>Setup wizard</strong>
              <span>Create a starter structure you can edit later</span>
            </span>
          </button>
          <button type="button" class="launchpad-action-row" @click="emit('openCommandPalette')">
            <span class="launchpad-action-icon launchpad-action-icon-command"><CommandLineIcon /></span>
            <span class="launchpad-action-copy">
              <strong>Command palette</strong>
              <span>Search actions from anywhere</span>
            </span>
          </button>
          <button type="button" class="launchpad-action-row" @click="emit('openShortcuts')">
            <span class="launchpad-action-icon"><QuestionMarkCircleIcon /></span>
            <span class="launchpad-action-copy">
              <strong>Shortcuts</strong>
              <span>Learn the keyboard-first flow</span>
            </span>
          </button>
        </div>
      </article>
    </div>

    <div v-else class="launchpad-grid">
      <article class="launchpad-card launchpad-card-wide">
        <div class="launchpad-section-head">
          <h3>Recent notes</h3>
          <span v-if="activeRecentNotes.length" class="launchpad-card-meta">{{ activeRecentNotes.length }}</span>
        </div>
        <div class="launchpad-segmented" role="tablist" aria-label="Recent note lists">
          <button
            type="button"
            class="launchpad-segmented-tab"
            :class="{ 'launchpad-segmented-tab-active': activeRecentTab === 'viewed' }"
            :aria-selected="activeRecentTab === 'viewed'"
            data-launchpad-tab="viewed"
            @click="activeRecentTab = 'viewed'"
          >
            Viewed
          </button>
          <button
            type="button"
            class="launchpad-segmented-tab"
            :class="{ 'launchpad-segmented-tab-active': activeRecentTab === 'updated' }"
            :aria-selected="activeRecentTab === 'updated'"
            data-launchpad-tab="updated"
            @click="activeRecentTab = 'updated'"
          >
            Updated
          </button>
        </div>
        <div v-if="activeRecentNotes.length" class="launchpad-table launchpad-table-scroll">
          <button
            v-for="note in activeRecentNotes"
            :key="note.path"
            type="button"
            class="launchpad-rich-row"
            @click="emit('openRecentNote', note.path)"
          >
            <div class="launchpad-rich-row-main">
              <span class="launchpad-cell launchpad-cell-title launchpad-cell-title-wrap">
                <span class="launchpad-row-icon" :class="{ 'launchpad-row-icon-daily': noteLooksLikeDaily(note.relativePath, note.title) }">
                  <CalendarDaysIcon v-if="noteLooksLikeDaily(note.relativePath, note.title)" />
                  <DocumentTextIcon v-else />
                </span>
                <span class="launchpad-cell-title-text">{{ note.title }}</span>
              </span>
              <span class="launchpad-rich-row-time">{{ shortUpdatedLabel(note.recencyLabel) }}</span>
            </div>
            <div class="launchpad-rich-row-sub">
              <span class="launchpad-rich-row-location">
                <span class="launchpad-rich-row-arrow">↳</span>
                <span class="launchpad-cell launchpad-cell-path">{{ noteLocationLabel(note.relativePath) }}</span>
              </span>
            </div>
          </button>
        </div>
        <div v-else class="launchpad-empty-block">
          <p class="launchpad-empty-title">{{ activeRecentEmptyTitle }}</p>
          <p class="launchpad-empty">{{ activeRecentEmptyCopy }}</p>
          <UiButton v-if="showWizardAction" variant="ghost" size="sm" @click="emit('openWizard')">Start with a setup wizard</UiButton>
        </div>
      </article>

      <article class="launchpad-card launchpad-card-panel launchpad-quick-panel">
        <div class="launchpad-section-head">
          <h3>Quick starts</h3>
        </div>
        <div class="launchpad-action-list">
          <button type="button" class="launchpad-action-row" @click="emit('quickStart', 'today')">
            <span class="launchpad-action-icon launchpad-action-icon-daily"><CalendarDaysIcon /></span>
            <span class="launchpad-action-copy">
              <strong>Today&apos;s note</strong>
              <span>Write in your daily journal</span>
            </span>
          </button>
          <button type="button" class="launchpad-action-row" @click="emit('quickStart', 'second-brain')">
            <span class="launchpad-action-icon launchpad-action-icon-second-brain"><BoltIcon /></span>
            <span class="launchpad-action-copy">
              <strong>Ask Second Brain</strong>
              <span>Query your entire workspace</span>
            </span>
          </button>
          <button type="button" class="launchpad-action-row" @click="emit('quickStart', 'cosmos')">
            <span class="launchpad-action-icon launchpad-action-icon-project"><RocketLaunchIcon /></span>
            <span class="launchpad-action-copy">
              <strong>Explore Cosmos</strong>
              <span>Open the knowledge graph</span>
            </span>
          </button>
          <button type="button" class="launchpad-action-row" @click="emit('quickStart', 'command-palette')">
            <span class="launchpad-action-icon launchpad-action-icon-command"><CommandLineIcon /></span>
            <span class="launchpad-action-copy">
              <strong>Search &amp; Commands</strong>
              <span>Press Cmd/Ctrl+Shift+P anywhere</span>
            </span>
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.launchpad-shell {
  min-height: 100%;
  padding: 10px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--surface-bg);
}

.launchpad-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
}

.launchpad-eyebrow {
  margin: 0 0 2px;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.launchpad-title {
  margin: 0;
  font-size: 1rem;
  line-height: 1.2;
  color: var(--text-main);
  font-weight: 600;
}

.launchpad-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--ui-border) 82%, transparent);
}

.launchpad-chip {
  border: 1px solid color-mix(in srgb, var(--ui-border) 90%, transparent);
  background: color-mix(in srgb, var(--panel-bg) 94%, transparent);
  color: var(--text-soft);
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 0.78rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.launchpad-chip:hover {
  background: color-mix(in srgb, var(--panel-soft-bg) 82%, transparent);
  color: var(--text-main);
}

.launchpad-chip :deep(svg) {
  width: 13px;
  height: 13px;
  stroke-width: 1.8;
}

.launchpad-chip-primary {
  color: color-mix(in srgb, var(--accent) 76%, var(--text-main));
  border-color: color-mix(in srgb, var(--accent) 28%, var(--ui-border));
  background: color-mix(in srgb, var(--accent-soft) 52%, var(--panel-bg));
}

.launchpad-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
  gap: 12px;
  min-height: 0;
  flex: 1;
}

.launchpad-card {
  border: 0;
  border-radius: 10px;
  padding: 10px 0 0;
  background: transparent;
  min-height: 0;
}

.launchpad-card-panel {
  padding: 12px;
  background: color-mix(in srgb, var(--panel-bg) 96%, var(--surface-bg));
  box-shadow: none;
}

.launchpad-card-wide {
  min-height: 360px;
  display: flex;
  flex-direction: column;
}

.launchpad-quick-panel {
  align-self: start;
  height: fit-content;
  padding-top: 8px;
  background: color-mix(in srgb, var(--surface-muted) 78%, var(--surface-bg));
  box-shadow: none;
}

.launchpad-quick-panel .launchpad-section-head {
  padding: 0 0 6px;
  margin-bottom: 0;
}

.launchpad-quick-panel .launchpad-action-list {
  padding: 0;
}

.launchpad-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  padding: 0 12px 8px;
}

.launchpad-section-head h3 {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-main);
}

.launchpad-card-meta,
.launchpad-cell-meta {
  font-size: 0.72rem;
  color: var(--text-dim);
}

.launchpad-segmented {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0 12px 8px;
  padding: 3px;
  width: fit-content;
  border: 1px solid color-mix(in srgb, var(--ui-border) 82%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel-bg) 88%, var(--surface-bg));
}

.launchpad-segmented-tab {
  border: 0;
  border-radius: 999px;
  padding: 5px 10px;
  background: transparent;
  color: var(--text-dim);
  font-size: 0.74rem;
  font-weight: 600;
}

.launchpad-segmented-tab-active {
  background: color-mix(in srgb, var(--accent-soft) 58%, var(--panel-bg));
  color: color-mix(in srgb, var(--accent) 80%, var(--text-main));
}

.launchpad-table {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.launchpad-table-scroll {
  flex: 1;
  overflow-y: auto;
}

.launchpad-table-row {
  color: var(--text-soft);
  text-align: left;
  transition: background-color 120ms ease, color 120ms ease;
}

.launchpad-table-row:hover {
  background: color-mix(in srgb, var(--panel-soft-bg) 82%, transparent);
  color: var(--text-main);
}

.launchpad-rich-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  text-align: left;
  color: var(--text-soft);
  transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}

.launchpad-rich-row:hover {
  background: color-mix(in srgb, var(--panel-soft-bg) 86%, transparent);
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--accent) 55%, transparent);
  color: var(--text-main);
}

.launchpad-rich-row-main {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.launchpad-rich-row-sub {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 22px;
}

.launchpad-rich-row-location {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.launchpad-rich-row-arrow {
  color: color-mix(in srgb, var(--text-dim) 80%, transparent);
  font-size: 0.8rem;
}

.launchpad-rich-row-time {
  flex: 0 0 auto;
  color: var(--text-dim);
  font-size: 0.76rem;
  font-weight: 500;
}

.launchpad-cell {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.launchpad-cell-title {
  color: var(--text-main);
  font-weight: 500;
}

.launchpad-cell-title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.launchpad-cell-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.launchpad-row-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--accent) 58%, var(--text-dim));
  opacity: 0.95;
}

.launchpad-row-icon-daily {
  color: color-mix(in srgb, var(--accent) 86%, white 14%);
}

.launchpad-row-icon :deep(svg) {
  width: 14px;
  height: 14px;
  stroke-width: 1.7;
}

.launchpad-cell-path,
.launchpad-empty {
  color: var(--text-dim);
  font-size: 0.82rem;
}

.launchpad-empty-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 12px 12px;
}

.launchpad-empty-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-main);
}

.launchpad-value-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--text-main);
  font-size: 0.85rem;
}

.launchpad-action-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  align-items: stretch;
}

.launchpad-action-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid transparent;
  color: var(--text-soft);
  text-align: left;
  background: transparent;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background-color 120ms ease;
}

.launchpad-action-row:hover {
  color: color-mix(in srgb, var(--text-main) 94%, var(--text-soft));
  background: color-mix(in srgb, var(--surface-bg) 18%, transparent);
}

.launchpad-action-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--accent) 62%, var(--text-dim));
  transition: color 120ms ease, opacity 120ms ease;
}

.launchpad-action-icon-daily {
  color: color-mix(in srgb, var(--accent) 88%, white 12%);
}

.launchpad-action-icon-second-brain {
  color: color-mix(in srgb, #f6d365 74%, var(--text-dim));
}

.launchpad-action-icon-project {
  color: color-mix(in srgb, #98e6b3 72%, var(--text-dim));
}

.launchpad-action-icon-command {
  color: color-mix(in srgb, #8ab4ff 78%, var(--text-dim));
}

.launchpad-action-icon :deep(svg) {
  width: 16px;
  height: 16px;
  stroke-width: 1.8;
}

.launchpad-action-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.launchpad-action-copy strong {
  font-size: 0.84rem;
  font-weight: 600;
  transition: color 120ms ease;
}

.launchpad-action-copy span {
  font-size: 0.76rem;
  color: var(--text-dim);
  transition: color 120ms ease;
}

.launchpad-action-row:hover .launchpad-action-icon {
  color: color-mix(in srgb, currentColor 74%, var(--text-main));
}

.launchpad-action-row:hover .launchpad-action-copy strong {
  color: var(--text-main);
}

.launchpad-action-row:hover .launchpad-action-copy span {
  color: color-mix(in srgb, var(--text-dim) 70%, var(--text-main));
}

@media (max-width: 960px) {
  .launchpad-shell {
    padding: 10px;
  }

  .launchpad-grid {
    grid-template-columns: 1fr;
  }
}

html[data-theme='light'] .launchpad-quick-panel {
  background: color-mix(in srgb, var(--surface-muted) 92%, var(--surface-subtle));
}

html[data-theme='dark'] .launchpad-quick-panel,
html.dark .launchpad-quick-panel {
  background: color-mix(in srgb, var(--panel-bg) 96%, var(--surface-bg));
}
</style>
