import { describe, expect, it } from 'vitest'
import { matchesWikilinkNotePath, resolveExistingWikilinkPath } from './wikilinkResolution'

describe('wikilink note identity', () => {
  it('resolves titles, extensions, suffixes and canonically equivalent accents', () => {
    const path = 'Connaissances/M\u00e9thode Zettelkasten.md'
    for (const query of ['M\u00e9thode Zettelkasten', 'ME\u0301THODE ZETTELKASTEN.markdown', 'Connaissances/M\u00e9thode Zettelkasten']) {
      expect(resolveExistingWikilinkPath(query, [path])).toBe(path)
      expect(matchesWikilinkNotePath(path, query)).toBe(true)
    }
    expect(resolveExistingWikilinkPath('nested/topic', ['deep/nested/topic.md'])).toBe('deep/nested/topic.md')
  })

  it('preserves exact and directory index priority without choosing ambiguous titles', () => {
    const paths = ['a/topic.md', 'b/topic.md']
    expect(resolveExistingWikilinkPath('topic', paths)).toBeNull()
    expect(resolveExistingWikilinkPath('topic', [...paths, 'topic.md'])).toBe('topic.md')
    expect(resolveExistingWikilinkPath('topic', [...paths, 'topic/index.md'])).toBe('topic/index.md')
    expect(resolveExistingWikilinkPath('missing/topic', paths)).toBeNull()
    expect(matchesWikilinkNotePath('a/topic.md', 'pic')).toBe(false)
    expect(matchesWikilinkNotePath('a/topic.md', '')).toBe(false)
  })
})
