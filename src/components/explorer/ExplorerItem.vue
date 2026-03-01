<script setup lang="ts">
import ExplorerRenameInput from './ExplorerRenameInput.vue'
import type { TreeNode } from '../../lib/api'
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
  showContextToggle?: boolean
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
  contexttoggle: [node: TreeNode]
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
    class="group relative flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] leading-[1.35] transition-colors"
    :class="[
      selected ? 'bg-[#e6eaf5] text-[#1f2937] dark:bg-[#2d3440] dark:text-[#d7dce5]' : 'text-[#4b5563] dark:text-[#abb2bf]',
      active ? 'bg-[rgb(94_106_210_/_0.12)] font-medium text-[#5e6ad2] dark:text-white' : '',
      focused ? 'bg-[#e9edf7] dark:bg-slate-800/90' : '',
      cutPending ? 'opacity-45' : 'opacity-100',
      editing ? 'cursor-default' : 'cursor-pointer select-none hover:bg-[#eceff6] hover:text-[#111827] dark:hover:bg-[#2f3540] dark:hover:text-[#d7dce5]'
    ]"
    :style="{ paddingLeft: `${depth * 14 + 8}px` }"
    @click="emit('click', $event, node)"
    @dblclick="emit('doubleclick', node)"
    @contextmenu.prevent="emit('contextmenu', { event: $event, node })"
  >
    <span
      v-if="active"
      class="absolute bottom-[3px] left-0 top-[3px] w-[3px] rounded-r bg-[#5e6ad2]"
      aria-hidden="true"
    />
    <button
      type="button"
      class="inline-flex h-4 w-4 items-center justify-center rounded text-[10px] text-[#4b5563] dark:text-[#9aa3b2]"
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
        class="block truncate"
        :class="node.is_dir ? 'font-medium text-[#2d313a] dark:text-[#d7dce5]' : 'font-normal'"
        :title="node.path"
      >
        {{ node.name }}
      </span>
    </div>

    <button
      v-if="showContextToggle && node.is_markdown"
      type="button"
      class="rounded-md px-1.5 text-sm leading-none text-[#4b5563] opacity-0 transition hover:bg-[#e8ebf2] hover:text-[#111827] hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 dark:text-[#9aa3b2] dark:hover:bg-[#343b47] dark:hover:text-[#d7dce5]"
      :title="contextActive ? 'Remove from context' : 'Add to context'"
      @click.stop="emit('contexttoggle', node)"
    >
      {{ contextActive ? '−' : '+' }}
    </button>
    <button
      v-else
      type="button"
      class="rounded-md px-1.5 text-sm leading-none text-[#4b5563] opacity-0 transition hover:bg-[#e8ebf2] hover:text-[#111827] hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 dark:text-[#9aa3b2] dark:hover:bg-[#343b47] dark:hover:text-[#d7dce5]"
      title="Actions"
      @click.stop="emit('rowaction', { event: $event, node })"
    >
      ⋯
    </button>
  </div>
</template>
