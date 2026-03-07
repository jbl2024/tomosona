import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCodeBlockUi } from './useCodeBlockUi'

function makeCodeBlock(code = 'const x = 1;'): HTMLElement {
  const block = document.createElement('div')
  block.className = 'ce-code'
  const textarea = document.createElement('textarea')
  textarea.className = 'ce-code__textarea'
  textarea.value = code
  block.appendChild(textarea)
  return block
}

describe('useCodeBlockUi', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('initializes wrap preference from localStorage', () => {
    const holder = ref<HTMLDivElement | null>(document.createElement('div'))
    const api = useCodeBlockUi({ holder })

    window.localStorage.setItem('tomosona:editor:code-wrap', '0')
    api.initFromStorage()

    expect(api.codeWrapEnabled.value).toBe(false)
  })

  it('decorates code blocks once and keeps controls idempotent', () => {
    const holderEl = document.createElement('div')
    const block = makeCodeBlock()
    holderEl.appendChild(block)
    document.body.appendChild(holderEl)

    const holder = ref<HTMLDivElement | null>(holderEl)
    const api = useCodeBlockUi({ holder })
    api.ensureCodeBlockUi()
    api.ensureCodeBlockUi()

    expect(block.querySelectorAll('.tomosona-code-wrap-btn')).toHaveLength(1)
    expect(block.querySelectorAll('.tomosona-code-copy-btn')).toHaveLength(1)
  })

  it('toggles wrap mode from the wrap button', () => {
    const holderEl = document.createElement('div')
    const block = makeCodeBlock()
    holderEl.appendChild(block)
    document.body.appendChild(holderEl)

    const holder = ref<HTMLDivElement | null>(holderEl)
    const api = useCodeBlockUi({ holder })
    api.ensureCodeBlockUi()

    const textarea = block.querySelector('.ce-code__textarea') as HTMLTextAreaElement
    const wrapButton = block.querySelector('.tomosona-code-wrap-btn') as HTMLButtonElement

    expect(block.classList.contains('tomosona-code-wrap-enabled')).toBe(true)
    expect(textarea.wrap).toBe('soft')

    wrapButton.click()

    expect(block.classList.contains('tomosona-code-wrap-enabled')).toBe(false)
    expect(textarea.wrap).toBe('off')
  })

  it('copies code and resets copied state after timeout', async () => {
    vi.useFakeTimers()

    const clipboard = {
      writeText: vi.fn(async () => {})
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard
    })

    const holderEl = document.createElement('div')
    const block = makeCodeBlock('hello world')
    holderEl.appendChild(block)
    document.body.appendChild(holderEl)

    const holder = ref<HTMLDivElement | null>(holderEl)
    const api = useCodeBlockUi({ holder })
    api.ensureCodeBlockUi()

    const copyButton = block.querySelector('.tomosona-code-copy-btn') as HTMLButtonElement
    copyButton.click()
    await Promise.resolve()

    expect(clipboard.writeText).toHaveBeenCalledWith('hello world')
    expect(copyButton.classList.contains('is-copied')).toBe(true)

    await vi.advanceTimersByTimeAsync(2000)
    expect(copyButton.classList.contains('is-copied')).toBe(false)
  })

  it('starts and stops observers and performs initial global refresh', async () => {
    type ObserverCallback = (mutations: MutationRecord[], observer: MutationObserver) => void
    let mutationCallback: ObserverCallback | null = null
    const observe = vi.fn()
    const disconnect = vi.fn()
    class FakeMutationObserver {
      constructor(callback: MutationCallback) {
        mutationCallback = callback
      }
      observe = observe
      disconnect = disconnect
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver as unknown as typeof MutationObserver)

    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0)
        return 1
      })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

    const holderEl = document.createElement('div')
    holderEl.appendChild(makeCodeBlock('existing block'))
    document.body.appendChild(holderEl)
    const holder = ref<HTMLDivElement | null>(holderEl)
    const api = useCodeBlockUi({ holder })

    api.startObservers()

    expect(holderEl.querySelectorAll('.tomosona-code-wrap-btn')).toHaveLength(1)
    expect(holderEl.querySelectorAll('.tomosona-code-copy-btn')).toHaveLength(1)
    expect(observe).toHaveBeenCalledTimes(1)
    expect(observe).toHaveBeenCalledWith(holderEl, { childList: true, subtree: true })
    expect(rafSpy).toHaveBeenCalled()

    const rafCallsAfterInitial = rafSpy.mock.calls.length
    const paragraph = document.createElement('div')
    paragraph.className = 'ce-paragraph'
    holderEl.appendChild(paragraph)
    if (mutationCallback) {
      ;(mutationCallback as unknown as (...args: unknown[]) => void)(
        [
          {
            type: 'childList',
            target: paragraph,
            addedNodes: [document.createTextNode('x')] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
            previousSibling: null,
            nextSibling: null,
            attributeName: null,
            attributeNamespace: null,
            oldValue: null
          } as MutationRecord
        ],
        {} as MutationObserver
      )
    }
    expect(rafSpy.mock.calls.length).toBe(rafCallsAfterInitial)

    api.stopObservers()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
