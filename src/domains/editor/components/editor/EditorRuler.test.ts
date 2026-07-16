import StarterKit from '@tiptap/starter-kit'
import { Editor } from '@tiptap/vue-3'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorFindExtension, setEditorFindSearch } from '../../lib/tiptap/extensions/EditorFind'
import EditorRuler from './EditorRuler.vue'

async function flushRuler() {
  await nextTick()
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  await nextTick()
}

describe('EditorRuler', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders headings, links and active search matches, then navigates the track', async () => {
    const root = document.createElement('div')
    const scroller = document.createElement('div')
    const editorRoot = document.createElement('div')
    document.body.append(root, scroller)
    scroller.appendChild(editorRoot)
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1200 }
    })
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400,
      toJSON: () => ({})
    })
    const scrollTo = vi.fn(({ top }: ScrollToOptions) => { scroller.scrollTop = Number(top ?? 0) })
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo

    const editor = new Editor({
      element: editorRoot,
      extensions: [StarterKit, EditorFindExtension],
      content: '<h2>Heading</h2><p>Find <a href="https://example.test">linked text</a> here.</p>'
    })
    vi.spyOn(editor.view, 'coordsAtPos').mockImplementation((pos) => ({
      left: 0,
      right: 0,
      top: pos * 10,
      bottom: pos * 10 + 16
    }))
    const summaries: unknown[] = []
    const app = createApp(defineComponent({
      setup: () => () => h(EditorRuler, {
        editor,
        path: 'note.md',
        scrollElement: scroller,
        visible: true,
        spellcheckEnabled: false,
        onSignalSummary: (summary: unknown) => summaries.push(summary)
      })
    }))
    app.mount(root)
    await flushRuler()

    expect(root.querySelector('.editor-ruler-heading--h2')).toBeTruthy()
    expect(root.querySelectorAll('.editor-ruler-signal--link')).toHaveLength(1)

    setEditorFindSearch(editor, { query: 'Find' })
    await flushRuler()
    expect(root.querySelectorAll('.editor-ruler-signal--find')).toHaveLength(1)
    expect(summaries[summaries.length - 1]).toMatchObject({ path: 'note.md', findActive: true, findCount: 1, linkCount: 1 })

    const ruler = root.querySelector<HTMLElement>('.editor-ruler')!
    Object.defineProperties(ruler, { clientHeight: { configurable: true, value: 400 } })
    ruler.setPointerCapture = vi.fn()
    vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 24, bottom: 400, width: 24, height: 400,
      toJSON: () => ({})
    })
    ruler.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { pointerId: 1, clientY: 300 }))
    expect(scrollTo).toHaveBeenCalled()

    const viewport = root.querySelector<HTMLElement>('.editor-ruler-viewport')!
    Object.defineProperties(viewport, { clientHeight: { configurable: true, value: 80 } })
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 120, top: 120, left: 0, right: 24, bottom: 200, width: 24, height: 80,
      toJSON: () => ({})
    })
    viewport.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { pointerId: 2, clientY: 150 }))
    ruler.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true }), { pointerId: 2, clientY: 220 }))
    expect(scrollTo).toHaveBeenCalledTimes(2)

    ruler.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }))
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1200, behavior: 'auto' })

    app.unmount()
    editor.destroy()
  })
})
