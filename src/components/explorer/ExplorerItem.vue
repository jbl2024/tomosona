<script setup lang="ts">
import ExplorerRenameInput from './ExplorerRenameInput.vue'
import type { TreeNode } from '../../lib/apiTypes'
import { DocumentIcon, DocumentTextIcon, FolderIcon, FolderOpenIcon, PhotoIcon } from '@heroicons/vue/24/outline'

const props = defineProps<{
  node: TreeNode
  depth: number
  expanded: boolean
  selected: boolean
  active: boolean
  focused: boolean
  cutPending: boolean
  editing: boolean
  renameValue: string
  contextActive?: boolean
}>()

const emit = defineEmits<{
  toggle: [path: string]
  click: [event: MouseEvent, node: TreeNode]
  doubleclick: [node: TreeNode]
  contextmenu: [payload: { event: MouseEvent; node: TreeNode }]
  rowaction: [payload: { event: MouseEvent; node: TreeNode }]
  renameUpdate: [value: string]
  renameConfirm: []
  renameCancel: []
}>()

function iconForNode(node: TreeNode) {
  if (node.is_dir) return props.expanded ? FolderOpenIcon : FolderIcon
  if (node.is_markdown) return DocumentTextIcon
  const ext = node.name.split('.').pop()?.toLowerCase() || ''
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp' || ext === 'svg') return PhotoIcon
  return DocumentIcon
}
</script>

<template>
  <div
    :data-explorer-path="node.path"
    class="explorer-item group relative flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] leading-[1.35] transition-colors"
    :class="[
      selected ? 'explorer-item--selected' : '',
      active ? 'explorer-item--active font-medium' : '',
      focused ? 'explorer-item--focused' : '',
      cutPending ? 'opacity-45' : 'opacity-100',
      editing ? 'cursor-default' : 'cursor-pointer select-none explorer-item--interactive'
    ]"
    :style="{ paddingLeft: `${depth * 14 + 8}px` }"
    @click="emit('click', $event, node)"
    @dblclick="emit('doubleclick', node)"
    @contextmenu.prevent="emit('contextmenu', { event: $event, node })"
  >
    <span
      v-if="active"
      class="explorer-item-indicator absolute bottom-[3px] left-0 top-[3px] w-[3px] rounded-r"
      aria-hidden="true"
    />
    <button
      type="button"
      class="explorer-item-icon inline-flex h-4 w-4 items-center justify-center rounded text-[10px]"
      @click.stop="node.is_dir && emit('toggle', node.path)"
    >
      <component :is="iconForNode(node)" class="h-4 w-4" />
    </button>

    <div class="min-w-0 flex-1">
      <ExplorerRenameInput
        v-if="editing"
        :model-value="renameValue"
        @update:model-value="emit('renameUpdate', $event)"
        @confirm="emit('renameConfirm')"
        @cancel="emit('renameCancel')"
      />
      <span
        v-else
        class="explorer-item-label block truncate"
        :class="[
          node.is_dir ? 'font-medium explorer-item-label--dir' : 'font-normal',
          !node.is_dir && node.is_markdown && contextActive ? 'font-semibold explorer-item-label--context' : ''
        ]"
        :title="node.path"
      >
        {{ node.name }}
      </span>
    </div>

    <button
      type="button"
      class="explorer-item-action rounded-md px-1.5 text-sm leading-none opacity-0 transition hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
      title="Actions"
      @click.stop="emit('rowaction', { event: $event, node })"
    >
      ⋯
    </button>
  </div>
</template>

<style scoped>
.explorer-item {
  color: var(--explorer-row-text);
}

.explorer-item--selected {
  background: var(--explorer-row-selected-bg);
  color: var(--explorer-row-selected-text);
}

.explorer-item--active {
  background: var(--explorer-row-active-bg);
  color: var(--explorer-row-active-text);
}

.explorer-item--focused {
  background: var(--explorer-row-focused-bg);
}

.explorer-item--interactive:hover {
  background: var(--explorer-row-hover-bg);
  color: var(--explorer-row-hover-text);
}

.explorer-item-indicator {
  background: var(--explorer-row-indicator);
}

.explorer-item-icon,
.explorer-item-action {
  color: var(--text-dim);
}

.explorer-item-label--dir {
  color: var(--explorer-row-text-strong);
}

.explorer-item-label--context {
  color: var(--explorer-row-hover-text);
}

.explorer-item-action:hover {
  background: var(--explorer-row-hover-bg);
  color: var(--explorer-row-hover-text);
}
</style>
