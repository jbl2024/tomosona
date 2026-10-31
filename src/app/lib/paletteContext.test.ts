import { describe, expect, it } from 'vitest'
import { contextSuggestionIds, EMPTY_PALETTE_CONTEXT, paletteContextKind } from './paletteContext'

describe('paletteContext', () => {
  it('resolves the most specific applicable context', () => {
    expect(paletteContextKind(EMPTY_PALETTE_CONTEXT)).toBe('empty')

    expect(paletteContextKind({ ...EMPTY_PALETTE_CONTEXT, activeFilePath: '/vault/note.md' })).toBe('note')

    expect(
      paletteContextKind({
        ...EMPTY_PALETTE_CONTEXT,
        activeFilePath: '/vault/note.md',
        explorerSelectionPath: '/vault/other.md',
        editorSelectionText: 'selected text'
      })
    ).toBe('selection')

    expect(
      paletteContextKind({
        ...EMPTY_PALETTE_CONTEXT,
        activeFilePath: '/vault/note.md',
        explorerSelectionPath: '/vault/other.md'
      })
    ).toBe('explorer')

    expect(
      paletteContextKind({ ...EMPTY_PALETTE_CONTEXT, activeFilePath: '/vault/journal.md', isDailyNote: true })
    ).toBe('daily')

    // The daily flag alone does not make a daily context without a document.
    expect(paletteContextKind({ ...EMPTY_PALETTE_CONTEXT, isDailyNote: true })).toBe('empty')

    // Whitespace-only selections do not count.
    expect(
      paletteContextKind({ ...EMPTY_PALETTE_CONTEXT, activeFilePath: '/vault/note.md', editorSelectionText: '   ' })
    ).toBe('note')
  })

  it('returns a suggestion set per context kind', () => {
    expect(contextSuggestionIds('empty')).toContain('create-new-file')
    expect(contextSuggestionIds('note')).toContain('convert-to-word')
    expect(contextSuggestionIds('selection')).toContain('extract-selection-to-note')
    expect(contextSuggestionIds('explorer')).toContain('open-explorer-selection')
    expect(contextSuggestionIds('daily')).toContain('open-yesterday')
  })
})
