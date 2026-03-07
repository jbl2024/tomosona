<script setup lang="ts">
import UiButton from '../ui/UiButton.vue'

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
  updatedLabel: string
}

defineProps<{
  mode: 'no-workspace' | 'workspace-launchpad'
  recentWorkspaces: RecentWorkspaceCard[]
  recentNotes: RecentNoteCard[]
  showWizardAction: boolean
}>()

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
  createSuggestedNote: [kind: 'daily' | 'inbox' | 'project']
}>()
</script>

<template>
  <section class="launchpad-shell" :data-launchpad-mode="mode">
    <div v-if="mode === 'no-workspace'" class="launchpad-hero">
      <p class="launchpad-eyebrow">Tomosona</p>
      <h2 class="launchpad-title">Open your Markdown workspace</h2>
      <p class="launchpad-subtitle">Work locally with notes, links, search, and AI context.</p>
      <div class="launchpad-actions">
        <UiButton variant="primary" class-name="launchpad-primary-btn" @click="emit('openWorkspace')">Open folder</UiButton>
        <UiButton v-if="showWizardAction" variant="secondary" @click="emit('openWizard')">Start with a setup wizard</UiButton>
      </div>
      <div class="launchpad-links">
        <button type="button" class="launchpad-link" @click="emit('openCommandPalette')">Command palette</button>
        <button type="button" class="launchpad-link" @click="emit('openShortcuts')">Keyboard shortcuts</button>
      </div>
    </div>

    <div v-else class="launchpad-hero">
      <p class="launchpad-eyebrow">Workspace launchpad</p>
      <h2 class="launchpad-title">Ready when you are</h2>
      <p class="launchpad-subtitle">Pick up your notes or start from today.</p>
      <div class="launchpad-actions">
        <UiButton variant="primary" size="sm" class-name="launchpad-primary-btn" @click="emit('openToday')">Open today&apos;s note</UiButton>
        <UiButton variant="secondary" size="sm" @click="emit('openQuickOpen')">Quick open</UiButton>
        <UiButton variant="secondary" size="sm" @click="emit('createNote')">New note</UiButton>
      </div>
    </div>

    <div v-if="mode === 'no-workspace'" class="launchpad-grid">
      <article class="launchpad-card">
        <div class="launchpad-card-head">
          <h3>Recent workspaces</h3>
          <span v-if="recentWorkspaces.length" class="launchpad-card-meta">{{ recentWorkspaces.length }}</span>
        </div>
        <div v-if="recentWorkspaces.length" class="launchpad-list">
          <button
            v-for="workspace in recentWorkspaces"
            :key="workspace.path"
            type="button"
            class="launchpad-list-item"
            @click="emit('openRecentWorkspace', workspace.path)"
          >
            <strong>{{ workspace.label }}</strong>
            <span>{{ workspace.subtitle }}</span>
            <span class="launchpad-list-meta">{{ workspace.recencyLabel }}</span>
          </button>
        </div>
        <p v-else class="launchpad-empty">No recent workspaces yet.</p>
      </article>

      <article class="launchpad-card">
        <div class="launchpad-card-head">
          <h3>What you get</h3>
        </div>
        <ul class="launchpad-value-list">
          <li>Rich Markdown editor</li>
          <li>Connected notes with [[wikilinks]]</li>
          <li>Search, Cosmos, and Second Brain</li>
        </ul>
      </article>
    </div>

    <div v-else class="launchpad-grid">
      <article class="launchpad-card launchpad-card-wide">
        <div class="launchpad-card-head">
          <h3>Recent notes</h3>
          <span v-if="recentNotes.length" class="launchpad-card-meta">{{ recentNotes.length }}</span>
        </div>
        <div v-if="recentNotes.length" class="launchpad-list launchpad-list-scroll">
          <button
            v-for="note in recentNotes"
            :key="note.path"
            type="button"
            class="launchpad-list-item launchpad-note-row"
            @click="emit('openRecentNote', note.path)"
          >
            <div class="launchpad-note-main">
              <strong>{{ note.title }}</strong>
              <span>{{ note.relativePath }}</span>
            </div>
            <span class="launchpad-list-meta">{{ note.updatedLabel }}</span>
          </button>
        </div>
        <div v-else class="launchpad-empty-block">
          <p class="launchpad-empty-title">No notes yet</p>
          <p class="launchpad-empty">Create your first note or open today&apos;s note.</p>
          <UiButton v-if="showWizardAction" variant="ghost" size="sm" @click="emit('openWizard')">Start with a setup wizard</UiButton>
        </div>
      </article>

      <article class="launchpad-card">
        <div class="launchpad-card-head">
          <h3>Suggested ways to start</h3>
        </div>
        <div class="launchpad-suggestions">
          <button type="button" class="launchpad-suggestion launchpad-quick-action" @click="emit('createSuggestedNote', 'daily')">
            <strong>Daily note</strong>
            <span>Today&apos;s page</span>
          </button>
          <button type="button" class="launchpad-suggestion launchpad-quick-action" @click="emit('createSuggestedNote', 'inbox')">
            <strong>Inbox</strong>
            <span>Quick capture note</span>
          </button>
          <button type="button" class="launchpad-suggestion launchpad-quick-action" @click="emit('createSuggestedNote', 'project')">
            <strong>Project note</strong>
            <span>`Projects/` starter</span>
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.launchpad-shell {
  min-height: 100%;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--surface-bg) 96%, white 4%), var(--surface-bg));
}

