import { describe, expect, it } from 'vitest'

import {
  clipboardHtmlToMarkdown,
  editorDataToMarkdown,
  inlineTextToHtml,
  markdownToEditorData,
  sanitizeExternalHref
} from './markdownBlocks'

describe('sanitizeExternalHref', () => {
  it('allows http/https/mailto', () => {
    expect(sanitizeExternalHref('https://example.com')).toBe('https://example.com')
    expect(sanitizeExternalHref('http://example.com/path')).toBe('http://example.com/path')
    expect(sanitizeExternalHref('mailto:test@example.com')).toBe('mailto:test@example.com')
  })

  it('rejects dangerous schemes and malformed links', () => {
    expect(sanitizeExternalHref('javascript:alert(1)')).toBeNull()
    expect(sanitizeExternalHref('data:text/html,abc')).toBeNull()
    expect(sanitizeExternalHref('file:///etc/passwd')).toBeNull()
    expect(sanitizeExternalHref('/relative/path')).toBeNull()
    expect(sanitizeExternalHref('')).toBeNull()
  })
})

describe('clipboardHtmlToMarkdown', () => {
  it('converts core html blocks to markdown', () => {
    const html = `
      <h2>Title</h2>
      <p>Hello <strong>world</strong></p>
      <ul><li>First</li><li>Second</li></ul>
      <blockquote><p>Quoted line</p></blockquote>
      <table>
        <tr><th>Col</th><th>Val</th></tr>
        <tr><td>A</td><td>B</td></tr>
      </table>
    `

    const markdown = clipboardHtmlToMarkdown(html)
    expect(markdown).toContain('## Title')
    expect(markdown).toContain('Hello **world**')
    expect(markdown).toContain('- First')
    expect(markdown).toContain('> Quoted line')
    expect(markdown).toContain('| Col | Val |')
    expect(markdown).toContain('| --- | --- |')
  })

  it('keeps unsafe href schemes inert through markdown parsing', () => {
    const html = '<p><a href="javascript:alert(1)">bad</a></p>'
    const markdown = clipboardHtmlToMarkdown(html)
    expect(markdown).toContain('[bad](javascript:alert(1))')

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(1)
    expect(String(parsed.blocks[0].data.text)).not.toContain('<a ')
    expect(String(parsed.blocks[0].data.text)).toContain('[bad](javascript:alert(1))')
  })

  it('round-trips wikilink-style anchors from html', () => {
    const html = '<p><a href="wikilink:notes%2Falpha.md" data-wikilink-target="notes/alpha.md">Alpha</a></p>'
    const markdown = clipboardHtmlToMarkdown(html)
    expect(markdown).toContain('[[notes/alpha.md|Alpha]]')
  })

  it('preserves wikilink target from data-target anchors copied from editor', () => {
    const html = '<p><a href="#" data-wikilink="true" data-target="graph/neurone.md" data-label="Neurone">Neurone</a></p>'
    const markdown = clipboardHtmlToMarkdown(html)
    expect(markdown).toContain('[[graph/neurone.md|Neurone]]')
  })

  it('preserves bare root anchor wikilinks from clipboard html', () => {
    const html = '<a href="#" data-wikilink="true" data-target="graph/neurone.md" data-label="Neurone">Neurone</a>'
    const markdown = clipboardHtmlToMarkdown(html)
    expect(markdown).toContain('[[graph/neurone.md|Neurone]]')
  })
})

describe('inline internal markdown links', () => {
  it('renders internal fragment links as anchors', () => {
    expect(inlineTextToHtml('[Resume](#1-resume-executif)')).toBe('<a href="#1-resume-executif">Resume</a>')
  })

  it('parses internal fragment links into editor html blocks', () => {
    const parsed = markdownToEditorData('- [Resume](#1-resume-executif)')
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0]).toEqual({
      type: 'list',
      data: {
        style: 'unordered',
        items: [
          {
            content: '<a href="#1-resume-executif">Resume</a>',
            items: []
          }
        ]
      }
    })
  })
})

