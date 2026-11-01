<script setup lang="ts">
import {
  DocumentPlusIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  EllipsisHorizontalIcon
} from '@heroicons/vue/24/outline'

defineProps<{
  disabled: boolean
  searchOpen?: boolean
  canReveal?: boolean
  showExtensions?: boolean
  sortOrder?: 'ascending' | 'descending'
}>()

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
}>()
</script>

<template>
  <div class="explorer-toolbar flex flex-wrap items-center gap-1 border-b pb-1">
    <button
      type="button"
      class="explorer-toolbar-btn inline-flex h-6.5 w-6.5 items-center justify-center rounded-md border border-transparent transition disabled:opacity-40 disabled:hover:bg-transparent"
      title="New note"
      aria-label="New note"
      :disabled="disabled"
      @click="emit('createFile')"
    >
      <DocumentPlusIcon class="h-4 w-4" />
    </button>
    <button
      type="button"
      class="explorer-toolbar-btn inline-flex h-6.5 w-6.5 items-center justify-center rounded-md border border-transparent transition disabled:opacity-40 disabled:hover:bg-transparent"
      title="New folder"
      aria-label="New folder"
      :disabled="disabled"
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
      :disabled="disabled"
      @click="emit('toggleSearch')"
    >
      <MagnifyingGlassIcon class="h-3.5 w-3.5" />
    </button>
    <details class="explorer-toolbar-more relative ml-auto">
      <summary class="explorer-toolbar-btn inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md" aria-label="Explorer options" title="Explorer options"><EllipsisHorizontalIcon class="h-4 w-4" /></summary>
      <div class="ui-menu absolute right-0 top-full z-50 mt-1 min-w-48 p-1" @click="($event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')">
        <button type="button" class="ui-menu-item" :disabled="disabled" @click="emit('expandAll')">Expand all folders</button>
        <button type="button" class="ui-menu-item" :disabled="disabled" @click="emit('collapseAll')">Collapse all folders</button>
        <button type="button" class="ui-menu-item" :disabled="disabled || !canReveal" @click="emit('revealActive')">Reveal active note</button>
        <button type="button" class="ui-menu-item" role="menuitemradio" :aria-checked="sortOrder !== 'descending'" :disabled="disabled" @click="emit('setSort', 'ascending')">{{ sortOrder !== 'descending' ? '✓ ' : '' }}Sort A to Z</button>
        <button type="button" class="ui-menu-item" role="menuitemradio" :aria-checked="sortOrder === 'descending'" :disabled="disabled" @click="emit('setSort', 'descending')">{{ sortOrder === 'descending' ? '✓ ' : '' }}Sort Z to A</button>
        <button type="button" class="ui-menu-item" role="menuitemcheckbox" :aria-checked="Boolean(showExtensions)" :disabled="disabled" @click="emit('toggleExtensions')">{{ showExtensions ? '✓ ' : '' }}Show extensions</button>
        <button type="button" class="ui-menu-item" :disabled="disabled" @click="emit('refresh')">Refresh explorer</button>
      </div>
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
