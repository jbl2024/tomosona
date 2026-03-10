import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import EditorMermaidPreviewDialog from './EditorMermaidPreviewDialog.vue'

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

describe('EditorMermaidPreviewDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders large preview content and emits actions', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const closeEvents: string[] = []
    const exportEvents: string[] = []
    const open = ref(true)

    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorMermaidPreviewDialog, {
          visible: open.value,
          svg: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg>',
          exportError: '',
          onClose: () => {
            open.value = false
            closeEvents.push('close')
          },
          onExportSvg: (previewSvg: SVGElement | null) => exportEvents.push(previewSvg?.tagName ?? 'svg:none'),
          onExportPng: () => exportEvents.push('png')
        })
      }
    }))

    app.mount(root)
    await flushUi()

    expect(root.textContent).toContain('Preview the diagram at full size and export it as SVG or PNG.')
    expect(root.querySelector('.editor-mermaid-preview svg')).toBeTruthy()

    const buttons = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[]
    buttons.find((button) => button.textContent?.includes('Export SVG'))?.click()
    buttons.find((button) => button.textContent?.includes('Export PNG'))?.click()
    buttons.find((button) => button.textContent?.includes('Close'))?.click()
    await flushUi()

    expect(exportEvents).toEqual(['svg', 'png'])
    expect(closeEvents).toEqual(['close'])
    app.unmount()
  })
})
