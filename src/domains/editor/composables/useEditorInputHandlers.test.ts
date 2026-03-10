import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/vue-3'
import { useEditorInputHandlers } from './useEditorInputHandlers'

function createHandlers(overrides: Partial<Parameters<typeof useEditorInputHandlers>[0]> = {}) {
  const insertContent = vi.fn()
  const editor = {
    chain: () => ({
      focus: () => ({
        insertContent: (...args: unknown[]) => {
          insertContent(...args)
          return { run: () => true }
        }
      })
    })
  } as unknown as Editor

  const options: Parameters<typeof useEditorInputHandlers>[0] = {
    editingPort: {
      getEditor: () => editor,
      currentPath: ref('a.md'),
      captureCaret: vi.fn(),
      currentTextSelectionContext: () => ({ text: '/quote', nodeType: 'paragraph', from: 1, to: 7 }),
      insertBlockFromDescriptor: vi.fn(() => true)
    },
    menusPort: {
      visibleSlashCommands: ref([{ id: 'quote', label: 'Quote', type: 'quote', data: {} }]),
      slashOpen: ref(true),
      slashIndex: ref(0),
      closeSlashMenu: vi.fn(),
      blockMenuOpen: ref(false),
      closeBlockMenu: vi.fn(),
      tableToolbarOpen: ref(false),
      hideTableToolbar: vi.fn(),
      inlineFormatToolbar: {
        linkPopoverOpen: ref(false),
        cancelLink: vi.fn()
      }
    },
    uiPort: {
      updateFormattingToolbar: vi.fn(),
      updateTableToolbar: vi.fn(),
      syncSlashMenuFromSelection: vi.fn()
    },
    zoomPort: {
      zoomEditorBy: vi.fn(() => 1),
      resetEditorZoom: vi.fn(() => 1)
    },
    ...overrides
  }

  return { handlers: useEditorInputHandlers(options), options, insertContent }
}

