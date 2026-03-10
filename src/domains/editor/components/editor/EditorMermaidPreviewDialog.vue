<script setup lang="ts">
import { ref } from 'vue'
import UiModalShell from '../../../../shared/components/ui/UiModalShell.vue'

const props = defineProps<{
  visible: boolean
  svg: string
  exportError: string
}>()

const emit = defineEmits<{
  close: []
  exportSvg: [previewSvg: SVGElement | null]
}>()

const previewEl = ref<HTMLDivElement | null>(null)

function emitExportSvg() {
  emit('exportSvg', previewEl.value?.querySelector('svg') ?? null)
}
</script>

<template>
  <UiModalShell
    :model-value="visible"
    title="Mermaid diagram"
    description="Preview the diagram at full size and export it as SVG."
    width="xl"
    panel-class="editor-mermaid-preview-panel"
    @close="emit('close')"
  >
    <div ref="previewEl" class="editor-mermaid-preview" v-html="svg"></div>
    <p v-if="exportError" class="editor-mermaid-preview-error">{{ exportError }}</p>
    <template #footer>
      <button
        type="button"
        class="editor-mermaid-preview-btn"
        @click="emitExportSvg"
      >
        Export SVG
      </button>
      <button
        type="button"
        class="editor-mermaid-preview-btn editor-mermaid-preview-btn--primary"
        @click="emit('close')"
      >
        Close
      </button>
    </template>
  </UiModalShell>
</template>

<style scoped>
.editor-mermaid-preview {
  overflow: auto;
}

.editor-mermaid-preview :deep(svg) {
  display: block;
  height: auto;
  margin: 0 auto;
  max-width: none;
  min-width: min(100%, 56rem);
}

.editor-mermaid-preview-error {
  color: var(--danger);
  font-size: 0.875rem;
}

.editor-mermaid-preview-btn {
  background: transparent;
  border: 1px solid var(--button-ghost-border);
  border-radius: 6px;
  color: var(--button-ghost-text);
  cursor: pointer;
  font-size: 13px;
  padding: 8px 12px;
}

.editor-mermaid-preview-btn:hover {
  background: var(--menu-hover-bg);
  color: var(--menu-text-strong);
}

.editor-mermaid-preview-btn--primary {
  border-color: var(--button-primary-border);
  background: var(--button-primary-bg);
  color: var(--button-primary-text);
}

.editor-mermaid-preview-btn--primary:hover {
  background: var(--button-primary-hover);
  color: var(--button-primary-text);
}
</style>
