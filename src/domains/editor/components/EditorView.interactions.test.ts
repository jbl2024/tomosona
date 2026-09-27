import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { TextSelection } from '@tiptap/pm/state'
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
  // Mount and load callbacks update gutter geometry on the next paint frame.
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  await nextTick()
}

async function flushMicrotasks() {
  await nextTick()
  await Promise.resolve()
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
  const rect = () => ({
    left: 0,
    top: 0,
    right: 40,
    bottom: 16,
    width: 40,
    height: 16,
    x: 0,
    y: 0,
    toJSON: () => ({})
  })

  const rectList = () => [rect()]

  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {}
  }
  if (!HTMLElement.prototype.scrollTo) {
    HTMLElement.prototype.scrollTo = () => {}
  }
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

  it('opens the @ menu and inserts a macro in the mounted editor', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const editorRef = ref<unknown>(null)

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            ref: editorRef,
            path: 'main.md',
            openPaths: ['main.md'],
            openFile: async () => 'Draft @title',
            saveFile: async () => ({ persisted: true }),
            renameFileFromTitle: async (valuePath: string, title: string) => ({ path: valuePath, title }),
            loadLinkTargets: async () => ['main.md'],
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
    const editor = setupState.renderedEditorsByPath?.['main.md']
    if (!editor) throw new Error('Expected mounted main editor')
    const interactionRuntime = setupState.interactionRuntime as {
      markAtActivatedByUser: () => void
      syncAtMenuFromSelection: () => void
      insertAtMacro: (item: { id: string; replacement: string }) => boolean
      atOpen: { value: boolean }
      visibleAtMacros: { value: Array<{ id: string; replacement: string }> }
    }

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, Math.max(1, editor.state.doc.content.size - 1))))
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: '@', bubbles: true, cancelable: true }))
    interactionRuntime.markAtActivatedByUser()
    interactionRuntime.syncAtMenuFromSelection()
    await flushUi()

    expect(interactionRuntime.atOpen.value).toBe(true)
    expect(interactionRuntime.visibleAtMacros.value.map((item) => item.id)).toContain('title')

    const titleButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Title')
    ) as HTMLButtonElement | undefined
    if (!titleButton) throw new Error('Expected @ Title macro button')

    titleButton.click()
    await flushUi()

    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\0')
    expect(text).toContain('Draft main')
    expect(text).not.toContain('@')

    app.unmount()
    document.body.innerHTML = ''
  })

  it('renders gutter toolbar controls for the active block', async () => {
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
    const holder = root.querySelector('.editor-holder') as HTMLElement
    Object.defineProperty(holder, 'clientWidth', {
      configurable: true,
      value: 400
    })
    const blockAndTable = setupState.chromeRuntime.blockAndTable
    const layout = setupState.chromeRuntime.layout
    layout.gutterHitboxStyle.value = {
      position: 'absolute',
      top: '0',
      left: '0px',
      bottom: '0',
      width: '240px'
    }
    blockAndTable.blockGutterAnchorRect.value = { left: 16, top: 20, width: 40, height: 16 }
    blockAndTable.blockGutterContentFocused.value = true

    const headingTarget = {
      pos: 1,
      nodeType: 'heading',
      nodeSize: 4,
      canDelete: true,
      canConvert: true,
      text: 'Title',
      attrs: { level: 1 }
    }
    blockAndTable.blockGutterTarget.value = headingTarget
    blockAndTable.blockMenuTarget.value = headingTarget
    await flushUi()

    const handle = root.querySelector('.tomosona-block-gutter') as HTMLElement | null
    expect(handle).toBeTruthy()
    expect(handle?.style.left).not.toBe('')
    expect(handle?.style.top).not.toBe('')
    expect(root.querySelector('.tomosona-block-structure-label')?.textContent).toBe('H1')
    expect(root.querySelector('button[aria-label="Insert below"]')).toBeTruthy()
    expect(root.querySelector('button[aria-label="Open block menu"]')).toBeTruthy()

    const menuButton = root.querySelector('button[aria-label="Open block menu"]') as HTMLButtonElement
    menuButton.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    await flushMicrotasks()
    expect(root.querySelector('.tomosona-block-gutter')).toBeTruthy()

    app.unmount()
    document.body.innerHTML = ''
  })

  it('keeps the gutter toolbar rendered while the block menu is open', async () => {
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
    try {
      await flushUi()

      const setupState = (editorRef.value as { $?: { setupState?: Record<string, any> } })?.$?.setupState
      if (!setupState) throw new Error('Expected EditorView setup state')
      const blockAndTable = setupState.chromeRuntime.blockAndTable
      const blockTarget = {
        pos: 1,
        nodeType: 'paragraph',
        nodeSize: 4,
        canDelete: true,
        canConvert: true,
        text: 'one',
        attrs: {}
      }
      blockAndTable.blockGutterTarget.value = blockTarget
      blockAndTable.blockMenuTarget.value = blockTarget
      blockAndTable.blockGutterAnchorRect.value = { left: 16, top: 20, width: 40, height: 16 }
      blockAndTable.blockGutterContentFocused.value = true
      await flushUi()

      expect(root.querySelector('.tomosona-block-gutter')).toBeTruthy()

      const menuButton = root.querySelector('button[aria-label="Open block menu"]') as HTMLButtonElement
      menuButton.click()
      await flushUi()

      expect(document.body.querySelector('.tomosona-block-menu')).toBeTruthy()
      expect(root.querySelector('.tomosona-block-gutter')).toBeTruthy()
    } finally {
      app.unmount()
      document.body.innerHTML = ''
    }
  })

  it('renders editor chrome inside a narrow split-style pane', async () => {
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
    try {
      await flushUi()

      const setupState = (editorRef.value as { $?: { setupState?: Record<string, any> } })?.$?.setupState
      if (!setupState) throw new Error('Expected EditorView setup state')

      const holder = root.querySelector('.editor-holder') as HTMLElement
      Object.defineProperty(holder, 'clientWidth', {
        configurable: true,
        value: 180
      })
      Object.defineProperty(holder, 'scrollLeft', {
        configurable: true,
        value: 0
      })

      const chromeRuntime = setupState.chromeRuntime as {
        toolbars: {
          inlineFormatToolbar: {
            formatToolbarOpen: { value: boolean }
            formatToolbarLeft: { value: number }
            formatToolbarTop: { value: number }
          }
        }
        blockAndTable: {
          blockGutterAnchorRect: { value: { left: number; top: number; width: number; height: number } | null }
          blockGutterContentFocused: { value: boolean }
          blockGutterTarget: { value: unknown | null }
          blockMenuTarget: { value: unknown | null }
        }
        layout: {
          gutterHitboxStyle: { value: { position: string; top: string; left: string; bottom: string; width: string } }
        }
      }
      chromeRuntime.layout.gutterHitboxStyle.value = {
        position: 'absolute',
        top: '0',
        left: '0px',
        bottom: '0',
        width: '64px'
      }

      const blockTarget = {
        pos: 1,
        nodeType: 'paragraph',
        nodeSize: 4,
        canDelete: true,
        canConvert: true,
        text: 'Body',
        attrs: {}
      }

      chromeRuntime.toolbars.inlineFormatToolbar.formatToolbarOpen.value = true
      chromeRuntime.toolbars.inlineFormatToolbar.formatToolbarLeft.value = 90
      chromeRuntime.toolbars.inlineFormatToolbar.formatToolbarTop.value = 52
      chromeRuntime.blockAndTable.blockGutterAnchorRect.value = { left: 16, top: 20, width: 40, height: 16 }
      chromeRuntime.blockAndTable.blockGutterContentFocused.value = true
      chromeRuntime.blockAndTable.blockGutterTarget.value = blockTarget
      chromeRuntime.blockAndTable.blockMenuTarget.value = blockTarget
      await flushUi()

      const gutterToolbar = root.querySelector('.tomosona-block-gutter') as HTMLElement
      expect(gutterToolbar).toBeTruthy()
      expect(root.querySelector('.tomosona-block-structure-label')).toBeFalsy()
      expect(chromeRuntime.toolbars.inlineFormatToolbar.formatToolbarLeft.value).toBeGreaterThanOrEqual(0)
      expect(chromeRuntime.toolbars.inlineFormatToolbar.formatToolbarLeft.value).toBeLessThanOrEqual(180)
      expect(Number.parseFloat(gutterToolbar.style.left)).toBeGreaterThanOrEqual(0)
      expect(Number.parseFloat(gutterToolbar.style.left)).toBeLessThanOrEqual(180)
    } finally {
      app.unmount()
      document.body.innerHTML = ''
    }
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

  it('restores an embedded note inline and removes the embed block from the current note', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const editorRef = ref<any>(null)
    const readNoteSnapshot = vi.fn(async (path: string) => {
      if (path === 'main.md') {
        return {
          path,
          content: '# Main\n\n![[notes/alpha]]\n\nAfter',
          version: { mtimeMs: 1, size: 31 }
        }
      }
      if (path === '/vault/notes/alpha.md') {
        return {
          path,
          content: '---\ntitle: Alpha\n---\n# Alpha\n\nRestored body',
          version: { mtimeMs: 2, size: 44 }
        }
      }
      return {
        path,
        content: '',
        version: { mtimeMs: 0, size: 0 }
      }
    })
    const saveFile = vi.fn(async () => ({ persisted: true }))

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            ref: editorRef,
            path: 'main.md',
            workspacePath: '/vault',
            openPaths: ['main.md'],
            readNoteSnapshot,
            saveFile,
            renameFileFromTitle: async (valuePath: string, title: string) => ({ path: valuePath, title }),
            loadLinkTargets: async () => ['main.md', 'notes/alpha'],
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
    const editor = setupState.renderedEditorsByPath?.['main.md']
    if (!editor) throw new Error('Expected mounted main editor')

    const restoreButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.getAttribute('aria-label') === 'Restore inline'
    ) as HTMLButtonElement | undefined
    if (!restoreButton) throw new Error('Expected restore inline button')

    restoreButton.click()
    await flushUi()
    await flushUi()

    const serialized = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\0')
    expect(serialized).toContain('Alpha')
    expect(serialized).toContain('Restored body')
    expect(serialized).not.toContain('notes/alpha')

    let hasEmbedNode = false
    editor.state.doc.descendants((node: any) => {
      if (node.type?.name === 'noteEmbedBlock') {
        hasEmbedNode = true
        return false
      }
      return true
    })
    expect(hasEmbedNode).toBe(false)
    expect(saveFile).toHaveBeenCalled()

    app.unmount()
    document.body.innerHTML = ''
  })

  it('replaces the misspelled word in the mounted editor when the spellcheck suggestion handler runs', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const editorRef = ref<any>(null)

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            ref: editorRef,
            path: 'spellcheck.md',
            openPaths: ['spellcheck.md'],
            openFile: async () => 'orthografe',
            saveFile: async () => ({ persisted: true }),
            renameFileFromTitle: async (valuePath: string, title: string) => ({ path: valuePath, title }),
            loadLinkTargets: async () => ['spellcheck.md'],
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
    const chromeRuntime = setupState.chromeRuntime as {
      spellcheck: {
        open: { value: boolean }
        range: { value: { from: number; to: number } | null }
        word: { value: string }
        selectSuggestion: (suggestion: string) => void
      }
      layout: {
        renderedEditor: { value: any }
      }
    }
    const editor = setupState.renderedEditorsByPath?.['spellcheck.md']
    if (!editor) throw new Error('Expected mounted spellcheck editor')
    expect(chromeRuntime.layout.renderedEditor.value).toBe(editor)

    const textNode: { from: number; to: number; text: string } = (() => {
      let result: { from: number; to: number; text: string } | null = null
      editor.state.doc.descendants((node: any, pos: number) => {
        if (result || !node.isText || !node.text) return true
        const from = pos + 1
        result = { from, to: from + node.text.length, text: node.text }
        return false
      })
      if (!result) throw new Error('Expected a text node in the editor document')
      return result
    })()
    const dispatchSpy = vi.spyOn(editor.view, 'dispatch')

    chromeRuntime.spellcheck.open.value = true
    chromeRuntime.spellcheck.range.value = { from: textNode.from, to: textNode.to }
    chromeRuntime.spellcheck.word.value = textNode.text
    chromeRuntime.spellcheck.selectSuggestion('orthographe')
    await flushUi()

    expect(dispatchSpy).toHaveBeenCalled()
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\0')).toContain('orthographe')
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\0')).not.toContain('orthografe')

    app.unmount()
    document.body.innerHTML = ''
  })

  it('replaces the misspelled word when a spellcheck suggestion button is clicked', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const editorRef = ref<any>(null)

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            ref: editorRef,
            path: 'spellcheck.md',
            openPaths: ['spellcheck.md'],
            openFile: async () => 'orthografe',
            saveFile: async () => ({ persisted: true }),
            renameFileFromTitle: async (valuePath: string, title: string) => ({ path: valuePath, title }),
            loadLinkTargets: async () => ['spellcheck.md'],
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
    const chromeRuntime = setupState.chromeRuntime as {
      spellcheck: {
        open: { value: boolean }
        range: { value: { from: number; to: number } | null }
        word: { value: string }
        suggestions: { value: string[] }
      }
      layout: {
        renderedEditor: { value: any }
      }
    }
    const editor = setupState.renderedEditorsByPath?.['spellcheck.md']
    if (!editor) throw new Error('Expected mounted spellcheck editor')
    expect(chromeRuntime.layout.renderedEditor.value).toBe(editor)

    const textNode: { from: number; to: number; text: string } = (() => {
      let result: { from: number; to: number; text: string } | null = null
      editor.state.doc.descendants((node: any, pos: number) => {
        if (result || !node.isText || !node.text) return true
        const from = pos + 1
        result = { from, to: from + node.text.length, text: node.text }
        return false
      })
      if (!result) throw new Error('Expected a text node in the editor document')
      return result
    })()

    chromeRuntime.spellcheck.open.value = true
    chromeRuntime.spellcheck.range.value = { from: textNode.from, to: textNode.to }
    chromeRuntime.spellcheck.word.value = textNode.text
    chromeRuntime.spellcheck.suggestions.value = ['orthographe']
    await flushUi()

    const suggestionButton = Array.from(document.body.querySelectorAll('.tomosona-spellcheck-menu button')).find((button) =>
      button.textContent?.toLowerCase().includes('orthographe')
    ) as HTMLButtonElement | undefined
    if (!suggestionButton) throw new Error('Expected a spellcheck suggestion button')

    suggestionButton.click()
    await flushUi()

    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\0')).toContain('orthographe')
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\0')).not.toContain('orthografe')

    app.unmount()
    document.body.innerHTML = ''
  })

  it('replaces the misspelled word when a spellcheck suggestion is chosen on mouse pointerdown', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const editorRef = ref<any>(null)

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorView, {
            ref: editorRef,
            path: 'spellcheck.md',
            openPaths: ['spellcheck.md'],
            openFile: async () => 'orthografe',
            saveFile: async () => ({ persisted: true }),
            renameFileFromTitle: async (valuePath: string, title: string) => ({ path: valuePath, title }),
            loadLinkTargets: async () => ['spellcheck.md'],
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
    const chromeRuntime = setupState.chromeRuntime as {
      spellcheck: {
        open: { value: boolean }
        range: { value: { from: number; to: number } | null }
        word: { value: string }
        suggestions: { value: string[] }
      }
      layout: {
        renderedEditor: { value: any }
      }
    }
    const editor = setupState.renderedEditorsByPath?.['spellcheck.md']
    if (!editor) throw new Error('Expected mounted spellcheck editor')
    expect(chromeRuntime.layout.renderedEditor.value).toBe(editor)

    const textNode: { from: number; to: number; text: string } = (() => {
      let result: { from: number; to: number; text: string } | null = null
      editor.state.doc.descendants((node: any, pos: number) => {
        if (result || !node.isText || !node.text) return true
        const from = pos + 1
        result = { from, to: from + node.text.length, text: node.text }
        return false
      })
      if (!result) throw new Error('Expected a text node in the editor document')
      return result
    })()

    chromeRuntime.spellcheck.open.value = true
    chromeRuntime.spellcheck.range.value = { from: textNode.from, to: textNode.to }
    chromeRuntime.spellcheck.word.value = textNode.text
    chromeRuntime.spellcheck.suggestions.value = ['orthographe']
    await flushUi()

    const suggestionButton = Array.from(document.body.querySelectorAll('.tomosona-spellcheck-menu button')).find((button) =>
      button.textContent?.toLowerCase().includes('orthographe')
    ) as HTMLButtonElement | undefined
    if (!suggestionButton) throw new Error('Expected a spellcheck suggestion button')

    suggestionButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    suggestionButton.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }))
    suggestionButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushUi()

    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\0')).toContain('orthographe')
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\0')).not.toContain('orthografe')

    app.unmount()
    document.body.innerHTML = ''
  })

})
