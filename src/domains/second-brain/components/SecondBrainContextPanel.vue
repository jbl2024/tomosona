<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SecondBrainContextItem } from '../../../shared/api/apiTypes'

const props = defineProps<{
  contextItems: SecondBrainContextItem[]
  allFiles: string[]
  tokenEstimate: number
}>()

const emit = defineEmits<{
  'replace-context': [paths: string[]]
}>()

const query = ref('')

const filteredCandidates = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.allFiles.slice(0, 120)
  return props.allFiles.filter((path) => path.toLowerCase().includes(q)).slice(0, 120)
})

function removePath(path: string) {
  const next = props.contextItems.map((item) => item.path).filter((item) => item !== path)
  emit('replace-context', next)
}

function addPath(path: string) {
  const set = new Set(props.contextItems.map((item) => item.path))
  set.add(path)
  emit('replace-context', Array.from(set))
}
</script>

<template>
  <section class="sb-context-panel">
    <div class="sb-context-head">
      <h3>Contexte actif</h3>
      <p>~{{ tokenEstimate }} tokens</p>
    </div>

    <input v-model="query" class="sb-input" type="text" placeholder="Ajouter une note...">

    <div class="sb-context-list">
      <div v-for="item in contextItems" :key="item.path" class="sb-context-card">
        <div class="sb-context-meta">
          <strong>{{ item.path.split('/').pop() }}</strong>
          <span>{{ item.path }}</span>
        </div>
        <button type="button" class="sb-mini-btn" @click="removePath(item.path)">Retirer</button>
      </div>
      <p v-if="!contextItems.length" class="sb-empty">Aucune note dans le contexte</p>
    </div>

    <div class="sb-candidate-list">
      <button
        v-for="path in filteredCandidates"
        :key="path"
        type="button"
        class="sb-candidate-item"
        @click="addPath(path)"
      >
        {{ path }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.sb-context-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.sb-context-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.sb-context-head h3,
.sb-context-head p {
  margin: 0;
  font-size: 12px;
}
.sb-input {
  width: 100%;
  height: 30px;
  border: 1px solid var(--sb-input-border);
  border-radius: 8px;
  background: var(--sb-input-bg);
  color: var(--sb-button-text);
  font-size: 12px;
  padding: 0 8px;
}
.sb-context-list,
.sb-candidate-list {
  border: 1px solid var(--sb-input-border);
  border-radius: 10px;
  background: var(--sb-thread-bg);
  color: var(--sb-text);
  overflow: auto;
  min-height: 120px;
  max-height: 240px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
}
.sb-context-card {
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  padding: 6px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.sb-context-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sb-context-meta span {
  color: var(--sb-text-dim);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sb-mini-btn,
.sb-candidate-item {
  border: 1px solid var(--sb-button-border);
  border-radius: 8px;
  background: var(--sb-button-bg);
  color: var(--sb-button-text);
  font-size: 11px;
  padding: 4px 8px;
  text-align: left;
}
.sb-empty {
  margin: 0;
  color: var(--sb-text-dim);
  font-size: 12px;
}
</style>
