import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/vue-3'
import { useEditorNavigation } from './useEditorNavigation'

type DescNode = {
  type: { name: string }
  attrs: Record<string, unknown>
  textContent: string
  isText?: boolean
  text?: string
}

function createEditor(nodes: Array<{ node: DescNode; pos: number }>) {
  const chainState = {
    selectionPos: -1,
    scrolled: false
  }

  const editor = {
    state: {
      doc: {
        descendants: (fn: (node: DescNode, pos: number) => boolean | void) => {
          for (const entry of nodes) {
            if (fn(entry.node, entry.pos) === false) return
          }
        }
      }
    },
    chain: () => ({
      focus: (pos?: number) => {
        if (typeof pos === 'number') chainState.selectionPos = pos
        return {
          scrollIntoView: () => ({
            run: () => {
              chainState.scrolled = true
              return true
            }
          })
        }
      }
    })
  }

  return { editor: editor as unknown as Editor, chainState }
}

describe('useEditorNavigation', () => {
  it('parses outline excluding virtual title', () => {
    const { editor } = createEditor([
      { pos: 1, node: { type: { name: 'heading' }, attrs: { level: 1, isVirtualTitle: true }, textContent: 'Virtual' } },
      { pos: 8, node: { type: { name: 'heading' }, attrs: { level: 2 }, textContent: 'Section A' } },
      { pos: 18, node: { type: { name: 'heading' }, attrs: { level: 4 }, textContent: 'Section B' } }
    ])

    const nav = useEditorNavigation({
      getEditor: () => editor,
      emitOutline: () => {},
      normalizeHeadingAnchor: (heading) => heading.trim().toLowerCase().replace(/\s+/g, '-'),
      slugifyHeading: (heading) => heading.trim().toLowerCase().replace(/\s+/g, '-'),
      normalizeBlockId: (value) => value.trim().toLowerCase()
    })

    expect(nav.parseOutlineFromDoc()).toEqual([
      { level: 2, text: 'Section A' },
      { level: 3, text: 'Section B' }
    ])
  })

  it('reveals heading, snippet, and block anchor', async () => {
    const { editor, chainState } = createEditor([
      { pos: 2, node: { type: { name: 'heading' }, attrs: { level: 2 }, textContent: 'Roadmap' } },
      { pos: 12, node: { type: { name: 'paragraph' }, attrs: {}, textContent: '', isText: true, text: 'alpha beta gamma ^task-12' } }
    ])

    const nav = useEditorNavigation({
      getEditor: () => editor,
      emitOutline: () => {},
      normalizeHeadingAnchor: (heading) => heading.trim().toLowerCase(),
      slugifyHeading: (heading) => heading.trim().toLowerCase(),
      normalizeBlockId: (value) => value.trim().toLowerCase().replace(/^\^+/, '')
    })

    await nav.revealOutlineHeading(0)
    expect(chainState.selectionPos).toBe(3)

    await nav.revealSnippet('beta')
    expect(chainState.selectionPos).toBeGreaterThan(0)

    const byHeading = await nav.revealAnchor({ heading: 'roadmap' })
    expect(byHeading).toBe(true)

    const byBlock = await nav.revealAnchor({ blockId: 'task-12' })
    expect(byBlock).toBe(true)
    expect(chainState.scrolled).toBe(true)
  })

  it('debounces outline emission', async () => {
    vi.useFakeTimers()
    const emitOutline = vi.fn()
    const { editor } = createEditor([
      { pos: 8, node: { type: { name: 'heading' }, attrs: { level: 2 }, textContent: 'Section A' } }
    ])
    const nav = useEditorNavigation({
      getEditor: () => editor,
      emitOutline,
      normalizeHeadingAnchor: (heading) => heading,
      slugifyHeading: (heading) => heading,
      normalizeBlockId: (value) => value
    })

    nav.emitOutlineSoon()
    nav.emitOutlineSoon()
    await vi.advanceTimersByTimeAsync(150)

    expect(emitOutline).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
