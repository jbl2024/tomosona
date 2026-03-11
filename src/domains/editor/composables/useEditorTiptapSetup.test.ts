import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useEditorTiptapSetup } from './useEditorTiptapSetup'

function createSetup(overrides: Partial<Parameters<typeof useEditorTiptapSetup>[0]> = {}) {
  const currentPath = ref('a.md')
  const currentEditor = {
    chain: () => ({ focus: () => ({ setTextSelection: () => ({ extendMarkRange: () => ({ run: () => true }) }) }) }),
    state: { selection: { from: 1, to: 2, empty: false } },
    isActive: () => true
  } as any
  const options: Parameters<typeof useEditorTiptapSetup>[0] = {
    currentPath,
    getCurrentEditor: () => currentEditor,
    getSessionEditor: () => null,
    markSlashActivatedByUser: vi.fn(),
    syncSlashMenuFromSelection: vi.fn(),
    updateTableToolbar: vi.fn(),
    syncWikilinkUiFromPluginState: vi.fn(),
    captureCaret: vi.fn(),
    updateFormattingToolbar: vi.fn(),
    onEditorDocChanged: vi.fn(),
    requestMermaidReplaceConfirm: vi.fn(async () => true),
    openMermaidPreview: vi.fn(),
    getWikilinkCandidates: vi.fn(async () => [{ target: 'a.md', exists: true }]),
    openLinkTargetWithAutosave: vi.fn(async () => {}),
    revealAnchor: vi.fn(async () => true),
    resolveWikilinkTarget: vi.fn(async () => true),
    sanitizeExternalHref: (v) => v,
    openExternalUrl: vi.fn(async () => {}),
    inlineFormatToolbar: {
      updateFormattingToolbar: vi.fn(),
      openLinkPopover: vi.fn()
    },
    ...overrides
  }
  return { setup: useEditorTiptapSetup(options), options }
}

