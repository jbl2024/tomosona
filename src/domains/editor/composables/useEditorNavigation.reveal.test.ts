import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Node, mergeAttributes } from '@tiptap/core'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import type { JSONContent } from '@tiptap/vue-3'
import { useEditorNavigation } from './useEditorNavigation'
import {
  PASSAGE_HIGHLIGHT_CLASS,
  PassageHighlightExtension
} from '../lib/tiptap/extensions/PassageHighlight'
import { CodeBlockNode } from '../lib/tiptap/extensions/CodeBlockNode'

/**
 * Mirrors the real CalloutNode schema (block atom whose text lives in the
 * `message` attribute) without the Vue node view, which needs an app
 * context. The reveal logic depends on the schema, not on the view.
 */
const TestCalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      kind: { default: 'NOTE' },
      message: { default: '' }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-callout-node]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout-node': 'true' })]
  }
})

const editors: Editor[] = []
const holders: HTMLElement[] = []

function createFixtureEditor(content: JSONContent) {
  const holder = document.createElement('div')
  holder.className = 'editor-holder'
  holder.scrollTo = vi.fn()
  Object.defineProperty(holder, 'clientHeight', { value: 600, configurable: true })
  Object.defineProperty(holder, 'scrollHeight', { value: 4000, configurable: true })
  Object.defineProperty(holder, 'scrollTop', { value: 0, writable: true, configurable: true })
  holder.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  const element = document.createElement('div')
  holder.appendChild(element)
  document.body.appendChild(holder)
  holders.push(holder)

  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      TestCalloutNode,
      CodeBlockNode,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      PassageHighlightExtension
    ],
    content
  })
  // jsdom text nodes lack getClientRects; coordinates only feed the scroll math.
  editor.view.coordsAtPos = (pos: number) => ({
    top: pos * 10,
    bottom: pos * 10 + 24,
    left: 20,
    right: 120
  }) as never
  editors.push(editor)
  return { editor, holder }
}

function createNav(editor: Editor) {
  return useEditorNavigation({
    getEditor: () => editor,
    emitOutline: () => {},
    normalizeHeadingAnchor: (heading) => heading.trim().toLowerCase(),
    slugifyHeading: (heading) => heading.trim().toLowerCase().replace(/\s+/g, '-'),
    normalizeBlockId: (value) => value.trim().toLowerCase()
  })
}

function highlightElement(editor: Editor): Element | null {
  return editor.view.dom.querySelector(`.${PASSAGE_HIGHLIGHT_CLASS}`)
}

/** Joins all highlight spans: whole-node ranges are painted as two adjacent spans. */
function highlightText(editor: Editor): string {
  return Array.from(editor.view.dom.querySelectorAll(`.${PASSAGE_HIGHLIGHT_CLASS}`))
    .map((element) => element.textContent ?? '')
    .join('')
}

/** Long intro so reveal targets sit deep inside the document, off-screen. */
function fillerParagraph(index: number): JSONContent {
  return {
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: `Introduction ${index}: contenu de remplissage pour pousser les cibles hors de la zone visible de l'editeur.`
      }
    ]
  }
}

function buildDoc(): JSONContent {
  return {
    type: 'doc',
    content: [
      ...Array.from({ length: 8 }, (_, index) => fillerParagraph(index)),
      {
        type: 'callout',
        attrs: {
          kind: 'TIP',
          message: 'Astuce: la granularite fine des notes atomiques aide a creer des liens pertinents.'
        }
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Colonne' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Valeur' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Granularite fine du tableau ici' }] }
                ]
              },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Autre' }] }] }
            ]
          }
        ]
      },
      {
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [{ type: 'text', text: 'const granularite = "fine dans le code source"' }]
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Paragraphe final avec la granularite mentionnee une derniere fois.' }]
      }
    ]
  }
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  holders.splice(0).forEach((holder) => holder.remove())
})

describe('useEditorNavigation reveal across block types', () => {
  it('reveals and highlights a phrase inside a callout', async () => {
    const { editor, holder } = createFixtureEditor(buildDoc())
    const nav = createNav(editor)

    const revealed = await nav.revealSnippet('...la <b>granularite fine des notes</b> atomiques...')

    expect(revealed).toBe(true)
    expect(editor.state.selection.from).toBeGreaterThan(10)
    expect(holder.scrollTo).toHaveBeenCalled()
    // The callout is an atom: the highlight decorates its node element.
    const highlighted = highlightElement(editor)
    expect(highlighted?.getAttribute('data-callout-node')).toBe('true')
  })

  it('reveals and highlights a phrase inside a table cell', async () => {
    const { editor, holder } = createFixtureEditor(buildDoc())
    const nav = createNav(editor)

    const revealed = await nav.revealSnippet('...<b>Granularite fine du tableau</b> ici...')

    expect(revealed).toBe(true)
    expect(editor.state.selection.from).toBeGreaterThan(10)
    expect(holder.scrollTo).toHaveBeenCalled()
    expect(highlightElement(editor)).not.toBeNull()
    expect(highlightText(editor)).toContain('Granularite fine du tableau')
  })

  it('reveals and highlights a phrase inside a code block', async () => {
    const { editor, holder } = createFixtureEditor(buildDoc())
    const nav = createNav(editor)

    const revealed = await nav.revealSnippet('...<b>fine dans le code</b> source...')

    expect(revealed).toBe(true)
    expect(editor.state.selection.from).toBeGreaterThan(10)
    expect(holder.scrollTo).toHaveBeenCalled()
    const highlighted = highlightElement(editor)
    expect(highlighted).not.toBeNull()
    expect(highlighted?.textContent).toContain('fine dans le code')
  })

  it('replaces the highlight on successive searches', async () => {
    const { editor } = createFixtureEditor(buildDoc())
    const nav = createNav(editor)

    const firstPos = editor.state.selection.from
    expect(await nav.revealSnippet('<b>Introduction 2</b>')).toBe(true)
    expect(highlightText(editor)).toContain('Introduction 2')

    expect(await nav.revealSnippet('<b>Granularite fine du tableau</b>')).toBe(true)
    expect(highlightText(editor)).toContain('Granularite fine du tableau')
    expect(editor.state.selection.from).toBeGreaterThan(firstPos)

    expect(await nav.revealSnippet('<b>granularite fine des notes</b>')).toBe(true)
    expect(highlightElement(editor)?.getAttribute('data-callout-node')).toBe('true')

    expect(await nav.revealSnippet('cette phrase n existe pas ici')).toBe(false)
  })

  it('targets the occurrence whose surrounding context matches the snippet window', async () => {
    // The index stores raw markdown: the snippet window keeps `**bold**`
    // syntax that the rendered document does not show, so only the short
    // highlighted segment matches verbatim. Context must pick the right of
    // the two occurrences.
    const { editor } = createFixtureEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Premiere zone: la granularite compte peu ici.' }]
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'favorise des ' },
            { type: 'text', text: 'granularite', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' eclaircit les notes atomiques.' }
          ]
        }
      ]
    })
    const nav = createNav(editor)

    const revealed = await nav.revealSnippet('...favorise des **<b>granularite</b>** eclaircit les notes...')

    expect(revealed).toBe(true)
    // The snippet window points at the second occurrence, not the first:
    // the first paragraph's match sits before position 50, the second after.
    const selection = editor.state.selection.from
    expect(selection).toBeGreaterThan(50)
    expect(highlightText(editor)).toContain('granularite')
  })
})
