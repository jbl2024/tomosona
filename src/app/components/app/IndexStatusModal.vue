<script setup lang="ts">
import {
  ArrowPathIcon,
  CheckCircleIcon,
  CircleStackIcon,
  ClockIcon,
  CpuChipIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  LinkIcon
} from '@heroicons/vue/24/outline'
import { computed } from 'vue'
import UiButton from '../../../shared/components/ui/UiButton.vue'
import type { IndexActivityRow, IndexLogFilter } from '../../lib/indexActivity'
import type { IndexRuntimeStatus } from '../../../shared/api/apiTypes'

/**
 * IndexStatusModal
 *
 * Purpose:
 * - Present the workspace indexing runtime in a compact, premium modal.
 * - Keep the surface focused on useful summary data, technical state, and
 *   recent activity while leaving orchestration in the shell controller.
 */

const props = defineProps<{
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
  currentOperationLabel: string
  currentOperationDetail: string
  currentOperationPath: string
  currentOperationStatusLabel: string
  modelStateClass: string
  modelStatusLabel: string
  showWarmupNote: boolean
  alert: { level: 'error' | 'warning'; title: string; message: string } | null
  semanticLinksCount: number
  processedNotesCount: number
  notesTotalCount: number
  notesTotalLoading: boolean
  lastRunFinishedAtMs: number | null
  lastRunTitle: string
  lastRunDurationMs: number | null
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

const visibleRows = computed(() => props.filteredRows.slice(0, 8))

const latestCompletedRow = computed(() => props.filteredRows[0] ?? null)
const latestRebuildRow = computed(() => props.filteredRows.find((row) => row.group === 'rebuild' && row.state === 'done') ?? null)

const lastRunFinishedAtLabel = computed(() =>
  latestRebuildRow.value
    ? latestRebuildRow.value.timeLabel
    : props.lastRunFinishedAtMs != null
      ? props.formatTimestamp(props.lastRunFinishedAtMs)
      : latestCompletedRow.value
        ? latestCompletedRow.value.timeLabel
        : '--:--:--'
)

const lastRunTitleLabel = computed(() =>
  latestRebuildRow.value?.title || props.lastRunTitle || latestCompletedRow.value?.title || 'Waiting for the first completed run'
)

const lastRunDetailLabel = computed(() => {
  const title = lastRunTitleLabel.value
  const durationLabel = (latestRebuildRow.value?.durationMs != null
    ? props.formatDurationMs(latestRebuildRow.value.durationMs)
    : (
    props.lastRunDurationMs != null ? props.formatDurationMs(props.lastRunDurationMs) : ''
  )).trim()
  if (!durationLabel || durationLabel === title) return title
  return `${title} · ${durationLabel}`
})

const showCurrentRunSection = computed(
  () => props.running || props.currentOperationLabel || props.progressSummary || props.currentPathLabel
)

const currentRunTitle = computed(() => {
  const currentOperationLabel = props.currentOperationLabel.trim()
  if (currentOperationLabel) return currentOperationLabel
  if (props.running) return props.progressSummary || 'Indexing'
  return props.currentOperationStatusLabel || 'Idle'
})

const currentRunDetail = computed(() => {
  const currentOperationDetail = props.currentOperationDetail.trim()
  if (currentOperationDetail) return currentOperationDetail
  if (props.running) return props.progressSummary
  if (props.progressSummary && props.progressSummary !== currentRunTitle.value) return props.progressSummary
  return ''
})

const currentRunMetaLine = computed(() => {
  const path = (props.currentOperationPath || props.currentPathLabel).trim()
  const detail = currentRunDetail.value.trim()
  if (path && detail) return `${path} · ${detail}`
  return path || detail
})

const modelDetail = computed(() => {
  const parts: string[] = []
  if (props.showWarmupNote) {
    parts.push('First initialization can download model weights and take longer.')
  }
  if (props.runtimeStatus?.model_last_duration_ms != null) {
    const lastInit = `Last init ${props.formatDurationMs(props.runtimeStatus.model_last_duration_ms)}`
    if (props.runtimeStatus.model_last_finished_at_ms != null) {
      parts.push(`${lastInit} at ${props.formatTimestamp(props.runtimeStatus.model_last_finished_at_ms)}`)
    } else {
      parts.push(lastInit)
    }
  }
  return parts.join(' · ')
})

const activityFilters = computed(() => [
  { key: 'all' as const, label: 'All' },
  { key: 'errors' as const, label: `Errors (${props.errorCount})` }
])

const heroStats = computed(() => [
  {
    icon: LinkIcon,
    label: 'Semantic links',
    value: String(props.semanticLinksCount),
    detail: props.semanticLinksCount > 0 ? 'Persisted in the database' : 'No semantic links stored yet'
  },
  {
    icon: DocumentTextIcon,
    label: 'Notes processed',
    value:
      props.notesTotalLoading
        ? `${props.processedNotesCount}/…`
        : props.notesTotalCount > 0
        ? `${props.processedNotesCount}/${props.notesTotalCount}`
        : String(props.processedNotesCount),
    detail:
      props.notesTotalLoading
        ? 'Loading workspace notes'
        : props.notesTotalCount > 0
        ? `${props.processedNotesCount} processed of ${props.notesTotalCount} workspace notes`
        : 'No notes discovered in the workspace yet'
  },
  {
    icon: ClockIcon,
    label: 'Last run',
    value: lastRunFinishedAtLabel.value,
    detail: lastRunDetailLabel.value
  }
])

function rowIcon(row: IndexActivityRow) {
  if (row.state === 'error') return ExclamationTriangleIcon
  if (row.state === 'running') return ArrowPathIcon
  return CheckCircleIcon
}

function rowToneClass(row: IndexActivityRow) {
  if (row.state === 'error') return 'index-activity-row--error'
  if (row.state === 'running') return 'index-activity-row--running'
  return 'index-activity-row--done'
}

function renderPathPrefix(row: IndexActivityRow) {
  if (!row.path || !row.directory) return ''
  return `${row.directory}/`
}
</script>

<template>
  <div v-if="visible" class="modal-overlay index-status-overlay" @click.self="emit('close')">
    <div
      class="modal confirm-modal index-status-modal"
      data-modal="index-status"
      role="dialog"
      aria-modal="true"
      aria-labelledby="index-status-title"
      tabindex="-1"
    >
      <header class="index-status-header">
        <div class="index-status-heading">
          <div class="index-status-title-lockup">
            <span class="index-status-icon" aria-hidden="true">
              <CircleStackIcon class="index-status-title-icon" />
            </span>
            <div>
              <h3 id="index-status-title" class="index-status-title">Index Status</h3>
              <p class="index-status-subtitle">Live index telemetry for the active workspace.</p>
            </div>
          </div>
          <span class="index-status-badge" :class="badgeClass">
            <span class="index-status-badge-dot"></span>
            {{ badgeLabel }}
          </span>
        </div>
      </header>

      <div class="index-status-body">
        <section class="index-hero-grid" aria-label="Index overview">
          <article v-for="stat in heroStats" :key="stat.label" class="index-hero-card">
            <div class="index-hero-card-top">
              <component :is="stat.icon" class="index-hero-icon" aria-hidden="true" />
              <p class="index-hero-label">{{ stat.label }}</p>
            </div>
            <div class="index-hero-value">{{ stat.value }}</div>
            <p class="index-hero-detail">{{ stat.detail }}</p>
          </article>
        </section>

        <section class="index-secondary-grid" :class="{ 'index-secondary-grid--single': !showCurrentRunSection }">
          <section class="index-hero-card index-model-strip">
            <div class="index-hero-card-top index-model-card-top">
              <div class="index-model-copy">
                <CpuChipIcon class="index-hero-icon" aria-hidden="true" />
                <p class="index-hero-label">Model</p>
              </div>
              <span class="index-model-state" :class="modelStateClass">{{ modelStatusLabel }}</span>
            </div>

            <div class="index-hero-value index-model-name">{{ runtimeStatus?.model_name || 'n/a' }}</div>
            <p v-if="modelDetail" class="index-hero-detail index-model-detail">
              {{ modelDetail }}
            </p>
          </section>

          <section v-if="showCurrentRunSection" class="index-progress-strip">
            <div class="index-progress-strip-head">
              <div class="index-progress-strip-copy">
                <p class="index-section-kicker">Current run</p>
                <p class="index-progress-title">{{ currentRunTitle }}</p>
              </div>
              <span class="index-progress-state">{{ currentOperationStatusLabel }}</span>
            </div>
            <p v-if="currentRunMetaLine" class="index-progress-meta-line">
              {{ currentRunMetaLine }}
            </p>
            <div
              v-if="showProgressBar"
              class="index-progress-track"
              role="progressbar"
              :aria-valuenow="progressPercent"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div class="index-progress-fill" :style="{ width: `${progressPercent}%` }"></div>
            </div>
            <div v-if="showProgressBar" class="index-progress-meta">
              <span>{{ progressLabel }}</span>
              <span>{{ progressPercent }}%</span>
            </div>
          </section>
        </section>

        <section v-if="alert" class="index-alert" :class="`index-alert-${alert.level}`">
          <ExclamationTriangleIcon class="index-alert-icon" aria-hidden="true" />
          <div class="index-alert-copy">
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

        <section class="index-activity">
          <div class="index-activity-head">
            <div>
              <p class="index-section-kicker">Recent activity</p>
              <h4 class="index-activity-title">Recent activity</h4>
            </div>
            <div class="index-log-filters" role="tablist" aria-label="Index log filters">
              <button
                v-for="filter in activityFilters"
                :key="filter.key"
                type="button"
                class="index-log-filter-btn"
                :class="{ active: logFilter === filter.key }"
                @click="emit('update:logFilter', filter.key)"
              >
                {{ filter.label }}
              </button>
            </div>
          </div>

          <p v-if="!visibleRows.length" class="index-empty-state">
            No matching activity yet.
          </p>
          <div v-else class="index-activity-list" role="list">
            <article
              v-for="row in visibleRows"
              :key="row.id"
              class="index-activity-row"
              :class="rowToneClass(row)"
              role="listitem"
            >
              <component :is="rowIcon(row)" class="index-activity-row-icon" aria-hidden="true" />
              <div class="index-activity-copy">
                <div class="index-activity-mainline">
                  <span class="index-activity-time">{{ row.timeLabel }}</span>
                  <span class="index-activity-event">{{ row.title }}</span>
                  <span v-if="row.path" class="index-activity-path">
                    {{ renderPathPrefix(row) }}
                    <strong>{{ row.fileName }}</strong>
                  </span>
                </div>
                <p v-if="row.detail" class="index-activity-detail">
                  {{ row.detail }}
                </p>
              </div>
            </article>
          </div>
        </section>
      </div>

      <footer class="index-status-footer">
        <UiButton size="sm" variant="ghost" @click="emit('close')">Close</UiButton>
        <UiButton
          size="sm"
          :variant="running ? 'danger' : 'primary'"
          :class-name="running ? 'index-stop-btn' : ''"
          :disabled="busy"
          :loading="busy"
          @click="emit('action')"
        >
          {{ actionLabel }}
        </UiButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.index-status-overlay {
  align-items: center;
  padding-top: 24px;
}

.index-status-modal {
  width: min(920px, calc(100vw - 24px));
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  background: var(--index-modal-bg);
  backdrop-filter: blur(18px) saturate(120%);
  border: 1px solid color-mix(in srgb, var(--panel-border) 86%, transparent);
  box-shadow:
    0 28px 88px color-mix(in srgb, #000 18%, transparent),
    0 2px 6px color-mix(in srgb, #000 8%, transparent),
    inset 0 1px 0 color-mix(in srgb, #fff 28%, transparent);
  animation: indexStatusEnter 180ms ease-out;
}

.index-status-header {
  padding: 18px 20px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--panel-border) 56%, transparent);
}

.index-status-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.index-status-title-lockup {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
}

.index-status-icon {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface-raised) 92%, white 8%), var(--surface-bg));
  border: 1px solid color-mix(in srgb, var(--panel-border) 66%, transparent);
  color: var(--text-soft);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, #fff 14%, transparent),
    0 8px 18px color-mix(in srgb, #000 5%, transparent);
}

