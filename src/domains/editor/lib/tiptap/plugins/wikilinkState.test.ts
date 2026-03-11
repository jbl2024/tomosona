import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import { NodeSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { ListKit } from '@tiptap/extension-list'
import { WikilinkNode } from '../extensions/WikilinkNode'
import { createWikilinkStatePlugin } from './wikilinkState'

const editors: Editor[] = []

function createEditor(content: Record<string, unknown>) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false
      }),
      ListKit.configure({
        taskItem: { nested: true }
      }),
      WikilinkNode
    ],
    content
  })
  editors.push(editor)
  return editor
}

function findFirstWikilinkPos(editor: Editor): number {
  let position = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'wikilink') return true
    position = pos
    return false
  })
  if (position < 0) throw new Error('Expected wikilink node in test document')
  return position
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

describe('createWikilinkStatePlugin', () => {
  it('splits bullet list items when Enter is pressed on a selected terminal wikilink', () => {
    const onNavigate = vi.fn()
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'wikilink',
                      attrs: {
                        target: 'Personnes/Emile.md',
                        label: 'Emile',
                        exists: true
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
    const position = findFirstWikilinkPos(editor)
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)))

    const plugin = createWikilinkStatePlugin(editor, {
      getCandidates: async () => [],
      onNavigate,
      onCreate: async () => {},
      resolve: async () => true
    }) as any
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })

    const handled = plugin.props.handleKeyDown(editor.view, event)

    expect(handled).toBe(true)
    expect(onNavigate).not.toHaveBeenCalled()
    expect(editor.state.selection.empty).toBe(true)
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(editor.state.selection.$from.parent.content.size).toBe(0)
    expect(editor.state.selection.$from.node(-1).type.name).toBe('listItem')
    expect(editor.getJSON().content?.[0]?.type).toBe('bulletList')
    expect((editor.getJSON().content?.[0] as any)?.content).toHaveLength(2)
  })

  it('splits task list items when Enter is pressed on a selected terminal wikilink', () => {
    const onNavigate = vi.fn()
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'wikilink',
                      attrs: {
                        target: 'Tasks/Next.md',
                        label: 'Next',
                        exists: true
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
    const position = findFirstWikilinkPos(editor)
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)))

    const plugin = createWikilinkStatePlugin(editor, {
      getCandidates: async () => [],
      onNavigate,
      onCreate: async () => {},
      resolve: async () => true
    }) as any
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })

    const handled = plugin.props.handleKeyDown(editor.view, event)

    expect(handled).toBe(true)
    expect(onNavigate).not.toHaveBeenCalled()
    expect(editor.state.selection.empty).toBe(true)
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(editor.state.selection.$from.parent.content.size).toBe(0)
    expect(editor.state.selection.$from.node(-1).type.name).toBe('taskItem')
    expect(editor.getJSON().content?.[0]?.type).toBe('taskList')
    expect((editor.getJSON().content?.[0] as any)?.content).toHaveLength(2)
  })

  it('keeps Enter navigation for selected wikilinks outside lists', () => {
    const onNavigate = vi.fn()
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'wikilink',
              attrs: {
                target: 'Personnes/Emile.md',
                label: 'Emile',
                exists: true
              }
            }
          ]
        }
      ]
    })
    const position = findFirstWikilinkPos(editor)
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)))

    const plugin = createWikilinkStatePlugin(editor, {
      getCandidates: async () => [],
      onNavigate,
      onCreate: async () => {},
      resolve: async () => true
    }) as any
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })

    const handled = plugin.props.handleKeyDown(editor.view, event)

    expect(handled).toBe(true)
    expect(onNavigate).toHaveBeenCalledWith('Personnes/Emile.md')
  })
})
