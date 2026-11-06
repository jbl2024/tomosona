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
import { ChevronRightIcon, ClockIcon, KeyIcon, LockClosedIcon, LockOpenIcon, ShieldExclamationIcon, StarIcon as StarOutlineIcon } from '@heroicons/vue/24/outline'
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
  pageProtected?: boolean
  pageLocked?: boolean
  canProtectPage?: boolean
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
  'page-protection-action': [action: 'protect' | 'unprotect' | 'change' | 'lock']
  'outline-click': [payload: { index: number; heading: HeadingNode }]
  'backlink-open': [path: string]
}>()

const outlineExpanded = ref(false)
const backlinksExpanded = ref(false)
const detailsExpanded = ref(false)
const previewLimit = 4
</script>

<template>
  <aside class="right-pane" :style="{ width: `${props.width}px` }">
    <section class="note-header">
      <h3 class="eyebrow">Active note</h3>
      <p class="note-title">{{ props.activeNoteTitle || 'No active note' }}</p>
      <p v-if="props.activeNotePath" class="note-path" :title="props.toRelativePath(props.activeNotePath)">{{ props.toRelativePath(props.activeNotePath) }}</p>
      <div v-if="props.activeNotePath && (props.activeStateLabel !== 'saved' || props.pageProtected)" class="note-status">
        <span v-if="props.activeStateLabel !== 'saved'">{{ props.activeStateLabel }}</span>
        <span v-if="props.pageProtected">{{ props.pageLocked ? 'Locked' : 'Protected' }}</span>
      </div>
      <div class="pane-toolbar-actions">
          <UiButton variant="ghost" size="sm" :class-name="`utility-note-btn favorite-toggle-btn ${props.isFavorite ? 'favorite-toggle-btn--active' : ''}`" :disabled="!props.canToggleFavorite" :aria-pressed="props.isFavorite" :title="props.isFavorite ? 'Remove from favorites' : 'Add to favorites'" :aria-label="props.isFavorite ? 'Remove from favorites' : 'Add to favorites'" @click="emit('toggle-favorite')">
            <StarSolidIcon v-if="props.isFavorite" /><StarOutlineIcon v-else />Favorite
          </UiButton>
          <UiButton v-if="props.canProtectPage && !props.pageProtected" size="sm" variant="ghost" class-name="utility-note-btn" title="Protect with password" @click="emit('page-protection-action', 'protect')"><LockClosedIcon />Protect</UiButton>
        <template v-if="props.canProtectPage && props.pageProtected">
          <UiButton size="sm" variant="ghost" class-name="utility-note-btn" @click="emit('page-protection-action', 'unprotect')"><ShieldExclamationIcon />Remove protection</UiButton>
          <UiButton size="sm" variant="ghost" class-name="utility-note-btn" @click="emit('page-protection-action', 'change')"><KeyIcon />Change password</UiButton>
          <UiButton v-if="!props.pageLocked" size="sm" variant="ghost" class-name="utility-note-btn" @click="emit('page-protection-action', 'lock')"><LockOpenIcon />Lock page</UiButton>
        </template>
        <UiButton variant="ghost" size="sm" class-name="history-toggle-btn utility-note-btn" :disabled="!props.activeNotePath" title="Open Note History" aria-label="Open Note History" @click="emit('open-note-history')"><ClockIcon />History</UiButton>
        <UiButton v-if="props.activeNoteSourceToggleLabel" variant="ghost" size="sm" class-name="utility-note-btn tertiary-note-btn" :disabled="!props.activeNotePath" @click="emit('active-note-toggle-source-mode')"><span class="source-icon" aria-hidden="true">&lt;/&gt;</span>{{ props.activeNoteSourceToggleLabel }}</UiButton>
      </div>
    </section>

    <section v-if="props.outline.length" class="pane-section">
      <div class="section-heading"><h3 class="section-title">Outline</h3><span class="count">{{ props.outline.length }}</span></div>
      <button v-for="(heading, idx) in (outlineExpanded ? props.outline : props.outline.slice(0, previewLimit))" :key="`${heading.text}-${idx}`" type="button" class="pane-item outline-row" :style="{ paddingLeft: `${(heading.level - 1) * 12 + 8}px` }" @click="emit('outline-click', { index: idx, heading })">{{ heading.text }}</button>
      <button v-if="props.outline.length > previewLimit" type="button" class="more-button" :aria-expanded="outlineExpanded" @click="outlineExpanded = !outlineExpanded">{{ outlineExpanded ? 'Show less' : `+${props.outline.length - previewLimit} more` }}</button>
    </section>

    <section class="pane-section">
      <div class="section-heading"><h3 class="section-title">Backlinks</h3><span class="count">{{ props.backlinkCount }}</span></div>
      <div v-if="props.backlinksLoading" class="empty-state">Loading...</div>
      <template v-else>
        <div v-if="props.backlinksError" class="empty-state">{{ props.backlinksError }}</div>
        <div v-else-if="!props.backlinks.length" class="empty-state">No backlinks yet</div>
        <template v-else>
          <button v-for="path in (backlinksExpanded ? props.backlinks : props.backlinks.slice(0, previewLimit))" :key="path" type="button" class="pane-item backlink-row" @click="emit('backlink-open', path)">{{ props.toRelativePath(path) }}</button>
          <button v-if="props.backlinks.length > previewLimit" type="button" class="more-button" :aria-expanded="backlinksExpanded" @click="backlinksExpanded = !backlinksExpanded">{{ backlinksExpanded ? 'Show less' : `+${props.backlinks.length - previewLimit} more` }}</button>
        </template>
      </template>
    </section>

    <section class="pane-section details-section">
      <div class="section-heading"><h3 class="section-title">Details</h3></div>
      <div class="metadata-grid">
        <div v-for="row in (detailsExpanded ? props.metadataRows : props.metadataRows.filter(row => row.label === 'Updated'))" :key="row.label" class="meta-row"><span class="meta-label">{{ row.label }}</span><span class="meta-value" :title="row.value">{{ row.value }}</span></div>
        <div v-if="props.propertyParseErrorCount" class="empty-state">{{ props.propertyParseErrorCount }} parse error{{ props.propertyParseErrorCount > 1 ? 's' : '' }}</div>
        <template v-else>
          <div v-for="row in (detailsExpanded ? props.propertiesPreview : props.propertiesPreview.slice(0, 2))" :key="row.key" class="meta-row"><span class="meta-label">{{ row.key }}</span><span class="meta-value" :title="row.value">{{ row.value }}</span></div>
          <div v-if="!props.propertiesPreview.length" class="empty-state">No properties</div>
        </template>
      </div>
      <button v-if="props.metadataRows.length || props.propertiesPreview.length > 2" type="button" class="more-button details-toggle" :aria-expanded="detailsExpanded" @click="detailsExpanded = !detailsExpanded">{{ detailsExpanded ? 'Show less' : 'Show all details' }}<ChevronRightIcon :class="{ expanded: detailsExpanded }" /></button>
    </section>
  </aside>
