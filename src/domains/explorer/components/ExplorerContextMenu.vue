<script setup lang="ts">
import type { Component } from 'vue'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowTopRightOnSquareIcon,
  ClipboardDocumentIcon,
  DocumentDuplicateIcon,
  DocumentPlusIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  PencilSquareIcon,
  ScissorsIcon,
  TrashIcon
} from '@heroicons/vue/24/outline'

export type MenuAction =
  | 'open'
  | 'open-external'
  | 'reveal'
  | 'rename'
  | 'delete'
  | 'duplicate'
  | 'new-file'
  | 'new-folder'
  | 'cut'
  | 'copy'
  | 'paste'

const props = defineProps<{
  x: number
  y: number
  canOpen: boolean
  canPaste: boolean
  canRename: boolean
  canDelete: boolean
}>()

const emit = defineEmits<{
  action: [action: MenuAction]
}>()

const menuRef = ref<HTMLElement | null>(null)
const clampedX = ref(0)
const clampedY = ref(0)

const items: Array<{ id: MenuAction; label: string; icon: Component; enabled?: boolean }> = [
  { id: 'open', label: 'Open', icon: FolderOpenIcon },
  { id: 'open-external', label: 'Open externally', icon: ArrowTopRightOnSquareIcon },
  { id: 'reveal', label: 'Reveal in file manager', icon: FolderOpenIcon },
  { id: 'rename', label: 'Rename', icon: PencilSquareIcon },
  { id: 'duplicate', label: 'Duplicate', icon: DocumentDuplicateIcon },
  { id: 'delete', label: 'Delete', icon: TrashIcon },
  { id: 'new-file', label: 'New note', icon: DocumentPlusIcon },
  { id: 'new-folder', label: 'New folder', icon: FolderPlusIcon },
  { id: 'cut', label: 'Cut', icon: ScissorsIcon },
  { id: 'copy', label: 'Copy', icon: DocumentDuplicateIcon },
  { id: 'paste', label: 'Paste', icon: ClipboardDocumentIcon }
]

function isDisabled(id: MenuAction): boolean {
  if (id === 'open' || id === 'open-external' || id === 'reveal') return !props.canOpen
  if (id === 'rename') return !props.canRename
  if (id === 'delete') return !props.canDelete
  if (id === 'paste') return !props.canPaste
  return false
}

function onAction(id: MenuAction) {
  if (isDisabled(id)) return
  emit('action', id)
}

function recomputePosition() {
  const margin = 8
  const width = menuRef.value?.offsetWidth ?? 230
  const height = menuRef.value?.offsetHeight ?? 320

  let x = props.x
  let y = props.y

  if (x + width > window.innerWidth - margin) {
    x = Math.max(margin, window.innerWidth - width - margin)
  }
  if (y + height > window.innerHeight - margin) {
    y = Math.max(margin, window.innerHeight - height - margin)
  }

  clampedX.value = x
  clampedY.value = y
}

watch(
  () => [props.x, props.y],
  async () => {
    await nextTick()
    recomputePosition()
  },
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('resize', recomputePosition)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', recomputePosition)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="menuRef"
      class="explorer-context-menu fixed z-[120] w-60 max-w-[calc(100vw-16px)] rounded-xl border p-1"
      :style="{ left: `${clampedX}px`, top: `${clampedY}px` }"
      @click.stop
    >
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="explorer-context-menu-item flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs"
        :class="isDisabled(item.id) ? 'cursor-not-allowed opacity-45' : ''"
        :disabled="isDisabled(item.id)"
        @click="onAction(item.id)"
      >
        <component :is="item.icon" class="h-4 w-4 shrink-0" />
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.explorer-context-menu {
  border-color: var(--menu-border);
  background: var(--menu-bg);
  box-shadow: var(--menu-shadow);
}

.explorer-context-menu-item {
  color: var(--menu-text);
}

.explorer-context-menu-item:hover:not(:disabled) {
  background: var(--menu-hover-bg);
  color: var(--menu-text-strong);
}
</style>
