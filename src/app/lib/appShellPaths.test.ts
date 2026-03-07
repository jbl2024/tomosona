import { describe, expect, it } from 'vitest'
import {
  dailyNotePath,
  formatIsoDate,
  isIsoDate,
  normalizePath,
  normalizePathKey,
  normalizeRelativeNotePath,
  parseIsoDateInput,
  sanitizeRelativePath,
  splitRelativePath
} from './appShellPaths'

describe('appShellPaths', () => {
  it('normalizes workspace-relative note paths without allowing escape traversal', () => {
    expect(normalizeRelativeNotePath('notes/./today.md')).toBe('notes/today.md')
    expect(normalizeRelativeNotePath('notes/projects/../today.md')).toBe('notes/today.md')
    expect(normalizeRelativeNotePath('../today.md')).toBeNull()
  })

  it('parses valid iso dates and rejects invalid ones', () => {
    expect(isIsoDate('2026-03-06')).toBe(true)
    expect(isIsoDate('2026-02-31')).toBe(false)
    expect(parseIsoDateInput('2026-03-06')).toBe('2026-03-06')
    expect(parseIsoDateInput('2026-02-31')).toBeNull()
  })

  it('formats workspace daily note paths and relative path helpers', () => {
    expect(dailyNotePath('/vault', '2026-03-06')).toBe('/vault/journal/2026-03-06.md')
    expect(sanitizeRelativePath('\\notes\\\\today.md')).toBe('notes/today.md')
    expect(sanitizeRelativePath('  /notes//today.md  ')).toBe('notes/today.md')
    expect(normalizeRelativeNotePath('notes/../journal/./today.md')).toBe('journal/today.md')
    expect(normalizePath('notes\\today.md')).toBe('notes/today.md')
    expect(normalizePathKey('Notes/TODAY.md')).toBe('notes/today.md')
    expect(splitRelativePath('notes/today.md')).toEqual({ directory: 'notes', fileName: 'today.md' })
  })

  it('formats dates using two-digit month and day segments', () => {
    expect(formatIsoDate(new Date(2026, 2, 6))).toBe('2026-03-06')
  })
})
