import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CodeBlockNodeView from './CodeBlockNodeView.vue'

async function flush() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function mountHarness(options?: {
  initialLanguage?: string
  initialCode?: string
}) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const language = ref(options?.initialLanguage ?? 'plaintext')
  const code = ref(options?.initialCode ?? 'const answer = 42')
  const updateAttributes = vi.fn((attrs: Record<string, unknown>) => {
    if (typeof attrs.language === 'string') {
      language.value = attrs.language
    }
  })

  const HarnessComponent = defineComponent({
    setup() {
      return () => h(CodeBlockNodeView, {
        node: {
          attrs: { language: language.value },
          textContent: code.value
        },
        updateAttributes
      })
    }
  })

  const app = createApp(HarnessComponent)
  app.provide('onDragStart', () => {})
  app.provide('decorationClasses', ref(''))
  app.mount(root)

  return { app, root, language, updateAttributes }
}

describe('CodeBlockNodeView', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders language controls inside the code surface', async () => {
    const harness = mountHarness({ initialLanguage: 'plaintext' })
    await flush()

    const surface = harness.root.querySelector('.tomosona-code-node-surface')
    const actions = harness.root.querySelector('.tomosona-code-node-actions')
    const pre = harness.root.querySelector('pre')

    expect(surface).toBeTruthy()
    expect(actions).toBeTruthy()
    expect(pre).toBeTruthy()
    expect(surface?.contains(actions as Node)).toBe(true)
    expect(surface?.contains(pre as Node)).toBe(true)
    expect((harness.root.querySelector('.tomosona-code-lang-btn') as HTMLButtonElement).textContent?.trim()).toBe('plaintext')

    harness.app.unmount()
  })

  it('keeps overlay controls visible while the language menu is open', async () => {
    const harness = mountHarness({ initialLanguage: 'plaintext' })
    await flush()

    const surface = harness.root.querySelector('.tomosona-code-node-surface') as HTMLElement
    const trigger = harness.root.querySelector('.tomosona-code-lang-btn') as HTMLButtonElement

    expect(surface.dataset.controlsOpen).toBe('false')

    trigger.click()
    await flush()

    expect(surface.dataset.controlsOpen).toBe('true')
    expect(surface.classList.contains('is-controls-open')).toBe(true)
    expect(harness.root.querySelector('.ui-filterable-dropdown-menu')).toBeTruthy()

    harness.app.unmount()
  })
})
