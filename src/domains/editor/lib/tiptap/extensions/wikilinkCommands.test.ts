import { describe, expect, it } from 'vitest'
import { buildWikilinkToken, parseWikilinkToken } from './wikilinkCommands'

describe('wikilinkCommands', () => {
  it('builds tokens with or without label', () => {
    expect(buildWikilinkToken('note/path.md')).toBe('[[note/path.md]]')
    expect(buildWikilinkToken('note/path.md', 'Alias')).toBe('[[note/path.md|Alias]]')
  })

  it('parses strict wikilink token syntax', () => {
    expect(parseWikilinkToken('[[note]]')).toEqual({ target: 'note', label: null })
    expect(parseWikilinkToken('[[note|Alias]]')).toEqual({ target: 'note', label: 'Alias' })
    expect(parseWikilinkToken('[[note|a|b]]')).toBeNull()
    expect(parseWikilinkToken('[[]]')).toBeNull()
  })
})
