<script setup lang="ts">
/**
 * EditorRightPane
 *
 * Purpose:
 * - Render note metadata, outline, and links.
 *
 * Boundaries:
 * - Stateless rendering component.
 * - Emits user intents and relies on the shell for navigation, state updates,
 *   and cross-surface orchestration.
 */
import { ref } from 'vue'
import { ChevronRightIcon, ClockIcon, StarIcon as StarOutlineIcon } from '@heroicons/vue/24/outline'
import { StarIcon as StarSolidIcon } from '@heroicons/vue/24/solid'
import UiButton from '../../../shared/components/ui/UiButton.vue'

type HeadingNode = { level: 1 | 2 | 3; text: string }
type PropertyPreviewRow = { key: string; value: string }
type MetadataRow = { label: string; value: string }

const props = defineProps<{
  width: number
  activeNotePath: string
  activeNoteTitle: string
  activeStateLabel: string
  activeNoteSourceToggleLabel?: string
  backlinkCount: number
  canToggleFavorite: boolean
  isFavorite: boolean
  indexingState: 'indexed' | 'indexing' | 'out_of_sync'
  outline: HeadingNode[]
  backlinks: string[]
  backlinksLoading: boolean
  backlinksError: string
  metadataRows: MetadataRow[]
  propertiesPreview: PropertyPreviewRow[]
  propertyParseErrorCount: number
  toRelativePath: (path: string) => string
}>()

const emit = defineEmits<{
  'toggle-favorite': []
  'open-note-history': []
  'active-note-toggle-source-mode': []
  'outline-click': [payload: { index: number; heading: HeadingNode }]
  'backlink-open': [path: string]
}>()

const outlineExpanded = ref(false)
const backlinksExpanded = ref(false)
const metadataExpanded = ref(false)
const propertiesExpanded = ref(false)
const activeNoteExpanded = ref(true)
</script>

<template>
  <aside class="right-pane" :style="{ width: `${props.width}px` }">
    <section class="pane-card pane-toolbar">
      <button type="button" class="section-toggle active-note-section-toggle" @click="activeNoteExpanded = !activeNoteExpanded">
        <h3 class="section-title pane-toolbar-title">Active Note</h3>
        <ChevronRightIcon class="section-toggle-chevron" :class="{ expanded: activeNoteExpanded }" />
      </button>
      <template v-if="activeNoteExpanded">
        <div class="pane-toolbar-header">
          <p class="pane-toolbar-note-title">{{ props.activeNoteTitle || 'No active note' }}</p>
        </div>
        <div class="pane-toolbar-actions">
          <UiButton
            variant="ghost"
            size="sm"
            :class-name="`favorite-toggle-btn ${props.isFavorite ? 'favorite-toggle-btn--active' : ''}`"
            :disabled="!props.canToggleFavorite"
            :title="props.isFavorite ? 'Remove from favorites' : 'Add to favorites'"
            :aria-label="props.isFavorite ? 'Remove from favorites' : 'Add to favorites'"
            @click="emit('toggle-favorite')"
          >
            <StarSolidIcon v-if="props.isFavorite" />
            <StarOutlineIcon v-else />
            {{ props.isFavorite ? 'Remove from favorites' : 'Add to favorites' }}
          </UiButton>
          <div class="pane-toolbar-divider" aria-hidden="true"></div>

          <UiButton
            variant="ghost"
            size="sm"
            class-name="history-toggle-btn utility-note-btn"
            :disabled="!props.activeNotePath"
            title="Open Note History"
            aria-label="Open Note History"
            @click="emit('open-note-history')"
          >
            <ClockIcon />
            History
          </UiButton>

          <UiButton
            v-if="props.activeNoteSourceToggleLabel"
            variant="ghost"
            size="sm"
            class-name="utility-note-btn tertiary-note-btn"
            :disabled="!props.activeNotePath"
            @click="emit('active-note-toggle-source-mode')"
          >
            <span class="menu-row-spacer" aria-hidden="true"></span>
            {{ props.activeNoteSourceToggleLabel }}
          </UiButton>
        </div>
      </template>
    </section>

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
      <button type="button" class="section-toggle" @click="backlinksExpanded = !backlinksExpanded">
        <h3 class="section-title">Backlinks</h3>
        <ChevronRightIcon class="section-toggle-chevron" :class="{ expanded: backlinksExpanded }" />
      </button>
      <template v-if="backlinksExpanded">
        <div v-if="props.backlinksLoading" class="empty-state">Loading...</div>
        <template v-else>
          <div v-if="props.backlinksError" class="empty-state">{{ props.backlinksError }}</div>
          <div v-if="!props.backlinks.length && !props.backlinksError" class="empty-state">No backlinks</div>
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
      </template>
    </section>

    <section class="pane-card pane-section">
      <button type="button" class="section-toggle" @click="metadataExpanded = !metadataExpanded">
        <h3 class="section-title">Metadata</h3>
        <ChevronRightIcon class="section-toggle-chevron" :class="{ expanded: metadataExpanded }" />
      </button>
      <div v-if="metadataExpanded" class="metadata-grid">
        <div v-for="row in props.metadataRows" :key="row.label" class="meta-row">
          <span class="meta-label">{{ row.label }}</span>
          <span class="meta-value" :title="row.value">{{ row.value }}</span>
        </div>
      </div>
    </section>

    <section class="pane-card pane-section">
      <button type="button" class="section-toggle" @click="propertiesExpanded = !propertiesExpanded">
        <h3 class="section-title">Properties</h3>
        <ChevronRightIcon class="section-toggle-chevron" :class="{ expanded: propertiesExpanded }" />
      </button>
      <template v-if="propertiesExpanded">
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
      </template>
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
  overscroll-behavior: contain;
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
  padding: 10px 10px 9px;
}

