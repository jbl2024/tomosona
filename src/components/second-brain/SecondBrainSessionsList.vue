<script setup lang="ts">
import { computed, ref } from 'vue'
import { PlusIcon, TrashIcon } from '@heroicons/vue/24/outline'
import type { SecondBrainSessionSummary } from '../../lib/api'

const props = defineProps<{
  sessions: SecondBrainSessionSummary[]
  activeSessionId: string
  loading: boolean
}>()

const emit = defineEmits<{
  select: [sessionId: string]
  create: []
  delete: [sessionId: string]
}>()

const query = ref('')
const confirmDeleteSessionId = ref('')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.sessions
  return props.sessions.filter((item) => item.title.toLowerCase().includes(q) || item.session_id.toLowerCase().includes(q))
})

function dateLabel(ts: number): string {
  return new Date(ts).toLocaleString()
}

function openDeleteConfirm(sessionId: string) {
  confirmDeleteSessionId.value = sessionId
}

function closeDeleteConfirm() {
  confirmDeleteSessionId.value = ''
}

function confirmDelete() {
  if (!confirmDeleteSessionId.value) return
  emit('delete', confirmDeleteSessionId.value)
  closeDeleteConfirm()
}
</script>

<template>
  <section class="sb-sessions">
    <div class="sb-sessions-head">
      <input v-model="query" class="sb-input" type="text" placeholder="Rechercher session...">
      <button type="button" class="sb-btn icon-btn" title="Nouvelle session" @click="emit('create')">
        <PlusIcon class="h-4 w-4" />
        <span>New</span>
      </button>
    </div>

    <div class="sb-list">
      <p v-if="loading" class="sb-empty">Chargement sessions...</p>
      <button
        v-for="session in filtered"
        :key="session.session_id"
        type="button"
        class="sb-session-item"
        :class="{ active: session.session_id === activeSessionId }"
        @click="emit('select', session.session_id)"
      >
        <div class="sb-session-main">
          <strong>{{ session.title || 'Session' }}</strong>
          <span>{{ dateLabel(session.updated_at_ms) }}</span>
        </div>
        <span
          class="sb-delete-btn"
          role="button"
          tabindex="0"
          title="Supprimer la session"
          @click.stop="openDeleteConfirm(session.session_id)"
          @keydown.enter.prevent.stop="openDeleteConfirm(session.session_id)"
        >
          <TrashIcon class="h-4 w-4" />
        </span>
      </button>
      <p v-if="!loading && !filtered.length" class="sb-empty">Aucune session</p>
    </div>

    <div v-if="confirmDeleteSessionId" class="modal-overlay" @click.self="closeDeleteConfirm">
      <div class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-session-title">
        <h3 id="delete-session-title" class="confirm-title">Delete session?</h3>
        <p class="confirm-text">This will permanently remove session messages and context.</p>
        <div class="confirm-actions">
          <button type="button" class="sb-btn" @click="closeDeleteConfirm">Cancel</button>
          <button type="button" class="sb-btn danger" @click="confirmDelete">Delete</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sb-sessions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  height: 100%;
  padding: 6px 0 0;
}
.sb-sessions-head {
  display: flex;
  gap: 8px;
  padding: 0 2px;
}
.sb-input {
  flex: 1;
  height: 32px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #fff;
  font-size: 12px;
  padding: 0 10px;
}
.sb-btn {
  height: 32px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #fff;
  padding: 0 10px;
  font-size: 12px;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sb-list {
  overflow: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}
.sb-session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #fff;
  padding: 10px;
  font-size: 12px;
  text-align: left;
  position: relative;
}
.sb-session-item.active {
  border-color: #2563eb;
  background: #eff6ff;
}
.sb-session-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
}
.sb-session-main strong {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sb-delete-btn {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #fecaca;
  border-radius: 999px;
  color: #b91c1c;
  background: #fff1f2;
  opacity: 0;
  transition: opacity 120ms ease;
}
.sb-session-item:hover .sb-delete-btn,
.sb-delete-btn:focus-visible {
  opacity: 1;
}
.sb-empty {
  color: #64748b;
  margin: 0;
  font-size: 12px;
}
.danger {
  border-color: #fecaca;
  color: #b91c1c;
  background: #fff1f2;
}
.modal-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(15 23 42 / 40%);
  z-index: 45;
}
.modal {
  width: min(380px, calc(100vw - 28px));
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  background: #fff;
  padding: 14px;
}
.confirm-title {
  margin: 0;
  font-size: 15px;
  color: #0f172a;
}
.confirm-text {
  margin: 8px 0 0;
  font-size: 13px;
  color: #475569;
}
.confirm-actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
:global(.ide-root.dark) .sb-input,
:global(.ide-root.dark) .sb-btn,
:global(.ide-root.dark) .sb-session-item {
  border-color: #3e4451;
  background: #282c34;
  color: #abb2bf;
}
:global(.ide-root.dark) .sb-session-item.active {
  border-color: #61afef;
  background: #2c313c;
}
:global(.ide-root.dark) .sb-delete-btn {
  border-color: #5c2b30;
  color: #e06c75;
  background: #33252a;
}
:global(.ide-root.dark) .danger {
  border-color: #5c2b30;
  color: #e06c75;
  background: #33252a;
}
:global(.ide-root.dark) .modal {
  border-color: #3e4451;
  background: #21252b;
}
:global(.ide-root.dark) .confirm-title {
  color: #d7dce5;
}
:global(.ide-root.dark) .confirm-text {
  color: #9aa3b2;
}
</style>
