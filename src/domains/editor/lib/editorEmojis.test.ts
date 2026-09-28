import { describe, expect, it } from 'vitest'
import { editorEmojiMatchesQuery } from './editorEmojis'

describe('editorEmojiMatchesQuery', () => {
  it('finds common emojis from portable English search terms', () => {
    expect(editorEmojiMatchesQuery('✅', 'check')).toBe(true)
    expect(editorEmojiMatchesQuery('👍', 'thumb')).toBe(true)
    expect(editorEmojiMatchesQuery('👎', 'thumb')).toBe(true)
  })

  it('does not return unrelated emoji for a text query', () => {
    expect(editorEmojiMatchesQuery('🍎', 'thumb')).toBe(false)
  })

  it('finds colored status indicators by color and status', () => {
    expect(editorEmojiMatchesQuery('🔴', 'status')).toBe(true)
    expect(editorEmojiMatchesQuery('🟢', 'green')).toBe(true)
  })
})
