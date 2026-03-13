<script setup lang="ts">
/**
 * EditorRightPane
 *
 * Purpose:
 * - Render the note-side context workflow: note -> Echoes -> constituted context
 *   -> Second Brain / Cosmos / Pulse.
 *
 * Boundaries:
 * - Stateless rendering component.
 * - Emits user intents and relies on the shell for navigation, state updates,
 *   and cross-surface orchestration.
 */
import { computed, ref, watch } from 'vue'
import { ChevronRightIcon, StarIcon as StarOutlineIcon } from '@heroicons/vue/24/outline'
import { StarIcon as StarSolidIcon } from '@heroicons/vue/24/solid'
import EditorEchoesPanel from './editor/EditorEchoesPanel.vue'
import UiButton from '../../../shared/components/ui/UiButton.vue'
import UiIconButton from '../../../shared/components/ui/UiIconButton.vue'
import type { ConstitutedContextItem } from '../composables/useConstitutedContext'
import type { EchoesItem } from '../../echoes/lib/echoes'

type HeadingNode = { level: 1 | 2 | 3; text: string }
type PropertyPreviewRow = { key: string; value: string }
type MetadataRow = { label: string; value: string }
type SemanticLinkRow = { path: string; score: number | null; direction: 'incoming' | 'outgoing' }
type ContextEchoesItem = EchoesItem & { isInContext: boolean }

const props = defineProps<{
  width: number
  activeNotePath: string
  activeNoteTitle: string
  activeStateLabel: string
  backlinkCount: number
  semanticLinkCount: number
  activeNoteInContext: boolean
  canToggleFavorite: boolean
  isFavorite: boolean
  echoesItems: ContextEchoesItem[]
  echoesLoading: boolean
  echoesError: string
  echoesHintVisible: boolean
  localContextItems: ConstitutedContextItem[]
  pinnedContextItems: ConstitutedContextItem[]
  contextError?: string
  canReasonOnContext: boolean
  isLaunchingContextAction: boolean
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
  'active-note-add-to-context': []
  'active-note-remove-from-context': []
  'active-note-open-cosmos': []
  'echoes-open': [path: string]
  'echoes-add-to-context': [path: string]
  'echoes-remove-from-context': [path: string]
  'outline-click': [payload: { index: number; heading: HeadingNode }]
  'backlink-open': [path: string]
  'context-open': [path: string]
  'context-remove-local': [path: string]
  'context-remove-pinned': [path: string]
  'context-pin': []
  'context-clear-local': []
  'context-clear-pinned': []
  'context-open-second-brain': []
  'context-open-cosmos': []
  'context-open-pulse': []
}>()

