import { describe, expect, it } from 'vitest'

import { buildWikilinkDraftToken, buildWikilinkToken, inferDeepWikilinkAlias, parseWikilinkTarget } from './wikilinks'

describe('wikilinks', () => {
  it('parses note and heading anchors', () => {
    expect(parseWikilinkTarget('folder/note.md#Heading')).toEqual({
      notePath: 'folder/note.md',
      anchor: { heading: 'Heading' }
    })
  })

  it('infers alias from deep note path last segment', () => {
    expect(inferDeepWikilinkAlias('folder1/foo')).toBe('foo')
    expect(inferDeepWikilinkAlias('folder1/nested/foo.md')).toBe('foo')
    expect(inferDeepWikilinkAlias('foo')).toBeNull()
  })

  it('builds token with auto alias for deep target by default', () => {
    expect(buildWikilinkToken('folder1/foo')).toBe('[[folder1/foo|foo]]')
    expect(buildWikilinkToken('folder1/foo.md')).toBe('[[folder1/foo.md|foo]]')
    expect(buildWikilinkToken('foo')).toBe('[[foo]]')
  })

  it('keeps explicit alias when provided', () => {
    expect(buildWikilinkToken('folder1/foo', 'custom')).toBe('[[folder1/foo|custom]]')
  })

  it('builds draft token without closing markers', () => {
    expect(buildWikilinkDraftToken('folder1/foo')).toBe('[[folder1/foo')
  })
})
