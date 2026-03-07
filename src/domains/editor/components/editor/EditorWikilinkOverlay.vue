<script setup lang="ts">
import EditorWikilinkMenu from './EditorWikilinkMenu.vue'

defineProps<{
  open: boolean
  index: number
  left: number
  top: number
  results: Array<{ id: string; label: string; target: string; isCreate: boolean }>
}>()

const emit = defineEmits<{
  'update:index': [value: number]
  select: [target: string]
}>()
</script>

<template>
  <Teleport to="body">
    <div :style="{ position: 'fixed', left: `${left}px`, top: `${top}px`, zIndex: 50 }">
      <EditorWikilinkMenu
        :open="open"
        :index="index"
        :left="0"
        :top="0"
        :results="results"
        @update:index="emit('update:index', $event)"
        @select="emit('select', $event)"
      />
    </div>
  </Teleport>
</template>
