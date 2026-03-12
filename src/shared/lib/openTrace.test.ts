import { afterEach, describe, expect, it } from 'vitest'
import {
  clearOpenTraceDebugState,
  finishOpenTrace,
  finishOpenTraceSpan,
  readRecentOpenTraceEntries,
  startOpenTrace,
  startOpenTraceSpan,
  traceOpenStep
} from './openTrace'

describe('openTrace', () => {
  afterEach(() => {
    clearOpenTraceDebugState()
    window.localStorage.clear()
  })

  it('records root traces, child spans, and final summaries', () => {
    window.localStorage.setItem('tomosona.debug.open', '1')

    const traceId = startOpenTrace('/vault/journal/2026-03-12.md', 'navigation-open')
    const spanId = startOpenTraceSpan(traceId, 'open.editor_load', { bucket: 'editor_load' })
    finishOpenTraceSpan(traceId, spanId, 'done')
    traceOpenStep(traceId, 'editor ready; awaiting active note effects')
    finishOpenTrace(traceId, 'done', { stage: 'open.complete' })

    const entries = readRecentOpenTraceEntries()
    expect(entries.some((entry) => entry.message === 'open.editor_load done')).toBe(true)
    expect(entries.some((entry) => entry.message === 'open summary' && typeof entry.editor_load_ms === 'string')).toBe(true)
    expect(entries.some((entry) => entry.message === 'open done' && entry.stage === 'open.complete')).toBe(true)
  })

  it('records blocked and error span outcomes', () => {
    const traceId = startOpenTrace('/vault/a.md', 'navigation-open')
    const blockedSpanId = startOpenTraceSpan(traceId, 'open.metadata', { bucket: 'metadata' })
    finishOpenTraceSpan(traceId, blockedSpanId, 'blocked', { stage: 'stale_metadata_response' })
    const errorSpanId = startOpenTraceSpan(traceId, 'open.backlinks', { bucket: 'backlinks' })
    finishOpenTraceSpan(traceId, errorSpanId, 'error', { message: 'boom' })
    finishOpenTrace(traceId, 'error', { stage: 'active_note_effects' })

    const entries = readRecentOpenTraceEntries()
    expect(entries.some((entry) => entry.message === 'open.metadata blocked' && entry.stage === 'stale_metadata_response')).toBe(true)
    expect(entries.some((entry) => entry.message === 'open.backlinks error' && entry.detail_message === 'boom')).toBe(true)
    expect(entries.some((entry) => entry.message === 'open error' && entry.stage === 'active_note_effects')).toBe(true)
  })
})
