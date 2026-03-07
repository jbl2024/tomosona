import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
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

})
