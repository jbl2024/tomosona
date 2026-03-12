import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import QuoteNodeView from './QuoteNodeView.vue'

async function flush() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function mountHarness(options?: {
  editable?: boolean
  initialText?: string
}) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const text = ref(options?.initialText ?? 'Initial quote')
  const editable = options?.editable ?? true
  const updateAttributes = vi.fn((attrs: Record<string, unknown>) => {
    if (typeof attrs.text === 'string') {
      text.value = attrs.text
    }
  })

  const HarnessComponent = defineComponent({
    setup() {
      return () => h(QuoteNodeView, {
        node: { attrs: { text: text.value } },
        updateAttributes,
        editor: { isEditable: editable }
      })
    }
  })

  const app = createApp(HarnessComponent)
  app.provide('onDragStart', () => {})
  app.provide('decorationClasses', ref(''))
  app.mount(root)

  return { app, root, text, updateAttributes }
}

describe('QuoteNodeView', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('updates quote text from textarea input', async () => {
    const harness = mountHarness({ initialText: 'Before' })
    await flush()

    const textarea = harness.root.querySelector('.tomosona-quote-source') as HTMLTextAreaElement
    textarea.value = 'After update'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(harness.updateAttributes).toHaveBeenCalledWith({ text: 'After update' })
    expect(harness.text.value).toBe('After update')

    harness.app.unmount()
  })

  it('autosizes quote textarea from a single-line minimum', async () => {
    const harness = mountHarness({ initialText: '' })
    await flush()

    const textarea = harness.root.querySelector('.tomosona-quote-source') as HTMLTextAreaElement
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 96 })

    textarea.value = 'line 1\nline 2\nline 3'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(textarea.getAttribute('rows')).toBe('1')
    expect(textarea.style.height).toBe('96px')

    harness.app.unmount()
  })

  it('keeps a full single-line height for quote textarea', async () => {
    const harness = mountHarness({ initialText: '' })
    await flush()

    const textarea = harness.root.querySelector('.tomosona-quote-source') as HTMLTextAreaElement
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 46 })

    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(textarea.style.height).toBe('46px')

    harness.app.unmount()
  })

  it('does not pin the quote textarea to 0px when initial metrics are unavailable', async () => {
    const harness = mountHarness({ initialText: '' })
    await flush()

    const textarea = harness.root.querySelector('.tomosona-quote-source') as HTMLTextAreaElement
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 0 })

    textarea.dispatchEvent(new Event('focus'))
    await flush()

    expect(textarea.style.height).toBe('')

    harness.app.unmount()
  })

  it('keeps textarea readonly in readonly mode', async () => {
    const harness = mountHarness({ editable: false, initialText: 'Readonly' })
    await flush()

    const textarea = harness.root.querySelector('.tomosona-quote-source') as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(true)

    harness.app.unmount()
  })
})
