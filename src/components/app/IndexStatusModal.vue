<script setup lang="ts">
import UiButton from '../ui/UiButton.vue'
import type { IndexActivityRow, IndexLogFilter } from '../../lib/indexActivity'
import type { IndexRuntimeStatus } from '../../lib/api'

/**
 * IndexStatusModal
 *
 * Purpose:
 * - Render index runtime, progress, warnings, and recent activity.
 */

defineProps<{
  visible: boolean
  running: boolean
  busy: boolean
  runtimeStatus: IndexRuntimeStatus | null
  badgeLabel: string
  badgeClass: string
  showProgressBar: boolean
  progressPercent: number
  progressLabel: string
  progressSummary: string
  currentPathLabel: string
  modelStateClass: string
  modelStatusLabel: string
  showWarmupNote: boolean
  alert: { level: 'error' | 'warning'; title: string; message: string } | null
  logFilter: IndexLogFilter
  filteredRows: IndexActivityRow[]
  errorCount: number
  slowCount: number
  actionLabel: string
  formatDurationMs: (value: number | null) => string
  formatTimestamp: (value: number | null) => string
}>()

const emit = defineEmits<{
  close: []
  action: []
  'update:logFilter': [value: IndexLogFilter]
}>()
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div
      class="modal confirm-modal index-status-modal"
      data-modal="index-status"
      role="dialog"
      aria-modal="true"
      aria-labelledby="index-status-title"
      tabindex="-1"
    >
      <h3 id="index-status-title" class="confirm-title">Index Status</h3>
      <div class="index-status-body">
        <section class="index-overview">
          <div class="index-overview-main">
            <span class="index-status-badge" :class="badgeClass">
              <span class="index-status-badge-dot"></span>
              {{ badgeLabel }}
            </span>
            <div
              v-if="showProgressBar"
              class="index-overview-progress-inline"
            >
              <div class="index-progress-track" role="progressbar" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100">
                <div class="index-progress-fill" :style="{ width: `${progressPercent}%` }"></div>
              </div>
              <div class="index-progress-meta">
                <span>{{ progressLabel }}</span>
                <span>{{ progressPercent }}%</span>
              </div>
            </div>
            <p v-else-if="progressSummary" class="index-overview-summary">{{ progressSummary }}</p>
            <p v-if="currentPathLabel" class="index-overview-current">
              Current: {{ currentPathLabel }}
            </p>
          </div>
        </section>

        <section class="index-model-card">
          <div class="index-model-head">
            <p class="index-model-label">Embedding model</p>
            <span class="index-model-state" :class="modelStateClass">{{ modelStatusLabel }}</span>
          </div>
          <p class="index-model-name">{{ runtimeStatus?.model_name || 'n/a' }}</p>
          <p v-if="runtimeStatus?.model_last_duration_ms != null" class="index-model-meta">
            Last init {{ formatDurationMs(runtimeStatus.model_last_duration_ms) }}
            <span v-if="runtimeStatus.model_last_finished_at_ms"> at {{ formatTimestamp(runtimeStatus.model_last_finished_at_ms) }}</span>
          </p>
          <p v-if="showWarmupNote" class="index-model-hint">
            First initialization can download model weights and take longer.
          </p>
        </section>

        <section v-if="alert" class="index-alert" :class="`index-alert-${alert.level}`">
          <div>
            <p class="index-alert-title">{{ alert.title }}</p>
            <p class="index-alert-message">{{ alert.message }}</p>
          </div>
          <UiButton
            v-if="!running"
            size="sm"
            variant="secondary"
            class-name="index-alert-action"
            :disabled="busy"
            @click="emit('action')"
          >
            Retry rebuild
          </UiButton>
        </section>

        <div class="index-status-sections">
          <div class="index-log-panel">
            <div class="index-log-header">
              <p class="index-log-title">Recent indexing activity</p>
              <div class="index-log-filters" role="tablist" aria-label="Index log filters">
                <button
                  type="button"
                  class="index-log-filter-btn"
                  :class="{ active: logFilter === 'all' }"
                  @click="emit('update:logFilter', 'all')"
                >
                  All
                </button>
                <button
                  type="button"
                  class="index-log-filter-btn"
                  :class="{ active: logFilter === 'errors' }"
                  @click="emit('update:logFilter', 'errors')"
                >
                  Errors ({{ errorCount }})
                </button>
                <button
                  type="button"
                  class="index-log-filter-btn"
                  :class="{ active: logFilter === 'slow' }"
                  @click="emit('update:logFilter', 'slow')"
                >
                  Slow >1s ({{ slowCount }})
                </button>
              </div>
            </div>
            <div v-if="!filteredRows.length" class="index-log-empty">No matching activity.</div>
            <div v-else class="index-log-list">
              <div
                v-for="row in filteredRows"
                :key="row.id"
                class="index-log-row"
                :class="`index-log-row-${row.state}`"
              >
                <span class="index-log-time">{{ row.timeLabel }}</span>
                <div class="index-log-copy">
                  <p class="index-log-main">
                    <span class="index-log-state-icon" aria-hidden="true">{{ row.state === 'done' ? '✅' : row.state === 'error' ? '⚠️' : '⏳' }}</span>
                    <span>{{ row.title }}</span>
                  </p>
                  <p v-if="row.path" class="index-log-path">
                    <span v-if="row.directory" class="index-log-dir">{{ row.directory }}/</span><strong>{{ row.fileName }}</strong>
                  </p>
                  <p v-if="row.detail" class="index-log-detail">{{ row.detail }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="confirm-actions">
        <UiButton
          size="sm"
          :variant="running ? 'secondary' : 'primary'"
          :class-name="running ? 'index-stop-btn' : ''"
          :disabled="busy"
          @click="emit('action')"
        >
          {{ actionLabel }}
        </UiButton>
        <UiButton size="sm" @click="emit('close')">Close</UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.index-status-modal {
  width: min(980px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  background: var(--index-modal-bg);
}

.index-status-body {
  min-height: 0;
  overflow: auto;
  padding-right: 6px;
}

.index-overview,
.index-model-card,
.index-log-panel {
  border: 1px solid var(--index-card-border);
  border-radius: 12px;
  background: var(--index-card-bg);
}

.index-overview {
  padding: 12px;
  margin-bottom: 10px;
}

.index-overview-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.index-overview-progress-inline {
  flex: 1 1 260px;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.index-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
}

.index-status-badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.index-badge-ready {
  background: var(--index-badge-ready-bg);
  color: var(--index-badge-ready-text);
}

.index-badge-ready .index-status-badge-dot {
  background: var(--index-badge-ready-dot);
}

.index-badge-running {
  background: var(--index-badge-running-bg);
  color: var(--index-badge-running-text);
}

.index-badge-running .index-status-badge-dot {
  background: var(--index-badge-running-dot);
  animation: indexStatusPulse 1.2s ease-in-out infinite;
}

.index-badge-error {
  background: var(--index-badge-error-bg);
  color: var(--index-badge-error-text);
}

.index-badge-error .index-status-badge-dot {
  background: var(--index-badge-error-dot);
}

.index-overview-summary {
  margin: 0;
  font-size: 12px;
  color: var(--text-main);
  font-weight: 600;
}

.index-overview-current,
.index-model-label,
.index-model-meta,
.index-model-hint,
.index-log-empty,
.index-log-time,
.index-log-dir,
.index-log-detail {
  color: var(--text-dim);
}

.index-overview-current {
  margin: 0;
  width: 100%;
  font-size: 11px;
}

.index-progress-track {
  margin-top: 10px;
  width: 100%;
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--index-progress-track);
}

.index-progress-fill {
  height: 100%;
  background: var(--index-progress-fill);
  transition: width 180ms ease;
}

.index-progress-meta {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-soft);
  display: flex;
  justify-content: space-between;
}

