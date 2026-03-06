<script setup lang="ts">
import SecondBrainView from './SecondBrainView.vue'

defineProps<{
  workspacePath: string
  allWorkspaceFiles: string[]
  requestedSessionId: string
  requestedSessionNonce: number
  activeNotePath: string
}>()

const emit = defineEmits<{
  'open-note': [path: string]
  'context-changed': [paths: string[]]
  'session-changed': [sessionId: string]
}>()
</script>

<template>
  <div class="sb-pane-surface">
    <SecondBrainView
      :workspace-path="workspacePath"
      :all-workspace-files="allWorkspaceFiles"
      :requested-session-id="requestedSessionId"
      :requested-session-nonce="requestedSessionNonce"
      :active-note-path="activeNotePath"
      @open-note="emit('open-note', $event)"
      @context-changed="emit('context-changed', $event)"
      @session-changed="emit('session-changed', $event)"
    />
  </div>
</template>

<style scoped>
.sb-pane-surface {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
