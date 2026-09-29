import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import QuoteNodeView from './QuoteNodeView.vue'
import { editorDataToMarkdown, markdownToEditorData } from '../../../lib/markdownBlocks'
import { toTiptapDoc } from '../../../lib/tiptap/editorBlocksToTiptapDoc'
import { fromTiptapDoc } from '../../../lib/tiptap/tiptapDocToEditorBlocks'

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

  it('renders inline Markdown, links and line breaks without changing source text', async () => {
    const source = '**Bold** *italic* ~~removed~~ `code`\n[Site](https://example.com) [[Note]]'
    const harness = mountHarness({ initialText: source })
    await flush()
    const preview = harness.root.querySelector('.tomosona-quote-preview')!
    expect(preview.querySelector('strong')?.textContent).toBe('Bold')
    expect(preview.querySelector('em')?.textContent).toBe('italic')
    expect(preview.querySelector('s')?.textContent).toBe('removed')
    expect(preview.querySelector('code')?.textContent).toBe('code')
    expect(preview.querySelector('br')).not.toBeNull()
    expect(preview.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    expect(preview.querySelector('[data-wikilink-target]')?.getAttribute('data-wikilink-target')).toBe('Note')
    expect(harness.text.value).toBe(source)
    expect(harness.updateAttributes).not.toHaveBeenCalled()
    harness.app.unmount()
  })

  it('renders Markdown while typing, then preserves it through a save and reload', async () => {
    const harness = mountHarness({ initialText: 'Before' })
    await flush()
    ;(harness.root.querySelector('.tomosona-quote-preview') as HTMLElement).click()
    await flush()
    const textarea = harness.root.querySelector('textarea')!
    expect(document.activeElement).toBe(textarea)
    for (const value of ['**this is it*', '**this is it**']) {
      textarea.value = value
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await flush()
    }
    expect(harness.root.querySelector('strong')?.textContent).toBe('this is it')
    expect(harness.root.querySelector('.tomosona-quote')?.classList.contains('is-editing')).toBe(true)
    const blocks = fromTiptapDoc(toTiptapDoc([{ type: 'quote', data: { text: harness.text.value } }]))
    const markdown = editorDataToMarkdown({ blocks })
    expect(markdown.trim()).toBe('> **this is it**')
    expect(markdownToEditorData(markdown).blocks[0]?.data.text).toBe('**this is it**')
    textarea.dispatchEvent(new Event('blur'))
    await flush()
    expect(harness.root.querySelector('.tomosona-quote')?.classList.contains('is-editing')).toBe(false)
    expect(harness.root.querySelector('strong')?.textContent).toBe('this is it')
    harness.app.unmount()
  })

  it('exits editing on external text changes and allows empty quotes to be filled', async () => {
    const harness = mountHarness({ initialText: '' })
    await flush()
    expect(harness.root.querySelector('.is-editing')).not.toBeNull()
    const textarea = harness.root.querySelector('textarea')!
    textarea.focus()
    textarea.value = 'First character'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(harness.root.querySelector('.is-editing')).not.toBeNull()
    harness.text.value = '**Another note**'
    await flush()
    expect(harness.root.querySelector('.is-editing')).toBeNull()
    expect(harness.root.querySelector('strong')?.textContent).toBe('Another note')
    harness.app.unmount()
  })

  it('escapes HTML and rejects unsafe links in the preview', async () => {
    const harness = mountHarness({ initialText: '<img src=x onerror=alert(1)> [bad](javascript:alert) **safe**' })
    await flush()
    expect(harness.root.querySelector('img')).toBeNull()
    expect(harness.root.querySelector('a')).toBeNull()
    expect(harness.root.querySelector('strong')?.textContent).toBe('safe')
    harness.app.unmount()
  })

  it('does not enter editing when a quote link is clicked', async () => {
    const harness = mountHarness({ initialText: '[[Note]]' })
    await flush()
    harness.root.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(harness.root.querySelector('.is-editing')).toBeNull()
    harness.app.unmount()
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

  it('autosizes the quote source after it becomes visible', async () => {
    const harness = mountHarness({ initialText: 'line 1\nline 2\nline 3' })
    await flush()

    const textarea = harness.root.querySelector('.tomosona-quote-source') as HTMLTextAreaElement
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 96 })

    ;(harness.root.querySelector('.tomosona-quote-preview') as HTMLElement).click()
    await flush()

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
    const harness = mountHarness({ editable: false, initialText: '**Readonly**' })
    await flush()

    const textarea = harness.root.querySelector('.tomosona-quote-source') as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(true)
    ;(harness.root.querySelector('.tomosona-quote-preview') as HTMLElement).click()
    await flush()
    expect(harness.root.querySelector('.is-editing')).toBeNull()
    expect(harness.root.querySelector('strong')?.textContent).toBe('Readonly')

    harness.app.unmount()
  })
})
