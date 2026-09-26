<script setup lang="ts">
import { computed } from 'vue'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../../../../shared/components/ui/UiFilterableDropdown.vue'
import { editorAtMacroMatchesQuery } from '../../lib/editorAtMacros'
import type { EditorAtMacroEntry } from '../../lib/editorAtMacros'

/**
 * Inline `@` macro popup for the editor.
 *
 * The parent composable owns trigger detection and insertion. This view only
 * renders the suggestion list and forwards selection/navigation events.
 */

const props = defineProps<{
  open: boolean
  index: number
  left: number
  top: number
  query: string
  items: EditorAtMacroEntry[]
}>()

const emit = defineEmits<{
  'update:index': [value: number]
  'update:query': [value: string]
  select: [item: EditorAtMacroEntry]
  close: []
}>()

const dropdownItems = computed<Array<FilterableDropdownItem & { item: EditorAtMacroEntry }>>(() =>
  props.items.map((item) => ({
    id: `at:${item.id}`,
    label: item.label,
    group: item.group,
    item,
    aliases: [item.id, item.label, item.group, item.kind, item.description, ...item.aliases]
  }))
)

function matcher(item: FilterableDropdownItem, query: string): boolean {
  const macro = (item as FilterableDropdownItem & { item?: EditorAtMacroEntry }).item
  if (macro) return editorAtMacroMatchesQuery(macro, query)
  const aliases = Array.isArray(item.aliases) ? item.aliases.map((value) => String(value).toLowerCase()) : []
  return aliases.some((alias) => alias.includes(query))
}

function onSelect(item: FilterableDropdownItem) {
  const macro = (item as FilterableDropdownItem & { item?: EditorAtMacroEntry }).item
  if (!macro) return
  emit('select', macro)
}

function onOpenChange(open: boolean) {
  if (!open) emit('close')
}

function labelForItem(item: unknown): string {
  return ((item as { item?: EditorAtMacroEntry })?.item?.label ?? '') as string
}

function detailForItem(item: unknown): string {
  return ((item as { item?: EditorAtMacroEntry })?.item?.preview ?? '') as string
}

function kindForItem(item: unknown): string {
  const macro = (item as { item?: EditorAtMacroEntry })?.item
  if (macro?.templatePath) return 'TPL'
  const kind = macro?.kind ?? 'insert_text'
  if (kind === 'insert_markdown') return 'MD'
  if (kind === 'dynamic_pick') return 'CTX'
  return 'TXT'
}
</script>

<template>
  <div class="editor-at-dropdown-anchor" :style="{ left: `${props.left}px`, top: `${props.top}px` }">
    <UiFilterableDropdown
      class="editor-at-dropdown"
      :items="dropdownItems"
      :model-value="props.open"
      :query="props.query"
      :active-index="props.index"
      :matcher="matcher"
      filter-placeholder="Search macros..."
      :show-filter="true"
      :auto-focus-on-open="true"
      :close-on-outside="false"
      :close-on-select="false"
      :max-height="280"
      @open-change="onOpenChange"
      @query-change="emit('update:query', $event)"
      @active-index-change="emit('update:index', $event)"
      @select="onSelect"
      >
      <template #item="{ item, active }">
        <span class="editor-at-item" :class="{ 'editor-at-item--active': active }">
          <span class="editor-at-item__main">
            <span class="editor-at-item__kind">{{ kindForItem(item) }}</span>
            <span class="editor-at-item__label">{{ labelForItem(item) }}</span>
          </span>
          <span class="editor-at-item__replacement" :title="detailForItem(item)">{{ detailForItem(item) }}</span>
        </span>
      </template>
    </UiFilterableDropdown>
  </div>
</template>

<style scoped>
.editor-at-dropdown-anchor {
  position: absolute;
}

.editor-at-dropdown :deep(.ui-filterable-dropdown-menu) {
  position: absolute;
  left: 0;
  top: 0;
  width: min(24rem, calc(100vw - 1.5rem));
  z-index: 20;
}

.editor-at-dropdown :deep(.ui-filterable-dropdown-filter) {
  border-bottom-color: var(--editor-menu-border);
}

.editor-at-dropdown :deep(.ui-filterable-dropdown-filter-input) {
  background: var(--editor-menu-bg);
  border-color: var(--editor-menu-border);
  color: var(--editor-menu-text);
}

.editor-at-dropdown :deep(.ui-filterable-dropdown-filter-input::placeholder) {
  color: var(--editor-menu-muted);
}

.editor-at-dropdown :deep(.ui-filterable-dropdown-option) {
  border-radius: 0.375rem;
  color: var(--editor-menu-text);
  font-size: 0.875rem;
  padding: 0.5rem 0.625rem;
}

.editor-at-item {
  align-items: center;
  display: grid;
  gap: 0.875rem;
  grid-template-columns: minmax(0, 1fr) minmax(5.5rem, max-content);
  min-width: 0;
  overflow: hidden;
  width: 100%;
}

.editor-at-item__main {
  align-items: baseline;
  display: inline-flex;
  flex: 1 1 auto;
  gap: 0.5rem;
  min-width: 0;
  overflow: hidden;
}

.editor-at-item__label {
  display: block;
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-at-item__kind {
  border: 1px solid var(--editor-menu-border);
  border-radius: 0.25rem;
  color: var(--editor-menu-muted);
  flex: 0 0 auto;
  font-size: 0.625rem;
  font-weight: 600;
  line-height: 1;
  padding: 0.125rem 0.1875rem;
}

.editor-at-item__replacement {
  align-self: center;
  color: var(--editor-menu-muted);
  display: block;
  font-size: 0.75rem;
  justify-self: end;
  max-width: 11rem;
  min-width: 0;
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-at-dropdown :deep(.ui-filterable-dropdown-option:hover),
.editor-at-dropdown :deep(.ui-filterable-dropdown-option[data-active='true']) {
  background: var(--editor-menu-hover-bg);
}

.editor-at-item--active .editor-at-item__label {
  font-weight: 600;
}

.editor-at-dropdown :deep(.ui-filterable-dropdown-empty) {
  color: var(--editor-menu-muted);
}
</style>
