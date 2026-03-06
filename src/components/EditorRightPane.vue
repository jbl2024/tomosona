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
import type { EchoesItem } from '../lib/echoes'
import EditorEchoesPanel from './editor/EditorEchoesPanel.vue'

type HeadingNode = { level: 1 | 2 | 3; text: string }
type PropertyPreviewRow = { key: string; value: string }
type MetadataRow = { label: string; value: string }
type SemanticLinkRow = { path: string; score: number | null; direction: 'incoming' | 'outgoing' }

const props = defineProps<{
  width: number
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
  'echoes-open': [path: string]
  'outline-click': [payload: { index: number; heading: HeadingNode }]
  'backlink-open': [path: string]
}>()
</script>

<template>
  <aside class="right-pane" :style="{ width: `${props.width}px` }">
    <EditorEchoesPanel
      :items="props.echoesItems"
      :loading="props.echoesLoading"
      :error="props.echoesError"
      :hint-visible="props.echoesHintVisible"
      :to-relative-path="props.toRelativePath"
      @open="emit('echoes-open', $event)"
    />

    <section class="pane-card pane-section">
      <h3 class="section-title">Outline</h3>
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
    </section>

    <section class="pane-card pane-section">
      <h3 class="section-title">Semantic Links</h3>
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
          <span v-if="item.score != null" class="semantic-link-score">{{ item.score.toFixed(2) }}</span>
        </span>
      </button>
    </section>

    <section class="pane-card pane-section">
      <h3 class="section-title">Backlinks</h3>
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
  background: #f6f8fb;
  border-left: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding: 12px 10px 14px;
}

.ide-root.dark .right-pane {
  background: #1e232b;
  border-color: #3e4451;
}

.pane-card {
  position: relative;
  border-radius: 10px;
  background: #fbfcff;
  padding: 10px 8px 8px 10px;
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.15);
  transition: box-shadow 160ms ease, background-color 160ms ease;
}

.pane-section {
  position: relative;
}

.pane-card:hover {
  box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.3);
}

.ide-root.dark .pane-card {
  background: #232a33;
  box-shadow: inset 0 0 0 1px rgba(71, 85, 105, 0.35);
}

.ide-root.dark .pane-card:hover {
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.45);
}

.section-title {
  margin: 2px 0 6px;
  font-size: 11px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  font-weight: 600;
  color: #5b6472;
}

.ide-root.dark .section-title {
  color: #a8b3c4;
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
  color: #2d313a;
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

.semantic-link-direction,
.semantic-link-score {
  font-size: 10px;
  line-height: 1;
  border-radius: 999px;
  padding: 2px 6px;
  font-weight: 600;
}

.semantic-link-direction {
  color: #4b5563;
  background: #e5e7eb;
}

.semantic-link-score {
  color: #1d4ed8;
  background: #dbeafe;
}

.pane-item:hover {
  background: #eef2f8;
  color: #1f2937;
}

.ide-root.dark .pane-item {
  color: #c8d0dc;
}

.ide-root.dark .pane-item:hover {
  background: #2f3845;
  color: #e2e8f0;
}

.ide-root.dark .semantic-link-direction {
  color: #cbd5e1;
  background: #334155;
}

.ide-root.dark .semantic-link-score {
  color: #bfdbfe;
  background: #1e3a8a;
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
  color: #7b8492;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.meta-value {
  font-size: 12px;
  color: #2d313a;
  font-weight: 500;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ide-root.dark .meta-label {
  color: #8f9cb0;
}

.ide-root.dark .meta-value {
  color: #d7dce5;
}

.empty-state {
  color: #8b93a3;
  font-size: 12px;
  line-height: 1.45;
  padding: 8px;
  border-radius: 8px;
  background: rgba(148, 163, 184, 0.08);
}

.ide-root.dark .empty-state {
  color: #9aa3b2;
  background: rgba(71, 85, 105, 0.26);
}
</style>
