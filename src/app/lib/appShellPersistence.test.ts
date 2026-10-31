import { describe, expect, it } from 'vitest'
import { normalizeCommandUsage, persistCommandUsage, readPersistedCommandUsage } from './appShellPersistence'

describe('command usage persistence', () => {
  it('normalizes raw usage and round-trips through storage', () => {
    expect(normalizeCommandUsage(null)).toEqual({ counts: {}, recent: [] })
    expect(normalizeCommandUsage({ counts: { a: 2, b: 'x', c: 0 }, recent: ['a', 3, '', 'b'] })).toEqual({
      counts: { a: 2 },
      recent: ['a', 'b']
    })

    persistCommandUsage('usage-key', { counts: { convert: 3 }, recent: ['convert'] })
    expect(readPersistedCommandUsage('usage-key')).toEqual({ counts: { convert: 3 }, recent: ['convert'] })
    window.localStorage.removeItem('usage-key')
  })

  it('caps the persisted recents list', () => {
    const usage = normalizeCommandUsage({ counts: {}, recent: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'] })
    expect(usage.recent).toHaveLength(10)
    expect(usage.recent[0]).toBe('a')
  })
})
