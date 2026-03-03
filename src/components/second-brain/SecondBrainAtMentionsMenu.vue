<script setup lang="ts">
import type { SecondBrainAtMentionItem } from '../../composables/useSecondBrainAtMentions'

const props = defineProps<{
  open: boolean
  suggestions: SecondBrainAtMentionItem[]
  activeIndex: number
}>()

const emit = defineEmits<{
  select: [item: SecondBrainAtMentionItem]
  'update:active-index': [index: number]
}>()
</script>

<template>
  <div v-if="open" class="sb-at-menu" role="listbox" aria-label="Context suggestions">
    <button
      v-for="(item, index) in suggestions"
      :key="item.id"
      type="button"
      class="sb-at-item"
      :class="{ active: index === activeIndex }"
      :aria-selected="index === activeIndex ? 'true' : 'false'"
      @mouseenter="emit('update:active-index', index)"
      @mousedown.prevent
      @click.prevent="emit('select', item)"
    >
      <span class="path">{{ item.relativePath }}</span>
    </button>
  </div>
</template>

<style>
.sb-at-menu {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  max-height: 220px;
  overflow: auto;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 10px 30px rgb(15 23 42 / 22%);
  padding: 6px;
  z-index: 20;
}

.sb-at-item {
  width: 100%;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  padding: 6px 8px;
  color: #0f172a;
  font-size: 12px;
}

.sb-at-item.active,
.sb-at-item:hover {
  background: #e2e8f0;
}

.path {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ide-root.dark .sb-at-menu {
  border-color: #334155;
  background: #0f172a;
}

.ide-root.dark .sb-at-item {
  color: #e2e8f0;
}

.ide-root.dark .sb-at-item.active,
.ide-root.dark .sb-at-item:hover {
  background: #1e293b;
}
</style>
