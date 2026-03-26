<script setup lang="ts">
/**
 * Shared inline composer action used by workspace surfaces.
 *
 * The parent owns layout and stream state; this component only renders the
 * send/stop affordance so the button geometry stays consistent across
 * workspace surfaces.
 */
import { PaperAirplaneIcon } from '@heroicons/vue/24/outline'

defineProps<{
  running: boolean
  startDisabled: boolean
  stopDisabled: boolean
  startTitle: string
  startAriaLabel: string
  stopTitle: string
  stopAriaLabel: string
}>()

defineEmits<{
  start: []
  stop: []
}>()
</script>

<template>
  <div class="workspace-composer-action">
    <button
      v-if="running"
      type="button"
      class="send-icon-btn send-icon-btn-stop"
      :disabled="stopDisabled"
      :title="stopTitle"
      :aria-label="stopAriaLabel"
      @click="$emit('stop')"
    >
      <span class="sb-loader" aria-label="Thinking"></span>
    </button>
    <button
      v-else
      type="button"
      class="send-icon-btn"
      :disabled="startDisabled"
      :title="startTitle"
      :aria-label="startAriaLabel"
      @click="$emit('start')"
    >
      <PaperAirplaneIcon class="h-4 w-4" />
    </button>
  </div>
</template>

<style scoped>
.workspace-composer-action {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 2;
}

.send-icon-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--sb-button-border);
  border-radius: 999px;
  background: var(--sb-button-bg);
  color: var(--sb-button-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sb-loader {
  width: 18px;
  height: 18px;
  border: 2px solid var(--sb-spinner-track);
  border-top-color: var(--sb-spinner-head);
  border-radius: 999px;
  animation: sb-spin 0.8s linear infinite;
  display: inline-block;
}
</style>
