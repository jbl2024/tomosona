import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const { mermaidRender } = vi.hoisted(() => ({
  mermaidRender: vi.fn(async (id: string, source: string) => ({
    svg: `<svg data-render-id="${id}"><text>${source}</text></svg>`
  }))
}))

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: mermaidRender
  }
}))

import EditorView from './EditorView.vue'

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

describe('EditorView interactions contract', () => {
  it('keeps event contract and supports keyboard flow without crashes', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const statusEvents = vi.fn()
    const outlineEvents = vi.fn()
    const propertiesEvents = vi.fn()
    const renameEvents = vi.fn()

    const Harness = defineComponent({
      setup() {
        const path = ref('a.md')
        return () =>
          h(EditorView, {
            path: path.value,
            openPaths: [path.value],
            openFile: async () => '# Title\n\nBody',
            saveFile: async () => ({ persisted: true }),
            renameFileFromTitle: async (valuePath: string, title: string) => ({ path: valuePath, title }),
            loadLinkTargets: async () => ['a.md', 'b.md'],
            loadLinkHeadings: async () => ['H1'],
            loadPropertyTypeSchema: async () => ({}),
            savePropertyTypeSchema: async () => {},
            openLinkTarget: async () => true,
            onStatus: statusEvents,
            onOutline: outlineEvents,
            onProperties: propertiesEvents,
            onPathRenamed: renameEvents
          })
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()

    const holder = root.querySelector('.editor-holder') as HTMLElement
    holder.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    holder.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
    await flushUi()

    expect(statusEvents).toHaveBeenCalled()
    expect(propertiesEvents).toHaveBeenCalled()
    expect(renameEvents).not.toHaveBeenCalled()

    app.unmount()
    document.body.innerHTML = ''
  })

  it('keeps a compact properties row inside the editor flow and expands it on demand', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const propertiesEvents = vi.fn()

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            path: 'a.md',
            openPaths: ['a.md'],
            openFile: async () => '# Title\n\nBody',
            saveFile: async () => ({ persisted: true }),
            renameFileFromTitle: async (valuePath: string, title: string) => ({ path: valuePath, title }),
            loadLinkTargets: async () => ['a.md'],
            loadLinkHeadings: async () => ['H1'],
            loadPropertyTypeSchema: async () => ({}),
            savePropertyTypeSchema: async () => {},
            openLinkTarget: async () => true,
            onStatus: () => {},
            onOutline: () => {},
            onProperties: propertiesEvents,
            onPathRenamed: () => {}
          })
      }
    }))

    app.mount(root)
    await flushUi()

    const holder = root.querySelector('.editor-holder') as HTMLElement
    const panel = root.querySelector('.editor-holder .properties-panel') as HTMLElement
    expect(panel).toBeTruthy()
    expect(holder.contains(panel)).toBe(true)
    expect(panel.textContent).toContain('Properties')

    expect(root.querySelector('.properties-content-wrap')).toBeFalsy()

    const toggle = root.querySelector('.properties-toggle') as HTMLButtonElement
    toggle.click()
    await flushUi()

    expect(root.querySelector('.properties-content-wrap')).toBeTruthy()
    expect(root.textContent).toContain('Structured')
    expect(propertiesEvents).toHaveBeenCalled()
    const title = root.querySelector('.ProseMirror > h1') as HTMLElement
    expect(title).toBeTruthy()
    expect(getComputedStyle(title).marginBottom).not.toBe('0px')

    app.unmount()
    document.body.innerHTML = ''
  })

  it('keeps interaction surface tied to active mounted editor during tab switches', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const path = ref('a.md')

    const Harness = defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            path: path.value,
            openPaths: ['a.md', 'b.md'],
            openFile: async (valuePath: string) => (valuePath === 'a.md' ? '# A\n\nAlpha' : '# B\n\nBeta'),
            saveFile: async () => ({ persisted: true }),
            renameFileFromTitle: async (valuePath: string, title: string) => ({ path: valuePath, title }),
            loadLinkTargets: async () => ['a.md', 'b.md'],
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
    await flushUi()

    const before = root.querySelector('.editor-session-pane[data-active="true"]')
    expect(before?.getAttribute('data-session-path')).toBe('a.md')

    path.value = 'b.md'
    await flushUi()

    const after = root.querySelector('.editor-session-pane[data-active="true"]')
    expect(after?.getAttribute('data-session-path')).toBe('b.md')

    const holder = root.querySelector('.editor-holder') as HTMLElement
    holder.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    holder.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
    await flushUi()

    app.unmount()
    document.body.innerHTML = ''
  })

  it('opens inline find with Cmd/Ctrl+F and supports filtering controls', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            path: 'a.md',
            openPaths: ['a.md'],
            openFile: async () => '# Title\n\nAlpha alpha ALPHA alphabet',
            saveFile: async () => ({ persisted: true }),
            renameFileFromTitle: async (valuePath: string, title: string) => ({ path: valuePath, title }),
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
    }))

    app.mount(root)
    await flushUi()

    const holder = root.querySelector('.editor-holder') as HTMLElement
    holder.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
    await flushUi()

    const input = root.querySelector('[data-editor-find-input="true"]') as HTMLInputElement
    expect(input).toBeTruthy()

    input.value = 'alpha'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()

    expect(root.querySelectorAll('.tomosona-editor-find-match')).toHaveLength(4)

    const buttons = Array.from(root.querySelectorAll('.editor-find-toolbar-btn'))
    const wholeWordButton = buttons.find((button) => button.textContent?.trim() === 'W') as HTMLButtonElement
    const caseButton = buttons.find((button) => button.textContent?.trim() === 'Aa') as HTMLButtonElement
    const nextButton = buttons.find((button) => button.textContent?.trim() === 'Next') as HTMLButtonElement

    wholeWordButton.click()
    await flushUi()
    expect(root.querySelectorAll('.tomosona-editor-find-match')).toHaveLength(3)

    caseButton.click()
    await flushUi()
    expect(root.querySelectorAll('.tomosona-editor-find-match')).toHaveLength(1)

    nextButton.click()
    await flushUi()
    expect(root.querySelector('.editor-find-toolbar-count')?.textContent).toContain('1/1')

    app.unmount()
    document.body.innerHTML = ''
  })

  it('opens the editor-level mermaid preview dialog from a rendered mermaid block', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            path: 'a.md',
            openPaths: ['a.md'],
            openFile: async () => '# Title\n\n```mermaid\nflowchart TD\n  A --> B\n```',
            saveFile: async () => ({ persisted: true }),
            renameFileFromTitle: async (valuePath: string, title: string) => ({ path: valuePath, title }),
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
    }))

    app.mount(root)
    await flushUi()
    await flushUi()

    const zoomButton = Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Zoom') as HTMLButtonElement
    expect(zoomButton).toBeTruthy()

    zoomButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await flushUi()

    expect(root.textContent).toContain('Preview the diagram at full size and export it as SVG.')
    expect(root.querySelector('.editor-mermaid-preview svg')).toBeTruthy()
    expect(mermaidRender).toHaveBeenCalled()

    app.unmount()
    document.body.innerHTML = ''
  })

})
