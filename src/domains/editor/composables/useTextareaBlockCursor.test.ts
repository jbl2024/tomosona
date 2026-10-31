import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, ref } from 'vue'
import {
  resolveTextareaBlockCursorOptions,
  useTextareaBlockCursor
} from './useTextareaBlockCursor'

function mountCursor(shape: () => 'block' | 'underline' | null, blink = () => false) {
  const textarea = document.createElement('textarea')
  document.body.appendChild(textarea)
  const textareaRef = ref<HTMLTextAreaElement | null>(textarea)

  const app = createApp(defineComponent({
    setup() {
      useTextareaBlockCursor({
        textarea: textareaRef,
        getShape: shape,
        getBlink: blink
      })
      return () => h('div')
    }
  }))
  app.mount(document.createElement('div'))

  return { textarea, textareaRef, app }
}

function overlayFor(textarea: HTMLTextAreaElement): HTMLDivElement | null {
  const found = Array.from(textarea.parentNode?.children ?? []).find(
    (element) => element.classList?.contains('tomosona-textarea-cursor-mirror')
  )
  return (found as HTMLDivElement | undefined) ?? null
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useTextareaBlockCursor', () => {
  it('draws the block cursor overlay while focused with a collapsed caret', () => {
    const { textarea } = mountCursor(() => 'block')
    textarea.value = 'hello world'
    textarea.focus()
    textarea.setSelectionRange(5, 5)
    textarea.dispatchEvent(new Event('focus'))

    const overlay = overlayFor(textarea)
    expect(overlay).not.toBeNull()
    const cursor = overlay?.querySelector('.tomosona-fake-cursor')
    expect(cursor?.classList.contains('tomosona-fake-cursor--underline')).toBe(false)
    // Mirror text surrounds the caret at offset 5.
    expect(overlay?.textContent).toBe('hello world')
    // The native caret is hidden while the overlay is active.
    expect(textarea.style.caretColor).toBe('transparent')
  })

  it('removes the overlay and restores the native caret on blur', () => {
    const { textarea } = mountCursor(() => 'block')
    textarea.focus()
    textarea.dispatchEvent(new Event('focus'))
    expect(overlayFor(textarea)).not.toBeNull()

    textarea.blur()
    textarea.dispatchEvent(new Event('blur'))
    expect(overlayFor(textarea)).toBeNull()
    expect(textarea.style.caretColor).toBe('')
  })

  it('hides the overlay while the user is selecting text', () => {
    const { textarea } = mountCursor(() => 'block')
    textarea.value = 'hello world'
    textarea.focus()
    textarea.setSelectionRange(0, 5)
    textarea.dispatchEvent(new Event('select'))

    expect(overlayFor(textarea)).toBeNull()
    expect(textarea.style.caretColor).toBe('')
  })

  it('does nothing when the shape is null (native caret mode)', () => {
    const { textarea } = mountCursor(() => null)
    textarea.focus()
    textarea.dispatchEvent(new Event('focus'))

    expect(overlayFor(textarea)).toBeNull()
    expect(textarea.style.caretColor).toBe('')
  })

  it('draws the underline variant and alternates blink keyframes', () => {
    const { textarea } = mountCursor(() => 'underline', () => true)
    textarea.focus()
    textarea.dispatchEvent(new Event('focus'))

    const overlay = overlayFor(textarea)
    expect(overlay?.querySelector('.tomosona-fake-cursor')?.classList.contains('tomosona-fake-cursor--underline')).toBe(true)

    const first = overlay?.querySelector('.tomosona-fake-cursor')?.className ?? ''
    textarea.dispatchEvent(new Event('input'))
    const second = overlayFor(textarea)?.querySelector('.tomosona-fake-cursor')?.className ?? ''
    expect(first).not.toBe(second)
  })

  it('steps aside during IME composition', () => {
    const { textarea } = mountCursor(() => 'block')
    textarea.focus()
    textarea.dispatchEvent(new Event('focus'))
    expect(overlayFor(textarea)).not.toBeNull()

    textarea.dispatchEvent(new CompositionEvent('compositionstart'))
    expect(overlayFor(textarea)).toBeNull()
    expect(textarea.style.caretColor).toBe('')
  })
})

describe('resolveTextareaBlockCursorOptions', () => {
  it('returns null shape and no blink without the extension', () => {
    const options = resolveTextareaBlockCursorOptions({ isEditable: true } as never)
    expect(options.getShape()).toBeNull()
    expect(options.getBlink()).toBe(false)
  })

  it('forwards the BlockCursor extension options', () => {
    const getShape = vi.fn(() => 'block')
    const getBlink = vi.fn(() => true)
    const options = resolveTextareaBlockCursorOptions({
      extensionManager: {
        extensions: [{ name: 'tomosonaBlockCursor', options: { getShape, getBlink } }]
      }
    })
    expect(options.getShape()).toBe('block')
    expect(options.getBlink()).toBe(true)
  })
})
