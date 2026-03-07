import { describe, expect, it } from 'vitest'
import type { EditorBlock } from '../lib/markdownBlocks'
import { useEditorVirtualTitleDocument } from './useEditorVirtualTitleDocument'

describe('useEditorVirtualTitleDocument', () => {
  it('normalizes note title from path stem', () => {
    const doc = useEditorVirtualTitleDocument()
    expect(doc.noteTitleFromPath('notes/Plan.MD')).toBe('Plan')
    expect(doc.noteTitleFromPath('docs/spec.markdown')).toBe('spec')
  })

  it('inserts/reads/strips virtual title blocks', () => {
    const doc = useEditorVirtualTitleDocument()
    const base: EditorBlock[] = [{ id: 'a', type: 'paragraph', data: { text: 'Body' } }]
    const withTitle = doc.withVirtualTitle(base, 'Hello')
    expect(withTitle.blocks[0].id).toBe('__virtual_title__')
    expect(doc.readVirtualTitle(withTitle.blocks)).toBe('Hello')
    expect(doc.stripVirtualTitle(withTitle.blocks)).toEqual(base)
  })

  it('keeps idempotent unchanged state for matching single leading virtual title', () => {
    const doc = useEditorVirtualTitleDocument()
    const blocks: EditorBlock[] = [
      { id: '__virtual_title__', type: 'header', data: { level: 1, text: 'Title' } },
      { id: 'p1', type: 'paragraph', data: { text: 'Body' } }
    ]

    const result = doc.withVirtualTitle(blocks, 'Title')
    expect(result.changed).toBe(false)
    expect(result.blocks.length).toBe(2)
  })

  it('extracts plain text from html-like text data', () => {
    const doc = useEditorVirtualTitleDocument()
    expect(doc.extractPlainText('<strong>Hello</strong>\u200B world')).toBe('Hello world')
  })
})