const outlineExpanded = ref(false)
const semanticExpanded = ref(false)
const backlinksExpanded = ref(false)
const metadataExpanded = ref(false)
const propertiesExpanded = ref(false)
const hasEchoesContent = computed(() => props.echoesItems.length > 0 && !props.echoesLoading && !props.echoesError)
const hasLocalContext = computed(() => props.localContextItems.length > 0)
const hasPinnedContext = computed(() => props.pinnedContextItems.length > 0)

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
          <p class="pane-toolbar-note-title">{{ props.activeNoteTitle || 'No active note' }}</p>
          <p class="pane-toolbar-meta">
            {{ props.activeStateLabel }}
            <template v-if="props.activeNotePath">
              <span>· {{ props.backlinkCount }} backlinks</span>
              <span>· {{ props.semanticLinkCount }} semantic links</span>
            </template>
          </p>
        </div>
        <UiIconButton
          variant="ghost"
          size="sm"
          :class-name="[
            'favorite-toggle-btn',
            props.isFavorite ? 'favorite-toggle-btn--active' : ''
          ].filter(Boolean).join(' ')"
          :disabled="!props.canToggleFavorite"
          :title="props.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'"
          :aria-label="props.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'"
          @click="emit('toggle-favorite')"
        >
          <StarSolidIcon v-if="props.isFavorite" />
          <StarOutlineIcon v-else />
        </UiIconButton>
      </div>

      <UiButton
        variant="secondary"
        size="sm"
        class-name="primary-context-btn"
        :disabled="!props.activeNotePath"
        @click="props.activeNoteInContext ? emit('active-note-remove-from-context') : emit('active-note-add-to-context')"
      >
        {{ props.activeNoteInContext ? 'Remove from Context' : 'Add to Context' }}
      </UiButton>
      <UiButton
        variant="ghost"
        size="sm"
        class-name="secondary-note-btn"
        :disabled="!props.activeNotePath"
        @click="emit('active-note-open-cosmos')"
      >
        Open in Cosmos
      </UiButton>
    </section>

    <EditorEchoesPanel
      :items="props.echoesItems"
      :loading="props.echoesLoading"
      :error="props.echoesError"
      :hint-visible="props.echoesHintVisible"
      :to-relative-path="props.toRelativePath"
      @open="emit('echoes-open', $event)"
      @add="emit('echoes-add-to-context', $event)"
      @remove="emit('echoes-remove-from-context', $event)"
    />

    <section class="pane-card pane-section context-card">
      <div class="context-head">
        <div class="context-head-copy">
          <h3 class="section-title">Context for This Note</h3>
          <p v-if="hasLocalContext" class="context-count">
            {{ props.localContextItems.length }} note{{ props.localContextItems.length > 1 ? 's' : '' }}
          </p>
        </div>
        <div class="context-actions" v-if="hasLocalContext">
          <UiButton
            variant="ghost"
            size="sm"
            class-name="context-chip-btn"
            @click="emit('context-pin')"
          >
            Pin Context
          </UiButton>
          <UiButton variant="ghost" size="sm" class-name="context-chip-btn" @click="emit('context-clear-local')">Clear</UiButton>
        </div>
      </div>

      <div v-if="props.contextError" class="empty-state">{{ props.contextError }}</div>
      <div v-else-if="!hasLocalContext" class="empty-state">Add notes from Echoes or the active note.</div>
      <div v-else class="context-list">
        <div v-for="item in props.localContextItems" :key="item.path" class="context-row">
          <UiButton
            variant="ghost"
            size="sm"
            class-name="context-open-btn !justify-start !text-left"
            :title="props.toRelativePath(item.path)"
            @click="emit('context-open', item.path)"
          >
            <span class="context-row-title">{{ item.title }}</span>
          </UiButton>
          <UiButton variant="ghost" size="sm" class-name="context-remove-btn" @click="emit('context-remove-local', item.path)">×</UiButton>
        </div>
      </div>
    </section>

    <section v-if="hasPinnedContext" class="pane-card pane-section context-card">
      <div class="context-head">
        <div class="context-head-copy">
          <h3 class="section-title">Pinned Context</h3>
          <p v-if="hasPinnedContext" class="context-count">
            {{ props.pinnedContextItems.length }} note{{ props.pinnedContextItems.length > 1 ? 's' : '' }}
          </p>
        </div>
        <div class="context-actions" v-if="hasPinnedContext">
          <UiButton variant="ghost" size="sm" class-name="context-chip-btn" @click="emit('context-clear-pinned')">Clear</UiButton>
        </div>
      </div>

      <div v-if="props.contextError" class="empty-state">{{ props.contextError }}</div>
      <div v-else class="context-list">
        <div v-for="item in props.pinnedContextItems" :key="item.path" class="context-row">
          <UiButton
            variant="ghost"
            size="sm"
            class-name="context-open-btn !justify-start !text-left"
            :title="props.toRelativePath(item.path)"
            @click="emit('context-open', item.path)"
          >
            <span class="context-row-title">{{ item.title }}</span>
          </UiButton>
          <UiButton variant="ghost" size="sm" class-name="context-remove-btn" @click="emit('context-remove-pinned', item.path)">×</UiButton>
        </div>
      </div>
    </section>

    <section class="pane-card pane-section action-card">
      <UiButton
        variant="primary"
        size="md"
        class-name="context-primary-cta"
        :disabled="!props.canReasonOnContext || props.isLaunchingContextAction"
        :loading="props.isLaunchingContextAction"
        @click="emit('context-open-second-brain')"
      >
        Reason on This Context
      </UiButton>

      <div class="context-secondary-actions">
        <UiButton
          variant="ghost"
          size="sm"
          class-name="context-link-btn"
          :disabled="!props.canReasonOnContext || props.isLaunchingContextAction"
          @click="emit('context-open-cosmos')"
        >
          Explore in Cosmos
        </UiButton>
        <UiButton
          variant="ghost"
          size="sm"
          class-name="context-link-btn"
          :disabled="!props.canReasonOnContext || props.isLaunchingContextAction"
          @click="emit('context-open-pulse')"
        >
          Transform with Pulse
        </UiButton>
      </div>
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
  align-items: flex-start;
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

.pane-toolbar-note-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--right-pane-text);
}

.pane-toolbar-meta {
  margin: 0;
  font-size: 12px;
  color: var(--right-pane-text);
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
  flex: 0 0 auto;
  color: var(--right-pane-text-soft);
}

.favorite-toggle-btn--active {
  color: var(--right-pane-favorite);
}

.favorite-toggle-btn :deep(svg) {
  width: 14px;
  height: 14px;
}

.primary-context-btn,
.context-primary-cta {
  width: 100%;
  margin-top: 10px;
}

.secondary-note-btn {
  width: 100%;
  margin-top: 8px;
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
}

.context-chip-btn {
  min-height: 1.75rem;
  padding-inline: 0.5rem;
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
