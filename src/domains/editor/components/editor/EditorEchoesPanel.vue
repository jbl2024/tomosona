<script setup lang="ts">
/**
 * Presentational Echoes panel for the note-side context surface.
 *
 * The component renders explainable suggestions and emits only user intents.
 * Reindexing stays in the shell so this surface remains presentational.
 */
import {
  ArrowTopRightOnSquareIcon,
  PlusIcon,
} from '@heroicons/vue/24/outline'
import { computed } from 'vue'
import type { EchoesItem } from '../../../echoes/lib/echoes'
import UiButton from '../../../../shared/components/ui/UiButton.vue'
import UiIconButton from '../../../../shared/components/ui/UiIconButton.vue'

type EditorEchoesListItem = EchoesItem & {
  isInContext: boolean
}

const props = defineProps<{
  items: EditorEchoesListItem[]
  loading: boolean
  error: string
  hintVisible: boolean
  indexingState: 'indexed' | 'indexing' | 'out_of_sync'
  canReindex: boolean
  toRelativePath: (path: string) => string
}>()

const emit = defineEmits<{
  open: [path: string]
  add: [path: string]
  remove: [path: string]
  reindex: []
}>()

type EchoesRenderItem = EditorEchoesListItem & {
  signalLabel: string
  signalTone: string
  dividerBefore: boolean
}

function reasonMeta(reason: string) {
  switch (reason) {
    case 'Direct link':
      return {
        label: 'direct link',
        tone: 'echoes-signal--direct'
      }
    case 'Backlink':
      return {
        label: 'backlink',
        tone: 'echoes-signal--backlink'
      }
    case 'Semantically related':
      return {
        label: 'semantic similarity',
        tone: 'echoes-signal--semantic'
      }
    case 'Recently active':
      return {
        label: 'recent activity',
        tone: 'echoes-signal--recent'
      }
    default:
      return {
        label: reason.toLowerCase(),
        tone: 'echoes-signal--default'
      }
  }
}

const visibleItems = computed<EchoesRenderItem[]>(() => {
  return props.items.slice(0, 5).map((item, index, list) => {
    const meta = reasonMeta(item.reasonLabel)
    const previous = index > 0 ? reasonMeta(list[index - 1].reasonLabel) : null
    return {
      ...item,
      signalLabel: meta.label,
      signalTone: meta.tone,
      dividerBefore: previous != null && previous.tone !== meta.tone
    }
  })
})

const isReindexing = computed(() => props.indexingState === 'indexing')

const reindexLabel = computed(() => {
  if (isReindexing.value) return 'Reindexing in progress'
  if (!props.canReindex) return 'No active note to reindex'
  return 'Reindex active note'
})

function addVisibleItemsToContext() {
  for (const item of visibleItems.value) {
    if (item.isInContext) continue
    emit('add', item.path)
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
  emit('open', item.path)
}
</script>

<template>
  <section class="pane-card pane-section" :data-indexing-state="props.indexingState">
    <div class="echoes-head">
      <div class="echoes-heading">
        <UiIconButton
          variant="ghost"
          size="sm"
          class-name="echoes-mark-btn"
          :disabled="!props.canReindex || isReindexing"
          :title="reindexLabel"
          :aria-label="reindexLabel"
          @click="emit('reindex')"
        >
          <span class="echoes-mark" aria-hidden="true">
            <span class="echoes-mark-bar echoes-mark-bar--short"></span>
            <span class="echoes-mark-bar echoes-mark-bar--tall"></span>
            <span class="echoes-mark-bar echoes-mark-bar--mid"></span>
          </span>
        </UiIconButton>
        <h3 class="section-title">Echoes</h3>
      </div>
      <button
        v-if="!loading && !error && items.length"
        type="button"
        class="echoes-count"
        @click="addVisibleItemsToContext"
      >
        {{ items.length }} suggestion{{ items.length > 1 ? 's' : '' }}
      </button>
    </div>
    <p v-if="hintVisible" class="echoes-helper">Suggestions around this note.</p>

    <div v-if="loading" class="empty-state">Loading...</div>
    <div v-else-if="error" class="empty-state">{{ error }}</div>
    <div v-else-if="!items.length" class="empty-state">
      Echoes surfaces nearby notes when Tomosona finds strong local context.
    </div>

    <article
      v-for="item in visibleItems"
      v-else
      :key="`echo-${item.path}`"
      class="echoes-card"
      :data-in-context="item.isInContext"
      :data-signal-tone="item.signalTone"
      @click="onCardClick(item)"
    >
      <div v-if="item.dividerBefore" class="echoes-divider" aria-hidden="true"></div>
      <div class="echoes-card-accent" aria-hidden="true"></div>
      <div class="echoes-card-copy">
        <strong
          class="echoes-item-title"
          :class="{ 'echoes-item-title--in-context': item.isInContext }"
          :title="props.toRelativePath(item.path)"
        >
          {{ item.title }}
        </strong>
        <span
          class="echoes-signal"
          :class="item.signalTone"
          :title="item.signalLabel"
          :aria-label="item.signalLabel"
        >
          {{ item.signalLabel }}
        </span>
      </div>
      <div class="echoes-card-actions">
        <UiIconButton
          variant="ghost"
          size="sm"
          class-name="echoes-open-btn"
          :title="`Open ${props.toRelativePath(item.path)}`"
          :aria-label="`Open ${props.toRelativePath(item.path)}`"
          @click.stop="emit('open', item.path)"
        >
          <ArrowTopRightOnSquareIcon />
        </UiIconButton>
        <UiButton
          variant="secondary"
          size="sm"
          :class-name="[
            'echoes-action-btn',
            item.isInContext ? 'echoes-action-btn--active' : ''
          ].filter(Boolean).join(' ')"
          @click.stop="onContextClick(item)"
        >
          <template v-if="!item.isInContext">
            <PlusIcon class="echoes-action-icon" />
            Add
          </template>
          <template v-else>Remove</template>
        </UiButton>
      </div>
    </article>
  </section>
