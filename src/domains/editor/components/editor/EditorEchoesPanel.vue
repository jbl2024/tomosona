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

function onCardClick(item: EditorEchoesListItem) {
  onContextClick(item)
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
      @click="onCardClick(item)"
    >
      <div class="echoes-card-copy">
        <button
          type="button"
          class="echoes-title-btn"
          :title="props.toRelativePath(item.path)"
          @click.stop="emit('open', item.path)"
        >
          <strong class="echoes-item-title">{{ item.title }}</strong>
        </button>
        <span class="echoes-item-reason">{{ reasonLabel(item.reasonLabel) }}</span>
      </div>
      <div class="echoes-card-actions">
        <UiButton
          variant="ghost"
          size="sm"
          :class-name="[
            'echoes-action-btn',
            item.isInContext ? 'echoes-action-btn--active' : ''
          ].filter(Boolean).join(' ')"
          @click.stop="onContextClick(item)"
        >
          {{ item.isInContext ? 'Added' : '+' }}
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
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  margin: 8px 0 0;
  border-radius: 10px;
  background: var(--echoes-empty-bg);
  box-shadow: inset 0 0 0 1px var(--echoes-item-hover-border);
  transition:
    background-color 140ms ease,
    box-shadow 140ms ease,
    transform 140ms ease;
  cursor: pointer;
}

.echoes-card:hover {
  background: color-mix(in srgb, var(--echoes-empty-bg) 72%, var(--right-pane-item-hover));
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--right-pane-favorite) 22%, var(--echoes-item-hover-border)),
    0 4px 14px color-mix(in srgb, var(--right-pane-border) 35%, transparent);
  transform: translateY(-1px);
}

.echoes-card[data-in-context='true'] {
  box-shadow: inset 0 0 0 1px var(--right-pane-accent, var(--echoes-item-hover-border));
}

.echoes-card-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  text-align: left;
}

.echoes-title-btn {
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
}

.echoes-item-title,
.echoes-item-reason {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.echoes-item-title {
  font-size: 12.5px;
  line-height: 1.3;
  font-weight: 600;
  color: var(--echoes-item-title);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  white-space: normal;
}

.echoes-title-btn:hover .echoes-item-title {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.echoes-item-reason {
  font-size: 11px;
  line-height: 1.25;
  color: var(--echoes-copy);
  white-space: nowrap;
}

.echoes-card-actions {
  flex: 0 0 auto;
}

.echoes-action-btn {
  min-width: 2rem;
  height: 2rem;
  padding-inline: 0.5rem;
  font-weight: 700;
  opacity: 0.82;
  transform: scale(0.98);
  transition: opacity 140ms ease, transform 140ms ease;
}

.echoes-card:hover .echoes-action-btn {
  opacity: 1;
  transform: scale(1);
}

.echoes-action-btn--active {
  color: var(--right-pane-text);
}
</style>
