import { describe, expect, it } from 'vitest'

import { parseSearchSnippet } from './searchSnippets'

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
