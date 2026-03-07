<script setup lang="ts">
import type { SlashCommand } from '../../lib/editorSlashCommands'
import EditorSlashMenu from './EditorSlashMenu.vue'

defineProps<{
  open: boolean
  index: number
  left: number
  top: number
  query: string
  commands: SlashCommand[]
}>()

const emit = defineEmits<{
  'update:index': [value: number]
  'update:query': [value: string]
  select: [command: SlashCommand]
  close: []
}>()
</script>

<template>
  <Teleport to="body">
    <div :style="{ position: 'fixed', left: `${left}px`, top: `${top}px`, zIndex: 50 }">
      <EditorSlashMenu
        :open="open"
        :index="index"
        :left="0"
        :top="0"
        :query="query"
        :commands="commands"
        @update:index="emit('update:index', $event)"
        @update:query="emit('update:query', $event)"
        @select="emit('select', $event)"
        @close="emit('close')"
      />
    </div>
  </Teleport>
</template>