.index-overview-progress-inline .index-progress-track,
.index-overview-progress-inline .index-progress-meta {
  margin-top: 0;
}

.index-model-card {
  padding: 10px 12px;
  margin-bottom: 10px;
}

.index-model-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.index-model-label {
  margin: 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
}

.index-model-state {
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 700;
}

.index-model-ready {
  color: var(--index-model-ready-text);
  background: var(--index-model-ready-bg);
}

.index-model-busy {
  color: var(--index-model-busy-text);
  background: var(--index-model-busy-bg);
}

.index-model-failed {
  color: var(--index-model-failed-text);
  background: var(--index-model-failed-bg);
}

.index-model-idle {
  color: var(--index-model-idle-text);
  background: var(--index-model-idle-bg);
}

.index-model-name,
.index-log-main,
.index-log-path {
  color: var(--text-main);
}

.index-model-name {
  margin: 7px 0 0;
  font-size: 12px;
  font-family: var(--font-code);
}

.index-model-meta {
  margin: 6px 0 0;
  font-size: 11px;
}

.index-model-hint {
  margin: 5px 0 0;
  font-size: 11px;
}

.index-alert {
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.index-alert-error {
  border: 1px solid var(--index-alert-error-border);
  background: var(--index-alert-error-bg);
}

.index-alert-warning {
  border: 1px solid var(--index-alert-warning-border);
  background: var(--index-alert-warning-bg);
}

.index-alert-title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--index-alert-title);
}

