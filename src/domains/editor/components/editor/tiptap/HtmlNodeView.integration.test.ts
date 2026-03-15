import StarterKit from '@tiptap/starter-kit'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { HtmlNode } from '../../../lib/tiptap/extensions/HtmlNode'

const editors: Editor[] = []
const apps: Array<ReturnType<typeof createApp>> = []

async function flushEditor() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await new Promise<void>((resolve) => {
    let remainingFrames = 8
    const step = () => {
      remainingFrames -= 1
      if (remainingFrames <= 0) {
        resolve()
        return
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
  await nextTick()
}

function createEditorHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        horizontalRule: false
      }),
      HtmlNode
    ],
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph'
        }
      ]
    }
  })

  editors.push(editor)
  const app = createApp(defineComponent({
    setup() {
      return () => h(EditorContent, { editor })
    }
  }))
  app.mount(root)
  apps.push(app)
  return { editor, root, app }
}

afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount())
  editors.splice(0).forEach((editor) => editor.destroy())
  document.body.innerHTML = ''
})

describe('HtmlNode integration focus', () => {
  it('focuses the html textarea and places caret inside the template after slash insertion', async () => {
    const { editor, root } = createEditorHarness()
    editor.commands.focus('end')
    const inserted = editor.commands.insertContent({
      type: 'htmlBlock',
      attrs: {
        html: '<div>\n  \n</div>',
        autoEdit: true
      }
    })
    expect(inserted).toBe(true)

    await flushEditor()

    const htmlNode = root.querySelector('.tomosona-html-node') as HTMLElement | null
    const textarea = root.querySelector('.tomosona-html-textarea') as HTMLTextAreaElement | null
    expect(htmlNode).toBeTruthy()
    expect(textarea).toBeTruthy()
    expect(document.activeElement).toBe(textarea)
    expect(textarea?.selectionStart).toBe('<div>\n  '.length)
    expect(textarea?.selectionEnd).toBe('<div>\n  '.length)
  })
})
