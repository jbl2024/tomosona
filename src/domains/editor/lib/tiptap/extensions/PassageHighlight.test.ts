import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import {
  clearPassageHighlight,
  PASSAGE_HIGHLIGHT_CLASS,
  PassageHighlightExtension,
  setPassageHighlight
} from './PassageHighlight'

const editors: Editor[] = []

function createEditor(content: string) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, PassageHighlightExtension],
    content: `<p>${content}</p>`
  })
  editors.push(editor)
  return editor
}

function hasHighlight(editor: Editor): boolean {
  return editor.view.dom.querySelector(`.${PASSAGE_HIGHLIGHT_CLASS}`) !== null
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  vi.useRealTimers()
})

describe('PassageHighlightExtension', () => {
  it('highlights the given range and clears itself after the timeout', () => {
    const editor = createEditor('alpha beta gamma')
    expect(hasHighlight(editor)).toBe(false)

    setPassageHighlight(editor, { from: 1, to: 6 })
    expect(hasHighlight(editor)).toBe(true)

    vi.advanceTimersByTime(2100)
    expect(hasHighlight(editor)).toBe(false)
  })

  it('keeps the highlight through document changes and lets the timeout clear it', () => {
    const editor = createEditor('alpha beta gamma')
    setPassageHighlight(editor, { from: 1, to: 6 })
    expect(hasHighlight(editor)).toBe(true)

    // Document changes must not clear the highlight: automatic append
    // transactions (e.g. the trailing paragraph after a table) run in the
    // same dispatch as the reveal and would swallow it.
    editor.commands.insertContentAt(0, 'x')
    expect(hasHighlight(editor)).toBe(true)

    vi.advanceTimersByTime(2100)
    expect(hasHighlight(editor)).toBe(false)
  })

  it('survives the trailing-paragraph append triggered by a table at the end of the document', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, PassageHighlightExtension, Table, TableRow, TableHeader, TableCell],
      content: {
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alpha beta' }] }] }
                ]
              }
            ]
          }
        ]
      }
    })
    editors.push(editor)

    setPassageHighlight(editor, { from: 5, to: 10 })
    expect(hasHighlight(editor)).toBe(true)
  })

  it('ignores invalid ranges and manual clears', () => {
    const editor = createEditor('alpha beta')
    setPassageHighlight(editor, { from: 6, to: 6 })
    expect(hasHighlight(editor)).toBe(false)

    setPassageHighlight(editor, { from: 1, to: 6 })
    expect(hasHighlight(editor)).toBe(true)
    clearPassageHighlight(editor)
    expect(hasHighlight(editor)).toBe(false)
  })
})
