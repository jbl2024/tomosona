import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EditorInlineFormatToolbar from './EditorInlineFormatToolbar.vue'

async function flush() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function mountHarness(options?: {
  open?: boolean
  linkPopoverOpen?: boolean
  linkValue?: string
  linkError?: string
}) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const onToggleMark = vi.fn<(mark: string) => void>()
  const onUnai = vi.fn()
  const onOpenLink = vi.fn()
  const onWrapWikilink = vi.fn()
  const onExtractNote = vi.fn()
  const onSelectBlockAction = vi.fn()
  const onCopyAs = vi.fn<(format: string) => void>()
  const onApplyLink = vi.fn()
  const onUnlink = vi.fn()
  const onCancelLink = vi.fn()
  const onUpdateLinkValue = vi.fn<(value: string) => void>()
  const linkValue = ref(options?.linkValue ?? 'https://example.com')
  const linkPopoverOpen = ref(options?.linkPopoverOpen ?? false)

  const Harness = defineComponent({
    setup() {
      return () => h(EditorInlineFormatToolbar, {
        open: options?.open ?? true,
        left: 40,
        top: 80,
        activeMarks: {
          bold: true,
          italic: false,
          strike: false,
          underline: false,
          code: false,
          link: true
        },
        blockMenuActions: [
          { id: 'insert_above', actionId: 'insert_above', label: 'Insert above' },
          { id: 'delete', actionId: 'delete', label: 'Delete' }
        ],
        blockMenuConvertActions: [
          { id: 'turn_into:paragraph', actionId: 'turn_into', label: 'Paragraph', turnIntoType: 'paragraph' }
        ],
        linkPopoverOpen: linkPopoverOpen.value,
        linkValue: linkValue.value,
        linkError: options?.linkError ?? '',
        onToggleMark,
        onUnai,
        onOpenLink,
        onWrapWikilink,
        onExtractNote,
        onSelectBlockAction,
        onCopyAs,
        onApplyLink,
        onUnlink,
        onCancelLink,
        'onUpdate:linkValue': onUpdateLinkValue
      })
    }
  })

  const app = createApp(Harness)
  app.mount(root)
  return {
    app,
    root,
    linkPopoverOpen,
    onToggleMark,
    onUnai,
    onOpenLink,
    onWrapWikilink,
    onExtractNote,
    onSelectBlockAction,
    onCopyAs,
    onApplyLink,
    onUnlink,
    onCancelLink,
    onUpdateLinkValue
  }
}

describe('EditorInlineFormatToolbar', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders toolbar actions and active classes', async () => {
    const harness = mountHarness()
    await flush()

    const bold = harness.root.querySelector('[data-action="bold"]') as HTMLButtonElement
    const italic = harness.root.querySelector('[data-action="italic"]') as HTMLButtonElement
    expect(bold).toBeTruthy()
    expect(italic).toBeTruthy()
    expect(bold.className).toContain('inline-format-toolbar-btn--active')
    expect(bold.className).not.toContain('bg-slate-200')

    harness.app.unmount()
  })

  it('emits semantic action events', async () => {
    const harness = mountHarness()
    await flush()

    ;(harness.root.querySelector('[data-action="bold"]') as HTMLButtonElement).click()
    ;(harness.root.querySelector('[data-action="unai"]') as HTMLButtonElement).click()
    ;(harness.root.querySelector('[data-action="wikilink"]') as HTMLButtonElement).click()
    ;(harness.root.querySelector('[data-action="extract-note"]') as HTMLButtonElement).click()
    ;(harness.root.querySelector('[data-action="link"]') as HTMLButtonElement).click()

    expect(harness.onToggleMark).toHaveBeenCalledWith('bold')
    expect(harness.onUnai).toHaveBeenCalledTimes(1)
    expect(harness.onWrapWikilink).toHaveBeenCalledTimes(1)
    expect(harness.onExtractNote).toHaveBeenCalledTimes(1)
    expect(harness.onOpenLink).toHaveBeenCalledTimes(1)

    harness.app.unmount()
  })

  it('opens block actions from the selection toolbar and emits the selected item', async () => {
    const harness = mountHarness()
    await flush()

    ;(harness.root.querySelector('[data-action="block-menu-toggle"]') as HTMLButtonElement).click()
    await flush()

    const deleteButton = Array.from(document.body.querySelectorAll('.tomosona-block-menu button')).find(
      (button) => button.textContent?.trim() === 'Delete'
    ) as HTMLButtonElement | undefined
    expect(deleteButton).toBeTruthy()

    deleteButton?.click()
    expect(harness.onSelectBlockAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'delete',
        label: 'Delete'
      })
    )

    harness.app.unmount()
  })

  it('supports link popover keyboard and action controls', async () => {
    const harness = mountHarness({ linkPopoverOpen: true, linkError: 'bad url' })
    await flush()

    const input = harness.root.querySelector('[data-testid="link-input"]') as HTMLInputElement
    input.value = 'https://changed.test'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    ;(harness.root.querySelector('[data-action="unlink"]') as HTMLButtonElement).click()
    ;(harness.root.querySelector('[data-action="cancel-link"]') as HTMLButtonElement).click()
    ;(harness.root.querySelector('[data-action="apply-link"]') as HTMLButtonElement).click()

    expect(harness.onUpdateLinkValue).toHaveBeenCalledWith('https://changed.test')
    expect(harness.onApplyLink).toHaveBeenCalled()
    expect(harness.onCancelLink).toHaveBeenCalled()
    expect(harness.onUnlink).toHaveBeenCalledTimes(1)

    harness.app.unmount()
  })

  it('renders link input as free text for internal anchors', async () => {
    const harness = mountHarness({ linkPopoverOpen: true, linkValue: '#section' })
    await flush()

    const input = harness.root.querySelector('[data-testid="link-input"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('text')
    expect(input.value).toBe('#section')
    expect(input.placeholder).toContain('#ma-section')

    harness.app.unmount()
  })

  it('opens copy menu and emits explicit copy format', async () => {
    const harness = mountHarness()
    await flush()

    ;(harness.root.querySelector('[data-action="copy-menu-toggle"]') as HTMLButtonElement).click()
    await flush()
    ;(harness.root.querySelector('[data-action="copy-as-markdown"]') as HTMLButtonElement).click()
    await flush()

    expect(harness.onCopyAs).toHaveBeenCalledWith('markdown')
    expect(harness.root.querySelector('[data-action="copy-as-html"]')).toBeNull()

    harness.app.unmount()
  })

  it('does not prevent default mousedown on URL input', async () => {
    const harness = mountHarness({ linkPopoverOpen: true })
    await flush()

    const input = harness.root.querySelector('[data-testid="link-input"]') as HTMLInputElement
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)

    harness.app.unmount()
  })

  it('auto-focuses URL input when popover opens', async () => {
    const harness = mountHarness({ linkPopoverOpen: false })
    await flush()

    harness.linkPopoverOpen.value = true
    await flush()

    const input = harness.root.querySelector('[data-testid="link-input"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(document.activeElement).toBe(input)

    harness.app.unmount()
  })
})
