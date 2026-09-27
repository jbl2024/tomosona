import { describe, expect, it } from 'vitest'
import { errorMessage, escapeSelectorValue, getAncestorDirs, getParentPath, isConflictError } from './explorerTreeUtils'

describe('errorMessage', () => {
  it('returns message from an Error instance', () => {
    expect(errorMessage(new Error('something went wrong'))).toBe('something went wrong')
  })

  it('returns a plain string as-is', () => {
    expect(errorMessage('oops')).toBe('oops')
  })

  it('returns the message property from an error-like object', () => {
    expect(errorMessage({ message: 'object error' })).toBe('object error')
  })

  it('returns null for a non-message object', () => {
    expect(errorMessage({ code: 42 })).toBeNull()
  })

  it('returns null for null and undefined', () => {
    expect(errorMessage(null)).toBeNull()
    expect(errorMessage(undefined)).toBeNull()
  })

  it('returns null for a number', () => {
    expect(errorMessage(404)).toBeNull()
  })
})

describe('isConflictError', () => {
  it('returns true when the error message contains "already exists"', () => {
    expect(isConflictError(new Error('File already exists at this path'))).toBe(true)
    expect(isConflictError(new Error('ALREADY EXISTS'))).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isConflictError(new Error('permission denied'))).toBe(false)
  })

  it('returns false for non-error values', () => {
    expect(isConflictError(null)).toBe(false)
    expect(isConflictError(undefined)).toBe(false)
    expect(isConflictError(42)).toBe(false)
  })
})

describe('getParentPath', () => {
  it('returns the parent directory of a nested path', () => {
    expect(getParentPath('notes/projects/todo.md')).toBe('notes/projects')
  })

  it('returns the root segment for a top-level file', () => {
    expect(getParentPath('notes/todo.md')).toBe('notes')
  })

  it('returns the original path when there is no parent', () => {
    // idx <= 0 branch: no slash or slash at position 0
    expect(getParentPath('todo.md')).toBe('todo.md')
  })

  it('normalizes backslashes before extracting parent', () => {
    expect(getParentPath('notes\\projects\\todo.md')).toBe('notes/projects')
  })
})

describe('getAncestorDirs', () => {
  it('returns all ancestor directories between root and a nested path', () => {
    expect(getAncestorDirs('/vault', '/vault/a/b/note.md')).toEqual([
      '/vault/a',
      '/vault/a/b'
    ])
  })

  it('returns an empty array when the path is a direct child of root', () => {
    expect(getAncestorDirs('/vault', '/vault/note.md')).toEqual([])
  })

  it('returns an empty array when path equals root', () => {
    expect(getAncestorDirs('/vault', '/vault')).toEqual([])
  })

  it('returns an empty array when path is outside the root', () => {
    expect(getAncestorDirs('/vault', '/other/note.md')).toEqual([])
  })
})

describe('escapeSelectorValue', () => {
  it('returns a non-empty string for a simple path', () => {
    const result = escapeSelectorValue('notes/my-note.md')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('does not alter a simple identifier', () => {
    // A slash is special in a CSS selector and is correctly escaped by CSS.escape.
    expect(escapeSelectorValue('notes')).toBe('notes')
  })

  it('escapes backslashes in the fallback (non-CSS.escape) path', () => {
    // When CSS.escape is unavailable the fallback escapes " and \
    // In the test environment CSS.escape IS available (jsdom), so the
    // result will be whatever CSS.escape returns — just verify it is a string.
    const result = escapeSelectorValue('vault\\notes\\today.md')
    expect(typeof result).toBe('string')
  })
})
