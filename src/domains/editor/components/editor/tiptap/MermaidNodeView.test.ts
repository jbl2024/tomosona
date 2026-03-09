import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mermaidInitialize, mermaidRender } = vi.hoisted(() => ({
  mermaidInitialize: vi.fn(),
  mermaidRender: vi.fn<(id: string, code: string) => Promise<{ svg: string }>>()
}))
const { beginHeavyRender, endHeavyRender } = vi.hoisted(() => ({
  beginHeavyRender: vi.fn<(scope?: string) => string>(),
  endHeavyRender: vi.fn<(token: string) => void>()
}))

vi.mock('mermaid', () => ({
  default: {
    initialize: mermaidInitialize,
    render: mermaidRender
  }
}))
vi.mock('../../../lib/tiptap/renderStabilizer', () => ({
  beginHeavyRender,
  endHeavyRender
}))

import MermaidNodeView from './MermaidNodeView.vue'

type FontEventType = 'loadingdone' | 'loadingerror'

type MockFontFaceSet = {
  ready: Promise<unknown>
  addEventListener: (type: FontEventType, listener: EventListener) => void
  removeEventListener: (type: FontEventType, listener: EventListener) => void
  dispatch: (type: FontEventType) => void
}

async function flush() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createMockFonts(ready: Promise<unknown> = Promise.resolve()): MockFontFaceSet {
  const listeners = new Map<FontEventType, Set<EventListener>>([
    ['loadingdone', new Set()],
    ['loadingerror', new Set()]
  ])

  return {
    ready,
    addEventListener(type, listener) {
      listeners.get(type)?.add(listener)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatch(type) {
      const event = new Event(type)
      for (const listener of listeners.get(type) ?? []) {
        listener(event)
      }
    }
  }
}

function mountHarness(options?: {
  editable?: boolean
  initialCode?: string
  confirmReplace?: (payload: { templateLabel: string }) => Promise<boolean>
}) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const code = ref(options?.initialCode ?? 'flowchart TD\n  A --> B')
  const editable = options?.editable ?? true
  const updateAttributes = vi.fn((attrs: Record<string, unknown>) => {
    if (typeof attrs.code === 'string') {
      code.value = attrs.code
    }
  })

  const HarnessComponent = defineComponent({
    setup() {
      return () => h(MermaidNodeView, {
        node: { attrs: { code: code.value } },
        updateAttributes,
        editor: { isEditable: editable },
        extension: { options: { confirmReplace: options?.confirmReplace } }
      })
    }
  })

  const app = createApp(HarnessComponent)
  app.provide('onDragStart', () => {})
  app.provide('decorationClasses', ref(''))
  app.mount(root)

  return { app, root, code, updateAttributes }
}

