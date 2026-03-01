<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchSecondBrainSessions } from '../../lib/secondBrainApi'
import type { SecondBrainSessionSummary } from '../../lib/api'

const emit = defineEmits<{
  'open-session': [sessionId: string]
}>()

const loading = ref(false)
const error = ref('')
const sessions = ref<SecondBrainSessionSummary[]>([])
const query = ref('')

function dateLabel(ts: number): string {
  return new Date(ts).toLocaleString()
}

async function loadSessions() {
  loading.value = true
  error.value = ''
  try {
    sessions.value = await fetchSecondBrainSessions(120)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load sessions.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadSessions()
})
</script>

<template>
  <section class="sb-history-root">
    <header class="sb-history-head">
      <h2>Second Brain Sessions</h2>
      <button type="button" class="sb-refresh" @click="loadSessions">Refresh</button>
    </header>

    <input v-model="query" class="sb-filter" type="text" placeholder="Filter by title, context, or target note">

    <div v-if="loading" class="sb-empty">Loading sessions...</div>
    <div v-else-if="error" class="sb-error">{{ error }}</div>
    <div v-else class="sb-list">
      <article
        v-for="session in sessions.filter((item) => {
          const q = query.trim().toLowerCase()
          if (!q) return true
          return item.title.toLowerCase().includes(q)
            || item.target_note_path.toLowerCase().includes(q)
            || item.context_paths.join(' ').toLowerCase().includes(q)
        })"
        :key="session.session_id"
        class="sb-session-card"
      >
        <div class="sb-session-title-row">
          <strong>{{ session.title || 'Untitled session' }}</strong>
          <button type="button" class="sb-open-btn" @click="emit('open-session', session.session_id)">Open</button>
        </div>
        <p class="sb-session-meta">{{ dateLabel(session.updated_at_ms) }}</p>
        <p class="sb-session-meta">Target: {{ session.target_note_path || 'Not linked' }}</p>
        <details>
          <summary>Context ({{ session.context_paths.length }})</summary>
          <ul class="sb-context-list">
            <li v-for="path in session.context_paths" :key="`${session.session_id}-${path}`">{{ path }}</li>
          </ul>
        </details>
      </article>
      <p v-if="!sessions.length" class="sb-empty">No sessions yet.</p>
    </div>
  </section>
</template>

<style scoped>
.sb-history-root {
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 14px;
  background: linear-gradient(160deg, #f8fafc, #eef2ff 45%, #f1f5f9);
}
.sb-history-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.sb-history-head h2 {
  margin: 0;
  font-size: 16px;
}
.sb-refresh,
.sb-open-btn {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  font-size: 12px;
  padding: 4px 10px;
}
.sb-filter {
  width: 100%;
  height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  padding: 0 10px;
  font-size: 12px;
}
.sb-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}
.sb-session-card {
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #fff;
  padding: 10px;
}
.sb-session-title-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.sb-session-meta {
  margin: 4px 0;
  color: #64748b;
  font-size: 12px;
}
.sb-context-list {
  margin: 8px 0 0;
  padding-left: 18px;
  color: #475569;
  font-size: 12px;
}
.sb-empty {
  margin-top: 16px;
  color: #64748b;
  font-size: 13px;
}
.sb-error {
  margin-top: 16px;
  color: #b91c1c;
  font-size: 13px;
}
:global(.ide-root.dark) .sb-history-root {
  background: linear-gradient(145deg, #020617, #0f172a 40%, #082f49);
}
:global(.ide-root.dark) .sb-session-card,
:global(.ide-root.dark) .sb-refresh,
:global(.ide-root.dark) .sb-open-btn,
:global(.ide-root.dark) .sb-filter {
  border-color: #334155;
  background: #0f172a;
  color: #e2e8f0;
}
:global(.ide-root.dark) .sb-session-meta,
:global(.ide-root.dark) .sb-context-list,
:global(.ide-root.dark) .sb-empty {
  color: #94a3b8;
}
</style>