</template>

<style scoped>
.pane-card {
  position: relative;
  border-radius: 12px;
  background: var(--echoes-card-bg);
  padding: 16px;
  box-shadow: inset 0 0 0 1px var(--right-pane-card-border);
  transition: box-shadow 160ms ease, background-color 160ms ease;
}

.pane-card:hover {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--right-pane-card-border) 88%, var(--echoes-card-hover-border));
}

.pane-section {
  position: relative;
  --echoes-header-accent: var(--echoes-icon);
  --echoes-header-accent-muted: var(--echoes-icon-secondary);
  --echoes-header-accent-soft: color-mix(in srgb, var(--echoes-icon) 14%, var(--surface-bg));
  --echoes-header-accent-border: var(--echoes-card-hover-border);
  --echoes-header-accent-hover-bg: color-mix(in srgb, var(--echoes-header-accent-soft) 78%, var(--surface-bg));
}

.pane-section[data-indexing-state='indexing'] {
  --echoes-header-accent: var(--echoes-reindexing-icon);
  --echoes-header-accent-muted: var(--echoes-reindexing-text);
  --echoes-header-accent-soft: var(--echoes-reindexing-bg);
  --echoes-header-accent-border: var(--echoes-reindexing-border);
  --echoes-header-accent-hover-bg: color-mix(in srgb, var(--echoes-reindexing-bg) 72%, var(--surface-bg));
}

.echoes-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.echoes-heading {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.echoes-mark {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: currentColor;
}

.echoes-mark-btn {
  color: var(--echoes-icon) !important;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  border-radius: 999px;
  width: 1.8rem;
  min-width: 1.8rem;
  height: 1.8rem;
  transition:
    color 140ms ease,
    opacity 140ms ease;
}

.echoes-mark-btn:hover:not(:disabled),
.echoes-mark-btn:focus-visible:not(:disabled) {
  color: var(--echoes-icon-hover) !important;
  opacity: 1;
}

.pane-section[data-indexing-state='indexing'] .echoes-mark-btn {
  color: var(--echoes-reindexing-icon) !important;
}

.pane-section[data-indexing-state='indexing'] .echoes-mark-btn:hover:not(:disabled),
.pane-section[data-indexing-state='indexing'] .echoes-mark-btn:focus-visible:not(:disabled) {
  color: color-mix(in srgb, var(--echoes-reindexing-icon) 88%, var(--echoes-item-title)) !important;
}

.echoes-mark-btn:disabled {
  color: var(--echoes-header-accent-muted);
  opacity: 0.92;
}

.echoes-mark-bar {
  width: 4px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.9;
  animation: echoes-pulse 2.2s ease-in-out infinite;
}

.echoes-mark-bar--short {
  height: 6px;
  animation-delay: 0s;
}

.echoes-mark-bar--tall {
  height: 12px;
  animation-delay: 0.16s;
}

.echoes-mark-bar--mid {
  height: 8px;
  animation-delay: 0.32s;
}

.section-title {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--echoes-title);
}

.echoes-helper {
  margin: 8px 0 2px;
  color: var(--echoes-copy);
  font-size: 11px;
  line-height: 1.4;
}

.echoes-count {
  color: var(--echoes-header-accent);
  font-size: 11px;
  font-family: var(--font-code);
  letter-spacing: 0.08em;
  font-weight: 600;
  white-space: nowrap;
  padding: 0.38rem 0.82rem;
  border-radius: 999px;
  background: var(--echoes-header-accent-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--echoes-header-accent-border) 48%, var(--right-pane-card-border));
  transition: background-color 140ms ease, box-shadow 140ms ease, color 140ms ease;
}

