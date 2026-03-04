import { Node } from '@tiptap/core'
import { ListKit } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { type JSONContent, Editor } from '@tiptap/vue-3'
import { afterEach, describe, expect, it } from 'vitest'
import { turnInto } from './actions'
import type { BlockMenuTarget, TurnIntoType } from './types'

const QuoteBlockNode = Node.create({
  name: 'quoteBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { text: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'div[data-quote-node="true"]' }]
  },
  renderHTML({ node }) {
    return ['div', { 'data-quote-node': 'true', 'data-text': String(node.attrs.text ?? '') }]
  }
})

const CalloutBlockNode = Node.create({
  name: 'calloutBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { kind: { default: 'NOTE' }, message: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'div[data-callout-node="true"]' }]
  },
  renderHTML({ node }) {
    return ['div', { 'data-callout-node': 'true', 'data-message': String(node.attrs.message ?? '') }]
  }
})

const MermaidBlockNode = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { code: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'div[data-mermaid-node="true"]' }]
  },
  renderHTML({ node }) {
    return ['div', { 'data-mermaid-node': 'true', 'data-code': String(node.attrs.code ?? '') }]
  }
})

const WikilinkNode = Node.create({
  name: 'wikilink',
  inline: true,
  atom: true,
  group: 'inline',
  addAttributes() {
    return {
      target: { default: '' },
      label: { default: null },
      exists: { default: true }
    }
  },
  parseHTML() {
    return [{ tag: 'a[data-wikilink="true"]' }]
  },
  renderHTML({ node }) {
    return ['a', { 'data-wikilink': 'true', 'data-target': String(node.attrs.target ?? '') }, String(node.attrs.label ?? node.attrs.target ?? '')]
  }
})

const TURN_INTO_TYPES: TurnIntoType[] = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bulletList',
  'orderedList',
  'taskList',
  'codeBlock',
  'quote'
]

function nodeTextWithLineBreaks(node: any): string {
  if (!node) return ''
  if (node.type?.name === 'hardBreak') return '\n'
  if (!node.childCount) {
    if (node.type?.name === 'quoteBlock') return String(node.attrs?.text ?? '')
    if (node.type?.name === 'calloutBlock') return String(node.attrs?.message ?? '')
    if (node.type?.name === 'mermaidBlock') return String(node.attrs?.code ?? '')
    return String(node.text ?? node.textContent ?? '')
  }
  let out = ''
  node.forEach((child: any) => {
    out += nodeTextWithLineBreaks(child)
  })
  return out
}

function createTarget(editor: Editor): BlockMenuTarget {
  const node = editor.state.doc.child(0)
  return {
    pos: 0,
    nodeType: node.type.name,
    nodeSize: node.nodeSize,
    canDelete: true,
    canConvert: true,
    text: node.textContent ?? '',
    isVirtualTitle: false
  }
}

const editors: Editor[] = []

function createEditor(firstNode: JSONContent): Editor {
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
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      QuoteBlockNode,
      CalloutBlockNode,
      MermaidBlockNode,
      WikilinkNode
    ],
    content: {
      type: 'doc',
      content: [firstNode]
    }
  })
  ;(editor.commands as { focus: (pos?: number) => boolean }).focus = () => true
  editors.push(editor)
  return editor
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

