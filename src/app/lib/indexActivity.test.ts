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
    expect(parseIndexLogFields('semantic_edges:refresh_error run_id=4 phase=insert_edge sqlite_code=ConstraintViolation')).toEqual({
      run_id: '4',
      phase: 'insert_edge',
      sqlite_code: 'ConstraintViolation'
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

  it('reconstructs running semantic refresh activity from start and phase logs', () => {
    const rows = buildIndexActivityRows([
      {
        ts_ms: 1_000,
        message: 'semantic_edges:refresh_start run_id=9 phase=scan_sources sources=12 top_k=3 threshold=0.62'
      },
      {
        ts_ms: 1_100,
        message: 'semantic_edges:refresh_phase run_id=9 phase=query_neighbors source_index=3 source_total=12 source_path=Notes/Projet.md'
      }
    ], (path) => path)

    expect(rows[0]).toMatchObject({
      state: 'running',
      title: 'Refreshing semantic links',
      detail: 'scan 3/12 · Notes/Projet.md'
    })
  })

  it('renders semantic refresh errors with actionable detail', () => {
    const rows = buildIndexActivityRows([
      {
        ts_ms: 1_000,
        message: 'semantic_edges:refresh_start run_id=9 phase=scan_sources sources=12 top_k=3 threshold=0.62'
      },
      {
        ts_ms: 1_100,
        message: 'semantic_edges:refresh_error run_id=9 phase=insert_edge source_path=Notes/Projet.md target_path=Notes/Cible.md sqlite_code=ConstraintViolation sqlite_msg=UNIQUE_constraint_failed'
      }
    ], (path) => path)

    expect(rows[0]).toMatchObject({
      state: 'error',
      title: 'Semantic link refresh failed',
      detail: 'phase insert edge · Notes/Projet.md · target Notes/Cible.md · sqlite ConstraintViolation · UNIQUE constraint failed'
    })
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
        message: 'model:unavailable failed to reach embedding provider'
      }
    ], (path) => path)

    expect(rows[0]).toMatchObject({
      state: 'error',
      group: 'system',
      title: 'Model warning'
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
