import { describe, expect, it } from 'vitest'
import {
  applyMarkdownShortcut,
  isEditorZoomModifier,
  isLikelyMarkdownPaste,
  selectSmartPasteMarkdown,
  isZoomInShortcut,
  isZoomOutShortcut,
  isZoomResetShortcut,
  looksLikeMarkdown
} from './editorInteractions'

describe('applyMarkdownShortcut', () => {
  it('maps checklist marker to checklist list block', () => {
    const result = applyMarkdownShortcut('- [x]')
    expect(result?.type).toBe('list')
    expect(result?.data).toMatchObject({
      style: 'checklist',
      items: [{ meta: { checked: true } }]
    })
  })

  it('maps heading marker to header block', () => {
    const result = applyMarkdownShortcut('###')
    expect(result).toEqual({
      type: 'header',
      data: { text: '', level: 3 }
    })
  })

  it('maps heading markdown with text to header block with preserved text', () => {
    const result = applyMarkdownShortcut('## roadmap')
    expect(result).toEqual({
      type: 'header',
      data: { text: 'roadmap', level: 2 }
    })
  })
})

describe('zoom shortcut helpers', () => {
  it('detects modifier and zoom key combinations', () => {
    expect(isEditorZoomModifier({ metaKey: true, ctrlKey: false, altKey: false })).toBe(true)
    expect(isZoomInShortcut({ key: '+', code: '' })).toBe(true)
    expect(isZoomOutShortcut({ key: '-', code: '' })).toBe(true)
    expect(isZoomResetShortcut({ key: '0', code: '' })).toBe(true)
  })
})

describe('markdown paste detection', () => {
  it('accepts likely markdown text', () => {
    expect(looksLikeMarkdown('# Hello')).toBe(true)
    expect(isLikelyMarkdownPaste('- item', '')).toBe(true)
  })

  it('rejects plain non-markdown text', () => {
    expect(looksLikeMarkdown('just text')).toBe(false)
    expect(isLikelyMarkdownPaste('just text', '')).toBe(false)
  })

  it('prefers structured html conversion when available', () => {
    const selected = selectSmartPasteMarkdown('', '<h2>Title</h2><ul><li>Alpha</li></ul>')
    expect(selected).toEqual({
      markdown: '## Title\n\n- Alpha\n',
      source: 'html'
    })
  })

  it('falls back to plain markdown when html confidence is low', () => {
    const selected = selectSmartPasteMarkdown('# Hello', '<div><strong>Hello</strong></div>')
    expect(selected).toEqual({
      markdown: '# Hello',
      source: 'plain'
    })
  })

  it('prefers html conversion for inline wikilinks copied from editor anchors', () => {
    const selected = selectSmartPasteMarkdown(
      'Neurone',
      '<a href="#" data-wikilink="true" data-target="graph/neurone.md" data-label="Neurone">Neurone</a>'
    )
    expect(selected).toEqual({
      markdown: '[[graph/neurone.md|Neurone]]\n',
      source: 'html'
    })
  })

  it('returns null when neither html nor plain has markdown signals', () => {
    const selected = selectSmartPasteMarkdown('just text', '<div><strong>Hello</strong></div>')
    expect(selected).toBeNull()
  })
})
