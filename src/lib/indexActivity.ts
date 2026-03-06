import type { IndexLogEntry } from './api'
import { normalizeDatePart, splitRelativePath } from './appShellPaths'

/**
 * Module: indexActivity
 *
 * Purpose:
 * - Derive UI-friendly indexing activity rows from raw backend log lines.
 */

export type IndexLogFilter = 'all' | 'errors' | 'slow'
export type IndexActivityState = 'running' | 'done' | 'error'

export type IndexActivityRow = {
  id: string
  ts: number
  timeLabel: string
  state: IndexActivityState
  group: 'file' | 'engine' | 'rebuild' | 'system'
  path: string
  directory: string
  fileName: string
  title: string
  detail: string
  durationMs: number | null
  chunks: number | null
  targets: number | null
  properties: number | null
  embeddingStatus: string
}

/** Parses space-delimited `key=value` fields from a backend log line. */
export function parseIndexLogFields(message: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const token of message.split(/\s+/)) {
    const equals = token.indexOf('=')
    if (equals <= 0 || equals >= token.length - 1) continue
    const key = token.slice(0, equals).trim()
    const value = token.slice(equals + 1).trim()
    if (!key || !value) continue
    out[key] = value
  }
  return out
}

/** Parses an integer field, returning `null` when absent or invalid. */
export function toNumberOrNull(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/** Formats a timestamp as `HH:mm:ss` for activity logs. */
export function formatTimeOnly(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return `${normalizeDatePart(date.getHours())}:${normalizeDatePart(date.getMinutes())}:${normalizeDatePart(date.getSeconds())}`
}

/** Formats a duration in milliseconds for activity summaries. */
export function formatDurationMs(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return ''
  const durationMs = Math.max(0, Math.round(value))
  if (durationMs < 1000) return `${durationMs} ms`
  const seconds = durationMs / 1000
  if (seconds < 60) {
    const precision = seconds < 10 ? 1 : 0
    return `${seconds.toFixed(precision)} s`
  }
  const totalSeconds = Math.floor(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainderSeconds = totalSeconds % 60
  if (hours > 0) {
    if (remainderSeconds > 0) return `${hours} h ${minutes} min ${remainderSeconds} s`
    if (minutes > 0) return `${hours} h ${minutes} min`
    return `${hours} h`
  }
  if (remainderSeconds > 0) return `${minutes} min ${remainderSeconds} s`
  return `${minutes} min`
}

/**
 * Builds recent indexing activity rows for the modal list.
 *
 * `toRelativePath` is injected so the module stays pure and independent from
 * workspace state ownership.
 */
export function buildIndexActivityRows(
  entries: IndexLogEntry[],
  toRelativePath: (path: string) => string
): IndexActivityRow[] {
  const sorted = entries.slice().sort((left, right) => left.ts_ms - right.ts_ms)
  const rows: IndexActivityRow[] = []
  const activeByPath = new Map<string, { startedAt: number; path: string }>()

  for (const entry of sorted) {
    const message = entry.message.trim()
    const fields = parseIndexLogFields(message)
    const resolvedPath = fields.path ? toRelativePath(fields.path) : ''
    const split = splitRelativePath(resolvedPath)
    const base = {
      ts: entry.ts_ms,
      timeLabel: formatTimeOnly(entry.ts_ms),
      path: resolvedPath,
      directory: split.directory,
      fileName: split.fileName,
      chunks: toNumberOrNull(fields.chunks),
      targets: toNumberOrNull(fields.targets),
      properties: toNumberOrNull(fields.properties),
      durationMs: toNumberOrNull(fields.total_ms) ?? toNumberOrNull(fields.embedding_ms),
      embeddingStatus: fields.embedding ?? ''
    }

    if (message.startsWith('reindex:start') && resolvedPath) {
      activeByPath.set(resolvedPath, { startedAt: entry.ts_ms, path: resolvedPath })
      continue
    }

    if (message.startsWith('reindex:done') && resolvedPath) {
      const run = activeByPath.get(resolvedPath)
      const stats: string[] = []
      if (base.chunks != null) stats.push(`chunks ${base.chunks}`)
      if (base.targets != null) stats.push(`targets ${base.targets}`)
      if (base.properties != null) stats.push(`properties ${base.properties}`)
      if (base.embeddingStatus) stats.push(`embed ${base.embeddingStatus}`)
      const durationLabel = formatDurationMs(base.durationMs)
      if (durationLabel) stats.push(durationLabel)
      const failedEmbedding = base.embeddingStatus.includes('failed')
      rows.push({
        id: `done-${resolvedPath}-${entry.ts_ms}`,
        state: failedEmbedding ? 'error' : 'done',
        group: 'file',
        title: run ? 'Indexed file' : 'File index update',
        detail: stats.join(' · '),
        ...base
      })
      activeByPath.delete(resolvedPath)
      continue
    }

    if (message.startsWith('rebuild:done')) {
      const indexed = fields.indexed ?? '?'
      rows.push({
        id: `rebuild-done-${entry.ts_ms}`,
        state: 'done',
        group: 'rebuild',
        title: `Workspace rebuild done (${indexed} indexed)`,
        detail: formatDurationMs(base.durationMs),
        ...base
      })
      continue
    }

    if (message.startsWith('rebuild:start')) {
      rows.push({
        id: `rebuild-start-${entry.ts_ms}`,
        state: 'running',
        group: 'rebuild',
        title: 'Workspace rebuild started',
        detail: '',
        ...base
      })
      continue
    }

    const isError = message.includes('failed') || message.includes(':error') || message.includes('unavailable')
    if (isError) {
      rows.push({
        id: `err-${entry.ts_ms}`,
        state: 'error',
        group: message.includes('reindex:') ? 'engine' : 'system',
        title: message.startsWith('reindex:')
          ? 'Indexing warning'
          : message.startsWith('model:')
            ? 'Model warning'
            : 'Indexer error',
        detail: message,
        ...base
      })
      continue
    }
  }

  for (const run of activeByPath.values()) {
    const split = splitRelativePath(run.path)
    rows.push({
      id: `running-${run.path}-${run.startedAt}`,
      ts: run.startedAt,
      timeLabel: formatTimeOnly(run.startedAt),
      state: 'running',
      group: 'file',
      path: run.path,
      directory: split.directory,
      fileName: split.fileName,
      title: 'Processing file',
      detail: '',
      durationMs: null,
      chunks: null,
      targets: null,
      properties: null,
      embeddingStatus: ''
    })
  }

  return rows.sort((left, right) => right.ts - left.ts).slice(0, 120)
}
