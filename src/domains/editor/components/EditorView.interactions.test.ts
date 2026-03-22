import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { SaveNoteResult } from '../../../shared/api/apiTypes'

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

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
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

  it('shows a compact structure label in the gutter for the active block', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const editorRef = ref<unknown>(null)

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            ref: editorRef,
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
            onProperties: () => {},
            onPathRenamed: () => {}
          })
      }
    }))

    app.mount(root)
    await flushUi()

    const setupState = (editorRef.value as { $?: { setupState?: Record<string, any> } })?.$?.setupState
    if (!setupState) throw new Error('Expected EditorView setup state')

    setupState.dragHandleUiState.activeTarget = {
      pos: 1,
      nodeType: 'heading',
      nodeSize: 4,
      canDelete: true,
      canConvert: true,
      text: 'Title',
      attrs: { level: 2 }
    }
    await flushUi()

    expect(root.querySelector('.tomosona-block-structure-label')?.textContent).toBe('H2')

    setupState.dragHandleUiState.activeTarget = null
    await flushUi()

    expect(root.querySelector('.tomosona-block-structure-label')).toBeNull()

    app.unmount()
    document.body.innerHTML = ''
  })

  it('shows the gutter controls when the caret is inside a heading', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const editorRef = ref<unknown>(null)

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            ref: editorRef,
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
            onProperties: () => {},
            onPathRenamed: () => {}
          })
      }
    }))

    app.mount(root)
    await flushUi()

    const setupState = (editorRef.value as { $?: { setupState?: Record<string, any> } })?.$?.setupState
    if (!setupState) throw new Error('Expected EditorView setup state')

    const editor = setupState.renderedEditorsByPath?.['a.md']
    if (!editor) throw new Error('Expected a rendered editor for a.md')

    Object.defineProperty(window, 'scrollBy', {
      configurable: true,
      value: vi.fn()
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn()
    })

    const rectList = () => [{ left: 0, top: 0, right: 40, bottom: 16, width: 40, height: 16 }]
    const rect = () => ({ left: 0, top: 0, right: 40, bottom: 16, width: 40, height: 16 })
    for (const prototype of [Node.prototype, Element.prototype, HTMLElement.prototype, Text.prototype, Range.prototype]) {
      Object.defineProperty(prototype, 'getClientRects', {
        configurable: true,
        value: rectList
      })
      Object.defineProperty(prototype, 'getBoundingClientRect', {
        configurable: true,
        value: rect
      })
    }

    editor.commands.focus()
    editor.commands.setTextSelection(1)
    await flushUi()

    const handle = root.querySelector('.tomosona-drag-handle') as HTMLElement | null
    expect(handle).toBeTruthy()
    expect(handle?.style.visibility).not.toBe('hidden')
    expect(handle?.style.left).not.toBe('0px')
    expect(root.querySelector('.tomosona-block-structure-label')?.textContent).toBe('H1')
    expect(root.querySelector('button[aria-label="Insert below"]')).toBeTruthy()
    expect(root.querySelector('button[aria-label="Open block menu"]')).toBeTruthy()

    let paragraphPos = -1
    editor.state.doc.descendants((node: { type: { name: string } }, pos: number) => {
      if (paragraphPos >= 0) return false
      if (node.type.name !== 'paragraph') return undefined
      paragraphPos = pos + 1
      return false
    })
    expect(paragraphPos).toBeGreaterThan(0)

    editor.commands.setTextSelection(paragraphPos)
    await flushUi()

    const paragraphHandle = root.querySelector('.tomosona-drag-handle') as HTMLElement | null
    expect(paragraphHandle?.style.visibility).not.toBe('hidden')
    expect(paragraphHandle?.style.left).not.toBe('0px')
    expect(root.querySelector('.tomosona-block-structure-label')?.textContent).toBe('P')
    expect(root.querySelector('button[aria-label="Insert below"]')).toBeTruthy()
    expect(root.querySelector('button[aria-label="Open block menu"]')).toBeTruthy()

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

  it('does not surface a false conflict banner during a manual title rename save when a watcher modify lands on the renamed path', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const controls = {
      path: ref('a.md'),
      openPaths: ref(['a.md'])
    }
    const editorRef = ref<any>(null)
    const pendingSave = deferred<SaveNoteResult>()

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            ref: editorRef,
            path: controls.path.value,
            openPaths: controls.openPaths.value,
            readNoteSnapshot: async (path: string) => ({
              path,
              content: '# Title\n\nBody',
              version: { mtimeMs: 1, size: 13 }
            }),
            saveNoteBuffer: async () => pendingSave.promise,
            renameFileFromTitle: async () => ({ path: 'b.md', title: 'Renamed' }),
            loadLinkTargets: async () => ['a.md', 'b.md'],
            loadLinkHeadings: async () => ['H1'],
            loadPropertyTypeSchema: async () => ({}),
            savePropertyTypeSchema: async () => {},
            openLinkTarget: async () => true,
            onStatus: () => {},
            onOutline: () => {},
            onProperties: () => {},
            onPathRenamed: ({ from, to }: { from: string; to: string }) => {
              controls.path.value = controls.path.value === from ? to : controls.path.value
              controls.openPaths.value = controls.openPaths.value.map((value) => value === from ? to : value)
            }
          })
      }
    }))

    app.mount(root)
    await flushUi()

    const titleField = root.querySelector('.editor-title-field') as HTMLElement
    expect(titleField).toBeTruthy()
    titleField.textContent = 'Renamed'
    titleField.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await flushUi()

    const savePromise = editorRef.value.saveNow()
    await flushUi()

    await editorRef.value.applyWorkspaceFsChanges([
      { kind: 'modified', path: 'b.md', is_dir: false, version: { mtimeMs: 2, size: 15 } }
    ])
    await flushUi()

    expect(root.textContent).not.toContain('A newer disk version was detected.')

    pendingSave.resolve({
      ok: true,
      version: { mtimeMs: 3, size: 15 }
    })
    await savePromise
    await flushUi()

    app.unmount()
    document.body.innerHTML = ''
  })

  it('does not surface a false conflict banner when the source path watcher event lands before the manual rename save resolves', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const controls = {
      path: ref('a.md'),
      openPaths: ref(['a.md'])
    }
    const editorRef = ref<any>(null)
    const pendingRename = deferred<{ path: string; title: string }>()
    const pendingSave = deferred<SaveNoteResult>()

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            ref: editorRef,
            path: controls.path.value,
            openPaths: controls.openPaths.value,
            readNoteSnapshot: async (path: string) => ({
              path,
              content: '# Title\n\nBody',
              version: { mtimeMs: 1, size: 13 }
            }),
            saveNoteBuffer: async () => pendingSave.promise,
            renameFileFromTitle: async () => pendingRename.promise,
            loadLinkTargets: async () => ['a.md', 'b.md'],
            loadLinkHeadings: async () => ['H1'],
            loadPropertyTypeSchema: async () => ({}),
            savePropertyTypeSchema: async () => {},
            openLinkTarget: async () => true,
            onStatus: () => {},
            onOutline: () => {},
            onProperties: () => {},
            onPathRenamed: ({ from, to }: { from: string; to: string }) => {
              controls.path.value = controls.path.value === from ? to : controls.path.value
              controls.openPaths.value = controls.openPaths.value.map((value) => value === from ? to : value)
            }
          })
      }
    }))

    app.mount(root)
    await flushUi()

    const titleField = root.querySelector('.editor-title-field') as HTMLElement
    expect(titleField).toBeTruthy()
    titleField.textContent = 'Renamed'
    titleField.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await flushUi()

    const savePromise = editorRef.value.saveNow()
    await flushUi()

    await editorRef.value.applyWorkspaceFsChanges([
      { kind: 'removed', path: 'a.md', is_dir: false }
    ])
    await flushUi()

    pendingRename.resolve({ path: 'b.md', title: 'Renamed' })
    await flushUi()

    pendingSave.resolve({
      ok: true,
      version: { mtimeMs: 3, size: 15 }
    })
    await savePromise
    await flushUi()

    expect(root.textContent).not.toContain('A newer disk version was detected.')

    app.unmount()
    document.body.innerHTML = ''
  })

  it('reloads a clean note only once for duplicate external watcher versions', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const externalReloads = vi.fn()
    let snapshotCallCount = 0
    const readNoteSnapshot = vi.fn(async (path: string) => ({
      path,
      content: '# Title\n\nBody',
      version: snapshotCallCount++ === 0
        ? { mtimeMs: 1, size: 8 }
        : { mtimeMs: 9, size: 12 }
    }))
    const editorRef = ref<any>(null)

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            ref: editorRef,
            path: 'a.md',
            openPaths: ['a.md'],
            readNoteSnapshot,
            saveNoteBuffer: async () => ({ ok: true, version: { mtimeMs: 1, size: 1 } } satisfies SaveNoteResult),
            renameFileFromTitle: async (valuePath: string, title: string) => ({ path: valuePath, title }),
            loadLinkTargets: async () => ['a.md'],
            loadLinkHeadings: async () => ['H1'],
            loadPropertyTypeSchema: async () => ({}),
            savePropertyTypeSchema: async () => {},
            openLinkTarget: async () => true,
            onStatus: () => {},
            onOutline: () => {},
            onProperties: () => {},
            onPathRenamed: () => {},
            onExternalReload: externalReloads
          })
      }
    }))

    app.mount(root)
    await flushUi()
    readNoteSnapshot.mockClear()
    snapshotCallCount = 1

    const duplicateChange = [{ kind: 'modified' as const, path: 'a.md', is_dir: false, version: { mtimeMs: 9, size: 12 } }]
    await editorRef.value.applyWorkspaceFsChanges(duplicateChange)
    await flushUi()
    await editorRef.value.applyWorkspaceFsChanges(duplicateChange)
    await flushUi()

    expect(readNoteSnapshot).toHaveBeenCalledTimes(1)
    expect(externalReloads).toHaveBeenCalledTimes(1)

    app.unmount()
    document.body.innerHTML = ''
  })

})
