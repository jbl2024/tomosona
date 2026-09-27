import { describe, expect, it } from 'vitest'
import { unaiText } from './unaiText'

describe('unaiText', () => {
  it('normalizes dashes, smart apostrophes, and Word-style quotation marks', () => {
    expect(unaiText('“L’outil” — « prêt » – c’est bon')).toBe('"L\'outil" - " prêt " - c\'est bon')
  })

  it('leaves already plain punctuation unchanged', () => {
    expect(unaiText('"Already plain" - it\'s ready')).toBe('"Already plain" - it\'s ready')
  })
})
