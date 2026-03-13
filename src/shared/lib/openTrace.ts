/**
 * Module: openTrace
 *
 * Purpose:
 * - Provide local, console-first tracing for note-open latency diagnosis.
 *
 * Boundaries:
 * - This is intentionally not OpenTelemetry: no exporter, no collector, no
 *   generic observability abstraction, and no cross-app telemetry concerns.
 * - The API is tailored to one workflow: tracing a note open end-to-end across
 *   shell orchestration, editor load, and note-activation side effects.
 *
 * Naming rules:
 * - Root workflow labels keep the `open.` prefix, for example `open.request`.
 * - Child IPC spans use explicit command names, for example `open.ipc.read_file_metadata`.
 * - Summary buckets are stable snake_case keys so final summaries stay easy to scan.
 */

const OPEN_DEBUG_STORAGE_KEY = 'tomosona.debug.open'
const RECENT_TRACE_LIMIT = 120

export type OpenTraceOutcome = 'done' | 'blocked' | 'error'
export type OpenTraceSummaryBucket =
  | 'editor_load'
  | 'editor_post_render'
  | 'active_note_effects'
  | 'right_pane_data'
  | 'metadata'
  | 'backlinks'
  | 'semantic_links'
  | 'explorer_reveal'

type TraceRecord = {
  id: string
  path: string
  startedAt: number
  source: string
  summaryBuckets: Partial<Record<OpenTraceSummaryBucket, number>>
}

type SpanRecord = {
  id: string
  traceId: string
  parentSpanId: string | null
  name: string
  startedAt: number
  bucket?: OpenTraceSummaryBucket
}

type OpenDebugGlobal = {
  recent: Array<Record<string, unknown>>
}

type OpenTraceActivityListener = (active: boolean) => void

type OpenTraceSpanOptions = {
  parentSpanId?: string | null
  bucket?: OpenTraceSummaryBucket
  payload?: Record<string, unknown>
}

type OpenTraceAsyncSpanOptions = OpenTraceSpanOptions & {
  blockedIf?: () => boolean
  blockedPayload?: Record<string, unknown>
}

const tracesById = new Map<string, TraceRecord>()
const spansById = new Map<string, SpanRecord>()
const pendingTraceByPath = new Map<string, string>()
const activeTraceIds = new Set<string>()
const activeTraceIdByPath = new Map<string, string>()
let traceCounter = 0
let spanCounter = 0
let longTaskObserverInstalled = false
const openTraceActivityListeners = new Set<OpenTraceActivityListener>()

function notifyOpenTraceActivityListeners() {
  const active = activeTraceIds.size > 0
  for (const listener of openTraceActivityListeners) {
    listener(active)
  }
}

function canUseWindow(): boolean {
  return typeof window !== 'undefined'
}

