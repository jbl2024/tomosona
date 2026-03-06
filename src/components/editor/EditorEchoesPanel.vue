<script setup lang="ts">
/**
 * Presentational Echoes panel for the note-side context surface.
 */
import type { EchoesItem } from '../../lib/echoes'

const props = defineProps<{
  items: EchoesItem[]
  loading: boolean
  error: string
  hintVisible: boolean
  toRelativePath: (path: string) => string
}>()

const emit = defineEmits<{
  open: [path: string]
}>()
</script>

<template>
  <section class="pane-card pane-section">
    <h3 class="section-title">Echoes</h3>
    <p v-if="hintVisible" class="echoes-helper">Relevant notes around what you're working on now.</p>
    <div v-if="loading" class="empty-state">Loading...</div>
    <div v-else-if="error" class="empty-state">{{ error }}</div>
    <div v-else-if="!items.length" class="empty-state">
      Echoes surfaces nearby notes when Tomosona finds strong local context.
    </div>
    <button
      v-for="item in items"
      v-else
      :key="`echo-${item.path}`"
      type="button"
      class="pane-item echoes-item"
      @click="emit('open', item.path)"
    >
      <span class="echoes-item-main">
        <strong class="echoes-item-title">{{ item.title }}</strong>
        <span class="echoes-item-path">{{ props.toRelativePath(item.path) }}</span>
      </span>
      <span class="echoes-item-reasons">
        <span class="echoes-pill">{{ item.reasonLabel }}</span>
        <span
          v-for="reason in item.reasonLabels.filter((reason) => reason !== item.reasonLabel).slice(0, 1)"
          :key="`${item.path}-${reason}`"
          class="echoes-pill echoes-pill-secondary"
        >
          {{ reason }}
        </span>
      </span>
    </button>
  </section>
</template>

<style scoped>
.echoes-helper {
  margin: 0 0 8px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.4;
}

.ide-root.dark .echoes-helper {
  color: #aab4c5;
}

.echoes-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.echoes-item-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.echoes-item-title,
.echoes-item-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.echoes-item-title {
  font-size: 13px;
}

.echoes-item-path {
  font-size: 11px;
  color: #6b7280;
}

.ide-root.dark .echoes-item-path {
  color: #9aa7bb;
}

.echoes-item-reasons {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  flex: 0 0 auto;
}

.echoes-pill {
  border-radius: 999px;
  background: #e0f2fe;
  color: #0f4c81;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.1;
}

.echoes-pill-secondary {
  background: #e5e7eb;
  color: #4b5563;
}

.ide-root.dark .echoes-pill {
  background: #0f2942;
  color: #bfdbfe;
}

.ide-root.dark .echoes-pill-secondary {
  background: #334155;
  color: #d4dbe6;
}
</style>
