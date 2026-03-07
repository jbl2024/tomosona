import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import EditorView from './EditorView.vue'

describe('EditorView smoke wiring', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('mounts safely with empty path and exposes imperative API', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const editorRef = ref<unknown>(null)

    const Harness = defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            ref: editorRef,
            path: '',
            openFile: async () => '',
            saveFile: async () => ({ persisted: true }),
            renameFileFromTitle: async (path: string, title: string) => ({ path, title }),
            loadLinkTargets: async () => [],
            loadLinkHeadings: async () => [],
            loadPropertyTypeSchema: async () => ({}),
            savePropertyTypeSchema: async () => {},
            openLinkTarget: async () => false,
            onStatus: () => {},
            onOutline: () => {},
            onProperties: () => {},
            onPathRenamed: () => {}
          })
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await nextTick()

    const api = editorRef.value as Record<string, unknown> | null
    expect(api).toBeTruthy()
    expect(typeof api?.saveNow).toBe('function')
    expect(typeof api?.reloadCurrent).toBe('function')
    expect(typeof api?.zoomIn).toBe('function')
    expect(typeof api?.getZoom).toBe('function')

    app.unmount()
  })

  it('mounts safely with active path and initializes editor callbacks without setup-order errors', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const Harness = defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            path: 'a.md',
            openPaths: ['a.md'],
            openFile: async () => '# Title\\n\\nBody',
            saveFile: async () => ({ persisted: true }),
            renameFileFromTitle: async (path: string, title: string) => ({ path, title }),
            loadLinkTargets: async () => ['a.md'],
            loadLinkHeadings: async () => ['H1'],
            loadPropertyTypeSchema: async () => ({}),
            savePropertyTypeSchema: async () => {},
            openLinkTarget: async () => true,
            onStatus: () => {},
            onOutline: () => {},
            onProperties: () => {},
            onPathRenamed: () => {}
          })
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await nextTick()

    expect(root.querySelector('.editor-holder')).toBeTruthy()

    app.unmount()
  })
})
