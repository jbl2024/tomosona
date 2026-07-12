import type { Editor } from '@tiptap/vue-3'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import EditorMinimap from './EditorMinimap.vue'

describe('EditorMinimap', () => {
  it('renders document blocks and follows editor updates', async () => {
    const root = document.createElement('div')
    const scroller = document.createElement('div')
    const editorRoot = document.createElement('div')
    editorRoot.innerHTML = `<div><h2>Heading</h2><p>${'Body text '.repeat(20)}</p><ul><li>Nested item</li></ul></div>`
    vi.spyOn(editorRoot.querySelector('p')!, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 20, top: 20, right: 600, bottom: 92, left: 0, width: 600, height: 72,
      toJSON: () => ({})
    })
    scroller.appendChild(editorRoot)
    document.body.append(root, scroller)

    const handlers = new Map<string, () => void>()
    const editor = {
      view: { dom: editorRoot },
      on: vi.fn((event: string, handler: () => void) => handlers.set(event, handler)),
      off: vi.fn((event: string) => handlers.delete(event))
    }

    const Harness = defineComponent({
      setup: () => () => h(EditorMinimap, { editor: editor as unknown as Editor, scrollElement: scroller })
    })
    const app = createApp(Harness)
    app.mount(root)
    await nextTick()
    await nextTick()

    const initialLineCount = root.querySelectorAll('.editor-minimap-line').length
    expect(initialLineCount).toBeGreaterThan(2)
    expect(root.querySelector('.editor-minimap-line--heading')).toBeTruthy()
    expect(root.querySelector('.editor-minimap-line--list')).toBeTruthy()

    editorRoot.appendChild(document.createElement('p'))
    handlers.get('update')?.()
    await nextTick()
    expect(root.querySelectorAll('.editor-minimap-line')).toHaveLength(initialLineCount + 1)

    app.unmount()
    expect(editor.off).toHaveBeenCalled()
    scroller.remove()
  })
})
