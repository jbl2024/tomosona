<script setup lang="ts">
/**
 * Presentational Echoes panel for the note-side context surface.
 *
 * The component renders explainable suggestions and emits only user intents.
 */
import type { EchoesItem } from '../../../echoes/lib/echoes'
import UiButton from '../../../../shared/components/ui/UiButton.vue'

type EditorEchoesListItem = EchoesItem & {
  isInContext: boolean
}

const props = defineProps<{
  items: EditorEchoesListItem[]
  loading: boolean
  error: string
  hintVisible: boolean
  toRelativePath: (path: string) => string
}>()

const emit = defineEmits<{
  open: [path: string]
  add: [path: string]
  remove: [path: string]
}>()

function compactRelativePath(path: string): string {
  const relative = props.toRelativePath(path)
  const segments = relative.split('/').filter(Boolean)
  if (segments.length <= 2) return relative
  return `.../${segments.slice(-2).join('/')}`
}

function reasonLabel(reason: string) {
  switch (reason) {
    case 'Direct link':
      return 'direct link'
    case 'Backlink':
      return 'backlink'
    case 'Semantically related':
      return 'semantic similarity'
    case 'Recently active':
      return 'recent activity'
    default:
      return reason.toLowerCase()
  }
}

function onContextClick(item: EditorEchoesListItem) {
  if (item.isInContext) {
    emit('remove', item.path)
    return
  }
  emit('add', item.path)
}
</script>

<template>
  <section class="pane-card pane-section">
    <div class="echoes-head">
      <div>
        <h3 class="section-title">Echoes</h3>
        <p v-if="hintVisible" class="echoes-helper">Suggestions around this note.</p>
      </div>
      <span v-if="!loading && !error && items.length" class="echoes-count">{{ items.length }} suggestion{{ items.length > 1 ? 's' : '' }}</span>
    </div>

    <div v-if="loading" class="empty-state">Loading...</div>
    <div v-else-if="error" class="empty-state">{{ error }}</div>
    <div v-else-if="!items.length" class="empty-state">
      Echoes surfaces nearby notes when Tomosona finds strong local context.
    </div>

    <article
      v-for="item in items"
      v-else
      :key="`echo-${item.path}`"
      class="echoes-card"
      :data-in-context="item.isInContext"
    >
      <div class="echoes-card-copy">
        <strong class="echoes-item-title">{{ item.title }}</strong>
        <span class="echoes-item-reason">{{ reasonLabel(item.reasonLabel) }}</span>
        <span class="echoes-item-path" :title="props.toRelativePath(item.path)">{{ compactRelativePath(item.path) }}</span>
      </div>
      <div class="echoes-card-actions">
        <UiButton
          variant="secondary"
          size="sm"
          class-name="echoes-action-btn"
          @click="emit('open', item.path)"
        >
          Open
        </UiButton>
        <UiButton
          :variant="item.isInContext ? 'secondary' : 'ghost'"
          size="sm"
          class="echoes-action-btn echoes-action-btn-context"
          :class-name="[
            'echoes-action-btn',
            'echoes-action-btn-context',
            item.isInContext ? 'echoes-action-btn-context--active' : ''
          ].filter(Boolean).join(' ')"
          @click="onContextClick(item)"
        >
          {{ item.isInContext ? 'Remove' : '+ Context' }}
        </UiButton>
      </div>
    </article>
  </section>
</template>

<style scoped>
.pane-card {
  position: relative;
  border-radius: 10px;
  background: var(--echoes-card-bg);
  padding: 10px 8px 8px 10px;
  box-shadow: inset 0 0 0 1px var(--echoes-card-border);
  transition: box-shadow 160ms ease, background-color 160ms ease;
}

.pane-card:hover {
  box-shadow: inset 0 0 0 1px var(--echoes-card-hover-border);
}

.pane-section {
  position: relative;
}

.echoes-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.section-title {
  margin: 2px 0 2px;
  font-size: 11px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--echoes-title);
}

.echoes-helper {
  margin: 0;
  color: var(--echoes-copy);
  font-size: 12px;
  line-height: 1.4;
}

.echoes-count {
  color: var(--echoes-title);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.empty-state {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
  padding: 8px;
  border-radius: 8px;
  background: var(--echoes-empty-bg);
}

.echoes-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  margin: 8px 0 0;
  border-radius: 10px;
  background: var(--echoes-empty-bg);
  box-shadow: inset 0 0 0 1px var(--echoes-item-hover-border);
}

.echoes-card[data-in-context='true'] {
  box-shadow: inset 0 0 0 1px var(--right-pane-accent, var(--echoes-item-hover-border));
}

.echoes-card-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.echoes-item-title,
.echoes-item-path,
.echoes-item-reason {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.echoes-item-title {
  font-size: 14px;
  color: var(--echoes-item-title);
}

.echoes-item-reason {
  font-size: 12px;
  color: var(--echoes-copy);
}

.echoes-item-path {
  font-size: 11px;
  color: var(--echoes-item-path);
}

.echoes-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.echoes-action-btn {
  min-height: 2rem;
}

.echoes-action-btn-context {
  color: var(--right-pane-favorite);
}

.echoes-action-btn-context--active {
  color: var(--right-pane-text);
}
</style>