describe('markdownToEditorData tables', () => {
  it('parses column alignment markers from separator row', () => {
    const markdown = `
| Left Aligned | Center Aligned | Right Aligned |
| :--- | :---: | ---: |
| A | B | C |
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0]).toEqual({
      type: 'table',
      data: {
        withHeadings: true,
        align: ['left', 'center', 'right'],
        content: [
          ['Left Aligned', 'Center Aligned', 'Right Aligned'],
          ['A', 'B', 'C']
        ]
      }
    })
  })

  it('parses optional table widths metadata line', () => {
    const markdown = `
| Nom | Age | Ville |
| --- | :-: | ---: |
| Alice | 30 | Lyon |
{widths: 40%,20%,40%}
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0]).toEqual({
      type: 'table',
      data: {
        withHeadings: true,
        align: [null, 'center', 'right'],
        widths: [40, 20, 40],
        content: [
          ['Nom', 'Age', 'Ville'],
          ['Alice', '30', 'Lyon']
        ]
      }
    })
  })

  it('normalizes legacy absolute-like widths into percentages', () => {
    const markdown = `
| A | B | C |
| --- | --- | --- |
| 1 | 2 | 3 |
{widths: 200,80,150}
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(1)
    expect((parsed.blocks[0].data as Record<string, unknown>).widths).toEqual([47, 19, 35])
  })

  it('parses tables that have an empty header row', () => {
    const markdown = `
|  |  |  |
| --- | --- | --- |
| a | b | e |
| c | d | f |
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0]).toEqual({
      type: 'table',
      data: {
        withHeadings: true,
        content: [
          ['', '', ''],
          ['a', 'b', 'e'],
          ['c', 'd', 'f']
        ]
      }
    })
  })

  it('keeps escaped pipes inside a table cell without creating extra columns', () => {
    const markdown = `
| A | B | C |  |
| --- | --- | :---: | --- |
| [[graph/adaptation.md\\|adaptation]] |  |  |  |
{widths: 30%,10%,30%,30%}
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0].type).toBe('table')
    const tableData = parsed.blocks[0].data as {
      align?: Array<'left' | 'center' | 'right' | null>
      widths?: Array<number | null>
      content: string[][]
    }
    expect(tableData.align).toEqual([null, null, 'center', null])
    expect(tableData.widths).toEqual([30, 10, 30, 30])
    expect(tableData.content[0]).toEqual(['A', 'B', 'C', ''])
    expect(tableData.content[1]).toHaveLength(4)
    expect(tableData.content[1]?.[0]).toContain('graph/adaptation.md')
  })

  it('keeps wikilink alias pipes inside a table cell without creating extra columns', () => {
    const markdown = `
| A | B | C |
| --- | --- | --- |
| [[graph/adaptation.md|adaptation]] | 2 | 3 |
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(1)
    const tableData = parsed.blocks[0].data as { content: string[][] }
    expect(tableData.content[1]).toHaveLength(3)
    expect(tableData.content[1]?.[0]).toContain('data-wikilink-target="graph/adaptation.md"')
    expect(tableData.content[1]?.[0]).toContain('adaptation')
  })

  it('renders inline markdown inside table cells', () => {
    const markdown = `
| Feature | Value |
| --- | --- |
| **Deployment** | Single binary |
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0].type).toBe('table')
    expect(parsed.blocks[0].data).toEqual({
      withHeadings: true,
      content: [
        ['Feature', 'Value'],
        ['<strong>Deployment</strong>', 'Single binary']
      ]
    })
  })

  it('preserves table inline formatting when saving back to markdown', () => {
    const markdown = `
| Feature | Value |
| --- | --- |
| **Deployment** | Single binary |
`.trim()

    const parsed = markdownToEditorData(markdown)
    const output = editorDataToMarkdown(parsed)
    expect(output).toContain('| **Deployment** | Single binary |')
  })

  it('pads sparse rows to stable column count when serializing tables', () => {
    const output = editorDataToMarkdown({
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: true,
            content: [
              ['A', 'B', 'C'],
              ['1', '2'],
              ['x']
            ]
          }
        }
      ]
    })

    expect(output).toContain('| A | B | C |')
    expect(output).toContain('| 1 | 2 |  |')
    expect(output).toContain('| x |  |  |')
  })

  it('serializes alignment markers and widths line when explicit widths exist', () => {
    const output = editorDataToMarkdown({
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: true,
            align: ['left', 'center', 'right'],
            widths: [40, 20, 40],
            content: [
              ['A', 'B', 'C'],
              ['1', '2', '3']
            ]
          }
        }
      ]
    })

    expect(output).toContain('| :--- | :---: | ---: |')
    expect(output).toContain('{widths: 40%,20%,40%}')
  })

  it('does not serialize widths metadata when no explicit width is provided', () => {
    const output = editorDataToMarkdown({
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: true,
            align: ['left', null, 'right'],
            widths: [null, null, null],
            content: [
              ['A', 'B', 'C'],
              ['1', '2', '3']
            ]
          }
        }
      ]
    })

    expect(output).toContain('| :--- | --- | ---: |')
    expect(output).not.toContain('{widths:')
  })

  it('keeps align and widths across markdown round-trip', () => {
    const input = `
| Left | Center | Right |
| :--- | :---: | ---: |
| A | B | C |
{widths: 40%,20%,40%}
`.trim()

    const parsed = markdownToEditorData(input)
    const output = editorDataToMarkdown(parsed)
    const reparsed = markdownToEditorData(output)
    expect((reparsed.blocks[0].data as Record<string, unknown>).align).toEqual(['left', 'center', 'right'])
    expect((reparsed.blocks[0].data as Record<string, unknown>).widths).toEqual([40, 20, 40])
  })
})

describe('nested lists', () => {
  it('parses nested unordered lists from indentation', () => {
    const markdown = `
- a
- b
  - nest1
  - nest2
- c
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0]).toEqual({
      type: 'list',
      data: {
        style: 'unordered',
        items: [
          { content: 'a', items: [] },
          {
            content: 'b',
            items: [
              { content: 'nest1', items: [] },
              { content: 'nest2', items: [] }
            ]
          },
          { content: 'c', items: [] }
        ]
      }
    })
  })

  it('preserves nested unordered lists in markdown round-trip', () => {
    const input = `
- a
- b
  - nest1
  - nest2
- c
`.trim()

    const parsed = markdownToEditorData(input)
    const markdown = editorDataToMarkdown(parsed)
    expect(markdown).toContain('- b\n  - nest1\n  - nest2')
    const reparsed = markdownToEditorData(markdown)
    expect(reparsed.blocks[0]).toEqual(parsed.blocks[0])
  })
})

