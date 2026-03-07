<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  HashtagIcon,
  ListBulletIcon,
  NumberedListIcon,
  QueueListIcon,
  TrashIcon,
} from '@heroicons/vue/24/outline'
import type { BlockMenuActionItem } from '../../lib/tiptap/blockMenu/types'

const props = defineProps<{
  open: boolean
  index: number
  actions: BlockMenuActionItem[]
  convertActions: BlockMenuActionItem[]
}>()

const emit = defineEmits<{
  'update:index': [value: number]
  select: [item: BlockMenuActionItem]
  close: []
  'menu-el': [value: HTMLDivElement | null]
}>()

const rootEl = ref<HTMLDivElement | null>(null)
const convertOpen = ref(false)
const convertButtonEl = ref<HTMLButtonElement | null>(null)
const convertMenuEl = ref<HTMLDivElement | null>(null)
const clearPrimarySelection = ref(false)
const convertMenuSide = ref<'left' | 'right'>('right')
const convertMenuOffsetY = ref(0)

function syncRootEl() {
  emit('menu-el', rootEl.value)
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      closeConvertMenu()
      return
    }
    requestAnimationFrame(() => {
      rootEl.value?.focus()
    })
  }
)

function onViewportChange() {
  if (!convertOpen.value) return
  positionConvertMenu()
}

onMounted(() => {
  syncRootEl()
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
})
onUpdated(syncRootEl)
onBeforeUnmount(() => {
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
})

function positionConvertMenu() {
  const trigger = convertButtonEl.value
  const menu = convertMenuEl.value
  if (!trigger || !menu) return

  const viewportPadding = 8
  const triggerRect = trigger.getBoundingClientRect()
  const menuRect = menu.getBoundingClientRect()
  const availableRight = window.innerWidth - triggerRect.right - viewportPadding
  const availableLeft = triggerRect.left - viewportPadding

  convertMenuSide.value = availableRight >= menuRect.width || availableRight >= availableLeft ? 'right' : 'left'

  let offset = 0
  const overflowBottom = triggerRect.top + menuRect.height - (window.innerHeight - viewportPadding)
  if (overflowBottom > 0) {
    offset -= overflowBottom
  }
  const topClamp = viewportPadding - triggerRect.top
  if (offset < topClamp) {
    offset = topClamp
  }
  convertMenuOffsetY.value = offset
}

function openConvertMenu() {
  convertOpen.value = true
  clearPrimarySelection.value = true
  nextTick(() => {
    positionConvertMenu()
  })
}

function closeConvertMenu() {
  convertOpen.value = false
  clearPrimarySelection.value = false
  convertMenuOffsetY.value = 0
}

function onPrimaryItemHover(index: number, disabled: boolean) {
  if (disabled) return
  closeConvertMenu()
  emit('update:index', index)
}

watch(convertOpen, (open) => {
  if (!open) return
  nextTick(() => {
    positionConvertMenu()
  })
})

function onMenuKeydown(event: KeyboardEvent) {
  if (!props.open) return

  if (event.key === 'Escape') {
    event.preventDefault()
    closeConvertMenu()
    emit('close')
    return
  }

  if (!props.actions.length) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    let next = props.index
    for (let i = 0; i < props.actions.length; i += 1) {
      next = (next + 1) % props.actions.length
      if (!props.actions[next]?.disabled) break
    }
    emit('update:index', next)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    let next = props.index
    for (let i = 0; i < props.actions.length; i += 1) {
      next = (next - 1 + props.actions.length) % props.actions.length
      if (!props.actions[next]?.disabled) break
    }
    emit('update:index', next)
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    const item = props.actions[props.index]
    if (!item || item.disabled) return
    emit('select', item)
  }
}