.index-alert-message {
  margin: 3px 0 0;
  font-size: 11px;
  color: var(--index-alert-copy);
}

.index-alert-action {
  white-space: nowrap;
}

.index-status-sections {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.index-log-panel {
  padding: 10px;
}

.index-log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.index-log-filters {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.index-log-filter-btn {
  border: 1px solid var(--index-filter-border);
  border-radius: 999px;
  background: var(--index-filter-bg);
  color: var(--index-filter-text);
  padding: 3px 9px;
  font-size: 10px;
  line-height: 1.3;
}

.index-log-filter-btn.active {
  border-color: var(--index-filter-active-border);
  color: var(--index-filter-active-text);
  background: var(--index-filter-active-bg);
}

.index-log-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-soft);
}

.index-log-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 260px;
  margin-top: 8px;
  padding-right: 4px;
  overflow: auto;
}

.index-log-row {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 8px;
  align-items: start;
  border: 1px solid var(--index-card-border);
  border-radius: 8px;
  padding: 6px;
  background: color-mix(in srgb, var(--surface-bg) 72%, transparent);
}

.index-log-row-running {
  border-color: var(--index-row-running-border);
}

.index-log-row-error {
  border-color: var(--index-row-error-border);
}

.index-log-time {
  font-size: 10px;
  line-height: 1.2;
  white-space: nowrap;
  font-family: var(--font-code);
}

.index-log-copy {
  min-width: 0;
}

.index-log-main {
  margin: 0;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.index-log-state-icon {
  width: 14px;
  text-align: center;
}

.index-log-path {
  margin: 2px 0 0;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.index-log-detail {
  margin: 2px 0 0;
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.index-stop-btn {
  border-color: var(--index-stop-border) !important;
  background: var(--index-stop-bg) !important;
  color: var(--index-stop-text) !important;
}

@keyframes indexStatusPulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.9);
  }

  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

@media (max-width: 980px) {
  .index-status-modal {
    width: min(760px, calc(100vw - 20px));
  }

  .index-overview-main {
    align-items: flex-start;
  }

  .index-alert {
    flex-direction: column;
  }

  .index-log-header {
    align-items: flex-start;
  }

  .index-log-list {
    height: 220px;
  }

  .index-log-row {
    grid-template-columns: 1fr;
  }

  .index-log-time {
    white-space: normal;
  }
}
</style>
