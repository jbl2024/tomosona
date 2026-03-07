import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { useInlineFormatToolbar } from './useInlineFormatToolbar'
import { WIKILINK_STATE_KEY } from '../lib/tiptap/plugins/wikilinkState'

type FakeChain = {
  focus: ReturnType<typeof vi.fn>
  setTextSelection: ReturnType<typeof vi.fn>
  toggleBold: ReturnType<typeof vi.fn>
  toggleItalic: ReturnType<typeof vi.fn>
  toggleStrike: ReturnType<typeof vi.fn>
  toggleUnderline: ReturnType<typeof vi.fn>
  toggleCode: ReturnType<typeof vi.fn>
  setLink: ReturnType<typeof vi.fn>
  unsetLink: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
}

function createFakeChain(): FakeChain {
  const chain = {
    focus: vi.fn(),
    setTextSelection: vi.fn(),
    toggleBold: vi.fn(),
    toggleItalic: vi.fn(),
    toggleStrike: vi.fn(),
    toggleUnderline: vi.fn(),
    toggleCode: vi.fn(),
    setLink: vi.fn(),
    unsetLink: vi.fn(),
    run: vi.fn()
  } as FakeChain

  chain.focus.mockReturnValue(chain)
  chain.setTextSelection.mockReturnValue(chain)
  chain.toggleBold.mockReturnValue(chain)
  chain.toggleItalic.mockReturnValue(chain)
  chain.toggleStrike.mockReturnValue(chain)
  chain.toggleUnderline.mockReturnValue(chain)
  chain.toggleCode.mockReturnValue(chain)
  chain.setLink.mockReturnValue(chain)
  chain.unsetLink.mockReturnValue(chain)
  chain.run.mockReturnValue(true)
  return chain
}

function createFakeEditor(options?: { href?: string; selection?: { from: number; to: number; empty: boolean } }) {
  const chain = createFakeChain()
  const selection = options?.selection ?? { from: 2, to: 8, empty: false }
  const tr = {
    doc: { content: { size: 500 } },
    insertText: vi.fn(),
    setSelection: vi.fn(),
    setMeta: vi.fn()
  }
  tr.insertText.mockReturnValue(tr)
  tr.setSelection.mockReturnValue(tr)
  tr.setMeta.mockReturnValue(tr)

  const editor = {
    state: {
      selection,
      doc: {
        textBetween: vi.fn(() => 'My selected note')
      },
      tr
    },
    view: {
      coordsAtPos: vi.fn((pos: number) => {
        if (pos === selection.from) return { left: 100, right: 120, top: 80 }
        return { left: 200, right: 250, top: 84 }
      }),
      dispatch: vi.fn()
    },
    chain: vi.fn(() => chain),
    isActive: vi.fn(() => false),
    getAttributes: vi.fn(() => ({ href: options?.href }))
  }

  return { editor: editor as unknown as Editor, chain, selection, tr, dispatch: editor.view.dispatch }
}

