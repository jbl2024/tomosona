import { describe, expect, it } from 'vitest'
import {
  composeTitleHeading,
  matchTitleHeading,
  stripTitleHeading
} from './noteTitleHeading'

describe('matchTitleHeading', () => {
  it('matches a first-line heading equal to the title', () => {
    expect(matchTitleHeading('# My Note\nBody text', 'My Note')).toEqual({ text: 'My Note' })
  })

  it('matches after leading blank lines', () => {
    expect(matchTitleHeading('\n\n# My Note\nBody', 'My Note')).toEqual({ text: 'My Note' })
  })

  it('matches with trailing whitespace in the heading or title', () => {
    expect(matchTitleHeading('# My Note  \nBody', ' My Note ')).toEqual({ text: 'My Note' })
  })

  it('rejects different text, other heading levels, and setext headings', () => {
    expect(matchTitleHeading('# Other\nBody', 'My Note')).toBeNull()
    expect(matchTitleHeading('## My Note\nBody', 'My Note')).toBeNull()
    expect(matchTitleHeading('My Note\n=====\nBody', 'My Note')).toBeNull()
    expect(matchTitleHeading('#My Note\nBody', 'My Note')).toBeNull()
  })

  it('returns null for bodies with no heading and empty bodies', () => {
    expect(matchTitleHeading('Body only', 'My Note')).toBeNull()
    expect(matchTitleHeading('', 'My Note')).toBeNull()
    expect(matchTitleHeading('\n \n', 'My Note')).toBeNull()
  })
})

describe('stripTitleHeading', () => {
  it('removes leading blank lines and the heading line', () => {
    expect(stripTitleHeading('\n\n# My Note\n\nBody')).toBe('Body')
    expect(stripTitleHeading('# My Note\nBody')).toBe('Body')
  })

  it('returns an empty body when only the heading exists', () => {
    expect(stripTitleHeading('# My Note')).toBe('')
  })

  it('keeps inner blank lines intact', () => {
    expect(stripTitleHeading('# My Note\n\nBody\n\nMore')).toBe('Body\n\nMore')
  })
})

describe('composeTitleHeading', () => {
  it('composes the canonical heading plus one blank line before the body', () => {
    expect(composeTitleHeading('My Note', 'Body')).toBe('# My Note\n\nBody')
  })

  it('composes the heading alone for an empty body', () => {
    expect(composeTitleHeading('My Note', '')).toBe('# My Note')
    expect(composeTitleHeading('My Note', '\n \n')).toBe('# My Note')
  })

  it('consumes leading blank lines from the body and trims the title', () => {
    expect(composeTitleHeading(' My Note ', '\nBody')).toBe('# My Note\n\nBody')
  })

  it('round-trips with stripTitleHeading for canonical bodies', () => {
    const composed = composeTitleHeading('My Note', 'Body\n\nMore')
    expect(matchTitleHeading(composed, 'My Note')).toEqual({ text: 'My Note' })
    expect(stripTitleHeading(composed)).toBe('Body\n\nMore')
    expect(composeTitleHeading('My Note', stripTitleHeading(composed))).toBe(composed)
  })
})
