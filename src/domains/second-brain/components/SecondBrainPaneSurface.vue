<script setup lang="ts">
import SecondBrainView from './SecondBrainView.vue'

defineProps<{
  workspacePath: string
  allWorkspaceFiles: string[]
  requestedSessionId: string
  requestedSessionNonce: number
  requestedPrompt: string
  requestedPromptNonce: number
  activeNotePath: string
  echoesRefreshToken: number
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
      :requested-prompt="requestedPrompt"
      :requested-prompt-nonce="requestedPromptNonce"
      :active-note-path="activeNotePath"
      :echoes-refresh-token="echoesRefreshToken"
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
