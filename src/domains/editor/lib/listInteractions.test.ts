import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { ListKit } from '@tiptap/extension-list'
import { adjustListLevelFromTab, liftListItemFromShortcut } from './editorInteractions'

function editorWith(content: string, selected: string) {
  const editor = new Editor({
    extensions: [StarterKit.configure({ bulletList: false, orderedList: false, listItem: false, listKeymap: false }), ListKit.configure({ taskItem: { nested: true } })],
    content
  })
  let pos = 0
  editor.state.doc.descendants((node, offset) => {
    if (node.isText && node.text === selected) pos = offset + 1
  })
  editor.commands.setTextSelection(pos)
  return editor
}

function press(editor: Editor, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...options })
  const handled = key === 'Tab' ? adjustListLevelFromTab(editor.view, event) : liftListItemFromShortcut(editor.view, event)
  return { handled, prevented: event.defaultPrevented }
}

describe('list keyboard interactions', () => {
  it.each(['ul', 'ol'])('splits a %s around the lifted middle item', (tag) => {
    const editor = editorWith(`<${tag}><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></${tag}>`, 'two')
    expect(press(editor, 'Enter', { metaKey: true })).toEqual({ handled: true, prevented: true })
    expect(editor.state.doc.childCount).toBeGreaterThanOrEqual(3)
    expect(editor.state.doc.child(0).textContent).toBe('one')
    expect(editor.state.doc.child(1).type.name).toBe('paragraph')
    expect(editor.state.doc.child(1).textContent).toBe('two')
    expect(editor.state.doc.child(2).textContent).toBe('three')
    editor.destroy()
  })

  it('indents and outdents an item while preserving its text and siblings', () => {
    const editor = editorWith('<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul>', 'two')
    expect(press(editor, 'Tab').handled).toBe(true)
    expect(editor.state.doc.firstChild?.firstChild?.lastChild?.type.name).toBe('bulletList')
    expect(press(editor, 'Tab', { shiftKey: true }).handled).toBe(true)
    expect(editor.state.doc.firstChild?.childCount).toBe(3)
    expect(editor.state.doc.textContent).toBe('onetwothree')
    editor.destroy()
  })

  it('lifts a nested item one level with Control+Enter', () => {
    const editor = editorWith('<ul><li><p>one</p><ul><li><p>two</p></li></ul></li><li><p>three</p></li></ul>', 'two')
    expect(press(editor, 'Enter', { ctrlKey: true }).handled).toBe(true)
    expect(editor.state.doc.firstChild?.childCount).toBe(3)
    expect(editor.state.doc.textContent).toBe('onetwothree')
    editor.destroy()
  })

  it('lifts a checked task without changing adjacent task states', () => {
    const editor = editorWith('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>one</p></li><li data-type="taskItem" data-checked="true"><p>two</p></li><li data-type="taskItem" data-checked="false"><p>three</p></li></ul>', 'two')
    expect(press(editor, 'Enter', { metaKey: true }).handled).toBe(true)
    expect(editor.state.doc.child(0).firstChild?.attrs.checked).toBe(false)
    expect(editor.state.doc.child(1).textContent).toBe('two')
    expect(editor.state.doc.child(2).firstChild?.attrs.checked).toBe(false)
    editor.destroy()
  })

  it('ignores unrelated shortcuts and text outside lists', () => {
    const editor = editorWith('<p>one</p>', 'one')
    expect(press(editor, 'Enter', { metaKey: true }).handled).toBe(false)
    expect(press(editor, 'Tab').handled).toBe(false)
    editor.destroy()
    const list = editorWith('<ul><li><p>one</p></li></ul>', 'one')
    expect(press(list, 'Enter', { metaKey: true, shiftKey: true }).handled).toBe(false)
    expect(press(list, 'Enter').handled).toBe(false)
    list.destroy()
  })
})