describe('MermaidNodeView', () => {
  let originalFonts: PropertyDescriptor | undefined
  let mockFonts: MockFontFaceSet

  beforeEach(() => {
    originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
    mockFonts = createMockFonts()
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: mockFonts
    })
    mermaidInitialize.mockReset()
    mermaidRender.mockReset()
    beginHeavyRender.mockReset()
    endHeavyRender.mockReset()
    mermaidRender.mockImplementation(async (id, source) => ({
      svg: `<svg data-render-id="${id}"><text>${source}</text></svg>`
    }))
    beginHeavyRender.mockImplementation(() => `token-${beginHeavyRender.mock.calls.length + 1}`)
    ;(window as typeof window & { __tomosonaMermaidRuntime?: unknown }).__tomosonaMermaidRuntime = undefined
  })

  afterEach(() => {
    if (originalFonts) {
      Object.defineProperty(document, 'fonts', originalFonts)
    } else {
      Reflect.deleteProperty(document, 'fonts')
    }
    document.documentElement.classList.remove('dark')
    document.documentElement.removeAttribute('data-theme')
    document.body.innerHTML = ''
  })

  it('renders preview from mermaid source and initializes once', async () => {
    const harness = mountHarness({ initialCode: 'flowchart TD\n  A --> B' })
    await flush()

    expect(mermaidInitialize).toHaveBeenCalledTimes(1)
    expect(mermaidInitialize).toHaveBeenCalledWith(expect.objectContaining({
      theme: 'base',
      darkMode: false,
      themeVariables: expect.objectContaining({
        primaryColor: '#ede9fe',
        primaryBorderColor: '#a78bfa'
      })
    }))
    expect(mermaidRender).toHaveBeenCalledTimes(1)
    expect(beginHeavyRender).toHaveBeenCalledTimes(1)
    expect(endHeavyRender).toHaveBeenCalledTimes(1)
    expect(harness.root.querySelector('.tomosona-mermaid-preview svg')).toBeTruthy()

    harness.app.unmount()
  })

  it('reconfigures mermaid when the app theme changes', async () => {
    const harness = mountHarness({ initialCode: 'flowchart TD\n  A --> B' })
    await flush()

    document.documentElement.classList.add('dark')
    await flush()

    expect(mermaidInitialize).toHaveBeenCalledTimes(2)
    expect(mermaidInitialize).toHaveBeenLastCalledWith(expect.objectContaining({
      theme: 'base',
      darkMode: true,
      themeVariables: expect.objectContaining({
        primaryColor: '#3b4252',
        primaryBorderColor: '#a78bfa',
        primaryTextColor: '#e5e7eb'
      })
    }))
    expect(mermaidRender).toHaveBeenCalledTimes(2)

    harness.app.unmount()
  })

  it('waits for document fonts before first render', async () => {
    const pendingFonts = deferred<void>()
    mockFonts = createMockFonts(pendingFonts.promise)
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: mockFonts
    })

    const harness = mountHarness({ initialCode: 'sequenceDiagram\n  A->>B: Ping' })
    await flush()

    expect(mermaidRender).toHaveBeenCalledTimes(0)

    pendingFonts.resolve()
    await flush()

    expect(mermaidRender).toHaveBeenCalledTimes(1)

    harness.app.unmount()
  })

  it('rerenders when fonts finish loading after mount', async () => {
    const harness = mountHarness({ initialCode: 'sequenceDiagram\n  A->>B: Ping' })
    await flush()

    expect(mermaidRender).toHaveBeenCalledTimes(1)

    mockFonts.dispatch('loadingdone')
    await flush()

    expect(mermaidRender).toHaveBeenCalledTimes(2)

    harness.app.unmount()
  })

  it('opens code editor on preview mouse down and keeps preview visible', async () => {
    const harness = mountHarness()
    await flush()

    const preview = harness.root.querySelector('.tomosona-mermaid-preview') as HTMLDivElement
    preview.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await flush()

    const wrapper = harness.root.querySelector('.tomosona-mermaid') as HTMLElement
    expect(wrapper.classList.contains('is-editing')).toBe(true)
    expect(harness.root.querySelector('.tomosona-mermaid-code')).toBeTruthy()
    expect(harness.root.querySelector('.tomosona-mermaid-preview')).toBeTruthy()

    harness.app.unmount()
  })

  it('updates raw syntax through editor textarea input', async () => {
    const harness = mountHarness()
    await flush()

    const preview = harness.root.querySelector('.tomosona-mermaid-preview') as HTMLDivElement
    preview.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await flush()

    const textarea = harness.root.querySelector('.tomosona-mermaid-code') as HTMLTextAreaElement
    textarea.value = 'sequenceDiagram\n  A->>B: Ping'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(harness.updateAttributes).toHaveBeenCalledWith({ code: 'sequenceDiagram\n  A->>B: Ping' })
    expect(harness.code.value).toContain('sequenceDiagram')

    harness.app.unmount()
  })

  it('inserts indentation when pressing Tab in raw editor', async () => {
    const harness = mountHarness({ initialCode: 'flowchart TD\nA --> B' })
    await flush()

    const preview = harness.root.querySelector('.tomosona-mermaid-preview') as HTMLDivElement
    preview.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await flush()

    const textarea = harness.root.querySelector('.tomosona-mermaid-code') as HTMLTextAreaElement
    textarea.setSelectionRange(0, 0)
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    await flush()

    expect(harness.code.value.startsWith('  flowchart TD')).toBe(true)

    harness.app.unmount()
  })

  it('indents and unindents selected lines with Tab and Shift+Tab', async () => {
    const harness = mountHarness({ initialCode: 'A --> B\nB --> C' })
    await flush()

    const preview = harness.root.querySelector('.tomosona-mermaid-preview') as HTMLDivElement
    preview.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await flush()

    const textarea = harness.root.querySelector('.tomosona-mermaid-code') as HTMLTextAreaElement
    textarea.setSelectionRange(0, textarea.value.length)
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    await flush()
    expect(harness.code.value).toBe('  A --> B\n  B --> C')

    const updated = harness.root.querySelector('.tomosona-mermaid-code') as HTMLTextAreaElement
    updated.setSelectionRange(0, updated.value.length)
    updated.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    await flush()
    expect(harness.code.value).toBe('A --> B\nB --> C')

    harness.app.unmount()
  })

  it('applies selected template from filterable dropdown', async () => {
    const harness = mountHarness()
    await flush()

    const trigger = harness.root.querySelector('.tomosona-mermaid-template-btn') as HTMLButtonElement
    trigger.click()
    await flush()

    const options = Array.from(harness.root.querySelectorAll('.ui-filterable-dropdown-option')) as HTMLButtonElement[]
    const classOption = options.find((option) => option.textContent?.includes('Class'))
    expect(classOption).toBeTruthy()
    classOption?.click()
    await flush()

    expect(harness.updateAttributes).toHaveBeenCalled()
    expect(harness.code.value).toContain('classDiagram')

    harness.app.unmount()
  })

  it('does not replace template when confirm dialog rejects', async () => {
    const confirmReplace = vi.fn(async () => false)
    const harness = mountHarness({
      initialCode: 'flowchart TD\n  X --> Y',
      confirmReplace
    })
    await flush()

    const trigger = harness.root.querySelector('.tomosona-mermaid-template-btn') as HTMLButtonElement
    trigger.click()
    await flush()

    const options = Array.from(harness.root.querySelectorAll('.ui-filterable-dropdown-option')) as HTMLButtonElement[]
    const sequenceOption = options.find((option) => option.textContent?.includes('Sequence'))
    sequenceOption?.click()
    await flush()

    expect(confirmReplace).toHaveBeenCalledTimes(1)
    expect(harness.code.value).toContain('flowchart TD')

    harness.app.unmount()
  })

  it('keeps latest render result when async renders resolve out of order', async () => {
    const pending: Array<(value: { svg: string }) => void> = []
    mermaidRender.mockImplementation(() => new Promise((resolve) => {
      pending.push(resolve)
    }))

    const harness = mountHarness({ initialCode: 'flowchart TD\n  A --> B' })
    await flush()

    harness.code.value = 'sequenceDiagram\n  A->>B: Ping'
    await flush()

    pending.shift()?.({ svg: '<svg data-version="old"></svg>' })
    await flush()
    pending.shift()?.({ svg: '<svg data-version="new"></svg>' })
    await flush()

    const preview = harness.root.querySelector('.tomosona-mermaid-preview') as HTMLDivElement
    expect(preview.innerHTML).toContain('data-version="new"')
    expect(preview.innerHTML).not.toContain('data-version="old"')
    expect(beginHeavyRender).toHaveBeenCalledTimes(2)
    expect(endHeavyRender).toHaveBeenCalledTimes(2)

    harness.app.unmount()
  })

  it('ends heavy render token when mermaid rendering fails', async () => {
    mermaidRender.mockRejectedValueOnce(new Error('boom'))
    const harness = mountHarness({ initialCode: 'flowchart TD\n  A --> B' })
    await flush()

    expect(beginHeavyRender).toHaveBeenCalledTimes(1)
    expect(endHeavyRender).toHaveBeenCalledTimes(1)

    harness.app.unmount()
  })
})
