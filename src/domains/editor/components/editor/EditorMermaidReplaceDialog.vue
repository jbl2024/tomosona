<script setup lang="ts">
const props = defineProps<{
  visible: boolean
  templateLabel: string
}>()

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()
</script>

<template>
  <div
    v-if="props.visible"
    class="editor-mermaid-dialog-backdrop fixed inset-0 z-30 flex items-center justify-center px-4"
    @click.self="emit('cancel')"
  >
    <div class="editor-mermaid-dialog w-full max-w-sm rounded-2xl border p-4">
      <h3 class="editor-mermaid-dialog-title text-sm font-semibold">Replace Mermaid diagram?</h3>
      <p class="editor-mermaid-dialog-copy mt-1 text-xs">
        Replace current Mermaid content with template "{{ props.templateLabel }}"?
      </p>
      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          class="editor-mermaid-dialog-btn rounded border px-3 py-1.5 text-xs"
          @click="emit('cancel')"
        >
          Cancel
        </button>
        <button
          type="button"
          class="editor-mermaid-dialog-btn editor-mermaid-dialog-btn--primary rounded border px-3 py-1.5 text-xs font-semibold"
          @click="emit('confirm')"
        >
          Replace
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-mermaid-dialog-backdrop {
  background: var(--menu-backdrop);
}

.editor-mermaid-dialog {
  border-color: var(--panel-border);
  background: var(--surface-bg);
  box-shadow: var(--menu-shadow);
}

.editor-mermaid-dialog-title {
  color: var(--text-main);
}

.editor-mermaid-dialog-copy {
  color: var(--text-dim);
}

.editor-mermaid-dialog-btn {
  border-color: var(--button-ghost-border);
  color: var(--button-ghost-text);
}

.editor-mermaid-dialog-btn:hover {
  background: var(--menu-hover-bg);
  color: var(--menu-text-strong);
}

.editor-mermaid-dialog-btn--primary {
  border-color: var(--button-primary-border);
  background: var(--button-primary-bg);
  color: var(--button-primary-text);
}

.editor-mermaid-dialog-btn--primary:hover {
  background: var(--button-primary-hover);
  color: var(--button-primary-text);
}
</style>
