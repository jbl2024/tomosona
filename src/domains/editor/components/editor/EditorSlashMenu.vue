<script setup lang="ts">
import { computed } from 'vue'
import {
  ChatBubbleLeftRightIcon,
  CodeBracketIcon,
  DocumentTextIcon,
  HashtagIcon,
  ListBulletIcon,
  QueueListIcon,
  RectangleGroupIcon,
  TableCellsIcon,
  ViewColumnsIcon,
} from '@heroicons/vue/24/outline'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../../../../shared/components/ui/UiFilterableDropdown.vue'

type SlashCommand = {
  id: string
  label: string
  type: string
  data: Record<string, unknown>
}

const props = defineProps<{
  open: boolean
  index: number
  left: number
  top: number
  query: string
  commands: SlashCommand[]
}>()

const emit = defineEmits<{
  'update:index': [value: number]
  'update:query': [value: string]
  select: [command: SlashCommand]
  close: []
}>()

const ICON_BY_ID: Record<string, unknown> = {
  heading: HashtagIcon,
  bullet: ListBulletIcon,
  checklist: QueueListIcon,
  table: TableCellsIcon,
  callout: ChatBubbleLeftRightIcon,
  mermaid: RectangleGroupIcon,
  code: CodeBracketIcon,
  html: CodeBracketIcon,
  quote: ChatBubbleLeftRightIcon,
  divider: ViewColumnsIcon,
}

const ICON_BY_TYPE: Record<string, unknown> = {
  header: HashtagIcon,
  list: ListBulletIcon,
  table: TableCellsIcon,
  callout: ChatBubbleLeftRightIcon,
  mermaid: RectangleGroupIcon,
  code: CodeBracketIcon,
  html: CodeBracketIcon,
  quote: ChatBubbleLeftRightIcon,
  delimiter: ViewColumnsIcon,
}

function iconFor(command: SlashCommand) {
  return ICON_BY_ID[command.id] ?? ICON_BY_TYPE[command.type] ?? DocumentTextIcon
}

const items = computed<Array<FilterableDropdownItem & { command: SlashCommand; aliases: string[] }>>(() =>
  props.commands.map((command) => ({
    id: `slash:${command.id}:${command.type}`,
    label: command.label,
    command,
    aliases: [command.id, command.type, command.label]
  }))
)

function slashMatcher(item: FilterableDropdownItem, query: string): boolean {
  const aliases = Array.isArray(item.aliases) ? item.aliases.map((entry) => String(entry).toLowerCase()) : []
  return aliases.some((token) => token.includes(query))
}

function onSelect(item: FilterableDropdownItem) {
  const command = (item as FilterableDropdownItem & { command?: SlashCommand }).command
  if (!command) return
  emit('select', command)
}

function onOpenChange(open: boolean) {
  if (!open) emit('close')
}

function commandFromItem(item: unknown): SlashCommand | null {
  const command = (item as { command?: SlashCommand } | null)?.command
  return command ?? null
}

function labelForItem(item: unknown): string {
  const command = commandFromItem(item)
  return command?.label ?? ''
}

function iconForItem(item: unknown) {
  const command = commandFromItem(item)
  return command ? iconFor(command) : DocumentTextIcon
}
</script>

<template>
  <div class="editor-slash-dropdown-anchor" :style="{ left: `${props.left}px`, top: `${props.top}px` }">
    <UiFilterableDropdown
      class="editor-slash-dropdown"
      :items="items"
      :model-value="props.open"
      :query="props.query"
      :active-index="props.index"
      :matcher="slashMatcher"
      filter-placeholder="Search blocks..."
      :show-filter="true"
      :auto-focus-on-open="true"
      :close-on-outside="false"
      :close-on-select="false"
      :max-height="320"
      @open-change="onOpenChange($event)"
      @query-change="emit('update:query', $event)"
      @active-index-change="emit('update:index', $event)"
      @select="onSelect($event)"
    >
      <template #item="{ item, active }">
        <span class="editor-slash-item" :class="{ 'editor-slash-item--active': active }">
          <component :is="iconForItem(item)" class="h-4 w-4 shrink-0" />
          <span class="truncate">{{ labelForItem(item) }}</span>
        </span>
      </template>
    </UiFilterableDropdown>
  </div>
</template>

<style scoped>
.editor-slash-dropdown-anchor {
  position: absolute;
}

.editor-slash-dropdown :deep(.ui-filterable-dropdown-menu) {
  position: absolute;
  left: 0;
  top: 0;
  width: 14rem;
  z-index: 20;
}

.editor-slash-dropdown :deep(.ui-filterable-dropdown-filter) {
  border-bottom-color: var(--editor-menu-border);
}

.editor-slash-dropdown :deep(.ui-filterable-dropdown-filter-input) {
  background: var(--editor-menu-bg);
  border-color: var(--editor-menu-border);
  color: var(--editor-menu-text);
}

.editor-slash-dropdown :deep(.ui-filterable-dropdown-filter-input::placeholder) {
  color: var(--editor-menu-muted);
}

.editor-slash-dropdown :deep(.ui-filterable-dropdown-option) {
  border-radius: 0.375rem;
  color: var(--editor-menu-text);
  font-size: 0.875rem;
  padding: 0.5rem 0.625rem;
}

.editor-slash-item {
  align-items: center;
  display: flex;
  gap: 0.5rem;
}

.editor-slash-dropdown :deep(.ui-filterable-dropdown-option:hover),
.editor-slash-dropdown :deep(.ui-filterable-dropdown-option[data-active='true']) {
  background: var(--editor-menu-hover-bg);
}

.editor-slash-item--active {
  font-weight: 600;
}

.editor-slash-dropdown :deep(.ui-filterable-dropdown-empty) {
  color: var(--editor-menu-muted);
}
</style>
