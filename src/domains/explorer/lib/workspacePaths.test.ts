import { describe, expect, it } from 'vitest'
import {
  dedupeWorkspacePaths,
  isAbsoluteWorkspacePath,
  normalizeWorkspacePath,
  toWorkspaceAbsolutePath,
  toWorkspacePathKey,
  toWorkspaceRelativePath
} from './workspacePaths'

describe('workspacePaths', () => {
  it('normalizes slashes, trims whitespace, removes duplicate separators, and drops leading dot slash', () => {
    expect(normalizeWorkspacePath('  ./notes\\\\today.md  ')).toBe('notes/today.md')
    expect(normalizeWorkspacePath('notes//nested///entry.md')).toBe('notes/nested/entry.md')
  })

  it('detects unix and windows absolute paths', () => {
    expect(isAbsoluteWorkspacePath('/vault/notes/a.md')).toBe(true)
    expect(isAbsoluteWorkspacePath('C:\\vault\\notes\\a.md')).toBe(true)
    expect(isAbsoluteWorkspacePath('./notes/a.md')).toBe(false)
    expect(isAbsoluteWorkspacePath('')).toBe(false)
  })

  it('resolves relative paths under a workspace and preserves absolute paths', () => {
    expect(toWorkspaceAbsolutePath('/vault', 'notes/a.md')).toBe('/vault/notes/a.md')
    expect(toWorkspaceAbsolutePath('/vault/', './notes/a.md')).toBe('/vault/notes/a.md')
    expect(toWorkspaceAbsolutePath('/vault', '/vault/notes/a.md')).toBe('/vault/notes/a.md')
    expect(toWorkspaceAbsolutePath('/vault', 'C:\\vault\\notes\\a.md')).toBe('C:/vault/notes/a.md')
  })

  it('returns relative workspace paths and keeps outside paths normalized', () => {
    expect(toWorkspaceRelativePath('/vault', '/vault/notes/a.md')).toBe('notes/a.md')
    expect(toWorkspaceRelativePath('/vault/', '/vault')).toBe('.')
    expect(toWorkspaceRelativePath('/vault', 'C:\\other\\note.md')).toBe('C:/other/note.md')
  })

  it('builds canonical path keys case-insensitively', () => {
    expect(toWorkspacePathKey(' Notes\\TODAY.md ')).toBe('notes/today.md')
  })

  it('deduplicates normalized paths while preserving the first normalized occurrence', () => {
    expect(dedupeWorkspacePaths([
      ' ./Notes/A.md ',
      '/vault/b.md',
      'notes/a.md',
      '',
      'C:\\Vault\\c.md',
      'c:/vault/c.md'
    ])).toEqual([
      'Notes/A.md',
      '/vault/b.md',
      'C:/Vault/c.md'
    ])
  })
})
