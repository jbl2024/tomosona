<script setup lang="ts">
/**
 * EditorRightPane
 *
 * Purpose:
 * - Render the right-side outline/backlinks/metadata/properties panel.
 *
 * Boundaries:
 * - Stateless rendering component.
 * - Emits user intents (`outline-click`, `backlink-open`) and relies on parent
 *   for navigation and data loading.
 */
import { computed, ref, watch } from 'vue'
import { ChevronRightIcon, StarIcon as StarOutlineIcon } from '@heroicons/vue/24/outline'
import { StarIcon as StarSolidIcon } from '@heroicons/vue/24/solid'
import type { EchoesItem } from '../../echoes/lib/echoes'
import EditorEchoesPanel from './editor/EditorEchoesPanel.vue'

type HeadingNode = { level: 1 | 2 | 3; text: string }
type PropertyPreviewRow = { key: string; value: string }
type MetadataRow = { label: string; value: string }
type SemanticLinkRow = { path: string; score: number | null; direction: 'incoming' | 'outgoing' }

const props = defineProps<{
  width: number
  activeNotePath: string
  canToggleFavorite: boolean
  isFavorite: boolean
  echoesItems: EchoesItem[]
  echoesLoading: boolean
  echoesError: string
  echoesHintVisible: boolean
  outline: HeadingNode[]
  semanticLinks: SemanticLinkRow[]
  semanticLinksLoading: boolean
  backlinks: string[]
  backlinksLoading: boolean
  metadataRows: MetadataRow[]
  propertiesPreview: PropertyPreviewRow[]
  propertyParseErrorCount: number
  toRelativePath: (path: string) => string
}>()

const emit = defineEmits<{
  'toggle-favorite': []
  'echoes-open': [path: string]
  'outline-click': [payload: { index: number; heading: HeadingNode }]
  'backlink-open': [path: string]
}>()

const outlineExpanded = ref(false)
const semanticExpanded = ref(true)
const backlinksExpanded = ref(true)
const hasEchoesContent = computed(() => props.echoesItems.length > 0 && !props.echoesLoading && !props.echoesError)

watch(
  hasEchoesContent,
  (hasEchoes) => {
    semanticExpanded.value = !hasEchoes
    backlinksExpanded.value = !hasEchoes
  },
  { immediate: true }
)
</script>

<template>
  <aside class="right-pane" :style="{ width: `${props.width}px` }">
    <section class="pane-card pane-toolbar">
      <div class="pane-toolbar-row">
        <div class="pane-toolbar-copy">
          <h3 class="section-title pane-toolbar-title">Active Note</h3>
          <p class="pane-toolbar-path" :title="props.activeNotePath || 'No active note'">
            {{ props.activeNotePath ? props.toRelativePath(props.activeNotePath) : 'No active note' }}
          </p>
        </div>
        <button
          type="button"
          class="favorite-toggle-btn"
          :class="{ 'favorite-toggle-btn--active': props.isFavorite }"
          :disabled="!props.canToggleFavorite"
          :title="props.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'"
          :aria-label="props.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'"
          @click="emit('toggle-favorite')"
        >
          <StarSolidIcon v-if="props.isFavorite" />
          <StarOutlineIcon v-else />
        </button>
      </div>
    </section>

    <EditorEchoesPanel
      :items="props.echoesItems"
      :loading="props.echoesLoading"
      :error="props.echoesError"
      :hint-visible="props.echoesHintVisible"
      :to-relative-path="props.toRelativePath"
      @open="emit('echoes-open', $event)"
    />

    <section class="pane-card pane-section">
      <button type="button" class="section-toggle" @click="outlineExpanded = !outlineExpanded">
        <h3 class="section-title">Outline</h3>
        <ChevronRightIcon class="section-toggle-chevron" :class="{ expanded: outlineExpanded }" />
      </button>
      <template v-if="outlineExpanded">
        <div v-if="!props.outline.length" class="empty-state">No headings</div>
        <button
          v-for="(heading, idx) in props.outline"
          :key="`${heading.text}-${idx}`"
          type="button"
          class="pane-item outline-row"
          :style="{ paddingLeft: `${(heading.level - 1) * 12 + 8}px` }"
          @click="emit('outline-click', { index: idx, heading })"
        >
          {{ heading.text }}
        </button>
      </template>
    </section>

    <section class="pane-card pane-section">
      <button type="button" class="section-toggle" @click="semanticExpanded = !semanticExpanded">
        <h3 class="section-title">Semantic Links</h3>
        <ChevronRightIcon class="section-toggle-chevron" :class="{ expanded: semanticExpanded }" />
      </button>
      <template v-if="semanticExpanded">
        <div v-if="props.semanticLinksLoading" class="empty-state">Loading...</div>
        <div v-else-if="!props.semanticLinks.length" class="empty-state">No semantic links</div>
        <button
          v-for="item in props.semanticLinks"
          :key="`semantic-${item.path}`"
          type="button"
          class="pane-item semantic-link-item"
          @click="emit('backlink-open', item.path)"
        >
          <span class="semantic-link-path">{{ props.toRelativePath(item.path) }}</span>
          <span class="semantic-link-meta">
            <span class="semantic-link-direction">{{ item.direction === 'outgoing' ? 'out' : 'in' }}</span>
          </span>
        </button>
      </template>
    </section>

    <section class="pane-card pane-section">
      <button type="button" class="section-toggle" @click="backlinksExpanded = !backlinksExpanded">
        <h3 class="section-title">Backlinks</h3>
        <ChevronRightIcon class="section-toggle-chevron" :class="{ expanded: backlinksExpanded }" />
      </button>
      <template v-if="backlinksExpanded">
        <div v-if="props.backlinksLoading" class="empty-state">Loading...</div>
        <div v-else-if="!props.backlinks.length" class="empty-state">No backlinks</div>
        <button
          v-for="path in props.backlinks"
          :key="path"
          type="button"
          class="pane-item"
          @click="emit('backlink-open', path)"
        >
          {{ props.toRelativePath(path) }}
        </button>
      </template>
    </section>

    <section class="pane-card pane-section">
      <h3 class="section-title">Metadata</h3>
      <div class="metadata-grid">
        <div v-for="row in props.metadataRows" :key="row.label" class="meta-row">
          <span class="meta-label">{{ row.label }}</span>
          <span class="meta-value" :title="row.value">{{ row.value }}</span>
        </div>
      </div>
    </section>

    <section class="pane-card pane-section">
      <h3 class="section-title">Properties</h3>
      <div v-if="props.propertyParseErrorCount > 0" class="empty-state">
        {{ props.propertyParseErrorCount }} parse error{{ props.propertyParseErrorCount > 1 ? 's' : '' }}
      </div>
      <div v-else-if="!props.propertiesPreview.length" class="empty-state">No properties</div>
      <div v-else class="metadata-grid">
        <div v-for="row in props.propertiesPreview" :key="row.key" class="meta-row">
          <span class="meta-label">{{ row.key }}</span>
          <span class="meta-value" :title="row.value">{{ row.value }}</span>
        </div>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.right-pane {
  min-width: 0;
  min-height: 0;
  background: var(--right-pane-bg);
  border-left: 1px solid var(--right-pane-border);
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding: 12px 10px 14px;
}