describe('useInlineFormatToolbar', () => {
  it('shows toolbar for non-empty selection and computes position', () => {
    const holder = ref<HTMLElement | null>({
      scrollLeft: 10,
      scrollTop: 5,
      getBoundingClientRect: () => ({ left: 50, top: 20 } as DOMRect)
    } as HTMLElement)
    const { editor } = createFakeEditor()
    const toolbar = useInlineFormatToolbar({
      holder,
      getEditor: () => editor,
      sanitizeHref: (raw) => raw
    })

    toolbar.updateFormattingToolbar()

    expect(toolbar.formatToolbarOpen.value).toBe(true)
    expect(toolbar.formatToolbarLeft.value).toBe(135)
    expect(toolbar.formatToolbarTop.value).toBe(55)
  })

  it('hides toolbar for empty selection', () => {
    const holder = ref<HTMLElement | null>({
      scrollLeft: 0,
      scrollTop: 0,
      getBoundingClientRect: () => ({ left: 0, top: 0 } as DOMRect)
    } as HTMLElement)
    const { editor } = createFakeEditor({ selection: { from: 4, to: 4, empty: true } })
    const toolbar = useInlineFormatToolbar({
      holder,
      getEditor: () => editor,
      sanitizeHref: (raw) => raw
    })

    toolbar.updateFormattingToolbar()

    expect(toolbar.formatToolbarOpen.value).toBe(false)
  })

  it('dispatches mark toggle commands', () => {
    const holder = ref<HTMLElement | null>(null)
    const { editor, chain } = createFakeEditor()
    const toolbar = useInlineFormatToolbar({
      holder,
      getEditor: () => editor,
      sanitizeHref: (raw) => raw
    })

    toolbar.toggleMark('bold')
    toolbar.toggleMark('italic')

    expect(chain.toggleBold).toHaveBeenCalledTimes(1)
    expect(chain.toggleItalic).toHaveBeenCalledTimes(1)
    expect(chain.run).toHaveBeenCalledTimes(2)
  })

  it('prefills link popover with existing href or default', () => {
    const holder = ref<HTMLElement | null>(null)
    const first = createFakeEditor({ href: 'https://existing.test' })
    const withExisting = useInlineFormatToolbar({
      holder,
      getEditor: () => first.editor,
      sanitizeHref: (raw) => raw
    })
    withExisting.openLinkPopover()
    expect(withExisting.linkValue.value).toBe('https://existing.test')

    const second = createFakeEditor()
    const withDefault = useInlineFormatToolbar({
      holder,
      getEditor: () => second.editor,
      sanitizeHref: (raw) => raw
    })
    withDefault.openLinkPopover()
    expect(withDefault.linkValue.value).toBe('https://')
  })

  it('applies valid link and restores snapshot selection', () => {
    const holder = ref<HTMLElement | null>(null)
    const fake = createFakeEditor()
    const toolbar = useInlineFormatToolbar({
      holder,
      getEditor: () => fake.editor,
      sanitizeHref: (raw) => (raw.startsWith('https://') ? raw : null)
    })

    toolbar.openLinkPopover()
    fake.selection.from = 1
    fake.selection.to = 1
    fake.selection.empty = true
    toolbar.linkValue.value = 'https://example.com'
    const applied = toolbar.applyLink()

    expect(applied).toBe(true)
    expect(fake.chain.setTextSelection).toHaveBeenCalledWith({ from: 2, to: 8 })
    expect(fake.chain.setLink).toHaveBeenCalledWith({
      href: 'https://example.com',
      target: '_blank',
      rel: 'noopener noreferrer'
    })
    expect(toolbar.linkPopoverOpen.value).toBe(false)
  })

  it('unsets link for empty value', () => {
    const holder = ref<HTMLElement | null>(null)
    const fake = createFakeEditor()
    const toolbar = useInlineFormatToolbar({
      holder,
      getEditor: () => fake.editor,
      sanitizeHref: (raw) => raw
    })

    toolbar.openLinkPopover()
    toolbar.linkValue.value = '   '
    const applied = toolbar.applyLink()

    expect(applied).toBe(true)
    expect(fake.chain.unsetLink).toHaveBeenCalledTimes(1)
    expect(fake.chain.setLink).not.toHaveBeenCalled()
  })

  it('keeps popover open and reports validation error for invalid URL', () => {
    const holder = ref<HTMLElement | null>(null)
    const fake = createFakeEditor()
    const toolbar = useInlineFormatToolbar({
      holder,
      getEditor: () => fake.editor,
      sanitizeHref: () => null
    })

    toolbar.openLinkPopover()
    toolbar.linkValue.value = 'not-valid'
    const applied = toolbar.applyLink()

    expect(applied).toBe(false)
    expect(fake.chain.setLink).not.toHaveBeenCalled()
    expect(fake.chain.unsetLink).not.toHaveBeenCalled()
    expect(toolbar.linkPopoverOpen.value).toBe(true)
    expect(toolbar.linkError.value).toContain('Enter a valid URL')
  })

  it('cancels link popover without mutating link commands', () => {
    const holder = ref<HTMLElement | null>(null)
    const fake = createFakeEditor()
    const toolbar = useInlineFormatToolbar({
      holder,
      getEditor: () => fake.editor,
      sanitizeHref: (raw) => raw
    })

    toolbar.openLinkPopover()
    toolbar.cancelLink()

    expect(toolbar.linkPopoverOpen.value).toBe(false)
    expect(fake.chain.setLink).not.toHaveBeenCalled()
    expect(fake.chain.unsetLink).not.toHaveBeenCalled()
  })

  it('wraps selection as wikilink and starts wikilink editing mode', () => {
    const holder = ref<HTMLElement | null>(null)
    const fake = createFakeEditor()
    const toolbar = useInlineFormatToolbar({
      holder,
      getEditor: () => fake.editor,
      sanitizeHref: (raw) => raw
    })

    toolbar.wrapSelectionWithWikilink()

    expect(fake.tr.insertText).toHaveBeenCalledWith('[[My selected note]]', 2, 8)
    expect(fake.tr.setMeta).toHaveBeenCalledWith(
      WIKILINK_STATE_KEY,
      { type: 'startEditing', range: { from: 2, to: 22 } }
    )
    expect(fake.dispatch).toHaveBeenCalledTimes(2)
    expect(toolbar.formatToolbarOpen.value).toBe(false)
  })
})
