import { onBeforeUnmount, watch, type Ref } from 'vue'
import type { BlockCursorShape } from '../lib/tiptap/extensions/BlockCursor'

/**
 * useTextareaBlockCursor
 *
 * Purpose:
 * - Draw the terminal-style cursor (same `.tomosona-fake-cursor` visuals as
 *   the rich text editor) inside node-view textareas (callout, quote, mermaid,
 *   html), where the native caret cannot be block-shaped.
 *
 * Boundary:
 * - Purely visual: owns the mirror overlay, the native caret transparency
 *   while active, and listener cleanup; text editing stays in the textarea.
 * - Reads shape/blink through getters so the app cursor preference drives it.
 */

export type TextareaBlockCursorOptions = {
  textarea: Ref<HTMLTextAreaElement | null>
  /** Cursor shape to draw; `null` keeps the native caret untouched. */
  getShape: () => BlockCursorShape | null
  /** Whether the drawn cursor should blink. */
  getBlink: () => boolean
}

/** Computed text styles that decide wrapping; copied so the mirror lays out like the textarea. */
const MIRRORED_TEXT_STYLES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'boxSizing',
  'tabSize'
] as const

const CURSOR_CLASS = 'tomosona-fake-cursor'

export function useTextareaBlockCursor(options: TextareaBlockCursorOptions) {
  let overlay: HTMLDivElement | null = null
  let cursorSpan: HTMLSpanElement | null = null
  let active = false
  let blinkPhase = 0
  let resizeObserver: ResizeObserver | null = null

  function restoreNativeCaret(textarea: HTMLTextAreaElement) {
    textarea.style.caretColor = ''
    if (active) {
      active = false
      overlay?.remove()
      overlay = null
      cursorSpan = null
    }
  }

  function ensureOverlay(textarea: HTMLTextAreaElement): HTMLDivElement {
    if (overlay) return overlay
    overlay = document.createElement('div')
    overlay.className = 'tomosona-textarea-cursor-mirror'
    overlay.setAttribute('aria-hidden', 'true')
    textarea.parentNode?.appendChild(overlay)
    return overlay
  }

  function syncMirrorStyles(overlay: HTMLDivElement, textarea: HTMLTextAreaElement) {
    const computed = window.getComputedStyle(textarea)
    for (const property of MIRRORED_TEXT_STYLES) {
      overlay.style.setProperty(camelToKebab(property), computed[property])
    }
  }

  function drawCursor(textarea: HTMLTextAreaElement, shape: BlockCursorShape, blink: boolean) {
    const mirror = ensureOverlay(textarea)
    syncMirrorStyles(mirror, textarea)

    const value = textarea.value
    const caret = textarea.selectionStart
    const fontSize = window.getComputedStyle(textarea).fontSize

    mirror.textContent = ''
    mirror.appendChild(document.createTextNode(value.slice(0, caret)))

    // A fresh span per draw: clearing the mirror detaches any previous span,
    // and recreating it also restarts the blink cycle on caret moves.
    cursorSpan = document.createElement('span')
    mirror.appendChild(cursorSpan)
    cursorSpan.className = CURSOR_CLASS
    if (shape === 'underline') cursorSpan.classList.add(`${CURSOR_CLASS}--underline`)
    if (blink) {
      blinkPhase = blinkPhase === 0 ? 1 : 0
      cursorSpan.classList.add(blinkPhase === 0 ? `${CURSOR_CLASS}--blink` : `${CURSOR_CLASS}--blink2`)
    }
    cursorSpan.style.fontSize = fontSize

    mirror.appendChild(document.createTextNode(value.slice(caret)))

    // The overlay hugs the textarea's offset box within the same positioned
    // ancestor, so scrolling and resize stay in sync by construction.
    overlay!.style.left = `${textarea.offsetLeft}px`
    overlay!.style.top = `${textarea.offsetTop}px`
    overlay!.style.width = `${textarea.offsetWidth}px`
    overlay!.style.height = `${textarea.offsetHeight}px`
    overlay!.style.whiteSpace = 'pre-wrap'
    overlay!.style.overflowWrap = 'break-word'
    overlay!.scrollTop = textarea.scrollTop
    overlay!.scrollLeft = textarea.scrollLeft

    textarea.style.caretColor = 'transparent'
    active = true
  }

  function update() {
    const textarea = options.textarea.value
    if (!textarea) return
    const shape = options.getShape()
    const focused = document.activeElement === textarea
    const collapsed = textarea.selectionStart === textarea.selectionEnd
    if (!shape || !focused || !collapsed) {
      restoreNativeCaret(textarea)
      return
    }
    drawCursor(textarea, shape, options.getBlink())
  }

  function bind(textarea: HTMLTextAreaElement | null, previous: HTMLTextAreaElement | null) {
    if (previous) {
      restoreNativeCaret(previous)
      resizeObserver?.disconnect()
      resizeObserver = null
    }
    if (!textarea) return

    for (const type of ['input', 'keyup', 'click', 'focus', 'blur', 'scroll', 'select', 'compositionstart', 'compositionend'] as const) {
      textarea.addEventListener(type, onTextareaEvent)
    }
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => update())
      resizeObserver.observe(textarea)
    }
    update()
  }

  function onTextareaEvent(event: Event) {
    const textarea = options.textarea.value
    if (!textarea) return
    // During IME composition the fake cursor steps aside for native editing.
    if (event.type === 'compositionstart') {
      restoreNativeCaret(textarea)
      return
    }
    update()
  }

  watch(
    () => options.textarea.value,
    (textarea, previous) => {
      bind(textarea, previous ?? null)
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    const textarea = options.textarea.value
    if (textarea) restoreNativeCaret(textarea)
    resizeObserver?.disconnect()
    resizeObserver = null
  })
}

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

/**
 * Reads the cursor shape and blink preference from the editor's BlockCursor
 * extension options, so node-view textareas follow the same preference as
 * the rich text surface without extra prop plumbing.
 */
export function resolveTextareaBlockCursorOptions(
  editor: {
    extensionManager?: { extensions?: Array<{ name: string; options: Record<string, unknown> }> }
  } & Record<string, unknown>
): Pick<TextareaBlockCursorOptions, 'getShape' | 'getBlink'> {
  const extension = editor.extensionManager?.extensions?.find((item) => item.name === 'tomosonaBlockCursor')
  const shapeGetter = extension?.options.getShape
  const blinkGetter = extension?.options.getBlink
  return {
    getShape: () => (typeof shapeGetter === 'function' ? (shapeGetter() as BlockCursorShape | null) : null),
    getBlink: () => (typeof blinkGetter === 'function' ? Boolean(blinkGetter()) : false)
  }
}
