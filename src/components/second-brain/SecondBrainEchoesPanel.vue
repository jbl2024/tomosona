<script setup lang="ts">
/**
 * Presentational Echoes suggestions for Second Brain.
 */
import { computed } from 'vue'
import type { EchoesItem } from '../../lib/echoes'

const props = defineProps<{
  items: EchoesItem[]
  loading: boolean
  error: string
  isInContext: (path: string) => boolean
  toRelativePath: (path: string) => string
}>()

const emit = defineEmits<{
  open: [path: string]
  add: [path: string]
}>()

const visibleItems = computed(() => props.items.slice(0, 5))
const parentPathLabel = computed(() =>
  new Map(
    visibleItems.value.map((item) => {
      const relativePath = props.toRelativePath(item.path)
      const parts = relativePath.split('/')
      const parent = parts.slice(0, -1).join('/')
      return [item.path, parent || '.']
    })
  )
)
const summaryLabel = computed(() => {
  if (!visibleItems.value.length) return 'No suggestions'
  const recentlyActiveCount = visibleItems.value.filter((item) => item.reasonLabel === 'Recently active').length
  if (recentlyActiveCount > 0) {
    return `${visibleItems.value.length} suggestions, ${recentlyActiveCount} recently active`
  }
  return `${visibleItems.value.length} suggestions`
})
</script>

<template>
  <section class="sb-echoes">
    <header class="sb-echoes-head">
      <h3>Suggested by Echoes</h3>
      <span class="sb-echoes-summary">{{ summaryLabel }}</span>
    </header>
    <div class="sb-echoes-body">
      <div v-if="loading" class="sb-echoes-state">Loading suggestions...</div>
      <div v-else-if="error" class="sb-echoes-state">{{ error }}</div>
      <div v-else-if="!visibleItems.length" class="sb-echoes-state">
        Echoes will suggest nearby notes when a current note has strong local context.
      </div>
      <article v-for="item in visibleItems" v-else :key="item.path" class="sb-echoes-item">
        <div class="sb-echoes-main">
          <strong>{{ item.title }}</strong>
          <span>{{ parentPathLabel.get(item.path) }}</span>
        </div>
        <div class="sb-echoes-meta">
          <span class="sb-echoes-pill">{{ item.reasonLabel }}</span>
          <button
            type="button"
            class="sb-echoes-open"
            @click="emit('open', item.path)"
          >
            Open
          </button>
          <button
            v-if="!isInContext(item.path)"
            type="button"
            class="sb-echoes-action"
            @click="emit('add', item.path)"
          >
            Add
          </button>
          <span v-else class="sb-echoes-in-context">In context</span>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.sb-echoes {
  border-bottom: 1px solid var(--panel-border);
  padding: 0 0 12px;
  margin: 0 0 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sb-echoes-head {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sb-echoes-head h3 {
  margin: 0;
  font-size: var(--font-size-md);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sb-text-dim);
}

.sb-echoes-summary {
  font-size: var(--font-size-sm);
  color: var(--sb-text-dim);
}

.sb-echoes-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sb-echoes-state {
  font-size: var(--font-size-md);
  color: var(--sb-text-dim);
  line-height: 1.5;
}

.sb-echoes-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0;
}

.sb-echoes-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sb-echoes-main strong,
.sb-echoes-main span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-echoes-main span {
  font-size: var(--font-size-md);
  color: var(--sb-text-dim);
}

.sb-echoes-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.sb-echoes-pill,
.sb-echoes-open,
.sb-echoes-in-context,
.sb-echoes-action {
  border-radius: var(--radius-pill);
  font-size: var(--font-size-xs);
  line-height: 1;
  font-weight: 600;
  padding: 4px 8px;
}

.sb-echoes-pill {
  background: var(--sb-active-bg);
  color: var(--sb-active-text);
}

.sb-echoes-open {
  border: 1px solid var(--sb-button-border);
  background: var(--sb-button-bg);
  color: var(--sb-button-text);
}

.sb-echoes-in-context {
  background: var(--sb-status-success-bg);
  color: var(--sb-status-success-text);
}

.sb-echoes-action {
  border: 0;
  background: var(--sb-button-text);
  color: var(--sb-button-bg);
}
</style>
