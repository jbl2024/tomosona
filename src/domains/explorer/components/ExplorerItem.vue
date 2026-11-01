<script setup lang="ts">
import { makeDraggable, makeDroppable, type IPlacement } from '@vue-dnd-kit/core'
import { computed, ref } from 'vue'
import ExplorerRenameInput from './ExplorerRenameInput.vue'
import type { TreeNode } from '../../../shared/api/apiTypes'
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, DocumentIcon, DocumentTextIcon, FolderIcon, FolderOpenIcon, LockClosedIcon, PhotoIcon } from '@heroicons/vue/24/outline'
import type { ExplorerDnDController } from '../composables/useExplorerDnD'
import type { ExplorerDropIntent } from '../lib/explorerDndRules'
import { explorerMatchPositions } from '../lib/explorerFilter'

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
  renameSelectionEnd?: number
  filterQuery?: string
  showExtensions?: boolean
  contextActive?: boolean
  dnd?: ExplorerDnDController
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
  createNote: [path: string]
}>()

function iconForNode(node: TreeNode) {
  if (node.is_dir) return props.expanded ? FolderOpenIcon : FolderIcon
  if (node.is_markdown) return DocumentTextIcon
  const ext = node.name.split('.').pop()?.toLowerCase() || ''
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp' || ext === 'svg') return PhotoIcon
  return DocumentIcon
}

const displayName = computed(() => props.node.is_markdown && !props.showExtensions ? props.node.name.replace(/\.md$/i, '') : props.node.name)
const matchPositions = computed(() => explorerMatchPositions(displayName.value, props.filterQuery ?? ''))
const showProtectionInfo = ref(false)
const rowRef = ref<HTMLElement | null>(null)

function onRowPointerDown(event: PointerEvent) {
  if (event.button === 0) return

  // Right/middle clicks should not reach the DnD provider, otherwise the row
  // can enter drag mode while the context menu is open.
  event.preventDefault()
  event.stopPropagation()
}

makeDraggable(
  rowRef,
  {
    disabled: computed(() => !props.dnd?.isRowDraggable(props.node.path)),
    dragHandle: '.explorer-item-drag-handle',
    activation: {
      distance: {
        x: 6,
        y: 6,
        condition: 'both'
      }
    },
    placementMargins: {
      top: 6,
      bottom: 6
    },
    events: {
      onSelfDragStart: () => {
        props.dnd?.handleDragStart(props.node.path)
      },
      onSelfDragEnd: () => {
        props.dnd?.handleDragEnd()
      },
      onSelfDragCancel: () => {
        props.dnd?.handleDragEnd()
      },
      onDragEnd: async (event) => {
        props.dnd?.syncDraggedPaths(event.draggedItems.map((item) => String(item.item)))
        const hoveredPlacement = event.hoveredDraggable?.placement as IPlacement | undefined
        const dropZonePlacement = event.dropZone?.placement as IPlacement | undefined

        if (dropZonePlacement || !hoveredPlacement) {
          return
        }

        await props.dnd?.handleDropResolved(props.node.path, hoveredPlacement)
      }
    }
  },
  () => {
    const paths = props.dnd?.buildDragPayload(props.node.path) ?? [props.node.path]
    return [Math.max(paths.indexOf(props.node.path), 0), paths]
  }
)

const droppable = makeDroppable(
  rowRef,
  {
    disabled: computed(() => !props.dnd?.isRowDropEnabled(props.node.path)),
    events: {
      onEnter: (event) => {
        props.dnd?.syncDraggedPaths(event.draggedItems.map((item) => String(item.item)))
      },
      onDrop: async (event) => {
        props.dnd?.syncDraggedPaths(event.draggedItems.map((item) => String(item.item)))
        const dropZonePlacement = event.dropZone?.placement as IPlacement | undefined
        const hoveredPlacement = event.hoveredDraggable?.placement as IPlacement | undefined
        const placement = dropZonePlacement ?? hoveredPlacement
        await props.dnd?.handleDropResolved(props.node.path, placement)
      },
      onLeave: () => {}
    }
  },
  () => [props.node.path]
)

const dndState = computed(() => props.dnd?.rowDropState(
  props.node.path,
  droppable.isDragOver.value as IPlacement | undefined,
  droppable.isAllowed.value
) ?? {
  active: false,
  intent: null as ExplorerDropIntent,
  allowed: false,
  blocked: false,
  dragging: false,
  dragGroup: false
})
</script>

