import { ref } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { type EditorCaretSnapshot, useEditorCaret } from './useEditorCaret'

function setCollapsedSelection(node: Text, offset: number) {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

describe('useEditorCaret', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('captures and restores contenteditable caret offsets', () => {
    const holderEl = document.createElement('div')
    const block = document.createElement('div')
    block.className = 'ce-block'
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const textNode = document.createTextNode('hello world')
    editable.appendChild(textNode)
    block.appendChild(editable)
    holderEl.appendChild(block)
    document.body.appendChild(holderEl)

    const caretByPath = ref<Record<string, EditorCaretSnapshot>>({})
    const { captureCaret, restoreCaret } = useEditorCaret({
      holder: ref(holderEl),
      caretByPath
    })

    editable.focus()
    setCollapsedSelection(textNode, 5)

    captureCaret('notes/a.md')

    expect(caretByPath.value['notes/a.md']).toEqual({
      kind: 'contenteditable',
      blockIndex: 0,
      offset: 5
    })

    setCollapsedSelection(textNode, 0)
    const restored = restoreCaret('notes/a.md')

    expect(restored).toBe(true)
    const selection = window.getSelection()
    expect(selection?.focusOffset).toBe(5)
  })

  it('captures and restores textarea caret offsets', () => {
    const holderEl = document.createElement('div')
    const block = document.createElement('div')
    block.className = 'ce-block'
    const textarea = document.createElement('textarea')
    textarea.value = 'abcdef'
    block.appendChild(textarea)
    holderEl.appendChild(block)
    document.body.appendChild(holderEl)

    const caretByPath = ref<Record<string, EditorCaretSnapshot>>({})
    const { captureCaret, restoreCaret } = useEditorCaret({
      holder: ref(holderEl),
      caretByPath
    })

    textarea.focus()
    textarea.setSelectionRange(3, 3)

    captureCaret('notes/a.md')

    expect(caretByPath.value['notes/a.md']).toEqual({
      kind: 'text-input',
      blockIndex: 0,
      offset: 3
    })

    textarea.setSelectionRange(0, 0)
    const restored = restoreCaret('notes/a.md')

    expect(restored).toBe(true)
    expect(textarea.selectionStart).toBe(3)
    expect(textarea.selectionEnd).toBe(3)
  })

  it('returns false when snapshot block index does not exist', () => {
    const holderEl = document.createElement('div')
    const caretByPath = ref<Record<string, EditorCaretSnapshot>>({
      'notes/a.md': { kind: 'contenteditable', blockIndex: 4, offset: 1 }
    })

    const { restoreCaret } = useEditorCaret({
      holder: ref(holderEl),
      caretByPath
    })

    expect(restoreCaret('notes/a.md')).toBe(false)
  })

  it('ignores selection outside holder during capture', () => {
    const holderEl = document.createElement('div')
    const block = document.createElement('div')
    block.className = 'ce-block'
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const holderText = document.createTextNode('inside')
    editable.appendChild(holderText)
    block.appendChild(editable)
    holderEl.appendChild(block)
    document.body.appendChild(holderEl)

    const outside = document.createElement('div')
    const outsideText = document.createTextNode('outside')
    outside.appendChild(outsideText)
    document.body.appendChild(outside)

    const caretByPath = ref<Record<string, EditorCaretSnapshot>>({})
    const { captureCaret } = useEditorCaret({
      holder: ref(holderEl),
      caretByPath
    })

    setCollapsedSelection(outsideText, 3)
    captureCaret('notes/a.md')

    expect(caretByPath.value['notes/a.md']).toBeUndefined()
  })
})