.index-status-title-icon {
  width: 18px;
  height: 18px;
}

.index-status-title {
  margin: 0;
  font-size: 1.08rem;
  line-height: 1.15;
  font-weight: 700;
  color: var(--text-main);
}

.index-status-subtitle {
  margin: 4px 0 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--text-dim);
}

.index-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 25%, transparent);
}

.index-status-badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.index-badge-ready {
  background: color-mix(in srgb, var(--index-badge-ready-bg) 88%, transparent);
  color: var(--index-badge-ready-text);
}

.index-badge-ready .index-status-badge-dot {
  background: var(--index-badge-ready-dot);
}

.index-badge-running {
  background: color-mix(in srgb, var(--index-badge-running-bg) 88%, transparent);
  color: var(--index-badge-running-text);
}

.index-badge-running .index-status-badge-dot {
  background: var(--index-badge-running-dot);
  animation: indexStatusPulse 1.2s ease-in-out infinite;
}

.index-badge-error {
  background: color-mix(in srgb, var(--index-badge-error-bg) 88%, transparent);
  color: var(--index-badge-error-text);
}

.index-badge-error .index-status-badge-dot {
  background: var(--index-badge-error-dot);
}

.index-status-body {
  min-height: 0;
  overflow: auto;
  padding: 14px 18px 0;
}