.launchpad-hero {
  max-width: 720px;
  padding: 16px 18px;
  border: 1px solid var(--shell-chrome-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface-bg) 98%, white 2%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.launchpad-eyebrow {
  margin: 0 0 6px;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.launchpad-title {
  margin: 0;
  font-size: clamp(1.45rem, 2.7vw, 2rem);
  line-height: 1.08;
  color: var(--text-main);
}

.launchpad-subtitle {
  margin: 6px 0 0;
  max-width: 56ch;
  font-size: 0.92rem;
  color: var(--text-dim);
}

.launchpad-actions {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.launchpad-primary-btn {
  min-width: 150px;
}

.launchpad-links {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.launchpad-link {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--accent);
  font-size: 0.82rem;
  text-decoration: none;
}

.launchpad-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
  gap: 12px;
  min-height: 0;
}

.launchpad-card {
  border: 1px solid var(--shell-chrome-border);
  border-radius: 14px;
  padding: 12px;
  background: color-mix(in srgb, var(--surface-bg) 95%, white 5%);
  min-height: 0;
}

.launchpad-card-wide {
  min-height: 360px;
  display: flex;
  flex-direction: column;
}

.launchpad-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.launchpad-card-head h3 {
  margin: 0;
  font-size: 0.95rem;
}

.launchpad-card-meta,
.launchpad-list-meta {
  font-size: 0.76rem;
  color: var(--text-dim);
}

.launchpad-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.launchpad-list-scroll {
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.launchpad-list-item,
.launchpad-suggestion {
  border: 1px solid color-mix(in srgb, var(--button-secondary-border) 96%, white 4%);
  border-radius: 10px;
  background: color-mix(in srgb, var(--button-secondary-bg) 92%, white 8%);
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  text-align: left;
  color: var(--text-main);
}

.launchpad-list-item:hover,
.launchpad-suggestion:hover {
  border-color: var(--button-primary-border);
  background: color-mix(in srgb, var(--menu-hover-bg) 78%, var(--surface-bg) 22%);
}

.launchpad-list-item strong,
.launchpad-suggestion strong {
  font-size: 0.9rem;
}

.launchpad-list-item span,
.launchpad-suggestion span,
.launchpad-empty {
  color: var(--text-dim);
  font-size: 0.82rem;
}

.launchpad-note-row {
  align-items: flex-start;
}

.launchpad-note-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.launchpad-note-main strong,
.launchpad-note-main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.launchpad-empty-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
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

.launchpad-suggestions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.launchpad-quick-action {
  align-items: flex-start;
  flex-direction: column;
  gap: 2px;
}

@media (max-width: 960px) {
  .launchpad-shell {
    padding: 10px;
  }

  .launchpad-hero {
    padding: 14px;
  }

  .launchpad-grid {
    grid-template-columns: 1fr;
  }
}
</style>
