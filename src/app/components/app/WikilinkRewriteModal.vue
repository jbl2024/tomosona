<script setup lang="ts">
import UiButton from '../../../shared/components/ui/UiButton.vue'

/**
 * WikilinkRewriteModal
 *
 * Purpose:
 * - Confirm workspace-wide wikilink rewrite after a note rename.
 */

defineProps<{
  prompt: { fromPath: string; toPath: string } | null
  fromLabel: string
  toLabel: string
}>()

const emit = defineEmits<{
  resolve: [approved: boolean]
}>()
</script>

<template>
  <div v-if="prompt" class="modal-overlay" @click.self="emit('resolve', false)">
    <div
      class="modal confirm-modal"
      data-modal="wikilink-rewrite"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wikilink-rewrite-title"
      aria-describedby="wikilink-rewrite-description"
      tabindex="-1"
    >
      <h3 id="wikilink-rewrite-title" class="confirm-title">Update wikilinks?</h3>
      <p id="wikilink-rewrite-description" class="confirm-text">The file was renamed. Do you want to rewrite matching wikilinks across the workspace?</p>
      <p class="confirm-path"><strong>From:</strong> {{ fromLabel }}</p>
      <p class="confirm-path"><strong>To:</strong> {{ toLabel }}</p>
      <div class="confirm-actions">
        <UiButton size="sm" variant="ghost" @click="emit('resolve', false)">Keep links</UiButton>
        <UiButton size="sm" @click="emit('resolve', true)">Update links</UiButton>
      </div>
    </div>
  </div>
</template>
