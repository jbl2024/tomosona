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

describe('fromTiptapDoc embed block', () => {
  it('maps noteEmbedBlock nodes to embedded note blocks', () => {
    const blocks = fromTiptapDoc({
      type: 'doc',
      content: [
        {
          type: 'noteEmbedBlock',
          attrs: {
            target: 'notes/alpha'
          }
        }
      ]
    })

    expect(blocks).toEqual([
      {
        type: 'embed',
        data: {
          target: 'notes/alpha'
        }
      }
    ])
  })
})

describe('fromTiptapDoc asset block', () => {
  it('maps assetBlock nodes to asset blocks', () => {
    const blocks = fromTiptapDoc({
      type: 'doc',
      content: [
        {
          type: 'assetBlock',
          attrs: {
            src: '../../assets/images/Formulaire_GLPI/kyPZV79XlEaFswpDL5cP47SlAfy25fO6fnN9FEM-TUY=.png',
            alt: 'kyPZV79XlEaFswpDL5cP47SlAfy25fO6fnN9FEM-TUY=.png',
            title: 'Formulaire GLPI'
          }
        }
      ]
    })

    expect(blocks).toEqual([
      {
        type: 'asset',
        data: {
          src: '../../assets/images/Formulaire_GLPI/kyPZV79XlEaFswpDL5cP47SlAfy25fO6fnN9FEM-TUY=.png',
          alt: 'kyPZV79XlEaFswpDL5cP47SlAfy25fO6fnN9FEM-TUY=.png',
          title: 'Formulaire GLPI'
        }
      }
    ])
  })
})

describe('fromTiptapDoc table metadata', () => {
  it('maps table alignment while dropping column widths', () => {
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
          content: [
            ['Nom', 'Age', 'Ville'],
            ['Alice', '30', 'Lyon']
          ]
        }
      }
    ])
  })

  it('does not serialize colwidth values', () => {
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

    expect((blocks[0]?.data as Record<string, unknown>).widths).toBeUndefined()
  })
})

describe('fromTiptapDoc internal links', () => {
  it('keeps internal anchor hrefs without external link attrs', () => {
    const blocks = fromTiptapDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Resume',
              marks: [{ type: 'link', attrs: { href: '#fragment' } }]
            }
          ]
        }
      ]
    })

    expect(blocks).toEqual([
      {
        type: 'paragraph',
        data: {
          text: '<a href="#fragment">Resume</a>'
        }
      }
    ])
  })

  it('keeps relative markdown links as internal anchors with markdown targets', () => {
    const blocks = fromTiptapDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Mattermost',
              marks: [{ type: 'link', attrs: { href: 'mattermost/index.md' } }]
            }
          ]
        }
      ]
    })

    expect(blocks).toEqual([
      {
        type: 'paragraph',
        data: {
          text: '<a href="mattermost/index.md" data-markdown-target="mattermost/index.md">Mattermost</a>'
        }
      }
    ])
  })
})