describe('useEditorTiptapSetup', () => {
  it('exposes expected extension contract', () => {
    const { setup } = createSetup()
    const editorOptions = setup.createEditorOptions('a.md') as any
    const extensionNames = (editorOptions.extensions ?? []).map((extension: { name?: string }) => extension.name)
    const codeBlock = (editorOptions.extensions ?? []).find((extension: { name?: string }) => extension.name === 'codeBlock')

    expect(Array.isArray(editorOptions.extensions)).toBe(true)
    expect(editorOptions.extensions.length).toBeGreaterThan(8)
    expect(editorOptions.injectCSS).toBe(false)
    expect(extensionNames).toContain('tableCellAlign')
    expect(codeBlock?.options?.exitOnTripleEnter).toBe(false)
    expect(typeof editorOptions.editorProps.handleClick).toBe('function')
  })

  it('dispatches update/selection/transaction callbacks', () => {
    const { setup, options } = createSetup()
    const editorOptions = setup.createEditorOptions('a.md') as any

    editorOptions.onUpdate()
    editorOptions.onSelectionUpdate()
    editorOptions.onTransaction({ transaction: { docChanged: true } })

    expect(options.syncSlashMenuFromSelection).toHaveBeenCalled()
    expect(options.updateTableToolbar).toHaveBeenCalled()
    expect(options.syncWikilinkUiFromPluginState).toHaveBeenCalled()
    expect(options.captureCaret).toHaveBeenCalledWith('a.md')
    expect(options.onEditorDocChanged).toHaveBeenCalledWith('a.md')
  })

  it('does not capture caret on selection update when capture gate rejects it', () => {
    const { setup, options } = createSetup({
      shouldCaptureCaret: vi.fn(() => false)
    })
    const editorOptions = setup.createEditorOptions('a.md') as any

    editorOptions.onSelectionUpdate()

    expect(options.captureCaret).not.toHaveBeenCalled()
    expect(options.syncSlashMenuFromSelection).toHaveBeenCalled()
    expect(options.updateFormattingToolbar).toHaveBeenCalled()
  })

  it('handles wikilink and external link click behavior', async () => {
    const openLinkTargetWithAutosave = vi.fn(async () => {})
    const openExternalUrl = vi.fn(async () => {})
    const { setup, options } = createSetup({ openLinkTargetWithAutosave, openExternalUrl })
    const editorOptions = setup.createEditorOptions('a.md') as any

    const view = {
      state: { doc: { content: { size: 100 } }, tr: { setMeta: vi.fn(() => ({})) } },
      posAtDOM: vi.fn(() => 10),
      dispatch: vi.fn()
    } as any

    const wikilinkAnchor = document.createElement('a')
    wikilinkAnchor.setAttribute('data-target', 'target.md')
    const wikilinkClick = editorOptions.editorProps.handleClick(view, 3, { target: wikilinkAnchor, metaKey: false, ctrlKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    expect(wikilinkClick).toBe(true)
    expect(openLinkTargetWithAutosave).toHaveBeenCalledWith('target.md')

    const externalAnchor = document.createElement('a')
    externalAnchor.setAttribute('href', 'https://example.com')
    const externalClick = editorOptions.editorProps.handleClick(view, 3, { target: externalAnchor, metaKey: false, ctrlKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    expect(externalClick).toBe(true)
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com')
    expect(options.inlineFormatToolbar.openLinkPopover).not.toHaveBeenCalled()
  })

  it('reveals internal anchor links on plain click', () => {
    const revealAnchor = vi.fn(async () => true)
    const { setup } = createSetup({ revealAnchor })
    const editorOptions = setup.createEditorOptions('a.md') as any

    const view = {
      state: { doc: { content: { size: 100 } } }
    } as any

    const internalAnchor = document.createElement('a')
    internalAnchor.setAttribute('href', '#1-resume')

    const click = editorOptions.editorProps.handleClick(view, 3, {
      target: internalAnchor,
      metaKey: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    })

    expect(click).toBe(true)
    expect(revealAnchor).toHaveBeenCalledWith({ heading: '1-resume' })
  })

  it('opens link popover on modifier-click for internal anchor links', () => {
    const revealAnchor = vi.fn(async () => true)
    const { setup, options } = createSetup({ revealAnchor })
    const editorOptions = setup.createEditorOptions('a.md') as any

    const view = {
      state: { doc: { content: { size: 100 } } },
      posAtDOM: vi.fn(() => 10)
    } as any

    const internalAnchor = document.createElement('a')
    internalAnchor.setAttribute('href', '#^todo-12')

    const click = editorOptions.editorProps.handleClick(view, 3, {
      target: internalAnchor,
      metaKey: true,
      ctrlKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    })

    expect(click).toBe(true)
    expect(options.inlineFormatToolbar.openLinkPopover).toHaveBeenCalledTimes(1)
    expect(revealAnchor).not.toHaveBeenCalled()
  })

  it('ignores empty internal anchor hrefs', () => {
    const revealAnchor = vi.fn(async () => true)
    const { setup } = createSetup({ revealAnchor, sanitizeExternalHref: () => null })
    const editorOptions = setup.createEditorOptions('a.md') as any

    const view = {
      state: { doc: { content: { size: 100 } } }
    } as any

    const internalAnchor = document.createElement('a')
    internalAnchor.setAttribute('href', '#')

    const click = editorOptions.editorProps.handleClick(view, 3, {
      target: internalAnchor,
      metaKey: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    })

    expect(click).toBe(false)
    expect(revealAnchor).not.toHaveBeenCalled()
  })

  it('opens ISO date token on modifier click without anchor', () => {
    const openLinkTargetWithAutosave = vi.fn(async () => {})
    const { setup } = createSetup({ openLinkTargetWithAutosave })
    const editorOptions = setup.createEditorOptions('a.md') as any

    const view = {
      state: {
        doc: {
          content: { size: 100 },
          textBetween: vi.fn(() => 'around 2026-02-23 around')
        }
      }
    } as any

    const textNode = document.createTextNode('2026-02-23')
    const click = editorOptions.editorProps.handleClick(view, 10, {
      target: textNode,
      metaKey: true,
      ctrlKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    })

    expect(click).toBe(true)
    expect(openLinkTargetWithAutosave).toHaveBeenCalledWith('2026-02-23')
  })

  it('demotes a heading when Tab is pressed at the start of the block', () => {
    const { setup } = createSetup()
    const editorOptions = setup.createEditorOptions('a.md') as any

    const setNodeMarkup = vi.fn(() => ({ step: 'setNodeMarkup' }))
    const dispatch = vi.fn()
    const event = {
      key: 'Tab',
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as KeyboardEvent

    const handled = editorOptions.editorProps.handleKeyDown({
      state: {
        selection: {
          empty: true,
          $from: {
            parent: {
              type: { name: 'heading' },
              attrs: { level: 2 }
            },
            parentOffset: 0,
            depth: 1,
            before: vi.fn(() => 12)
          }
        },
        tr: {
          setNodeMarkup
        }
      },
      dispatch
    }, event)

    expect(handled).toBe(true)
    expect(setNodeMarkup).toHaveBeenCalledWith(12, undefined, { level: 3 })
    expect(dispatch).toHaveBeenCalledWith({ step: 'setNodeMarkup' })
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('promotes a heading when Shift+Tab is pressed at the start of the block', () => {
    const { setup } = createSetup()
    const editorOptions = setup.createEditorOptions('a.md') as any

    const setNodeMarkup = vi.fn(() => ({ step: 'setNodeMarkup' }))
    const dispatch = vi.fn()
    const event = {
      key: 'Tab',
      shiftKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as KeyboardEvent

    const handled = editorOptions.editorProps.handleKeyDown({
      state: {
        selection: {
          empty: true,
          $from: {
            parent: {
              type: { name: 'heading' },
              attrs: { level: 3 }
            },
            parentOffset: 0,
            depth: 1,
            before: vi.fn(() => 20)
          }
        },
        tr: {
          setNodeMarkup
        }
      },
      dispatch
    }, event)

    expect(handled).toBe(true)
    expect(setNodeMarkup).toHaveBeenCalledWith(20, undefined, { level: 2 })
    expect(dispatch).toHaveBeenCalledWith({ step: 'setNodeMarkup' })
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('leaves Tab alone when the caret is not at the start of a heading', () => {
    const { setup } = createSetup()
    const editorOptions = setup.createEditorOptions('a.md') as any

    const setNodeMarkup = vi.fn(() => ({ step: 'setNodeMarkup' }))
    const dispatch = vi.fn()
    const event = {
      key: 'Tab',
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as KeyboardEvent

    const handled = editorOptions.editorProps.handleKeyDown({
      state: {
        selection: {
          empty: true,
          $from: {
            parent: {
              type: { name: 'heading' },
              attrs: { level: 2 }
            },
            parentOffset: 1,
            depth: 1,
            before: vi.fn(() => 8)
          }
        },
        tr: {
          setNodeMarkup
        }
      },
      dispatch
    }, event)

    expect(handled).toBe(false)
    expect(setNodeMarkup).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
