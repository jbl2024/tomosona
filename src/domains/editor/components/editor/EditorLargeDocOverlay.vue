<script setup lang="ts">
const props = defineProps<{
  visible: boolean
  stageLabel: string
  progressPercent: number
  progressIndeterminate: boolean
  stats: { chars: number; lines: number } | null
}>()
</script>

<template>
  <div
    v-if="props.visible"
    class="editor-large-doc-overlay pointer-events-none absolute inset-0 z-30 flex items-start justify-center px-6 py-6 backdrop-blur-[1px]"
  >
    <div class="editor-large-doc-panel pointer-events-auto w-full max-w-md rounded-xl border p-4 shadow-sm">
      <div class="editor-large-doc-title text-sm font-medium">Loading large document</div>
      <div class="editor-large-doc-copy mt-1 text-xs">{{ props.stageLabel }}</div>
      <div v-if="props.stats" class="editor-large-doc-meta mt-1 text-[11px]">
        {{ props.stats.lines.toLocaleString() }} lines · {{ props.stats.chars.toLocaleString() }} chars
      </div>
      <div class="editor-large-doc-track mt-3 h-2 overflow-hidden rounded-full">
        <div
          class="editor-large-doc-fill h-full rounded-full transition-[width] duration-200 ease-out"
          :class="{ 'tomosona-load-indeterminate': props.progressIndeterminate }"
          :style="props.progressIndeterminate ? undefined : { width: `${props.progressPercent}%` }"
        ></div>
      </div>
      <div class="editor-large-doc-copy mt-2 text-right text-[11px]">
        {{ props.progressIndeterminate ? 'Working...' : `${props.progressPercent}%` }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-large-doc-overlay {
  background: var(--editor-overlay-backdrop);
}

.editor-large-doc-panel {
  border-color: var(--editor-menu-border);
  background: var(--editor-overlay-panel);
}

.editor-large-doc-title {
  color: var(--text-main);
}

.editor-large-doc-copy {
  color: var(--text-soft);
}

.editor-large-doc-meta {
  color: var(--text-dim);
}

.editor-large-doc-track {
  background: var(--editor-progress-track);
}

.editor-large-doc-fill {
  background: var(--editor-progress-fill);
}

.tomosona-load-indeterminate {
  width: 45%;
  background-image: linear-gradient(
    90deg,
    var(--editor-progress-fill) 0%,
    var(--editor-progress-fill-2) 50%,
    var(--editor-progress-fill) 100%
  );
  background-size: 200% 100%;
  animation: tomosona-load-slide 1.1s linear infinite;
}

@keyframes tomosona-load-slide {
  from {
    transform: translateX(-120%);
    background-position: 0% 0%;
  }
  to {
    transform: translateX(260%);
    background-position: 100% 0%;
  }
}
</style>