describe('useEditorInputHandlers', () => {
  it('moves slash selection with arrow keys', () => {
    const { handlers, options } = createHandlers({
      menusPort: {
        visibleSlashCommands: ref([
          { id: 'quote', label: 'Quote', type: 'quote', data: {} },
          { id: 'code', label: 'Code', type: 'code', data: {} }
        ]),
        slashOpen: ref(true),
        slashIndex: ref(0),
        closeSlashMenu: vi.fn(),
        blockMenuOpen: ref(false),
        closeBlockMenu: vi.fn(),
        tableToolbarOpen: ref(false),
        hideTableToolbar: vi.fn(),
        inlineFormatToolbar: {
          linkPopoverOpen: ref(false),
          cancelLink: vi.fn()
        }
      }
    })

    handlers.onEditorKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(options.menusPort.slashIndex.value).toBe(1)

    handlers.onEditorKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    expect(options.menusPort.slashIndex.value).toBe(0)
  })

  it('handles slash Enter selection', () => {
    const { handlers, options } = createHandlers()
    const event = new KeyboardEvent('keydown', { key: 'Enter' })
    handlers.onEditorKeydown(event)
    expect(options.menusPort.closeSlashMenu).toHaveBeenCalledTimes(1)
    expect(options.editingPort.insertBlockFromDescriptor).toHaveBeenCalledWith('quote', {})
  })

  it('routes keyup refresh hooks', () => {
    const { handlers, options } = createHandlers()
    handlers.onEditorKeyup()
    expect(options.editingPort.captureCaret).toHaveBeenCalledWith('a.md')
    expect(options.uiPort.syncSlashMenuFromSelection).toHaveBeenCalledWith({ preserveIndex: true })
    expect(options.uiPort.updateFormattingToolbar).toHaveBeenCalledTimes(1)
    expect(options.uiPort.updateTableToolbar).toHaveBeenCalledTimes(1)
  })

  it('does not resync slash menu on Escape when it is closed', () => {
    const { handlers, options } = createHandlers({
      menusPort: {
        visibleSlashCommands: ref([{ id: 'quote', label: 'Quote', type: 'quote', data: {} }]),
        slashOpen: ref(false),
        slashIndex: ref(0),
        closeSlashMenu: vi.fn(),
        blockMenuOpen: ref(false),
        closeBlockMenu: vi.fn(),
        tableToolbarOpen: ref(false),
        hideTableToolbar: vi.fn(),
        inlineFormatToolbar: {
          linkPopoverOpen: ref(false),
          cancelLink: vi.fn()
        }
      }
    })

    handlers.onEditorKeydown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(options.uiPort.syncSlashMenuFromSelection).not.toHaveBeenCalled()
  })

  it('converts markdown paste to editor json content', () => {
    const { handlers, insertContent } = createHandlers({
      menusPort: {
        visibleSlashCommands: ref([{ id: 'quote', label: 'Quote', type: 'quote', data: {} }]),
        slashOpen: ref(false),
        slashIndex: ref(0),
        closeSlashMenu: vi.fn(),
        blockMenuOpen: ref(false),
        closeBlockMenu: vi.fn(),
        tableToolbarOpen: ref(false),
        hideTableToolbar: vi.fn(),
        inlineFormatToolbar: {
          linkPopoverOpen: ref(false),
          cancelLink: vi.fn()
        }
      },
      editingPort: {
        getEditor: () => ({ chain: () => ({ focus: () => ({ insertContent: (...args: unknown[]) => { insertContent(...args); return { run: () => true } } }) }) } as unknown as Editor),
        currentPath: ref('a.md'),
        captureCaret: vi.fn(),
        currentTextSelectionContext: () => null,
        insertBlockFromDescriptor: vi.fn(() => true)
      }
    })

    const clipboardData = {
      getData: (kind: string) => (kind === 'text/plain' ? '# title' : '')
    }
    const event = {
      clipboardData,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as ClipboardEvent

    handlers.onEditorPaste(event)
    expect(insertContent).toHaveBeenCalledTimes(1)
  })

  it('converts structured html paste to editor json content', () => {
    const { handlers, insertContent } = createHandlers({
      menusPort: {
        visibleSlashCommands: ref([{ id: 'quote', label: 'Quote', type: 'quote', data: {} }]),
        slashOpen: ref(false),
        slashIndex: ref(0),
        closeSlashMenu: vi.fn(),
        blockMenuOpen: ref(false),
        closeBlockMenu: vi.fn(),
        tableToolbarOpen: ref(false),
        hideTableToolbar: vi.fn(),
        inlineFormatToolbar: {
          linkPopoverOpen: ref(false),
          cancelLink: vi.fn()
        }
      }
    })

    const event = {
      clipboardData: {
        getData: (kind: string) => (kind === 'text/html' ? '<h2>Title</h2><ul><li>First</li></ul>' : '')
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as ClipboardEvent

    handlers.onEditorPaste(event)
    expect(insertContent).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('falls back to native paste when html and plain are low-confidence', () => {
    const { handlers, insertContent } = createHandlers({
      menusPort: {
        visibleSlashCommands: ref([{ id: 'quote', label: 'Quote', type: 'quote', data: {} }]),
        slashOpen: ref(false),
        slashIndex: ref(0),
        closeSlashMenu: vi.fn(),
        blockMenuOpen: ref(false),
        closeBlockMenu: vi.fn(),
        tableToolbarOpen: ref(false),
        hideTableToolbar: vi.fn(),
        inlineFormatToolbar: {
          linkPopoverOpen: ref(false),
          cancelLink: vi.fn()
        }
      }
    })

    const event = {
      clipboardData: {
        getData: (kind: string) => {
          if (kind === 'text/plain') return 'just text'
          if (kind === 'text/html') return '<div><strong>Hello</strong></div>'
          return ''
        }
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as ClipboardEvent

    handlers.onEditorPaste(event)
    expect(insertContent).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })

  it('keeps native paste inside code blocks', () => {
    const insertContent = vi.fn()
    const editor = {
      state: {
        selection: {
          $from: {
            parent: {
              type: { name: 'codeBlock' }
            },
            marks: () => []
          }
        }
      },
      chain: () => ({
        focus: () => ({
          insertContent: (...args: unknown[]) => {
            insertContent(...args)
            return { run: () => true }
          }
        })
      })
    } as unknown as Editor

    const { handlers } = createHandlers({
      menusPort: {
        visibleSlashCommands: ref([]),
        slashOpen: ref(false),
        slashIndex: ref(0),
        closeSlashMenu: vi.fn(),
        blockMenuOpen: ref(false),
        closeBlockMenu: vi.fn(),
        tableToolbarOpen: ref(false),
        hideTableToolbar: vi.fn(),
        inlineFormatToolbar: {
          linkPopoverOpen: ref(false),
          cancelLink: vi.fn()
        }
      },
      editingPort: {
        getEditor: () => editor,
        currentPath: ref('a.md'),
        captureCaret: vi.fn(),
        currentTextSelectionContext: () => null,
        insertBlockFromDescriptor: vi.fn(() => true)
      }
    })

    const event = {
      clipboardData: {
        getData: (kind: string) => (kind === 'text/plain' ? '# title' : '')
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as ClipboardEvent

    handlers.onEditorPaste(event)
    expect(insertContent).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })

  it('replaces current paragraph when heading markdown with text is converted', () => {
    const { handlers, options } = createHandlers({
      menusPort: {
        visibleSlashCommands: ref([]),
        slashOpen: ref(false),
        slashIndex: ref(0),
        closeSlashMenu: vi.fn(),
        blockMenuOpen: ref(false),
        closeBlockMenu: vi.fn(),
        tableToolbarOpen: ref(false),
        hideTableToolbar: vi.fn(),
        inlineFormatToolbar: {
          linkPopoverOpen: ref(false),
          cancelLink: vi.fn()
        }
      },
      editingPort: {
        getEditor: () => ({ chain: () => ({ focus: () => ({ insertContent: vi.fn(() => ({ run: () => true })) }) }) } as unknown as Editor),
        currentPath: ref('a.md'),
        captureCaret: vi.fn(),
        currentTextSelectionContext: () => ({ text: '## title', nodeType: 'paragraph', from: 10, to: 18 }),
        insertBlockFromDescriptor: vi.fn(() => true)
      }
    })

    handlers.onEditorKeydown(new KeyboardEvent('keydown', { key: ' ', code: 'Space' }))

    expect(options.editingPort.insertBlockFromDescriptor).toHaveBeenCalledWith(
      'header',
      { text: 'title', level: 2 },
      { replaceRange: { from: 10, to: 18 } }
    )
  })
})