describe('blockMenu turnInto', () => {
  it('keeps quoteBlock multiline content when converting to paragraph', () => {
    const sourceText = 'line one\nline two'
    const editor = createEditor({
      type: 'quoteBlock',
      attrs: { text: sourceText }
    })

    expect(turnInto(editor, createTarget(editor), 'paragraph')).toBe(true)
    const converted = editor.state.doc.child(0)
    expect(converted.type.name).toBe('paragraph')
    expect(nodeTextWithLineBreaks(converted)).toBe(sourceText)
  })

  it('keeps atom-block source data for quote/callout/mermaid conversions', () => {
    const cases: Array<{ name: string; node: JSONContent; expected: string; target: TurnIntoType }> = [
      {
        name: 'quoteBlock',
        node: { type: 'quoteBlock', attrs: { text: 'quote alpha\nquote beta' } },
        expected: 'quote alpha\nquote beta',
        target: 'paragraph'
      },
      {
        name: 'calloutBlock',
        node: { type: 'calloutBlock', attrs: { kind: 'NOTE', message: 'callout body' } },
        expected: 'callout body',
        target: 'paragraph'
      },
      {
        name: 'mermaidBlock',
        node: { type: 'mermaidBlock', attrs: { code: 'graph TD\nA-->B' } },
        expected: 'graph TD\nA-->B',
        target: 'codeBlock'
      }
    ]

    for (const testCase of cases) {
      const editor = createEditor(testCase.node)
      expect(turnInto(editor, createTarget(editor), testCase.target), testCase.name).toBe(true)
      const converted = editor.state.doc.child(0)
      expect(nodeTextWithLineBreaks(converted), testCase.name).toBe(testCase.expected)
    }
  })

  it('keeps list/code/table content when converting to paragraph', () => {
    const cases: Array<{ name: string; node: JSONContent; expected: string }> = [
      {
        name: 'bulletList',
        node: {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item one' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item two' }] }] }
          ]
        },
        expected: 'item one\nitem two'
      },
      {
        name: 'codeBlock',
        node: {
          type: 'codeBlock',
          content: [{ type: 'text', text: 'first\nsecond' }]
        },
        expected: 'first\nsecond'
      },
      {
        name: 'table',
        node: {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h1' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h2' }] }] }
              ]
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c1' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c2' }] }] }
              ]
            }
          ]
        },
        expected: 'h1 | h2\nc1 | c2'
      }
    ]

    for (const testCase of cases) {
      const editor = createEditor(testCase.node)
      expect(turnInto(editor, createTarget(editor), 'paragraph'), testCase.name).toBe(true)
      const converted = editor.state.doc.child(0)
      expect(converted.type.name, testCase.name).toBe('paragraph')
      expect(nodeTextWithLineBreaks(converted), testCase.name).toBe(testCase.expected)
    }
  })

  it('uses quote target as custom quoteBlock node', () => {
    const editor = createEditor({
      type: 'paragraph',
      content: [{ type: 'text', text: 'paragraph text' }]
    })
    expect(turnInto(editor, createTarget(editor), 'quote')).toBe(true)
    const converted = editor.state.doc.child(0)
    expect(converted.type.name).toBe('quoteBlock')
    expect(String(converted.attrs.text ?? '')).toBe('paragraph text')
  })

  it('preserves inline wikilink node and text marks when converting paragraph to task list', () => {
    const editor = createEditor({
      type: 'paragraph',
      content: [
        { type: 'wikilink', attrs: { target: 'Note.md', label: null, exists: true } },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] }
      ]
    })

    expect(turnInto(editor, createTarget(editor), 'taskList')).toBe(true)
    const taskList = editor.state.doc.child(0)
    expect(taskList.type.name).toBe('taskList')
    const paragraph = taskList.child(0).child(0)
    expect(paragraph.type.name).toBe('paragraph')
    expect(paragraph.child(0).type.name).toBe('wikilink')
    expect(String(paragraph.child(0).attrs.target ?? '')).toBe('Note.md')
    expect(paragraph.child(2).marks.some((mark) => mark.type.name === 'bold')).toBe(true)
  })

  it('converts every source/target pair without dropping non-empty content', () => {
    const sources: Array<{ name: string; node: JSONContent; expectedNonEmpty: boolean }> = [
      { name: 'paragraph', node: { type: 'paragraph', content: [{ type: 'text', text: 'Paragraph source' }] }, expectedNonEmpty: true },
      { name: 'heading', node: { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading source' }] }, expectedNonEmpty: true },
      {
        name: 'bulletList',
        node: {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet source' }] }] }]
        },
        expectedNonEmpty: true
      },
      {
        name: 'orderedList',
        node: {
          type: 'orderedList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ordered source' }] }] }]
        },
        expectedNonEmpty: true
      },
      {
        name: 'taskList',
        node: {
          type: 'taskList',
          content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task source' }] }] }]
        },
        expectedNonEmpty: true
      },
      { name: 'codeBlock', node: { type: 'codeBlock', content: [{ type: 'text', text: 'Code source' }] }, expectedNonEmpty: true },
      { name: 'quoteBlock', node: { type: 'quoteBlock', attrs: { text: 'Quote source' } }, expectedNonEmpty: true },
      { name: 'calloutBlock', node: { type: 'calloutBlock', attrs: { kind: 'NOTE', message: 'Callout source' } }, expectedNonEmpty: true },
      { name: 'mermaidBlock', node: { type: 'mermaidBlock', attrs: { code: 'graph TD\nA-->B' } }, expectedNonEmpty: true },
    ]

    for (const source of sources) {
      for (const targetType of TURN_INTO_TYPES) {
        const editor = createEditor(source.node)
        const convertedOk = turnInto(editor, createTarget(editor), targetType)
        expect(convertedOk, `${source.name} -> ${targetType}`).toBe(true)
        const converted = editor.state.doc.child(0)
        expect(converted, `${source.name} -> ${targetType} node`).toBeTruthy()
        if (source.expectedNonEmpty) {
          const text = nodeTextWithLineBreaks(converted)
          expect(text.length, `${source.name} -> ${targetType} content`).toBeGreaterThan(0)
        }
      }
    }
  })
})
