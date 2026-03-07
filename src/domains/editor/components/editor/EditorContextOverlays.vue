<script setup lang="ts">
import type { BlockMenuActionItem } from '../../lib/tiptap/blockMenu/types'
import type { TableActionId, TableToolbarAction } from '../../lib/tiptap/tableToolbarActions'
import EditorBlockMenu from './EditorBlockMenu.vue'
import EditorTableToolbar from './EditorTableToolbar.vue'

defineProps<{
  blockMenuOpen: boolean
  blockMenuIndex: number
  blockMenuX: number
  blockMenuY: number
  blockMenuActions: BlockMenuActionItem[]
  blockMenuConvertActions: BlockMenuActionItem[]
  tableToolbarOpen: boolean
  tableToolbarViewportLeft: number
  tableToolbarViewportTop: number
  tableToolbarActions: TableToolbarAction[]
  tableMarkdownMode: boolean
  tableToolbarViewportMaxHeight: number
}>()

const emit = defineEmits<{
  'block:updateIndex': [value: number]
  'block:select': [item: BlockMenuActionItem]
  'block:close': []
  'block:menuEl': [element: HTMLDivElement | null]
  'table:select': [actionId: TableActionId]
  'table:close': []
  'table:menuEl': [element: HTMLDivElement | null]
}>()
</script>

<template>
  <Teleport to="body">
    <div :style="{ position: 'fixed', left: `${blockMenuX}px`, top: `${blockMenuY}px`, zIndex: 50 }">
      <EditorBlockMenu
        :open="blockMenuOpen"
        :index="blockMenuIndex"
        :actions="blockMenuActions"
        :convert-actions="blockMenuConvertActions"
        @menu-el="emit('block:menuEl', $event)"
        @update:index="emit('block:updateIndex', $event)"
        @select="emit('block:select', $event)"
        @close="emit('block:close')"
      />
    </div>

    <div :style="{ position: 'fixed', left: `${tableToolbarViewportLeft}px`, top: `${tableToolbarViewportTop}px`, zIndex: 52 }">
      <EditorTableToolbar
        :open="tableToolbarOpen"
        :actions="tableToolbarActions"
        :markdown-mode="tableMarkdownMode"
        :max-height-px="tableToolbarViewportMaxHeight"
        @menu-el="emit('table:menuEl', $event)"
        @select="emit('table:select', $event)"
        @close="emit('table:close')"
      />
    </div>
  </Teleport>
</template>
