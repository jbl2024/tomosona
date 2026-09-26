import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { ListKit } from '@tiptap/extension-list'
import { AdjacentListNormalizer } from './AdjacentListNormalizer'

const editors: Editor[] = []

function createEditor() {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ bulletList: false, orderedList: false, listItem: false, listKeymap: false }),
      ListKit.configure({ taskItem: { nested: true } }),
      AdjacentListNormalizer
    ],
    content: {
      type: 'doc',
      content: [
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Temporary separator' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] }] }
      ]
    }
  })
  editors.push(editor)
  return editor
}

afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))

describe('AdjacentListNormalizer', () => {
  it('joins matching lists when the separator text is deleted', () => {
    const editor = createEditor()
    const firstList = editor.state.doc.child(0)
    const separator = editor.state.doc.child(1)

    editor.view.dispatch(editor.state.tr.delete(firstList.nodeSize + 1, firstList.nodeSize + separator.nodeSize - 1))

    expect(editor.getJSON().content?.[0]).toEqual(
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] }
        ]
      }
    )
    expect(editor.getJSON().content?.[1]).toEqual({ type: 'paragraph' })
  })
})
