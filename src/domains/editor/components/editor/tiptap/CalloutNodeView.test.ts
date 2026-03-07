import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CalloutNodeView from './CalloutNodeView.vue'

async function flush() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function mountHarness(options?: {
  editable?: boolean
  initialKind?: string
  initialMessage?: string
}) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const kind = ref(options?.initialKind ?? 'NOTE')
  const message = ref(options?.initialMessage ?? 'Initial callout')
  const editable = options?.editable ?? true
  const updateAttributes = vi.fn((attrs: Record<string, unknown>) => {
    if (typeof attrs.kind === 'string') {
      kind.value = attrs.kind
    }
    if (typeof attrs.message === 'string') {
      message.value = attrs.message
    }
  })

  const HarnessComponent = defineComponent({
    setup() {
      return () => h(CalloutNodeView, {
        node: { attrs: { kind: kind.value, message: message.value } },
        updateAttributes,
        editor: { isEditable: editable }
      })
    }
  })

  const app = createApp(HarnessComponent)
  app.provide('onDragStart', () => {})
  app.provide('decorationClasses', ref(''))
  app.mount(root)

  return { app, root, kind, message, updateAttributes }
}

describe('CalloutNodeView', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('updates callout kind from filterable dropdown selection', async () => {
    const harness = mountHarness({ initialKind: 'NOTE' })
    await flush()

    const titleIcon = harness.root.querySelector('.tomosona-callout-title .tomosona-callout-icon-svg')
    expect(titleIcon).toBeTruthy()

    const trigger = harness.root.querySelector('.tomosona-callout-title-trigger') as HTMLButtonElement
    trigger.click()
    await flush()

    const options = Array.from(harness.root.querySelectorAll('.ui-filterable-dropdown-option')) as HTMLButtonElement[]
    expect(options[0]?.querySelector('.tomosona-callout-kind-option-icon')).toBeTruthy()
    const warningOption = options.find((option) => option.textContent?.includes('Warning'))
    expect(warningOption).toBeTruthy()
    warningOption?.click()
    await flush()

    expect(harness.updateAttributes).toHaveBeenCalledWith({ kind: 'WARNING' })
    expect(harness.kind.value).toBe('WARNING')
    expect(trigger.textContent?.trim()).toContain('Warning')

    harness.app.unmount()
  })

  it('updates callout message from textarea input', async () => {
    const harness = mountHarness({ initialMessage: 'Before' })
    await flush()

    const textarea = harness.root.querySelector('.tomosona-callout-message') as HTMLTextAreaElement
    textarea.value = 'After update'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(harness.updateAttributes).toHaveBeenCalledWith({ message: 'After update' })
    expect(harness.message.value).toBe('After update')

    harness.app.unmount()
  })

  it('hides kind selector in readonly mode', async () => {
    const harness = mountHarness({ editable: false, initialKind: 'TIP' })
    await flush()

    expect(harness.root.querySelector('.tomosona-callout-title-trigger')).toBeNull()
    const textarea = harness.root.querySelector('.tomosona-callout-message') as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(true)

    harness.app.unmount()
  })
})
