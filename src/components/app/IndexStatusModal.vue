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
