import type { IndexLogEntry } from '../../shared/api/apiTypes'
import { normalizeDatePart, splitRelativePath } from './appShellPaths'

/**
 * Module: indexActivity
 *
 * Purpose:
 * - Derive UI-friendly indexing activity rows from raw backend log lines.
 */

/** Filters exposed by the index activity modal. */
export type IndexLogFilter = 'all' | 'errors' | 'slow'
/** UI-level status assigned to a rendered activity row. */
export type IndexActivityState = 'running' | 'done' | 'error'

/** Normalized row shape consumed by the index status modal activity list. */
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
  rawMessage: string
}

/** Parses space-delimited `key=value` fields from a backend log line. */
export function parseIndexLogFields(message: string): Record<string, string> {
  const out: Record<string, string> = {}
  // Backend index logs currently expose lightweight `key=value` tokens such as
  // `path=journal/today.md total_ms=245`.
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

function isNoisyIndexLog(message: string): boolean {
  return (
    message.startsWith('save_note_buffer:') ||
    message.startsWith('record_internal_write') ||
    message.startsWith('reindex:')
  )
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
  // Start/done logs arrive as separate lines, so the row builder keeps short-
  // lived maps to reconstruct active file-index and refresh work.
  const activeByKey = new Map<string, IndexActivityRow>()

  function withBase(entry: IndexLogEntry, message: string, fields: Record<string, string>): Omit<IndexActivityRow, 'id' | 'state' | 'group' | 'title' | 'detail'> {
    const anchorPath = fields.path ?? fields.source_path ?? ''
    const resolvedPath = anchorPath ? toRelativePath(anchorPath) : ''
    const split = splitRelativePath(resolvedPath)
    return {
      ts: entry.ts_ms,
      timeLabel: formatTimeOnly(entry.ts_ms),
      path: resolvedPath,
      directory: split.directory,
      fileName: split.fileName,
      chunks: toNumberOrNull(fields.chunks),
      targets: toNumberOrNull(fields.targets),
      properties: toNumberOrNull(fields.properties),
      durationMs: toNumberOrNull(fields.total_ms),
      rawMessage: message
    }
  }

  function upsertActive(key: string, row: IndexActivityRow) {
    activeByKey.set(key, row)
  }

  for (const entry of sorted) {
    const message = entry.message.trim()
    if (isNoisyIndexLog(message)) continue
    const fields = parseIndexLogFields(message)
    const base = withBase(entry, message, fields)

    if (message.startsWith('reindex:start') && base.path) {
      upsertActive(`lexical:${base.path}`, {
        id: `lexical-running-${base.path}-${entry.ts_ms}`,
        state: 'running',
        group: 'file',
        title: 'Indexing file content',
        detail: '',
        ...base
      })
      continue
    }

    if (message.startsWith('reindex:done') && base.path) {
      const run = activeByKey.get(`lexical:${base.path}`)
      const stats: string[] = []
      if (base.chunks != null) stats.push(`chunks ${base.chunks}`)
      if (base.targets != null) stats.push(`targets ${base.targets}`)
      if (base.properties != null) stats.push(`properties ${base.properties}`)
      const durationLabel = formatDurationMs(base.durationMs)
      if (durationLabel) stats.push(durationLabel)
      rows.push({
        id: `lexical-done-${base.path}-${entry.ts_ms}`,
        state: 'done',
        group: 'file',
        title: run ? 'Indexed file content' : 'File index update',
        detail: stats.join(' · '),
        ...base
      })
      activeByKey.delete(`lexical:${base.path}`)
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
        group: 'system',
        title: 'Indexer error',
        detail: message,
        ...base
      })
      continue
    }
  }

  for (const row of activeByKey.values()) {
    rows.push(row)
  }

  return rows.sort((left, right) => right.ts - left.ts).slice(0, 120)
}
