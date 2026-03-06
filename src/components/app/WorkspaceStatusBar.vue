<script setup lang="ts">
/**
 * WorkspaceStatusBar
 *
 * Purpose:
 * - Render the compact app status footer.
 */

defineProps<{
  activeFileLabel: string
  activeStateLabel: string
  indexStateLabel: string
  indexStateClass: string
  workspaceLabel: string
}>()

const emit = defineEmits<{
  'open-index-status': []
}>()
</script>

<template>
  <footer class="status-bar">
    <span class="status-item">{{ activeFileLabel }}</span>
    <span class="status-item status-item-state">{{ activeStateLabel }}</span>
    <button type="button" class="status-item status-item-index status-trigger" :class="indexStateClass" @click="emit('open-index-status')">
      <span class="status-dot" :class="indexStateClass"></span>
      <span>index: {{ indexStateLabel }}</span>
    </button>
    <span class="status-item">workspace: {{ workspaceLabel }}</span>
  </footer>
</template>
