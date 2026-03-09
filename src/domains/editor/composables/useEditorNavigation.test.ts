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

  const holder = document.createElement('div')
  holder.className = 'editor-holder'
  Object.defineProperty(holder, 'clientHeight', { value: 400, configurable: true })
  Object.defineProperty(holder, 'scrollHeight', { value: 1200, configurable: true })
  Object.defineProperty(holder, 'scrollTop', { value: 100, writable: true, configurable: true })
  holder.getBoundingClientRect = () => ({ top: 50, left: 0, right: 800, bottom: 450, width: 800, height: 400, x: 0, y: 50, toJSON: () => ({}) }) as DOMRect
  holder.scrollTo = vi.fn((optionsOrX?: ScrollToOptions | number, _y?: number) => {
    if (typeof optionsOrX === 'number') {
      holder.scrollTop = optionsOrX
      return
    }
    holder.scrollTop = optionsOrX?.top ?? holder.scrollTop
  })

  const dom = document.createElement('div')
  dom.focus = vi.fn()
  holder.appendChild(dom)
  document.body.appendChild(holder)

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
    view: {
      dom,
      coordsAtPos: vi.fn((pos: number) => ({
        top: pos * 10,
        bottom: pos * 10 + 24,
        left: 20,
        right: 120
      }))
    },
    commands: {
      setTextSelection: vi.fn((pos: number) => {
        chainState.selectionPos = pos
        return true
      })
    },
    chain: () => ({
      focus: (pos?: number) => {
        if (typeof pos === 'number') chainState.selectionPos = pos
        return {
          run: () => true,
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

  return {
    editor: editor as unknown as Editor,
    chainState,
    holder,
    coordsAtPos: editor.view.coordsAtPos,
    setTextSelection: editor.commands.setTextSelection,
    focusDom: dom.focus
  }
}

describe('useEditorNavigation', () => {
  it('parses outline from body headings', () => {
    const { editor } = createEditor([
      { pos: 1, node: { type: { name: 'heading' }, attrs: { level: 1 }, textContent: 'Title heading' } },
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
      { level: 1, text: 'Title heading' },
      { level: 2, text: 'Section A' },
      { level: 3, text: 'Section B' }
    ])
  })

  it('reveals heading, snippet, and block anchor', async () => {
    const { editor, chainState, holder, setTextSelection, focusDom } = createEditor([
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
    expect(chainState.scrolled).toBe(false)
    expect(setTextSelection).toHaveBeenCalled()
    expect(focusDom).toHaveBeenCalled()
    expect(holder.scrollTo).toHaveBeenCalled()
    expect(holder.scrollTop).toBeGreaterThanOrEqual(0)
  })

  it('scrolls smoothly and centers the target inside the editor holder', async () => {
    const { editor, holder } = createEditor([
      { pos: 30, node: { type: { name: 'heading' }, attrs: { level: 2 }, textContent: 'Centered Heading' } }
    ])

    const nav = useEditorNavigation({
      getEditor: () => editor,
      emitOutline: () => {},
      normalizeHeadingAnchor: (heading) => heading.trim().toLowerCase(),
      slugifyHeading: (heading) => heading.trim().toLowerCase().replace(/\s+/g, '-'),
      normalizeBlockId: (value) => value.trim().toLowerCase()
    })

    await nav.revealAnchor({ heading: 'centered-heading' })

    expect(holder.scrollTo).toHaveBeenCalledWith({
      top: 160,
      behavior: 'smooth'
    })
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