.echoes-count:hover,
.echoes-count:focus-visible {
  color: var(--echoes-item-title);
  background: var(--echoes-header-accent-hover-bg);
  box-shadow: inset 0 0 0 1px var(--echoes-header-accent-border);
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
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  margin: 0;
  border-radius: 12px;
  background: transparent;
  box-shadow: inset 0 0 0 1px transparent;
  transition:
    background-color 140ms ease,
    box-shadow 140ms ease,
    transform 140ms ease;
  cursor: pointer;
}

.echoes-card + .echoes-card {
  margin-top: 4px;
}

.echoes-head + .echoes-card,
.echoes-helper + .echoes-card,
.empty-state + .echoes-card {
  margin-top: 10px;
}

.echoes-card:hover {
  background: var(--right-pane-item-hover);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--right-pane-card-border) 48%, transparent);
}

.echoes-card[data-signal-tone='echoes-signal--backlink']:hover {
  --echoes-item-hover-border: color-mix(in srgb, var(--accent) 70%, var(--text-soft));
}

.echoes-card[data-signal-tone='echoes-signal--semantic']:hover {
  --echoes-item-hover-border: color-mix(in srgb, var(--success) 70%, var(--text-soft));
}

.echoes-card[data-signal-tone='echoes-signal--recent']:hover {
  --echoes-item-hover-border: color-mix(in srgb, var(--warning) 74%, var(--text-soft));
}

.echoes-card[data-signal-tone='echoes-signal--direct']:hover,
.echoes-card[data-signal-tone='echoes-signal--default']:hover {
  --echoes-item-hover-border: color-mix(in srgb, var(--accent) 66%, var(--text-soft));
}

.echoes-divider {
  position: absolute;
  top: -8px;
  left: 12px;
  right: 12px;
  height: 1px;
  background: color-mix(in srgb, var(--right-pane-card-border) 88%, transparent);
}

.echoes-card-accent {
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 999px;
  background: transparent;
  opacity: 0;
  transition: opacity 140ms ease, background-color 140ms ease;
}

.echoes-card:hover .echoes-card-accent,
.echoes-card:focus-within .echoes-card-accent {
  opacity: 1;
  background: var(--echoes-item-hover-border);
}

.echoes-card-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 3px;
}

.echoes-item-title,
.echoes-signal {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.echoes-item-title {
  font-size: 11.5px;
  line-height: 1.2;
  font-weight: 500;
  color: var(--echoes-item-title);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  white-space: normal;
}

.echoes-item-title--in-context {
  color: var(--text-dim);
}

.echoes-signal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 1.28rem;
  padding: 0.06rem 0.42rem;
  border-radius: 0.38rem;
  box-shadow: inset 0 0 0 1px transparent;
  font-size: 8.5px;
  font-family: var(--font-code);
  font-weight: 550;
  line-height: 1.1;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.echoes-signal--backlink {
  background: color-mix(in srgb, var(--accent) 14%, var(--surface-bg));
  color: color-mix(in srgb, var(--accent) 80%, var(--text-main));
}

.echoes-signal--semantic {
  background: color-mix(in srgb, var(--success) 14%, var(--surface-bg));
  color: color-mix(in srgb, var(--success) 82%, var(--text-main));
}

.echoes-signal--recent {
  background: color-mix(in srgb, var(--warning) 16%, var(--surface-bg));
  color: color-mix(in srgb, var(--warning) 86%, var(--text-main));
}

.echoes-signal--direct,
.echoes-signal--default {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-bg));
  color: color-mix(in srgb, var(--accent) 74%, var(--text-main));
}

.echoes-card-actions {
  position: absolute;
  top: 50%;
  right: 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(calc(-50% - 2px));
  transition: opacity 140ms ease, transform 140ms ease;
}

.echoes-card:hover .echoes-card-actions,
.echoes-card:focus-within .echoes-card-actions {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(-50%);
}

.echoes-action-btn {
  min-width: 1.8rem;
  height: 1.8rem;
  padding-inline: 0.56rem;
  font-size: 11px;
  font-weight: 500;
  gap: 0.28rem;
  border-radius: 0.5rem;
}

.echoes-open-btn {
  color: var(--echoes-icon-secondary);
  background: transparent;
  box-shadow: none;
  border-color: transparent;
  width: 1.8rem;
  min-width: 1.8rem;
  height: 1.8rem;
  border-radius: 0.5rem;
}

.echoes-open-btn:hover,
.echoes-open-btn:focus-visible {
  color: var(--echoes-item-title);
  border-color: transparent;
}

.echoes-open-btn:deep(svg) {
  width: 0.9rem;
  height: 0.9rem;
}

.echoes-action-icon {
  width: 0.82rem;
  height: 0.82rem;
  flex: 0 0 auto;
}

.echoes-action-btn--active {
  color: var(--right-pane-text);
}

@keyframes echoes-pulse {
  0%,
  100% {
    opacity: 0.35;
  }

  50% {
    opacity: 0.8;
  }
}
</style>
