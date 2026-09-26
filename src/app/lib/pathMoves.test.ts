import { describe, expect, it } from 'vitest'
import { expandPathMoves, rewritePathWithMoves, sortPathMoves } from './pathMoves'

describe('pathMoves', () => {
  it('prefers the most specific source prefix', () => {
    const moves = sortPathMoves([
      { from: '/vault/notes', to: '/vault/archive/notes' },
      { from: '/vault/notes/project', to: '/vault/projects/current' }
    ])

    expect(rewritePathWithMoves('/vault/notes/project/a.md', moves)).toBe('/vault/projects/current/a.md')
    expect(rewritePathWithMoves('/vault/notes/other.md', moves)).toBe('/vault/archive/notes/other.md')
  })

  it('returns the original path when no move applies', () => {
    expect(rewritePathWithMoves('/vault/notes/a.md', [{ from: '/vault/archive', to: '/vault/old' }])).toBe('/vault/notes/a.md')
  })

  it('rewrites Windows paths that use device prefixes and drive-letter casing', () => {
    const moves = sortPathMoves([
      { from: '\\\\?\\D:\\vault\\notes', to: 'd:/vault/archive/notes' }
    ])

    expect(rewritePathWithMoves('D:/vault/notes/a.md', moves)).toBe('d:/vault/archive/notes/a.md')
    expect(rewritePathWithMoves('\\\\?\\d:\\vault\\notes\\a.md', moves)).toBe('d:/vault/archive/notes/a.md')
  })

  it('expands folder moves into exact candidate pairs', () => {
    expect(expandPathMoves(
      [{ from: '/vault/journal', to: '/vault/archive/journal' }],
      [
        '/vault/journal/2026/03/2026-03-06.md',
        '/vault/journal/2026/03/2026-03-07.md',
        '/vault/features/related.md'
      ]
    )).toEqual([
      {
        from: '/vault/journal/2026/03/2026-03-06.md',
        to: '/vault/archive/journal/2026/03/2026-03-06.md'
      },
      {
        from: '/vault/journal/2026/03/2026-03-07.md',
        to: '/vault/archive/journal/2026/03/2026-03-07.md'
      }
    ])
  })
})
