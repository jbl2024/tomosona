import { describe, expect, it, vi } from 'vitest'
import { Editor, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { exitAtomBlock } from './exitAtomBlock'

const Atom = Node.create({ name: 'testAtom', group: 'block', atom: true, renderHTML: () => ['div'] })

describe('exitAtomBlock', () => {
  it.each(['metaKey', 'ctrlKey'] as const)('creates a paragraph after the block with %s', (modifier) => {
    const editor = new Editor({ extensions: [StarterKit, Atom], content: { type: 'doc', content: [{ type: 'testAtom' }, { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Next' }] }] } })
    const event = new KeyboardEvent('keydown', { key: 'Enter', [modifier]: true, cancelable: true })
    expect(exitAtomBlock(event, editor, () => 0)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(editor.state.doc.child(1).type.name).toBe('paragraph')
    expect(editor.state.doc.child(2).textContent).toBe('Next')
    editor.destroy()
  })

  it('reuses the following paragraph and ignores unrelated keys', () => {
    const editor = new Editor({ extensions: [StarterKit, Atom], content: { type: 'doc', content: [{ type: 'testAtom' }, { type: 'paragraph', content: [{ type: 'text', text: 'Next' }] }] } })
    const insert = vi.spyOn(editor.commands, 'insertContentAt')
    expect(exitAtomBlock(new KeyboardEvent('keydown', { key: 'Enter' }), editor, () => 0)).toBe(false)
    expect(exitAtomBlock(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }), editor, () => 0)).toBe(true)
    expect(editor.state.doc.child(1).textContent).toBe('Next')
    expect(insert).not.toHaveBeenCalled()
    editor.destroy()
  })
})