.index-hero-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.index-hero-card {
  min-height: 104px;
  border-radius: 16px;
  padding: 12px 14px 11px;
  display: grid;
  grid-template-rows: auto auto 1fr;
  align-content: start;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--index-card-bg) 92%, white 8%), var(--index-card-bg)),
    var(--index-card-bg);
  border: 1px solid color-mix(in srgb, var(--index-card-border) 72%, transparent);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, #fff 14%, transparent),
    0 10px 24px color-mix(in srgb, #000 4%, transparent);
}

.index-hero-card-top {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.index-hero-icon {
  width: 16px;
  height: 16px;
  color: var(--text-soft);
  flex: 0 0 auto;
}

.index-hero-label {
  margin: 0;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.075em;
  text-transform: uppercase;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.index-hero-value {
  margin-top: 10px;
  font-size: 1.34rem;
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--text-main);
}

.index-hero-card--lead .index-hero-value {
  font-size: 1.58rem;
}

.index-hero-detail {
  margin: 8px 0 0;
  font-size: 0.72rem;
  line-height: 1.35;
  color: var(--text-dim);
  align-self: end;
}

.index-secondary-grid,
.index-alert,
.index-activity {
  margin-top: 12px;
}

.index-secondary-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  align-items: stretch;
}

.index-secondary-grid--single {
  grid-template-columns: minmax(0, 1fr);
}

