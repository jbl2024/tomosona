<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import UiButton from '../../../shared/components/ui/UiButton.vue'

const props = defineProps<{
  path: string
  title: string
  html: string
  loading?: boolean
  error?: string
  locked?: boolean
}>()

const emit = defineEmits<{
  close: []
  open: [path: string]
}>()

const rootRef = ref<HTMLElement | null>(null)

function onKeydown(event: KeyboardEvent) {
  // Escape or Space closes the preview and returns focus to the explorer row.
  if (event.key === 'Escape' || event.key === ' ') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  rootRef.value?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <div class="explorer-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
    <div
      ref="rootRef"
      class="explorer-modal explorer-preview w-full max-w-2xl rounded-2xl border p-4 outline-none"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      :aria-label="`Preview of ${title}`"
    >
      <header class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="explorer-modal-title truncate text-sm font-semibold">{{ title }}</h3>
          <p class="explorer-modal-copy mt-0.5 truncate text-xs">{{ path }}</p>
        </div>
        <div class="flex shrink-0 gap-2">
          <UiButton size="sm" variant="ghost" @click="emit('open', path)">Open note</UiButton>
          <UiButton size="sm" variant="primary" @click="emit('close')">Close</UiButton>
        </div>
      </header>

      <div class="explorer-preview-body mt-3 max-h-[60vh] overflow-y-auto rounded-lg border p-3">
        <p v-if="loading" class="explorer-modal-copy text-xs">Loading preview…</p>
        <p v-else-if="locked" class="explorer-modal-copy text-xs">This note is protected and locked. Unlock it in the editor to preview its content.</p>
        <p v-else-if="error" class="explorer-modal-copy text-xs">{{ error }}</p>
        <div v-else class="explorer-preview-content" v-html="html" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.explorer-modal-backdrop {
  background: var(--menu-backdrop);
}

.explorer-modal {
  border-color: var(--panel-border);
  background: var(--surface-bg);
  box-shadow: var(--menu-shadow);
}

.explorer-modal-title {
  color: var(--text-main);
}

.explorer-modal-copy {
  color: var(--text-dim);
}

.explorer-preview-body {
  border-color: var(--panel-border);
}

.explorer-preview-content :deep(h1),
.explorer-preview-content :deep(h2),
.explorer-preview-content :deep(h3),
.explorer-preview-content :deep(h4),
.explorer-preview-content :deep(h5),
.explorer-preview-content :deep(h6) {
  color: var(--text-main);
  margin: 0.75rem 0 0.25rem;
}

.explorer-preview-content :deep(p),
.explorer-preview-content :deep(li) {
  color: var(--text-main);
}

.explorer-preview-content :deep(ul),
.explorer-preview-content :deep(ol) {
  margin: 0.35rem 0 0.35rem 1.15rem;
  padding: 0;
}

.explorer-preview-content :deep(ul) {
  list-style: disc;
}

.explorer-preview-content :deep(ol) {
  list-style: decimal;
}

.explorer-preview-content :deep(.preview-checklist) {
  list-style: none;
  margin-left: 0.15rem;
}

.explorer-preview-content :deep(.preview-checkbox) {
  color: var(--text-dim);
  font-family: var(--font-code, ui-monospace, SFMono-Regular, monospace);
}

.explorer-preview-content :deep(a) {
  color: var(--link-color, #4f8ef7);
}

.explorer-preview-content :deep(pre),
.explorer-preview-content :deep(code) {
  background: var(--code-bg, rgba(127, 127, 127, 0.12));
  border-radius: 6px;
}

.explorer-preview-content :deep(pre) {
  padding: 0.55rem 0.7rem;
  overflow-x: auto;
}

.explorer-preview-content :deep(blockquote) {
  margin: 0.45rem 0;
  padding-left: 0.7rem;
  border-left: 2px solid var(--panel-border);
  color: var(--text-soft);
}

.explorer-preview-content :deep(.preview-callout) {
  padding: 0.45rem 0.7rem;
  border: 1px solid var(--panel-border);
  border-left-width: 3px;
  border-radius: 6px;
  background: var(--surface-subtle, rgba(127, 127, 127, 0.06));
}

.explorer-preview-content :deep(.preview-embed) {
  color: var(--text-dim);
  font-style: italic;
}

.explorer-preview-content :deep(table) {
  width: 100%;
  margin: 0.5rem 0;
  border-collapse: collapse;
  font-size: 0.85em;
}

.explorer-preview-content :deep(th),
.explorer-preview-content :deep(td) {
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--panel-border);
  text-align: left;
}

.explorer-preview-content :deep(hr) {
  margin: 0.75rem 0;
  border: 0;
  border-top: 1px solid var(--panel-border);
}

.explorer-preview-content :deep(img) {
  max-width: 100%;
}
</style>
