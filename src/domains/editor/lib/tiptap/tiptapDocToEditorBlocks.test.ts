import { describe, expect, it } from 'vitest'
import { fromTiptapDoc } from './tiptapDocToEditorBlocks'

describe('fromTiptapDoc html block', () => {
  it('maps htmlBlock nodes to html blocks', () => {
    const blocks = fromTiptapDoc({
      type: 'doc',
      content: [
        {
          type: 'htmlBlock',
          attrs: {
            html: '<div><em>Hi</em></div>'
          }
        }
      ]
    })

    expect(blocks).toEqual([
      {
        type: 'html',
        data: {
          html: '<div><em>Hi</em></div>'
        }
      }
    ])
  })
})

describe('fromTiptapDoc table metadata', () => {
  it('maps table cell attrs back to table align and widths metadata', () => {
    const blocks = fromTiptapDoc({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', attrs: { textAlign: 'left', colwidth: [400] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nom' }] }] },
                { type: 'tableHeader', attrs: { textAlign: 'center', colwidth: [200] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Age' }] }] },
                { type: 'tableHeader', attrs: { textAlign: 'right', colwidth: [400] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ville' }] }] }
              ]
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', attrs: { textAlign: 'left', colwidth: [400] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alice' }] }] },
                { type: 'tableCell', attrs: { textAlign: 'center', colwidth: [200] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '30' }] }] },
                { type: 'tableCell', attrs: { textAlign: 'right', colwidth: [400] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lyon' }] }] }
              ]
            }
          ]
        }
      ]
    })

    expect(blocks).toEqual([
      {
        type: 'table',
        data: {
          withHeadings: true,
          align: ['left', 'center', 'right'],
          widths: [40, 20, 40],
          content: [
            ['Nom', 'Age', 'Ville'],
            ['Alice', '30', 'Lyon']
          ]
        }
      }
    ])
  })

  it('fills missing colwidth values before serializing widths percentages', () => {
    const blocks = fromTiptapDoc({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', attrs: { colwidth: [220] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nom' }] }] },
                { type: 'tableHeader', attrs: { colwidth: [180] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Age' }] }] },
                { type: 'tableHeader', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ville' }] }] }
              ]
            }
          ]
        }
      ]
    })

    expect((blocks[0]?.data as Record<string, unknown>).widths).toEqual([37, 30, 33])
  })
})
