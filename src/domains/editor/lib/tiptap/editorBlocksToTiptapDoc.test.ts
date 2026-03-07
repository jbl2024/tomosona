import { describe, expect, it } from 'vitest'
import { toTiptapDoc } from './editorBlocksToTiptapDoc'

describe('toTiptapDoc list inline content', () => {
  it('preserves external links and wikilinks in list items', () => {
    const doc = toTiptapDoc([
      {
        type: 'list',
        data: {
          style: 'unordered',
          items: [
            {
              content: '<a href="http://GLPI.md" target="_blank" rel="noopener noreferrer">GLPI.md</a>',
              items: []
            },
            {
              content: '<a href="wikilink:GLPI.md" data-wikilink-target="GLPI.md">GLPI.md</a>',
              items: []
            },
            {
              content: '<a href="wikilink:Another.md" data-wikilink-target="Another.md">Another.md</a>',
              items: []
            }
          ]
        }
      }
    ])

    expect(doc).toEqual({
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
                      type: 'text',
                      text: 'GLPI.md',
                      marks: [{ type: 'link', attrs: { href: 'http://GLPI.md' } }]
                    }
                  ]
                }
              ]
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'wikilink',
                      attrs: { target: 'GLPI.md', label: null, exists: true }
                    }
                  ]
                }
              ]
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'wikilink',
                      attrs: { target: 'Another.md', label: null, exists: true }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
  })
})

describe('toTiptapDoc html block', () => {
  it('maps html blocks to htmlBlock nodes', () => {
    const doc = toTiptapDoc([
      {
        type: 'html',
        data: {
          html: '<div><strong>Hello</strong></div>'
        }
      }
    ])

    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'htmlBlock',
          attrs: {
            html: '<div><strong>Hello</strong></div>'
          }
        }
      ]
    })
  })
})

describe('toTiptapDoc table metadata', () => {
  it('maps table align and widths metadata to table cell attrs', () => {
    const doc = toTiptapDoc([
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

    const table = doc.content?.[0] as any
    const headerRow = table.content[0]
    const bodyRow = table.content[1]
    expect(headerRow.content[0].attrs).toEqual({ textAlign: 'left', colwidth: [40] })
    expect(headerRow.content[1].attrs).toEqual({ textAlign: 'center', colwidth: [20] })
    expect(headerRow.content[2].attrs).toEqual({ textAlign: 'right', colwidth: [40] })
    expect(bodyRow.content[0].attrs).toEqual({ textAlign: 'left', colwidth: [40] })
    expect(bodyRow.content[1].attrs).toEqual({ textAlign: 'center', colwidth: [20] })
    expect(bodyRow.content[2].attrs).toEqual({ textAlign: 'right', colwidth: [40] })
  })

  it('fills missing widths metadata to keep stable table column sizing', () => {
    const doc = toTiptapDoc([
      {
        type: 'table',
        data: {
          withHeadings: true,
          widths: [55, 45, null],
          content: [
            ['Nom', 'Age', 'Ville'],
            ['Jerome', '42', 'Lyon']
          ]
        }
      }
    ])

    const table = doc.content?.[0] as any
    const headerRow = table.content[0]
    expect(headerRow.content[0].attrs.colwidth).toEqual([37])
    expect(headerRow.content[1].attrs.colwidth).toEqual([30])
    expect(headerRow.content[2].attrs.colwidth).toEqual([33])
  })
})
