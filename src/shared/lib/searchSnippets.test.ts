import { describe, expect, it } from 'vitest'

import { parseSearchSnippet, snippetRevealTargets } from './searchSnippets'

describe('parseSearchSnippet', () => {
  it('parses bold markers into highlighted parts', () => {
    expect(parseSearchSnippet('a <b>match</b> b')).toEqual([
      { text: 'a ', highlighted: false },
      { text: 'match', highlighted: true },
      { text: ' b', highlighted: false }
    ])
  })

  it('treats non-marker HTML as plain text', () => {
    expect(parseSearchSnippet('<img src=x onerror=alert(1)>')).toEqual([
      { text: '<img src=x onerror=alert(1)>', highlighted: false }
    ])
  })
})

describe('snippetRevealTargets', () => {
  it('strips boundary ellipses and index markers, then adds highlighted segments', () => {
    expect(snippetRevealTargets('...des <b>notes</b> reliées...')).toEqual([
      'des notes reliées',
      'notes'
    ])
  })

  it('keeps interior text intact and orders multiple highlighted segments', () => {
    expect(snippetRevealTargets('La <b>granularité</b> fine favorise des <b>liens</b>')).toEqual([
      'La granularité fine favorise des liens',
      'granularité',
      'liens'
    ])
  })

  it('deduplicates a highlighted segment that equals the full text', () => {
    expect(snippetRevealTargets('<b>notes</b>')).toEqual(['notes'])
  })

  it('returns no target for an empty snippet', () => {
    expect(snippetRevealTargets('')).toEqual([])
    expect(snippetRevealTargets('   ')).toEqual([])
  })
})
