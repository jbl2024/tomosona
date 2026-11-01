<script setup lang="ts">
import { computed } from 'vue'
import { toWorkspaceRelativePath } from '../../../explorer/lib/workspacePaths'

/** Shows the active document's location without changing navigation state. */
const props = defineProps<{ path: string; workspacePath: string }>()
const location = computed(() => toWorkspaceRelativePath(props.workspacePath, props.path) || props.path)
</script>

<template>
  <div v-if="path" class="editor-path" tabindex="0" :title="location" :aria-label="`File location: ${location}`">
    {{ location }}
  </div>
</template>

<style scoped>
.editor-path { flex: 0 0 auto; min-width: 0; overflow: hidden; padding: .45rem 1rem; border-bottom: 1px solid var(--border-strong); color: var(--text-dim); font-size: .7rem; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.editor-path:focus-visible { white-space: normal; overflow-wrap: anywhere; outline: 2px solid var(--input-focus-border); outline-offset: -2px; }
</style>
