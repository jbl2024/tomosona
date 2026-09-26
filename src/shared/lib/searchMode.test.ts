import { describe, expect, it } from 'vitest'
import { applySearchMode, detectSearchMode, stripSearchModePrefix } from './searchMode'

describe('searchMode', () => {
  it('detects leading search mode prefixes', () => {
    expect(detectSearchMode(' Lexical: rust tauri')).toBe('lexical')
    expect(detectSearchMode('hybrid: backlinks')).toBe('hybrid')
    expect(detectSearchMode('just text')).toBe('hybrid')
  })

  it('strips only leading mode prefixes', () => {
    expect(stripSearchModePrefix('lexical: exact phrase')).toBe('exact phrase')
    expect(stripSearchModePrefix('note semantic: in middle')).toBe('note semantic: in middle')
  })

  it('applies target mode prefixes with caret placement', () => {
    expect(applySearchMode('note title', 'lexical')).toEqual({
      value: 'lexical: note title',
      caret: 'lexical: '.length
    })
    expect(applySearchMode('lexical: note title', 'hybrid')).toEqual({
      value: 'note title',
      caret: 0
    })
    expect(applySearchMode('lexical: exact', 'hybrid')).toEqual({
      value: 'exact',
      caret: 0
    })
  })
})
