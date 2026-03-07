<script setup lang="ts">
import { computed, nextTick, onMounted, onUpdated, ref, watch, type Component } from 'vue'
import {
  ArrowUpIcon,
  ArrowDownIcon,
  Bars3BottomLeftIcon,
  Bars3Icon,
  MinusIcon,
  TableCellsIcon,
  ViewColumnsIcon
} from '@heroicons/vue/24/outline'
import type { TableActionGroup, TableToolbarAction, TableActionId } from '../../lib/tiptap/tableToolbarActions'

const props = defineProps<{
  open: boolean
  actions: TableToolbarAction[]
  markdownMode: boolean
  maxHeightPx?: number
}>()

const emit = defineEmits<{
  select: [actionId: TableActionId]
  close: []
  'menu-el': [value: HTMLDivElement | null]
}>()

const rootEl = ref<HTMLDivElement | null>(null)

function syncRootEl() {
  emit('menu-el', rootEl.value)
}

onMounted(syncRootEl)
onUpdated(syncRootEl)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    void nextTick(() => {
      rootEl.value?.focus()
    })
  }
)

const GROUP_ORDER: TableActionGroup[] = ['rows', 'columns', 'header', 'table']
const GROUP_LABELS: Record<TableActionGroup, string> = {
  rows: 'Rows',
  columns: 'Columns',
  header: 'Header',
  table: 'Table'
}

const groupedActions = computed(() => GROUP_ORDER
  .map((group) => ({
    group,
    label: GROUP_LABELS[group],
    items: props.actions.filter((item) => item.group === group)
  }))
  .filter((entry) => entry.items.length > 0)
)

const toolbarStyle = computed(() => {
  if (!props.maxHeightPx || props.maxHeightPx <= 0) return {}
  return { maxHeight: `${props.maxHeightPx}px` }
})

const ICONS: Record<TableActionId, Component> = {
  add_row_before: ArrowUpIcon,
  add_row_after: ArrowDownIcon,
  delete_row: MinusIcon,
  add_col_before: ViewColumnsIcon,
  add_col_after: Bars3Icon,
  delete_col: MinusIcon,
  align_col_left: Bars3BottomLeftIcon,
  align_col_center: Bars3Icon,
  align_col_right: ViewColumnsIcon,
  toggle_header_row: Bars3BottomLeftIcon,
  toggle_header_col: ViewColumnsIcon,
  toggle_header_cell: TableCellsIcon,
  delete_table: MinusIcon
}

function iconFor(action: TableToolbarAction): Component {
  return ICONS[action.id] ?? TableCellsIcon
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  emit('close')
}
</script>

<template>
  <div
    v-if="open"
    ref="rootEl"
    tabindex="-1"
    class="tomosona-table-toolbar z-50 w-[320px] max-h-[72vh] overflow-y-auto rounded-xl border p-1.5 outline-none"
    :style="toolbarStyle"
    @keydown="onKeydown"
  >
    <div class="tomosona-table-toolbar-title mb-1 px-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide">
      Table actions
      <span v-if="markdownMode" class="tomosona-table-toolbar-subtitle ml-1 font-normal normal-case tracking-normal">(Markdown mode)</span>
    </div>

    <div
      v-for="section in groupedActions"
      :key="section.group"
      class="tomosona-table-toolbar-section mb-1.5 rounded-lg border p-1"
    >
      <div class="tomosona-table-toolbar-subtitle mb-1 px-1.5 text-[10px] font-semibold uppercase tracking-wide">{{ section.label }}</div>
      <button
        v-for="item in section.items"
        :key="item.id"
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
        :class="item.disabled
          ? 'tomosona-table-toolbar-item tomosona-table-toolbar-item--disabled cursor-not-allowed'
          : 'tomosona-table-toolbar-item'"
        :data-action="item.id"
        :title="item.disabledReason ?? ''"
        :aria-disabled="item.disabled ? 'true' : 'false'"
        :disabled="item.disabled"
        @mousedown.prevent
        @click.stop.prevent="emit('select', item.id)"
      >
        <component :is="iconFor(item)" class="h-4 w-4 shrink-0" />
        <span class="truncate">{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tomosona-table-toolbar {
  border-color: var(--editor-menu-border);
  background: var(--editor-menu-bg);
  box-shadow: var(--editor-menu-shadow);
}

.tomosona-table-toolbar-title {
  color: var(--text-dim);
}

.tomosona-table-toolbar-subtitle {
  color: var(--text-faint);
}

.tomosona-table-toolbar-section {
  border-color: var(--editor-menu-section-border);
}

.tomosona-table-toolbar-item {
  color: var(--editor-menu-text);
}

.tomosona-table-toolbar-item:hover {
  background: var(--editor-menu-hover-bg);
  color: var(--editor-menu-text-strong);
}

.tomosona-table-toolbar-item--disabled {
  color: var(--editor-menu-disabled);
}
</style>