.pane-card {
  position: relative;
  border-radius: 10px;
  background: var(--right-pane-card-bg);
  padding: 10px 8px 8px 10px;
  box-shadow: inset 0 0 0 1px var(--right-pane-card-border);
  transition: box-shadow 160ms ease, background-color 160ms ease;
}

.pane-section {
  position: relative;
}

.pane-card:hover {
  box-shadow: inset 0 0 0 1px var(--right-pane-card-hover);
}

.pane-toolbar {
  padding: 10px;
}

.pane-toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.pane-toolbar-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pane-toolbar-title {
  margin-bottom: 0;
}

.pane-toolbar-path {
  margin: 0;
  font-size: 12px;
  color: var(--right-pane-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-title {
  margin: 2px 0 6px;
  font-size: 11px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--right-pane-title);
}

.favorite-toggle-btn {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--right-pane-text-soft);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 140ms ease,
    border-color 140ms ease,
    color 140ms ease,
    box-shadow 140ms ease,
    transform 90ms ease;
}

.favorite-toggle-btn:hover:not(:disabled) {
  background: var(--right-pane-item-hover);
  color: var(--right-pane-text);
}

.favorite-toggle-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.favorite-toggle-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.favorite-toggle-btn--active {
  color: var(--right-pane-favorite);
}

.favorite-toggle-btn--active:hover:not(:disabled) {
  color: var(--right-pane-favorite-hover);
}

.favorite-toggle-btn :deep(svg) {
  width: 14px;
  height: 14px;
}

.pane-item {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 5px 8px;
  border-radius: 8px;
  margin: 2px 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--right-pane-text);
  transition: background-color 120ms ease, color 120ms ease;
}

.outline-row {
  font-weight: 500;
}

.semantic-link-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.semantic-link-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.semantic-link-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.semantic-link-direction {
  font-size: 10px;
  line-height: 1;
  border-radius: 999px;
  padding: 2px 6px;
  font-weight: 600;
}

.semantic-link-direction {
  color: var(--right-pane-text-soft);
  background: var(--right-pane-item-hover);
}

.pane-item:hover {
  background: var(--right-pane-item-hover);
  color: var(--right-pane-text);
}

.metadata-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: baseline;
}

.meta-label {
  font-size: 11px;
  color: var(--right-pane-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.meta-value {
  font-size: 12px;
  color: var(--right-pane-text);
  font-weight: 500;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-state {
  color: var(--right-pane-text-dim);
  font-size: 12px;
  line-height: 1.45;
  padding: 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--right-pane-border) 24%, transparent);
}

.section-toggle {
  width: 100%;
  border: 0;
  padding: 0;
  margin: 0 0 6px;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-toggle-chevron {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  color: var(--right-pane-text-dim);
  transition: transform 140ms ease;
}

.section-toggle-chevron.expanded {
  transform: rotate(90deg);
}

</style>