.index-model-strip {
  min-height: 104px;
  display: grid;
  grid-template-rows: auto auto 1fr;
  align-content: start;
  padding: 12px 14px 11px;
  border-radius: 16px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--index-card-bg) 94%, white 6%), var(--index-card-bg)),
    var(--index-card-bg);
  border: 1px solid color-mix(in srgb, var(--index-card-border) 72%, transparent);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, #fff 12%, transparent),
    0 10px 24px color-mix(in srgb, #000 4%, transparent);
}

.index-model-copy {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.index-model-icon {
  width: 18px;
  height: 18px;
  color: var(--text-soft);
  flex: 0 0 auto;
}

.index-model-text {
  min-width: 0;
}

.index-section-kicker {
  margin: 0;
  font-size: 0.68rem;
  line-height: 1;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.index-model-name {
  margin: 10px 0 0;
  font-size: 1.12rem;
  font-family: var(--font-code);
  color: var(--text-main);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  white-space: normal;
  line-height: 1.18;
  min-height: calc(1.12rem * 1.18 * 2);
}

.index-model-state {
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 0.72rem;
  font-weight: 700;
  white-space: nowrap;
  justify-self: end;
  align-self: start;
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

.index-model-note {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.35;
  color: var(--text-dim);
}

.index-model-meta {
  margin: 0;
  grid-column: 1 / -1;
  font-size: 0.72rem;
  line-height: 1.35;
  color: var(--text-soft);
}

.index-progress-strip {
  height: 100%;
  padding: 11px 13px 12px;
  border-radius: 16px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--index-card-bg) 94%, white 6%), var(--index-card-bg)),
    var(--index-card-bg);
  border: 1px solid color-mix(in srgb, var(--panel-border) 76%, transparent);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, #fff 12%, transparent),
    0 10px 24px color-mix(in srgb, #000 4%, transparent);
}

.index-progress-strip-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.index-progress-strip-copy {
  min-width: 0;
}

.index-progress-title {
  margin: 5px 0 0;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text-main);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  white-space: normal;
  line-height: 1.25;
}

.index-progress-state {
  border-radius: 999px;
  padding: 4px 9px;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-dim);
  background: color-mix(in srgb, var(--surface-bg) 88%, transparent);
  white-space: nowrap;
}