function debugEnabled(): boolean {
  if (!canUseWindow()) return false
  try {
    return window.localStorage.getItem(OPEN_DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/')
}

function readGlobalState(): OpenDebugGlobal | null {
  if (!canUseWindow()) return null
  const globalWindow = window as Window & { __tomosonaOpenDebug?: OpenDebugGlobal }
  if (!globalWindow.__tomosonaOpenDebug) {
    globalWindow.__tomosonaOpenDebug = { recent: [] }
  }
  return globalWindow.__tomosonaOpenDebug
}

function pushRecent(entry: Record<string, unknown>) {
  const state = readGlobalState()
  if (!state) return
  state.recent.push(entry)
  if (state.recent.length > RECENT_TRACE_LIMIT) {
    state.recent.splice(0, state.recent.length - RECENT_TRACE_LIMIT)
  }
}

function formatMs(value: number): string {
  return `${value.toFixed(value >= 100 ? 0 : 1)}ms`
}

function compactPath(path: unknown): string {
  if (typeof path !== 'string') return ''
  const normalized = normalizePath(path)
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length <= 3) return normalized
  return segments.slice(-3).join('/')
}

function formatConsoleValue(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? `${value}` : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value
  return ''
}

function buildConsoleSuffix(payload: Record<string, unknown>): string {
  const fields: string[] = []
  const pushField = (label: string, value: unknown, formatter: (value: unknown) => string = formatConsoleValue) => {
    const formatted = formatter(value)
    if (!formatted) return
    fields.push(`${label}=${formatted}`)
  }

  pushField('trace', payload.trace_id)
  pushField('span', payload.span_id)
  pushField('path', payload.path, compactPath)
  pushField('source', payload.source)
  pushField('duration', payload.duration_ms, (value) => typeof value === 'number' ? formatMs(value) : '')
  pushField('elapsed', payload.elapsed_ms, (value) => typeof value === 'number' ? formatMs(value) : '')
  pushField('total', payload.total_ms)
  pushField('stage', payload.stage)
  pushField('status', payload.status)
  pushField('chars', payload.chars)
  pushField('blocks', payload.block_count)
  pushField('pane', payload.target_pane)
  pushField('reveal_only', payload.reveal_only)
  return fields.length > 0 ? ` ${fields.join(' ')}` : ''
}

function emitTrace(level: 'log' | 'warn' | 'error', message: string, payload: Record<string, unknown>) {
  const recentPayload = Object.prototype.hasOwnProperty.call(payload, 'message')
    ? {
        ...payload,
        detail_message: payload.message,
        message
      }
    : {
        ...payload,
        message
      }
  pushRecent({
    ts: Date.now(),
    level,
    ...recentPayload
  })
  if (!debugEnabled()) return
  console[level](`[open-trace] ${message}${buildConsoleSuffix(recentPayload)}`, payload)
}

function levelForOutcome(outcome: OpenTraceOutcome): 'log' | 'warn' | 'error' {
  if (outcome === 'error') return 'error'
  if (outcome === 'blocked') return 'warn'
  return 'log'
}

function currentElapsedMs(trace: TraceRecord): number {
  return Math.round(performance.now() - trace.startedAt)
}

function baseTracePayload(trace: TraceRecord): Record<string, unknown> {
  return {
    trace_id: trace.id,
    path: trace.path,
    source: trace.source,
    elapsed_ms: currentElapsedMs(trace)
  }
}

function appendSummaryBucket(trace: TraceRecord, bucket: OpenTraceSummaryBucket, durationMs: number) {
  trace.summaryBuckets[bucket] = Math.round((trace.summaryBuckets[bucket] ?? 0) + durationMs)
}

function clearPendingBindings(traceId: string) {
  for (const [path, currentTraceId] of pendingTraceByPath.entries()) {
    if (currentTraceId === traceId) {
      pendingTraceByPath.delete(path)
    }
  }
}

function buildSummaryPayload(trace: TraceRecord, totalMs: number, outcome: OpenTraceOutcome): Record<string, unknown> {
  return {
    trace_id: trace.id,
    path: trace.path,
    source: trace.source,
    status: outcome,
    total_ms: formatMs(totalMs),
    total_duration_ms: Math.round(totalMs),
    editor_load_ms: trace.summaryBuckets.editor_load != null ? formatMs(trace.summaryBuckets.editor_load) : '',
    editor_post_render_ms: trace.summaryBuckets.editor_post_render != null ? formatMs(trace.summaryBuckets.editor_post_render) : '',
    active_note_effects_ms: trace.summaryBuckets.active_note_effects != null ? formatMs(trace.summaryBuckets.active_note_effects) : '',
    right_pane_data_ms: trace.summaryBuckets.right_pane_data != null ? formatMs(trace.summaryBuckets.right_pane_data) : '',
    metadata_ms: trace.summaryBuckets.metadata != null ? formatMs(trace.summaryBuckets.metadata) : '',
    backlinks_ms: trace.summaryBuckets.backlinks != null ? formatMs(trace.summaryBuckets.backlinks) : '',
    semantic_links_ms: trace.summaryBuckets.semantic_links != null ? formatMs(trace.summaryBuckets.semantic_links) : '',
    explorer_reveal_ms: trace.summaryBuckets.explorer_reveal != null ? formatMs(trace.summaryBuckets.explorer_reveal) : ''
  }
}

/** Enables quick inspection of note-open timings from the browser console. */
export function installOpenDebugLongTaskObserver() {
  if (longTaskObserverInstalled || !canUseWindow() || !('PerformanceObserver' in window)) return
  longTaskObserverInstalled = true

  const Observer = window.PerformanceObserver
  const supported = Array.isArray(Observer.supportedEntryTypes) ? Observer.supportedEntryTypes : []
  if (!supported.includes('longtask')) return

  const observer = new Observer((list) => {
    for (const entry of list.getEntries()) {
      emitTrace('warn', 'main-thread long task', {
        duration_ms: Math.round(entry.duration),
        start_ms: Math.round(entry.startTime),
        entry_type: entry.entryType,
        name: entry.name
      })
    }
  })

  observer.observe({ entryTypes: ['longtask'] })
}

/** Starts a new open trace and returns its stable trace id. */
export function startOpenTrace(path: string, source: string): string | null {
  const normalizedPath = normalizePath(path)
  traceCounter += 1
  const id = `${Date.now().toString(36)}-${traceCounter.toString(36)}`
  const record: TraceRecord = {
    id,
    path: normalizedPath,
    startedAt: performance.now(),
    source,
    summaryBuckets: {}
  }
  activeTraceIds.add(id)
  activeTraceIdByPath.set(normalizedPath, id)
  tracesById.set(id, record)
  notifyOpenTraceActivityListeners()
  emitTrace('log', 'open started', {
    trace_id: id,
    source,
    path: normalizedPath
  })
  return id
}

/** Returns whether at least one document-open flow is still in flight. */
export function hasActiveOpenTrace(): boolean {
  return activeTraceIds.size > 0
}

/** Subscribes to whether at least one document-open flow is still in flight. */
export function subscribeOpenTraceActivity(listener: OpenTraceActivityListener): () => void {
  openTraceActivityListeners.add(listener)
  listener(activeTraceIds.size > 0)
  return () => {
    openTraceActivityListeners.delete(listener)
  }
}

/** Associates a pending open trace with a document path until the editor starts loading it. */
export function bindPendingOpenTrace(path: string, traceId: string | null) {
  if (!traceId) return
  pendingTraceByPath.set(normalizePath(path), traceId)
}

/** Clears a pending path binding when navigation stops before editor load starts. */
export function clearPendingOpenTrace(path: string, traceId?: string | null) {
  const normalizedPath = normalizePath(path)
  const current = pendingTraceByPath.get(normalizedPath)
  if (!current) return
  if (traceId && current !== traceId) return
  pendingTraceByPath.delete(normalizedPath)
}

/** Returns and removes the pending trace for the path, if one exists. */
export function takePendingOpenTrace(path: string): string | null {
  const normalizedPath = normalizePath(path)
  const traceId = pendingTraceByPath.get(normalizedPath) ?? null
  if (traceId) {
    pendingTraceByPath.delete(normalizedPath)
  }
  return traceId
}

/** Finds the currently active trace id for a path, if note-open work is still running. */
export function findOpenTrace(path: string): string | null {
  const traceId = activeTraceIdByPath.get(normalizePath(path)) ?? null
  if (!traceId || !activeTraceIds.has(traceId)) return null
  return traceId
}

/** Starts a child span for a note-open trace. */
export function startOpenTraceSpan(
  traceId: string | null,
  name: string,
  options: OpenTraceSpanOptions = {}
): string | null {
  if (!traceId) return null
  const trace = tracesById.get(traceId)
  if (!trace) return null
  spanCounter += 1
  const spanId = `${traceId}-s${spanCounter.toString(36)}`
  const span: SpanRecord = {
    id: spanId,
    traceId,
    parentSpanId: options.parentSpanId ?? null,
    name,
    startedAt: performance.now(),
    bucket: options.bucket
  }
  spansById.set(spanId, span)
  emitTrace('log', `${name} started`, {
    ...baseTracePayload(trace),
    span_id: spanId,
    parent_span_id: span.parentSpanId,
    name,
    ...options.payload
  })
  return spanId
}

/** Finishes a child span and records its local duration. */
export function finishOpenTraceSpan(
  traceId: string | null,
  spanId: string | null,
  outcome: OpenTraceOutcome,
  payload: Record<string, unknown> = {}
): number | null {
  if (!traceId || !spanId) return null
  const trace = tracesById.get(traceId)
  const span = spansById.get(spanId)
  if (!trace || !span) return null
  spansById.delete(spanId)
  const durationMs = Math.round(performance.now() - span.startedAt)
  if (span.bucket) {
    appendSummaryBucket(trace, span.bucket, durationMs)
  }
  emitTrace(levelForOutcome(outcome), `${span.name} ${outcome}`, {
    ...baseTracePayload(trace),
    span_id: span.id,
    parent_span_id: span.parentSpanId,
    name: span.name,
    duration_ms: durationMs,
    ...payload
  })
  return durationMs
}

/** Runs an async function inside a child span and auto-completes it. */
export async function runWithOpenTraceSpan<T>(
  traceId: string | null,
  name: string,
  run: () => Promise<T>,
  options: OpenTraceAsyncSpanOptions = {}
): Promise<T> {
  const spanId = startOpenTraceSpan(traceId, name, options)
  try {
    const result = await run()
    if (options.blockedIf?.()) {
      finishOpenTraceSpan(traceId, spanId, 'blocked', options.blockedPayload)
    } else {
      finishOpenTraceSpan(traceId, spanId, 'done')
    }
    return result
  } catch (error) {
    finishOpenTraceSpan(traceId, spanId, 'error', {
      message: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

/** Records a trace-level event without creating a duration-bearing span. */
export function traceOpenStep(traceId: string | null, label: string, payload: Record<string, unknown> = {}) {
  if (!traceId) return
  const trace = tracesById.get(traceId)
  if (!trace) return
  emitTrace('log', label, {
    ...baseTracePayload(trace),
    ...payload
  })
}

/** Ends a trace and records the final summary plus total elapsed time. */
export function finishOpenTrace(
  traceId: string | null,
  outcome: OpenTraceOutcome,
  payload: Record<string, unknown> = {}
) {
  if (!traceId) return
  activeTraceIds.delete(traceId)
  notifyOpenTraceActivityListeners()
  const trace = tracesById.get(traceId)
  if (!trace) return
  tracesById.delete(traceId)
  clearPendingBindings(traceId)
  const activeTraceForPath = activeTraceIdByPath.get(trace.path)
  if (activeTraceForPath === traceId) {
    activeTraceIdByPath.delete(trace.path)
  }
  for (const [spanId, span] of spansById.entries()) {
    if (span.traceId === traceId) {
      spansById.delete(spanId)
    }
  }
  const totalMs = performance.now() - trace.startedAt
  emitTrace(levelForOutcome(outcome), 'open summary', buildSummaryPayload(trace, totalMs, outcome))
  emitTrace(levelForOutcome(outcome), `open ${outcome}`, {
    trace_id: trace.id,
    path: trace.path,
    source: trace.source,
    total_ms: formatMs(totalMs),
    total_duration_ms: Math.round(totalMs),
    ...payload
  })
}

/** Returns recent in-memory trace entries for tests or console inspection helpers. */
export function readRecentOpenTraceEntries(): Array<Record<string, unknown>> {
  return readGlobalState()?.recent.slice() ?? []
}

/** Clears in-memory trace state between tests. */
export function clearOpenTraceDebugState() {
  tracesById.clear()
  spansById.clear()
  pendingTraceByPath.clear()
  activeTraceIds.clear()
  activeTraceIdByPath.clear()
  traceCounter = 0
  spanCounter = 0
  const state = readGlobalState()
  if (state) {
    state.recent.splice(0, state.recent.length)
  }
}