<template>
  <div
    ref="rowRef"
    :data-explorer-path="node.path"
    class="explorer-item group relative flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] leading-[1.35] transition-colors"
    :class="[
      selected ? 'explorer-item--selected' : '',
      active ? 'explorer-item--active font-medium' : '',
      focused ? 'explorer-item--focused' : '',
      cutPending ? 'opacity-45' : 'opacity-100',
      editing ? 'cursor-default' : 'cursor-pointer select-none explorer-item--interactive',
      dndState.dragging ? 'explorer-item--dragging' : '',
      dndState.dragGroup ? 'explorer-item--drag-group' : '',
      dndState.active && dndState.allowed ? 'explorer-item--drop-active' : '',
      dndState.active && dndState.blocked ? 'explorer-item--drop-blocked' : '',
      dndState.intent === 'inside' ? 'explorer-item--drop-inside' : '',
      dndState.intent === 'before' ? 'explorer-item--drop-before' : '',
      dndState.intent === 'after' ? 'explorer-item--drop-after' : ''
    ]"
    :style="{ paddingLeft: `${depth * 14 + 8}px` }"
    :data-drop-intent="dndState.intent ?? undefined"
    :data-drop-allowed="dndState.allowed ? 'true' : undefined"
    :data-drop-blocked="dndState.blocked ? 'true' : undefined"
    @pointerdown="onRowPointerDown"
    @click="emit('click', $event, node)"
    @dblclick="emit('doubleclick', node)"
    @contextmenu.prevent.stop="emit('contextmenu', { event: $event, node })"
  >
    <span
      v-if="active"
      class="explorer-item-indicator absolute bottom-[3px] left-0 top-[3px] w-[3px] rounded-r"
      aria-hidden="true"
    />
    <button
      v-if="node.is_dir"
      type="button"
      class="explorer-item-icon inline-flex h-4 w-4 shrink-0 items-center justify-center rounded"
      :aria-label="expanded ? 'Collapse folder' : 'Expand folder'"
      :aria-expanded="expanded"
      @click.stop="emit('toggle', node.path)"
    >
      <component :is="expanded ? ChevronDownIcon : ChevronRightIcon" class="h-4 w-4" />
    </button>
    <span v-else class="h-4 w-4 shrink-0" aria-hidden="true" />
    <component :is="iconForNode(node)" class="explorer-item-icon h-4 w-4 shrink-0" aria-hidden="true" />

    <div class="explorer-item-drag-handle min-w-0 flex-1">
      <ExplorerRenameInput
        v-if="editing"
        :model-value="renameValue"
        :selection-end="renameSelectionEnd"
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
        <template v-for="(character, index) in Array.from(displayName)" :key="index"><mark v-if="matchPositions.has(index)">{{ character }}</mark><template v-else>{{ character }}</template></template>
      </span>
    </div>

    <span v-if="node.isProtected" class="relative">
      <button type="button" aria-label="Password protected" title="About page protection" @click.stop="showProtectionInfo = !showProtectionInfo"><LockClosedIcon class="h-4 w-4" /></button>
      <span v-if="showProtectionInfo" role="status" class="ui-menu absolute right-0 top-full z-50 w-56 p-2 text-xs" @click.stop>This page's content is encrypted and requires its password while locked. Its filename remains visible.</span>
    </span>

    <button
      v-if="node.is_dir"
      type="button"
      class="explorer-item-action rounded-md p-1 opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100"
      :aria-label="`New note in ${node.name}`"
      :title="`New note in ${node.name}`"
      @click.stop="emit('createNote', node.path)"
    ><PlusIcon class="h-4 w-4" /></button>

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

.explorer-item::before,
.explorer-item::after {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  height: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}

.explorer-item--selected {
  background: var(--explorer-row-selected-bg);
  color: var(--explorer-row-selected-text);
}

.explorer-item--active {
  color: var(--explorer-row-active-text);
}

.explorer-item--focused {
  box-shadow: inset 0 0 0 1px var(--explorer-row-indicator);
}

.explorer-item--interactive:hover {
  background: var(--explorer-row-hover-bg);
  color: var(--explorer-row-hover-text);
}

.explorer-item--dragging {
  opacity: 0.72;
}

.explorer-item--drag-group {
  box-shadow: inset 0 0 0 1px var(--explorer-row-indicator);
}

.explorer-item--drop-active.explorer-item--drop-inside {
  background: var(--explorer-row-hover-bg);
  box-shadow: inset 0 0 0 1px var(--explorer-row-indicator);
}

.explorer-item--drop-before::before,
.explorer-item--drop-after::after {
  border-top: 2px solid var(--explorer-row-indicator);
  opacity: 1;
}

.explorer-item--drop-before::before {
  top: 0;
}

.explorer-item--drop-after::after {
  bottom: 0;
}

.explorer-item--drop-blocked {
  box-shadow: inset 0 0 0 1px var(--danger);
}

.explorer-item--drop-blocked::before,
.explorer-item--drop-blocked::after {
  border-top-color: var(--danger);
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