.pane-toolbar-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pane-toolbar-note-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--right-pane-text);
  line-height: 1.2;
}

.pane-toolbar-actions {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
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
  justify-content: flex-start;
  width: 100%;
  padding-inline: 0.45rem;
  text-align: left;
  color: var(--right-pane-text-soft);
}

.favorite-toggle-btn--active {
  color: var(--right-pane-favorite);
}

.favorite-toggle-btn :deep(svg) {
  width: 0.8rem;
  height: 0.8rem;
}

.menu-row-spacer {
  display: inline-block;
  width: 14px;
  flex: 0 0 14px;
}

.history-toggle-btn {
  min-width: 0;
  justify-content: flex-start;
  width: 100%;
  padding-inline: 0.45rem;
  text-align: left;
}

.history-toggle-btn :deep(svg),
.utility-note-btn :deep(svg) {
  width: 14px;
  height: 14px;
}

.primary-context-btn,
.context-primary-cta {
  width: 100%;
  margin-top: 0;
  justify-content: flex-start;
  padding-inline: 0.45rem;
  text-align: left;
}

.secondary-note-btn {
  width: 100%;
  margin-top: 0;
  justify-content: flex-start;
  padding-inline: 0.45rem;
  text-align: left;
}

.pane-toolbar-divider {
  height: 1px;
  margin: 2px 0 1px;
  background: color-mix(in srgb, var(--right-pane-border) 24%, transparent);
}

.utility-note-btn {
  justify-content: flex-start;
  width: 100%;
  margin-top: 0;
  padding-inline: 0.45rem;
  text-align: left;
  color: var(--right-pane-text-dim);
}

.favorite-toggle-btn :deep(.ui-button),
.primary-context-btn :deep(.ui-button),
.secondary-note-btn :deep(.ui-button),
.history-toggle-btn :deep(.ui-button),
.utility-note-btn :deep(.ui-button) {
  min-height: 1.85rem;
  height: 1.85rem;
  padding-inline: 0.45rem;
}

.tertiary-note-btn {
  align-self: flex-start;
}

.tertiary-note-btn:hover,
.tertiary-note-btn:focus-visible {
  color: var(--right-pane-text);
  background: transparent;
}

.context-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.context-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.context-head-copy {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.context-count {
  margin: 0;
  color: var(--right-pane-text-dim);
  font-size: 11px;
  white-space: nowrap;
}

.context-actions {
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
  margin-left: auto;
}

.context-icon-btn {
  min-width: 1.9rem;
  width: 1.9rem;
  height: 1.9rem;
  padding: 0;
  color: var(--right-pane-text-soft);
}

.context-icon-btn:hover,
.context-icon-btn:focus-visible {
  color: var(--right-pane-text);
}

.context-icon-btn :deep(svg) {
  width: 0.95rem;
  height: 0.95rem;
}

.context-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.context-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
}

.context-open-btn {
  flex: 1 1 auto;
  min-width: 0;
  margin-top: 0;
}

.context-open-btn:hover,
.pane-item:hover {
  background: var(--right-pane-item-hover);
  color: var(--right-pane-text);
}

.context-row-title,
.context-row-path {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-row-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--right-pane-text);
}

.context-row-path {
  font-size: 11px;
  color: var(--right-pane-text-dim);
}

.context-open-btn:deep(.ui-button) {
  justify-content: flex-start;
  text-align: left;
  min-height: 1.85rem;
  height: 1.85rem;
  padding-inline: 0.45rem;
}

.context-open-btn:deep(.ui-button > span:last-child) {
  display: block;
  width: 100%;
  text-align: left;
  margin-right: auto;
}

.context-open-btn:deep(.ui-button__spinner),
.context-open-btn:deep(.ui-button__icon) {
  display: none;
}

.context-remove-btn {
  min-width: 1.85rem;
  width: 1.85rem;
  padding-inline: 0;
  margin-top: 0;
  color: var(--right-pane-text-dim);
}

.action-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.context-secondary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
  color: var(--right-pane-text-soft);
  background: var(--right-pane-item-hover);
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
