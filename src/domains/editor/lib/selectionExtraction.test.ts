import { getSchema, type Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { AllSelection, EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { extractSelectedMarkdownBlocks } from './selectionExtraction'

const schema = getSchema([StarterKit])
const paragraph = (text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)
const heading = (text: string) => schema.nodes.heading.create({ level: 2 }, schema.text(text))
const list = schema.nodes.bulletList.create(null, [
  schema.nodes.listItem.create(null, paragraph('Alpha')),
  schema.nodes.listItem.create(null, paragraph('Beta'))
])
const doc = schema.nodes.doc.create(null, [heading('Before'), heading('Why'), list, heading('How'), paragraph('After')])
const start = doc.child(0).nodeSize
const end = start + doc.child(1).nodeSize + list.nodeSize + doc.child(3).nodeSize

function extract(selection: EditorState['selection'], document = doc) {
  return extractSelectedMarkdownBlocks({ state: EditorState.create({ doc: document, selection }) } as Editor)
}

describe('extractSelectedMarkdownBlocks', () => {
  it.each([false, true])('extracts headings and lists selected through their text edges (backward: %s)', (backward) => {
    const from = start + 1
    const to = end - 1
    const result = extract(TextSelection.create(doc, backward ? to : from, backward ? from : to))

    expect(result).toMatchObject({ from: start, to: end, markdown: '## Why\n\n- Alpha\n- Beta\n\n## How\n' })
    expect(result?.blocks).toHaveLength(3)
  })

  it('excludes the following block when selection ends at its text start', () => {
    const result = extract(TextSelection.create(doc, start + 1, end + 1))
    expect(result).toMatchObject({ from: start, to: end })
    expect(result?.markdown).not.toContain('After')
  })

  it('replaces complete wrappers without leaving empty headings or list fragments', () => {
    const selection = TextSelection.create(doc, start + 1, end + 1)
    const extracted = extract(selection)!
    const state = EditorState.create({ doc, selection })
    const replacement = schema.nodes.horizontalRule.create()
    const updated = state.tr.replaceWith(extracted.from, extracted.to, replacement).doc

    expect(updated.toJSON()).toEqual(schema.nodes.doc.create(null, [
      heading('Before'), replacement, paragraph('After')
    ]).toJSON())
  })

  it('accepts document-level block boundaries', () => {
    expect(extract(NodeSelection.create(doc, start))).toMatchObject({ from: start, to: start + doc.child(1).nodeSize })
    expect(extract(new AllSelection(doc))).toMatchObject({ from: 0, to: doc.content.size })
  })

  it('lifts complete list text selections through list wrappers', () => {
    const listStart = start + doc.child(1).nodeSize
    const listEnd = listStart + list.nodeSize
    expect(extract(TextSelection.create(doc, listStart + 3, listEnd - 3))).toMatchObject({
      from: listStart, to: listEnd, markdown: '- Alpha\n- Beta\n'
    })
  })

  it('rejects partial text and partially selected lists', () => {
    expect(extract(TextSelection.create(doc, start + 2, end - 1))).toBeNull()
    expect(extract(TextSelection.create(doc, start + 1, end - 2))).toBeNull()
    const listStart = start + doc.child(1).nodeSize
    expect(extract(TextSelection.create(doc, listStart + 3, listStart + 8))).toBeNull()
  })

  it('rejects empty selections and missing editors', () => {
    expect(extract(TextSelection.create(doc, start + 1))).toBeNull()
    expect(extractSelectedMarkdownBlocks(null)).toBeNull()
  })

  it('does not include an empty trailing paragraph', () => {
    const document = schema.nodes.doc.create(null, [paragraph('Alpha'), paragraph('')])
    expect(extract(TextSelection.create(document, 1, 8), document)).toMatchObject({ from: 0, to: 7, markdown: 'Alpha\n' })
  })
})