</template>

<style scoped>
.right-pane { min-width: 0; min-height: 0; background: var(--right-pane-bg); border-left: 1px solid var(--right-pane-border); display: flex; flex-direction: column; overflow-y: auto; overscroll-behavior: contain; padding: 20px 16px; }
.note-header { padding: 0 0 18px; }
.eyebrow { margin: 0 0 10px; color: var(--right-pane-title); font-size: 10px; font-weight: 700; letter-spacing: .11em; text-transform: uppercase; }
.note-title { margin: 0; color: var(--right-pane-text); font-size: 19px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
.note-path { margin: 5px 0 0; color: var(--right-pane-text-dim); font-size: 11px; overflow-wrap: anywhere; }
.note-status { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.note-status span { border-radius: 4px; background: var(--right-pane-card-bg); color: var(--right-pane-text-dim); padding: 3px 6px; font-size: 10px; text-transform: capitalize; }
.pane-toolbar-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; margin-top: 14px; }
.utility-note-btn { justify-content: flex-start; color: var(--right-pane-text-dim); }
.favorite-toggle-btn--active :deep(svg) { color: var(--right-pane-favorite); }
.favorite-toggle-btn :deep(svg), .utility-note-btn :deep(svg) { width: 14px; height: 14px; }
.source-icon { font-size: 10px; width: 14px; }
.pane-section { border-top: 1px solid var(--right-pane-border); padding: 17px 0; }
.section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.section-title { margin: 0; color: var(--right-pane-text); font-size: 13px; font-weight: 650; }
.count { color: var(--right-pane-text-dim); font-size: 11px; }
.pane-item { display: block; width: 100%; border: 0; background: transparent; text-align: left; padding: 5px 8px; border-radius: 6px; font-size: 12px; line-height: 1.4; color: var(--right-pane-text-soft); overflow-wrap: anywhere; }
.pane-item:hover, .pane-item:focus-visible { background: var(--right-pane-item-hover); color: var(--right-pane-text); }
.outline-row { border-left: 2px solid var(--right-pane-card-border); border-radius: 0 6px 6px 0; }
.more-button { border: 0; background: transparent; padding: 6px 8px; color: var(--right-pane-text-dim); font-size: 11px; text-align: left; }
.more-button:hover, .more-button:focus-visible { color: var(--right-pane-text); }
.metadata-grid { display: flex; flex-direction: column; gap: 8px; padding: 3px 0; }
.meta-row { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.meta-label { color: var(--right-pane-text-dim); font-size: 11px; overflow-wrap: anywhere; }
.meta-value { color: var(--right-pane-text); font-size: 12px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty-state { color: var(--right-pane-text-dim); font-size: 12px; line-height: 1.45; }
.details-toggle { display: inline-flex; align-items: center; gap: 4px; padding-left: 0; margin-top: 6px; }
.details-toggle svg { width: 12px; height: 12px; transition: transform 140ms ease; }
.details-toggle svg.expanded { transform: rotate(90deg); }
</style>