describe('robust list parsing', () => {
  it('parses simple task lists and preserves checked state', () => {
    const markdown = `
- [x] done
- [ ] todo
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toEqual([
      {
        type: 'list',
        data: {
          style: 'checklist',
          items: [
            { content: 'done', items: [], meta: { checked: true } },
            { content: 'todo', items: [], meta: { checked: false } }
          ]
        }
      }
    ])
  })

  it('parses three-level nested task lists', () => {
    const markdown = `
- [ ] parent
  - [x] child
    - [ ] grandchild
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toEqual([
      {
        type: 'list',
        data: {
          style: 'checklist',
          items: [
            {
              content: 'parent',
              meta: { checked: false },
              items: [
                {
                  content: 'child',
                  meta: { checked: true },
                  items: [
                    {
                      content: 'grandchild',
                      meta: { checked: false },
                      items: []
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    ])
  })

  it('keeps indented continuation lines inside an unordered item', () => {
    const markdown = `
- parent
  continuation line
  - child
- sibling
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks[0]).toEqual({
      type: 'list',
      data: {
        style: 'unordered',
        items: [
          {
            content: 'parent<br>continuation line',
            items: [{ content: 'child', items: [] }]
          },
          { content: 'sibling', items: [] }
        ]
      }
    })
  })

  it('keeps one blank line inside a task item when the next line remains attached', () => {
    const markdown = `
- [ ] parent

  more details
  - [x] child
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks[0]).toEqual({
      type: 'list',
      data: {
        style: 'checklist',
        items: [
          {
            content: 'parent<br><br>more details',
            meta: { checked: false },
            items: [{ content: 'child', meta: { checked: true }, items: [] }]
          }
        ]
      }
    })
  })

  it('stops the list on a blank line before a sibling item', () => {
    const markdown = `
- first

- second
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(2)
    expect(parsed.blocks[0]).toEqual({
      type: 'list',
      data: { style: 'unordered', items: [{ content: 'first', items: [] }] }
    })
    expect(parsed.blocks[1]).toEqual({
      type: 'list',
      data: { style: 'unordered', items: [{ content: 'second', items: [] }] }
    })
  })

  it('normalizes unicode newlines and indentation spaces in lists', () => {
    const markdown = '## Taches\u2028\u2028- [ ] parent\u2028\u00a0\u00a0- [x] child'
    const parsed = markdownToEditorData(markdown)

    expect(parsed.blocks).toEqual([
      {
        type: 'header',
        data: { level: 2, text: 'Taches' }
      },
      {
        type: 'list',
        data: {
          style: 'checklist',
          items: [
            {
              content: 'parent',
              meta: { checked: false },
              items: [{ content: 'child', meta: { checked: true }, items: [] }]
            }
          ]
        }
      }
    ])
  })

  it('does not absorb explicit block starters into list continuations', () => {
    const markdown = `
- first
  still first

## Heading

- second
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks.map((block) => block.type)).toEqual(['list', 'header', 'list'])
    expect(parsed.blocks[0]).toEqual({
      type: 'list',
      data: {
        style: 'unordered',
        items: [{ content: 'first<br>still first', items: [] }]
      }
    })
  })

  it('keeps ordered lists from absorbing non-conforming text', () => {
    const markdown = `
1. first
plain text
2. second
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks.map((block) => block.type)).toEqual(['list', 'paragraph', 'list'])
  })

  it('round-trips task lists with continuations into canonical markdown', () => {
    const markdown = `
- [ ] parent
  details
  - [x] child
`.trim()

    const parsed = markdownToEditorData(markdown)
    const output = editorDataToMarkdown(parsed)
    const reparsed = markdownToEditorData(output)

    expect(output).toContain('- [ ] parent\n  details\n  - [x] child')
    expect(reparsed.blocks[0]).toEqual(parsed.blocks[0])
  })
})

describe('wikilinks with underscores', () => {
  it('does not interpret intraword underscores as italic', () => {
    const markdown = '[[showcase/folder_with_underscore/note_in_folder.md]]'
    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0].type).toBe('paragraph')
    expect(String(parsed.blocks[0].data.text)).toContain('showcase/folder_with_underscore/note_in_folder.md')
    expect(String(parsed.blocks[0].data.text)).not.toContain('<em>')
  })
})

describe('underline formatting', () => {
  it('parses inline <u> tags as underline html', () => {
    const parsed = markdownToEditorData('This is <u>important</u>.')
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0].type).toBe('paragraph')
    expect(String(parsed.blocks[0].data.text)).toContain('<u>important</u>')
  })

  it('preserves underline tags in markdown round-trip', () => {
    const markdown = 'This is <u>important</u>.'
    const parsed = markdownToEditorData(markdown)
    const output = editorDataToMarkdown(parsed)
    expect(output).toContain('<u>important</u>')
  })
})

describe('inline links with surrounding emphasis', () => {
  it('renders bold around markdown links', () => {
    const html = inlineTextToHtml('**[liens](https://google.com)**')
    expect(html).toContain('<strong><a href="https://google.com"')
    expect(html).toContain('>liens</a></strong>')
  })

  it('renders bold around wikilinks', () => {
    const html = inlineTextToHtml('**[[journal/2026-02-22.md]]**')
    expect(html).toContain('<strong><a href="wikilink:journal%2F2026-02-22.md"')
    expect(html).toContain('>journal/2026-02-22.md</a></strong>')
  })

  it('keeps adjacent wikilinks stable inside task items', () => {
    const parsed = markdownToEditorData('- [x] Préparer[[Projets/JDEV.md|JDEV]] demander aux collègues')
    expect(parsed.blocks).toEqual([
      {
        type: 'list',
        data: {
          style: 'checklist',
          items: [
            {
              content:
                'Préparer<a href="wikilink:Projets%2FJDEV.md" data-wikilink-target="Projets/JDEV.md">JDEV</a> demander aux collègues',
              meta: { checked: true },
              items: []
            }
          ]
        }
      }
    ])
  })

  it('treats empty markdown links as inert text', () => {
    const parsed = markdownToEditorData('- [x] partager son agenda [](https://example.com)')
    expect(parsed.blocks[0]).toEqual({
      type: 'list',
      data: {
        style: 'checklist',
        items: [
          {
            content: 'partager son agenda [](https://example.com)',
            meta: { checked: true },
            items: []
          }
        ]
      }
    })
  })
})

describe('indented blocks', () => {
  it('parses four-space indented content as code block (not raw)', () => {
    const markdown = `
2026-02-22 test

    [[showcase/folder_with_underscore/note_in_folder.md]]
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(2)
    expect(parsed.blocks[0].type).toBe('paragraph')
    expect(parsed.blocks[1]).toEqual({
      type: 'code',
      data: {
        code: '[[showcase/folder_with_underscore/note_in_folder.md]]',
        language: ''
      }
    })
  })
})

describe('html-like lines', () => {
  it('parses block html markup into html blocks', () => {
    const markdown = `
<h1>hello</h1>

sddsd
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(2)
    expect(parsed.blocks[0].type).toBe('html')
    expect(String(parsed.blocks[0].data.html)).toContain('<h1>hello</h1>')
    expect(parsed.blocks[1].type).toBe('paragraph')
    expect(String(parsed.blocks[1].data.text)).toBe('sddsd')
  })

  it('round-trips multiline html blocks as raw html markdown', () => {
    const markdown = `
<div style="text-align: center;">
<strong>One<br>Two</strong>
</div>
`.trim()
    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0].type).toBe('html')
    expect(editorDataToMarkdown(parsed).trim()).toBe(markdown)
  })
})

describe('blockquote parsing', () => {
  it('keeps multiline quote structure including list lines', () => {
    const markdown = `
> Une citation principale.
>
> Un second paragraphe dans la citation.
>
> - Une liste dans la citation
> - Un second point
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0].type).toBe('quote')
    expect(String(parsed.blocks[0].data.text)).toContain('\n\n')
    expect(String(parsed.blocks[0].data.text)).toContain('- Une liste dans la citation')
  })

  it('round-trips nested quote markers in quote content', () => {
    const markdown = `
> > Citation imbriquée niveau 2
> >
> > > Citation niveau 3
`.trim()

    const parsed = markdownToEditorData(markdown)
    const output = editorDataToMarkdown(parsed)
    expect(output).toContain('> > Citation imbriquée niveau 2')
    expect(output).toContain('> > > Citation niveau 3')
  })
})

describe('markdownToEditorData regressions', () => {
  it('keeps the reduced dashboard sample as one checklist block without paragraph inserts', () => {
    const markdown = `
## Tâches à faire

- [x] Prendre RDV avec la DSI de l'ENS : 2026-03-11
  - [ ] Prendre RDV avec le RSSI de l'ENS : à la suite du rdv
- [x] Préparer[[Projets/JDEV.md|JDEV]] demander aux collègues
  - [ ] S'inscrire sur [https://jdev26.sciencesconf.org/user/createaccount](https://jdev26.sciencesconf.org/user/createaccount)
- [ ] Tickets à faire :
  - [x] partager son agenda avec un usager (comment le retrouver)[](https://jdev26.sciencesconf.org/user/createaccount)
  - [ ] Trouver un autre ticket à faire
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks).toHaveLength(2)
    expect(parsed.blocks[0].type).toBe('header')
    expect(parsed.blocks[1].type).toBe('list')
    expect(((parsed.blocks[1].data as { items: unknown[] }).items)).toHaveLength(3)
  })

  it('keeps the larger dashboard sample free of paragraph blocks inside checklist sections', () => {
    const markdown = `
## Tâches à faire

- [x] Prendre RDV avec la DSI de l'ENS : 2026-03-11
  - [ ] Prendre RDV avec le RSSI de l'ENS : à la suite du rdv
- [x] Préparer[[Projets/JDEV.md|JDEV]] demander aux collègues
  - [ ] S'inscrire sur [https://jdev26.sciencesconf.org/user/createaccount](https://jdev26.sciencesconf.org/user/createaccount)
- [x] Analyser demande disque dur 2To/4To
  - [ ] On ne fait pas : trop de risques, prévenir [[Personnes/Ludovic.md|Ludovic]]
- [ ] Tickets à faire :
  - [x] paramétrer le wifi eduroam sur ma machine
  - [x] partager son agenda avec un usager (comment le retrouver)[](https://jdev26.sciencesconf.org/user/createaccount)
  - [ ] Trouver un autre ticket à faire
- [ ] Préparer fiche de poste ASR (ASI) [[Projets/Recrutement ASR.md|Recrutement ASR]]
- [ ] Préparer fiche de poste développeur Legacy
- [x] Faire météo grist
- [ ] Creuser [[Veille/ADR Architecture Document Record|ADR Architecture Document Record]]

## Premiers pas

## Accès

- [x] Canal dev sur team
- [x] Accès Kanboard
  - [ ] Pas accès à tous les boards
- [x] Accès Omicron RocketChat
- [x] Accès Gitlab
`.trim()

    const parsed = markdownToEditorData(markdown)
    expect(parsed.blocks.map((block) => block.type)).toEqual(['header', 'list', 'header', 'header', 'list'])
  })
})
