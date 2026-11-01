<script setup lang="ts">
import {
  CalendarDaysIcon,
  DocumentPlusIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  EllipsisHorizontalIcon
} from '@heroicons/vue/24/outline'
import { computed } from 'vue'
import UiMenu from '../../../shared/components/ui/UiMenu.vue'
import UiMenuList from '../../../shared/components/ui/UiMenuList.vue'

const props = defineProps<{
  disabled: boolean
  searchOpen?: boolean
  canReveal?: boolean
  canUndo?: boolean
  showExtensions?: boolean
  sortOrder?: 'ascending' | 'descending'
  journalView?: boolean
}>()

/**
 * Disables the actions that only operate on the structural tree.
 *
 * The journal view owns its own header (refresh, organize), so creating notes or
 * folders, filtering and tree navigation have no target there. Undo stays
 * enabled because journal organization produces workspace-level moves.
 */
const treeActionsDisabled = computed(() => props.disabled || Boolean(props.journalView))

const emit = defineEmits<{
  createFile: []
  createFolder: []
  expandAll: []
  collapseAll: []
  refresh: []
  toggleSearch: []
  revealActive: []
  toggleExtensions: []
  setSort: [order: 'ascending' | 'descending']
  toggleJournalView: []
  undo: []
}>()
</script>

<template>
  <div class="explorer-toolbar flex flex-wrap items-center gap-1 border-b pb-1">
    <button
      type="button"
      class="explorer-toolbar-btn inline-flex h-6.5 w-6.5 items-center justify-center rounded-md border border-transparent transition disabled:opacity-40 disabled:hover:bg-transparent"
      title="New note"
      aria-label="New note"
      :disabled="treeActionsDisabled"
      @click="emit('createFile')"
    >
      <DocumentPlusIcon class="h-4 w-4" />
    </button>
    <button
      type="button"
      class="explorer-toolbar-btn inline-flex h-6.5 w-6.5 items-center justify-center rounded-md border border-transparent transition disabled:opacity-40 disabled:hover:bg-transparent"
      title="New folder"
      aria-label="New folder"
      :disabled="treeActionsDisabled"
      @click="emit('createFolder')"
    >
      <FolderPlusIcon class="h-4 w-4" />
    </button>
    <button
      type="button"
      class="explorer-toolbar-btn inline-flex h-6.5 w-6.5 items-center justify-center rounded-md border border-transparent transition disabled:opacity-40 disabled:hover:bg-transparent"
      :class="{ 'explorer-toolbar-btn--active': searchOpen }"
      title="Toggle filter"
      aria-label="Toggle filter"
      :disabled="treeActionsDisabled"
      @click="emit('toggleSearch')"
    >
      <MagnifyingGlassIcon class="h-3.5 w-3.5" />
    </button>
    <button
      type="button"
      class="explorer-toolbar-btn inline-flex h-6.5 w-6.5 items-center justify-center rounded-md border border-transparent transition disabled:opacity-40 disabled:hover:bg-transparent"
      :class="{ 'explorer-toolbar-btn--active': journalView }"
      title="Journal view"
      aria-label="Journal view"
      :aria-pressed="Boolean(journalView)"
      :disabled="disabled"
      @click="emit('toggleJournalView')"
    >
      <CalendarDaysIcon class="h-3.5 w-3.5" />
    </button>
    <details class="explorer-toolbar-more relative ml-auto" @keydown.esc.stop.prevent="($event.currentTarget as HTMLDetailsElement).open = false; ($event.currentTarget as HTMLDetailsElement).querySelector('summary')?.focus()">
      <summary class="explorer-toolbar-btn inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md" aria-label="Explorer options" title="Explorer options"><EllipsisHorizontalIcon class="h-4 w-4" /></summary>
      <UiMenu class-name="explorer-toolbar-menu absolute right-0 top-full z-50 mt-1 w-48 max-w-[calc(100vw-16px)]" @click="($event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')">
        <UiMenuList>
        <button type="button" class="ui-menu-item" :disabled="treeActionsDisabled" @click="emit('expandAll')">Expand all folders</button>
        <button type="button" class="ui-menu-item" :disabled="treeActionsDisabled" @click="emit('collapseAll')">Collapse all folders</button>
        <button type="button" class="ui-menu-item" :disabled="treeActionsDisabled || !canReveal" @click="emit('revealActive')">Reveal active note</button>
        <button type="button" class="ui-menu-item" role="menuitemradio" :aria-checked="sortOrder !== 'descending'" :disabled="treeActionsDisabled" @click="emit('setSort', 'ascending')">{{ sortOrder !== 'descending' ? '✓ ' : '' }}Sort A to Z</button>
        <button type="button" class="ui-menu-item" role="menuitemradio" :aria-checked="sortOrder === 'descending'" :disabled="treeActionsDisabled" @click="emit('setSort', 'descending')">{{ sortOrder === 'descending' ? '✓ ' : '' }}Sort Z to A</button>
        <button type="button" class="ui-menu-item" role="menuitemcheckbox" :aria-checked="Boolean(showExtensions)" :disabled="treeActionsDisabled" @click="emit('toggleExtensions')">{{ showExtensions ? '✓ ' : '' }}Show extensions</button>
        <button type="button" class="ui-menu-item" :disabled="disabled || !canUndo" @click="emit('undo')">Undo last operation</button>
        <button type="button" class="ui-menu-item" :disabled="treeActionsDisabled" @click="emit('refresh')">Refresh explorer</button>
        </UiMenuList>
      </UiMenu>
    </details>
  </div>
</template>

<style scoped>
.explorer-toolbar {
  border-color: color-mix(in srgb, var(--border-strong) 72%, transparent);
}

.explorer-toolbar-more summary { list-style: none; }
.explorer-toolbar-more summary::-webkit-details-marker { display: none; }

.explorer-toolbar-btn {
  color: var(--text-soft);
}

.explorer-toolbar-btn:hover:not(:disabled) {
  background: var(--explorer-toolbar-hover-bg);
  color: var(--menu-text-strong);
}

.explorer-toolbar-btn--active {
  background: var(--explorer-toolbar-hover-bg);
  color: var(--menu-text-strong);
}
</style>
