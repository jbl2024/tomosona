<script setup lang="ts">
/**
 * Pane-level adapter for mounting the Second Brain view inside the app shell.
 *
 * This component exists only to forward shell props and events into the domain
 * view so pane orchestration stays separate from chat behavior.
 */
import type { AppSettingsAlters } from '../../../shared/api/apiTypes'
import SecondBrainView from './SecondBrainView.vue'

defineProps<{
  workspacePath: string
  allWorkspaceFiles: string[]
  requestedSessionId: string
  requestedSessionNonce: number
  requestedPrompt: string
  requestedPromptNonce: number
  requestedAlterId: string
  requestedAlterNonce: number
  activeNotePath: string
  echoesRefreshToken: number
  settings: AppSettingsAlters
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
      :requested-alter-id="requestedAlterId"
      :requested-alter-nonce="requestedAlterNonce"
      :active-note-path="activeNotePath"
      :echoes-refresh-token="echoesRefreshToken"
      :settings="settings"
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
