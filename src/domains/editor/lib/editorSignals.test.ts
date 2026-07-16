import { Schema } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/vue-3'
import { describe, expect, it } from 'vitest'
import {
  assignEditorSignalLanes,
  buildEditorSignalSummary,
  collectEditorHeadingRanges,
  collectEditorSignalRanges,
  resolveActiveEditorSignalSummary
} from './editorSignals'

function createEditorDoc() {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      heading: { content: 'inline*', group: 'block', attrs: { level: { default: 1 } } },
      paragraph: { content: 'inline*', group: 'block' },
      text: { group: 'inline' },
      wikilink: { inline: true, group: 'inline', atom: true, attrs: { target: { default: '' } } }
    },
    marks: {
      link: { attrs: { href: {} } }
    }
  })
  const link = schema.marks.link.create({ href: 'https://example.test' })
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.heading.create({ level: 2 }, schema.text('Structure')),
    schema.nodes.paragraph.create(null, [
      schema.text('linked', [link]),
      schema.text(' text', [link]),
      schema.nodes.wikilink.create({ target: 'Missing note' })
    ])
  ])
  return { schema, doc }
}

describe('editor signals', () => {
  it('extracts H1-H3 headings and coalesces fragmented link marks', () => {
    const { doc } = createEditorDoc()
    const editor = { state: { doc } } as unknown as Editor

    expect(collectEditorHeadingRanges(editor)).toMatchObject([{ level: 2, text: 'Structure' }])
    expect(collectEditorSignalRanges(editor).filter((signal) => signal.kind === 'link')).toHaveLength(2)
  })

  it('keeps every colliding signal while assigning horizontal lanes', () => {
    const positioned = assignEditorSignalLanes([
      { kind: 'link', from: 1, to: 2, topPercent: 20 },
      { kind: 'find', from: 3, to: 4, topPercent: 20.1 },
      { kind: 'spellcheck', from: 5, to: 6, topPercent: 20.2 },
      { kind: 'link', from: 7, to: 8, topPercent: 20.3 }
    ])

    expect(positioned).toHaveLength(4)
    expect(positioned.map((signal) => signal.lane)).toEqual([0, 1, 2, 0])
    expect(positioned[3].overflowOffset).toBe(2)
  })

  it('builds conditional status metadata without dropping zero counts', () => {
    expect(buildEditorSignalSummary('note.md', [
      { kind: 'spellcheck', from: 1, to: 2 },
      { kind: 'link', from: 3, to: 4 }
    ], { spellcheckEnabled: true, findActive: false })).toEqual({
      path: 'note.md',
      spellcheckEnabled: true,
      findActive: false,
      spellcheckCount: 1,
      findCount: 0,
      linkCount: 1
    })
  })

  it('selects only the active pane summary for the active document', () => {
    const paneOne = buildEditorSignalSummary('one.md', [], { spellcheckEnabled: false, findActive: false })
    const paneTwo = buildEditorSignalSummary('two.md', [{ kind: 'link', from: 1, to: 2 }], {
      spellcheckEnabled: false,
      findActive: false
    })

    expect(resolveActiveEditorSignalSummary({ one: paneOne, two: paneTwo }, 'two', 'two.md').linkCount).toBe(1)
    expect(resolveActiveEditorSignalSummary({ one: paneOne, two: paneTwo }, 'one', 'two.md').linkCount).toBe(0)
  })
})
