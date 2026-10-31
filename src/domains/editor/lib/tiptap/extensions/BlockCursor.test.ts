import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import {
  BlockCursorExtension,
  getBlockCursorState,
  refreshBlockCursorDecorations,
  type BlockCursorShape
} from './BlockCursor'

const editors: Editor[] = []

function createEditor(options: { getShape: () => BlockCursorShape | null; getBlink?: () => boolean }) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      BlockCursorExtension.configure({
        getShape: options.getShape,
        getBlink: options.getBlink ?? (() => true)
      })
    ],
    content: '<p>alpha beta</p>'
  })
  editors.push(editor)
  return editor
}

function focusEditor(editor: Editor) {
  editor.view.dom.dispatchEvent(new Event('focus'))
}

function cursorDecorations(editor: Editor) {
  return getBlockCursorState(editor)?.decorations.find() ?? []
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

describe('BlockCursorExtension', () => {
  it('draws a widget at the selection head while focused with a collapsed selection', () => {
    const editor = createEditor({ getShape: () => 'block' })
    editor.commands.setTextSelection(3)
    focusEditor(editor)

    const decorations = cursorDecorations(editor)
    expect(decorations).toHaveLength(1)
    expect(decorations[0].from).toBe(editor.state.selection.head)
    expect(editor.view.dom.querySelector('.tomosona-fake-cursor--block')).toBeTruthy()
  })

  it('hides the cursor while blurred, during selections, and when disabled', () => {
    const editor = createEditor({ getShape: () => 'block' })
    editor.commands.setTextSelection(3)
    expect(cursorDecorations(editor)).toHaveLength(0)

    focusEditor(editor)
    expect(cursorDecorations(editor)).toHaveLength(1)

    editor.commands.setTextSelection({ from: 1, to: 4 })
    expect(cursorDecorations(editor)).toHaveLength(0)

    editor.commands.setTextSelection(3)
    editor.view.dom.dispatchEvent(new Event('blur'))
    expect(cursorDecorations(editor)).toHaveLength(0)
  })

  it('steps aside during IME composition', () => {
    const editor = createEditor({ getShape: () => 'block' })
    editor.commands.setTextSelection(3)
    focusEditor(editor)
    expect(cursorDecorations(editor)).toHaveLength(1)

    editor.view.dom.dispatchEvent(new Event('compositionstart'))
    expect(cursorDecorations(editor)).toHaveLength(0)

    editor.view.dom.dispatchEvent(new Event('compositionend'))
    expect(cursorDecorations(editor)).toHaveLength(1)
  })

  it('restarts the blink cycle on activity so the cursor stays solid', () => {
    const editor = createEditor({ getShape: () => 'block' })
    editor.commands.setTextSelection(3)
    focusEditor(editor)

    const widget = editor.view.dom.querySelector('.tomosona-fake-cursor') as HTMLSpanElement
    expect(widget.style.animationName).toBe('tomosona-fake-cursor-blink')

    // Doc edit that keeps the caret put: the widget element is reused, so the
    // cycle must be restarted by switching to the alternate keyframe set.
    editor.view.dispatch(editor.state.tr.insertText('x', 5))
    expect(editor.view.dom.querySelector('.tomosona-fake-cursor')).toBe(widget)
    expect(widget.style.animationName).toBe('tomosona-fake-cursor-blink2')

    // Typing at the caret reuses the same node and restarts the cycle again.
    editor.commands.insertContent('x')
    expect(editor.view.dom.querySelector('.tomosona-fake-cursor')).toBe(widget)
    expect(widget.style.animationName).toBe('tomosona-fake-cursor-blink')
  })

  it('reflects blink and shape variants in the widget classes after a refresh', () => {
    let shape: BlockCursorShape | null = 'block'
    let blink = true
    const editor = createEditor({ getShape: () => shape, getBlink: () => blink })
    editor.commands.setTextSelection(3)
    focusEditor(editor)

    const widget = () => editor.view.dom.querySelector('.tomosona-fake-cursor')
    expect(widget()?.className).toContain('tomosona-fake-cursor--blink')

    blink = false
    refreshBlockCursorDecorations(editor)
    expect(widget()?.className).toContain('tomosona-fake-cursor--static')

    shape = 'underline'
    refreshBlockCursorDecorations(editor)
    expect(widget()?.className).toContain('tomosona-fake-cursor--underline')

    shape = null
    refreshBlockCursorDecorations(editor)
    expect(cursorDecorations(editor)).toHaveLength(0)
    expect(widget()).toBeNull()
  })
})