.index-progress-meta-line {
  margin: 5px 0 0;
  font-size: 0.74rem;
  line-height: 1.35;
  color: var(--text-dim);
  font-family: var(--font-code);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  white-space: normal;
}

.index-progress-track {
  margin-top: 8px;
  width: 100%;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in srgb, var(--index-progress-track) 85%, white 15%);
}

.index-progress-fill {
  height: 100%;
  background: var(--index-progress-fill);
  transition: width 180ms ease;
}

.index-progress-meta {
  margin-top: 5px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.68rem;
  color: var(--text-soft);
}

.index-alert {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface-bg) 92%, white 8%);
}

.index-alert-error {
  border: 1px solid var(--index-alert-error-border);
  background: var(--index-alert-error-bg);
}

.index-alert-warning {
  border: 1px solid var(--index-alert-warning-border);
  background: var(--index-alert-warning-bg);
}

.index-alert-icon {
  width: 18px;
  height: 18px;
  margin-top: 1px;
  flex: 0 0 auto;
  color: var(--index-alert-title);
}

.index-alert-copy {
  min-width: 0;
  flex: 1 1 auto;
}

.index-alert-title {
  margin: 0;
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--index-alert-title);
}

.index-alert-message {
  margin: 4px 0 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--index-alert-copy);
}

.index-alert-action {
  white-space: nowrap;
}

.index-activity {
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--panel-border) 54%, transparent);
}

.index-activity-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.index-activity-title {
  margin: 5px 0 0;
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--text-main);
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
  padding: 4px 10px;
  font-size: 0.72rem;
  line-height: 1.25;
}

.index-log-filter-btn.active {
  border-color: var(--index-filter-active-border);
  color: var(--index-filter-active-text);
  background: var(--index-filter-active-bg);
}

.index-empty-state {
  margin: 14px 0 0;
  font-size: 0.8rem;
  color: var(--text-dim);
}

.index-activity-list {
  display: flex;
  flex-direction: column;
  margin-top: 6px;
}

.index-activity-row {
  display: grid;
  grid-template-columns: 18px 1fr;
  gap: 12px;
  padding: 10px 0;
  font-family: var(--font-code);
}

.index-activity-row + .index-activity-row {
  border-top: 1px solid color-mix(in srgb, var(--panel-border) 34%, transparent);
}

.index-activity-row-icon {
  width: 18px;
  height: 18px;
  margin-top: 1px;
  flex: 0 0 auto;
}

.index-activity-row--done .index-activity-row-icon {
  color: var(--success);
}

.index-activity-row--error .index-activity-row-icon {
  color: var(--warning);
}

.index-activity-row--running .index-activity-row-icon {
  color: var(--accent);
  animation: indexStatusPulse 1.2s ease-in-out infinite;
}

.index-activity-copy {
  min-width: 0;
}

.index-activity-mainline {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}

.index-activity-time {
  font-size: 0.7rem;
  font-family: var(--font-code);
  color: var(--text-soft);
  white-space: nowrap;
}

.index-activity-event {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-main);
}

.index-activity-path {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 3px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-muted) 68%, white 32%);
  color: var(--text-dim);
  font-size: 0.74rem;
  line-height: 1.25;
}

.index-activity-path strong {
  font-weight: 700;
  color: var(--text-main);
}

.index-activity-detail {
  margin: 3px 0 0;
  font-size: 0.74rem;
  line-height: 1.3;
  color: var(--text-dim);
}

.index-status-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 13px 20px 16px;
  border-top: 1px solid color-mix(in srgb, var(--panel-border) 62%, transparent);
  background: color-mix(in srgb, var(--surface-bg) 96%, white 4%);
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
    transform: scale(1.08);
  }
}

@keyframes indexStatusEnter {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.985);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 760px) {
  .index-status-modal {
    width: min(100vw - 20px, 100%);
  }

  .index-status-heading,
  .index-activity-head,
  .index-progress-strip-head {
    flex-direction: column;
  }

  .index-hero-grid {
    grid-template-columns: 1fr;
  }

  .index-secondary-grid {
    grid-template-columns: 1fr;
  }

  .index-activity-row {
    grid-template-columns: 1fr;
  }

  .index-activity-row-icon {
    display: none;
  }

  .index-activity-path {
    width: 100%;
  }
}
</style>
