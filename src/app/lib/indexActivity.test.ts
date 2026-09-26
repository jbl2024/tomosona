import { describe, expect, it } from 'vitest'
import {
  buildIndexActivityRows,
  formatDurationMs,
  formatTimeOnly,
  parseIndexLogFields,
  toNumberOrNull
} from './indexActivity'

describe('indexActivity', () => {
  it('parses structured key value fields from backend logs', () => {
    expect(parseIndexLogFields('rebuild:done run_id=4 indexed=12 total_ms=987')).toEqual({
      run_id: '4',
      indexed: '12',
      total_ms: '987'
    })
  })

  it('ignores invalid key value tokens and invalid numeric fields', () => {
    expect(parseIndexLogFields('run_id=4 invalid pair= spaced value=')).toEqual({
      run_id: '4'
    })
    expect(toNumberOrNull('12')).toBe(12)
    expect(toNumberOrNull('not-a-number')).toBeNull()
    expect(formatTimeOnly(Number.NaN)).toBe('--:--:--')
  })

  it('formats durations across milliseconds, seconds, minutes, and hours', () => {
    expect(formatDurationMs(42)).toBe('42 ms')
    expect(formatDurationMs(1_250)).toBe('1.3 s')
    expect(formatDurationMs(61_000)).toBe('1 min 1 s')
    expect(formatDurationMs(3_600_000)).toBe('1 h')
  })

  it('ignores noisy indexing progress logs in the activity feed', () => {
    const rows = buildIndexActivityRows([
      {
        ts_ms: 1_000,
        message: 'reindex:start path=notes/a.md'
      },
      {
        ts_ms: 1_100,
        message: 'record_internal_write path=notes/b.md'
      },
      {
        ts_ms: 1_200,
        message: 'save_note_buffer:start path=notes/c.md'
      }
    ], (path) => path)

    expect(rows).toEqual([])
  })

  it('renders rebuild and generic error rows with the newest entry first', () => {
    const rows = buildIndexActivityRows([
      {
        ts_ms: 1_000,
        message: 'rebuild:start'
      },
      {
        ts_ms: 1_100,
        message: 'rebuild:done indexed=3 total_ms=987'
      },
      {
        ts_ms: 1_200,
        message: 'fts_search:error gobject failed to start'
      }
    ], (path) => path)

    expect(rows[0]).toMatchObject({
      state: 'error',
      group: 'system',
      title: 'Indexer error'
    })
    expect(rows[1]).toMatchObject({
      state: 'done',
      group: 'rebuild',
      title: 'Workspace rebuild done (3 indexed)',
      detail: '987 ms'
    })
    expect(rows[2]).toMatchObject({
      state: 'running',
      group: 'rebuild',
      title: 'Workspace rebuild started'
    })
  })
})