const ICONS: Record<string, unknown> = {
  insert_above: ArrowUpIcon,
  insert_below: ArrowDownIcon,
  move_up: ArrowUturnLeftIcon,
  move_down: ArrowUturnRightIcon,
  duplicate: DocumentDuplicateIcon,
  copy_anchor: ClipboardDocumentIcon,
  delete: TrashIcon,
  paragraph: DocumentTextIcon,
  heading1: HashtagIcon,
  heading2: HashtagIcon,
  heading3: HashtagIcon,
  bulletList: ListBulletIcon,
  orderedList: NumberedListIcon,
  taskList: QueueListIcon,
  codeBlock: DocumentTextIcon,
  quote: DocumentTextIcon,
}

function iconFor(item: BlockMenuActionItem) {
  if (item.turnIntoType) return ICONS[item.turnIntoType] ?? DocumentTextIcon
  return ICONS[item.actionId] ?? DocumentTextIcon
}
</script>

<template>
  <div
    v-if="props.open"
    ref="rootEl"
    tabindex="-1"
    class="tomosona-block-menu z-40 w-64 rounded-xl border p-1.5 outline-none"
    @keydown="onMenuKeydown"
    @mouseleave="closeConvertMenu()"
  >
    <button
      v-for="(item, idx) in props.actions"
      :key="item.id"
      type="button"
      class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm"
      :class="[
        item.disabled
          ? 'tomosona-block-menu-item tomosona-block-menu-item--disabled cursor-not-allowed'
          : 'tomosona-block-menu-item',
        idx === props.index && !item.disabled && !clearPrimarySelection ? 'tomosona-block-menu-item--active' : '',
      ]"
      @mouseenter="onPrimaryItemHover(idx, Boolean(item.disabled))"
      @mousedown.prevent
      @click.stop.prevent="!item.disabled && emit('select', item)"
    >
      <component :is="iconFor(item)" class="h-4 w-4 shrink-0" />
      <span class="truncate">{{ item.label }}</span>
    </button>

    <div class="relative">
      <button
        ref="convertButtonEl"
        type="button"
        class="tomosona-block-menu-item flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm"
        @mouseenter="openConvertMenu()"
        @mousedown.prevent
        @click.stop.prevent="convertOpen ? closeConvertMenu() : openConvertMenu()"
      >
        <DocumentTextIcon class="h-4 w-4 shrink-0" />
        <span class="flex-1 truncate">Convert to</span>
        <ChevronRightIcon class="h-4 w-4 shrink-0" />
      </button>

      <div
        v-if="convertOpen"
        ref="convertMenuEl"
        class="tomosona-block-menu-submenu absolute top-0 z-50 w-56 max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border p-1.5"
        :class="convertMenuSide === 'right' ? 'left-full ml-2' : 'right-full mr-2'"
        :style="{ top: `${convertMenuOffsetY}px` }"
      >
        <button
          v-for="item in props.convertActions"
          :key="item.id"
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm"
          :class="
            item.disabled
              ? 'tomosona-block-menu-item tomosona-block-menu-item--disabled cursor-not-allowed'
              : 'tomosona-block-menu-item'
          "
          @mousedown.prevent
          @click.stop.prevent="!item.disabled && emit('select', item)"
        >
          <component :is="iconFor(item)" class="h-4 w-4 shrink-0" />
          <span class="truncate">{{ item.label }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tomosona-block-menu,
.tomosona-block-menu-submenu {
  border-color: var(--editor-menu-border);
  background: var(--editor-menu-bg);
  box-shadow: var(--editor-menu-shadow);
}

.tomosona-block-menu-item {
  color: var(--editor-menu-text);
}

.tomosona-block-menu-item:hover {
  background: var(--editor-menu-hover-bg);
  color: var(--editor-menu-text-strong);
}

.tomosona-block-menu-item--active {
  background: var(--editor-menu-active-bg);
  color: var(--editor-menu-text-strong);
}

.tomosona-block-menu-item--disabled {
  color: var(--editor-menu-disabled);
}
</style>
