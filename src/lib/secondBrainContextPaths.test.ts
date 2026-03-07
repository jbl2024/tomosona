import { describe, expect, it } from 'vitest'
import {
  normalizeContextPathsForUpdate,
  toAbsoluteWorkspacePath,
  workspaceScopedSecondBrainSessionKey
} from './secondBrainContextPaths'

describe('secondBrainContextPaths', () => {
  it('keeps absolute paths while normalizing separators', () => {
    expect(toAbsoluteWorkspacePath('/vault', '/vault/notes/a.md')).toBe('/vault/notes/a.md')
    expect(toAbsoluteWorkspacePath('/vault', 'C:\\vault\\notes\\a.md')).toBe('C:/vault/notes/a.md')
  })

  it('resolves relative paths under workspace root', () => {
    expect(toAbsoluteWorkspacePath('/vault', 'notes/a.md')).toBe('/vault/notes/a.md')
    expect(toAbsoluteWorkspacePath('/vault/', './notes/a.md')).toBe('/vault/notes/a.md')
  })

  it('normalizes, trims and deduplicates update payload paths', () => {
    const normalized = normalizeContextPathsForUpdate('/vault', [
      'notes/a.md',
      '/vault/notes/a.md',
      '  notes/b.md  ',
      '',
      'notes/a.md'
    ])
    expect(normalized).toEqual(['/vault/notes/a.md', '/vault/notes/b.md'])
  })

  it('deduplicates update payload paths case-insensitively after normalization', () => {
    expect(normalizeContextPathsForUpdate('/vault', ['Notes/A.md', 'notes/a.md'])).toEqual(['/vault/Notes/A.md'])
  })

  it('builds a workspace-scoped session key', () => {
    expect(workspaceScopedSecondBrainSessionKey('/vault/my ws')).toBe(
      'tomosona:second-brain:last-session-id:%2Fvault%2Fmy%20ws'
    )
  })
})
