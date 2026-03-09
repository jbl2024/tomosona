const OPEN_DEBUG_STORAGE_KEY = 'tomosona.debug.open'
const RECENT_TRACE_LIMIT = 80

type TraceRecord = {
  id: string
  path: string
  startedAt: number
  source: string
}

type OpenDebugGlobal = {
  recent: Array<Record<string, unknown>>
}

const tracesById = new Map<string, TraceRecord>()
const pendingTraceByPath = new Map<string, string>()
let traceCounter = 0
let longTaskObserverInstalled = false

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

function emitTrace(level: 'log' | 'warn' | 'error', message: string, payload: Record<string, unknown>) {
  pushRecent({
    ts: Date.now(),
    level,
    message,
    ...payload
  })
  if (!debugEnabled()) return
  console[level](`[open-trace] ${message}`, payload)
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
  if (!debugEnabled()) return null
  const normalizedPath = normalizePath(path)
  traceCounter += 1
  const id = `${Date.now().toString(36)}-${traceCounter.toString(36)}`
  const record: TraceRecord = {
    id,
    path: normalizedPath,
    startedAt: performance.now(),
    source
  }
  tracesById.set(id, record)
  emitTrace('log', 'open started', {
    trace_id: id,
    source,
    path: normalizedPath
  })
  return id
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

/** Records a sub-step against a trace id with elapsed time since trace start. */
export function traceOpenStep(traceId: string | null, label: string, payload: Record<string, unknown> = {}) {
  if (!traceId) return
  const record = tracesById.get(traceId)
  if (!record) return
  emitTrace('log', label, {
    trace_id: traceId,
    path: record.path,
    source: record.source,
    elapsed_ms: formatMs(performance.now() - record.startedAt),
    ...payload
  })
}

/** Ends a trace and records total elapsed time. */
export function finishOpenTrace(
  traceId: string | null,
  outcome: 'done' | 'blocked' | 'error',
  payload: Record<string, unknown> = {}
) {
  if (!traceId) return
  const record = tracesById.get(traceId)
  if (!record) return
  tracesById.delete(traceId)
  emitTrace(outcome === 'error' ? 'error' : outcome === 'blocked' ? 'warn' : 'log', `open ${outcome}`, {
    trace_id: traceId,
    path: record.path,
    source: record.source,
    total_ms: formatMs(performance.now() - record.startedAt),
    ...payload
  })
}
