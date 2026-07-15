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
    markAtActivatedByUser: vi.fn(),
    syncSlashMenuFromSelection: vi.fn(),
    syncAtMenuFromSelection: vi.fn(),
    syncBlockHandleFromSelection: vi.fn(),
    updateTableToolbar: vi.fn(),
    syncWikilinkUiFromPluginState: vi.fn(),
    captureCaret: vi.fn(),
    updateFormattingToolbar: vi.fn(),
    onEditorDocChanged: vi.fn(),
    requestMermaidReplaceConfirm: vi.fn(async () => true),
    openMermaidPreview: vi.fn(),
    openAssetPreview: vi.fn(),
    getAssetBrowserItems: vi.fn(() => [{ id: 'asset-media:/vault/assets/preview.png', label: 'preview.png', meta: 'assets/preview.png', path: '/vault/assets/preview.png' }]),
    getWikilinkCandidates: vi.fn(async () => [{ target: 'a.md', exists: true }]),
    openLinkTargetWithAutosave: vi.fn(async () => {}),
    loadEmbeddedNotePreview: vi.fn(async () => null),
    restoreEmbeddedNoteInline: vi.fn(async () => {}),
    revealAnchor: vi.fn(async () => true),
    resolveWikilinkTarget: vi.fn(async () => true),
    sanitizeExternalHref: (v) => v,
    openExternalUrl: vi.fn(async () => {}),
    getSpellcheckLanguage: vi.fn(() => 'fr' as const),
    spellcheckEnabled: ref(false),
    isSpellcheckWordIgnored: vi.fn(() => false),
    inlineFormatToolbar: {
      updateFormattingToolbar: vi.fn(),
      openLinkPopover: vi.fn()
    },
    ...overrides
  }
  return { setup: useEditorTiptapSetup(options), options }
}

describe('useEditorTiptapSetup', () => {
  it('keeps text typed after a pasted URL outside the link', () => {
    const OriginalClipboardEvent = globalThis.ClipboardEvent
    const OriginalDataTransfer = globalThis.DataTransfer
    class TestDataTransfer {
      private data = new Map<string, string>()
      getData(type: string) { return this.data.get(type) ?? '' }
      setData(type: string, value: string) { this.data.set(type, value) }
    }
    class TestClipboardEvent extends Event {
      clipboardData: TestDataTransfer | null
      constructor(type: string, init?: { clipboardData?: TestDataTransfer }) {
        super(type)
        this.clipboardData = init?.clipboardData ?? null
      }
    }
    vi.stubGlobal('DataTransfer', TestDataTransfer)
    vi.stubGlobal('ClipboardEvent', TestClipboardEvent)
    const { setup } = createSetup()
    const editor = setup.createSessionEditor('a.md')

    try {
      editor.commands.insertContent('https://example.com', { applyPasteRules: true })
      editor.commands.insertContent(' suite')

      const content = editor.getJSON().content?.[0]?.content
      expect(content).toHaveLength(2)
      expect(content?.[0]).toMatchObject({
        type: 'text',
        marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        text: 'https://example.com'
      })
      expect(content?.[1]).toEqual({ type: 'text', text: ' suite' })
    } finally {
      editor.destroy()
      vi.stubGlobal('ClipboardEvent', OriginalClipboardEvent)
      vi.stubGlobal('DataTransfer', OriginalDataTransfer)
    }
  })

  it('exposes expected extension contract', () => {
    const { setup } = createSetup()
    const editorOptions = setup.createEditorOptions('a.md') as any
    const extensionNames = (editorOptions.extensions ?? []).map((extension: { name?: string }) => extension.name)
    const codeBlock = (editorOptions.extensions ?? []).find((extension: { name?: string }) => extension.name === 'codeBlock')

    expect(Array.isArray(editorOptions.extensions)).toBe(true)
    expect(editorOptions.extensions.length).toBeGreaterThan(8)
    expect(editorOptions.injectCSS).toBe(false)
    expect(extensionNames).toContain('spellcheck')
    expect(extensionNames).toContain('tableCellAlign')
    expect(codeBlock?.options?.exitOnTripleEnter).toBe(false)
    expect(editorOptions.editorProps.attributes.spellcheck).toBe('true')
    expect(editorOptions.editorProps.attributes.lang).toBe('fr')
    expect(typeof editorOptions.editorProps.handleDOMEvents.click).toBe('function')
    expect(typeof editorOptions.editorProps.handleClick).toBe('function')
  })

  it('resolves asset previews against the current note path', () => {
    const { setup } = createSetup()
    const editorOptions = setup.createEditorOptions('/vault/gestion_parc/glpi/current.md') as any
    const assetExtension = (editorOptions.extensions ?? []).find((extension: { name?: string }) => extension.name === 'assetBlock')

    expect(assetExtension?.options?.resolvePreviewSrc('../../assets/images/kyPZV79XlEaFswpDL5cP47SlAfy25fO6fnN9FEM-TUY%3D.png')).toBe(
      '/vault/assets/images/kyPZV79XlEaFswpDL5cP47SlAfy25fO6fnN9FEM-TUY=.png'
    )
  })

  it('passes the media catalog provider to the asset node extension', () => {
    const { setup, options } = createSetup()
    const editorOptions = setup.createEditorOptions('/vault/a.md') as any
    const assetExtension = (editorOptions.extensions ?? []).find((extension: { name?: string }) => extension.name === 'assetBlock')

    expect(assetExtension?.options?.getAssetBrowserItems?.()).toEqual([
      { id: 'asset-media:/vault/assets/preview.png', label: 'preview.png', meta: 'assets/preview.png', path: '/vault/assets/preview.png' }
    ])
    expect(options.getAssetBrowserItems).toHaveBeenCalled()
  })

  it('stores imported assets relative to the current note', async () => {
    const importAssetFiles = vi.fn(async () => [
      '/vault/assets/Capture écran.png',
      '/vault/assets/report.pdf'
    ])
    const { setup } = createSetup({ importAssetFiles })
    const editorOptions = setup.createEditorOptions('/vault/notes/projects/current.md') as any
    const assetExtension = (editorOptions.extensions ?? []).find((extension: { name?: string }) => extension.name === 'assetBlock')

    await expect(assetExtension?.options?.importAssetFiles?.()).resolves.toEqual([
      '../../assets/Capture écran.png',
      '../../assets/report.pdf'
    ])
  })

  it('dispatches update/selection/transaction callbacks', () => {
    const { setup, options } = createSetup()
    const editorOptions = setup.createEditorOptions('a.md') as any

    editorOptions.onUpdate()
    editorOptions.onSelectionUpdate()
    editorOptions.onTransaction({ transaction: { docChanged: true } })

    expect(options.syncSlashMenuFromSelection).toHaveBeenCalled()
    expect(options.syncAtMenuFromSelection).toHaveBeenCalled()
    expect(options.syncBlockHandleFromSelection).toHaveBeenCalled()
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
    expect(options.syncAtMenuFromSelection).toHaveBeenCalled()
    expect(options.syncBlockHandleFromSelection).toHaveBeenCalled()
    expect(options.updateFormattingToolbar).toHaveBeenCalled()
  })

  it('refreshes the block handle on doc changes so heading level edits update the gutter in real time', () => {
    const { setup, options } = createSetup()
    const editorOptions = setup.createEditorOptions('a.md') as any

    editorOptions.onTransaction({ transaction: { docChanged: true } })

    expect(options.onEditorDocChanged).toHaveBeenCalledWith('a.md')
    expect(options.syncBlockHandleFromSelection).toHaveBeenCalled()
  })

  it('syncs the @ menu from selection updates after user activation', () => {
    const { setup, options } = createSetup()
    const editorOptions = setup.createEditorOptions('a.md') as any

    editorOptions.editorProps.handleKeyDown(
      {
        state: {
          selection: {
            empty: true,
            $from: {
              parent: {
                isTextblock: true,
                textContent: 'Draft @',
                type: { name: 'paragraph' }
              },
              parentOffset: 7,
              start: () => 1,
              end: () => 8,
              marks: () => []
            }
          }
        }
      } as any,
      {
        key: '@',
        metaKey: false,
        ctrlKey: false,
        altKey: false
      } as KeyboardEvent
    )

    editorOptions.onSelectionUpdate()

    expect(options.markAtActivatedByUser).toHaveBeenCalledTimes(1)
    expect(options.syncAtMenuFromSelection).toHaveBeenCalled()
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

  it('routes wikilink, markdown, and external anchors through the correct handler precedence', async () => {
    const openLinkTargetWithAutosave = vi.fn(async () => {})
    const openExternalUrl = vi.fn(async () => {})
    const revealAnchor = vi.fn(async () => true)
    const { setup } = createSetup({ openLinkTargetWithAutosave, openExternalUrl, revealAnchor })
    const editorOptions = setup.createEditorOptions('docs/current.md') as any

    const view = {
      state: { doc: { content: { size: 100 } } },
      posAtDOM: vi.fn(() => 10)
    } as any

    const cases = [
      {
        name: 'wikilink target',
        anchor: () => {
          const element = document.createElement('a')
          element.setAttribute('data-target', 'folder/note.md')
          element.setAttribute('href', 'https://example.com')
          return element
        },
        expected: () => expect(openLinkTargetWithAutosave).toHaveBeenCalledWith('folder/note.md')
      },
      {
        name: 'markdown target marker',
        anchor: () => {
          const element = document.createElement('a')
          element.setAttribute('data-markdown-target', 'mattermost/index.md')
          element.setAttribute('href', 'https://example.com')
          return element
        },
        expected: () => expect(openLinkTargetWithAutosave).toHaveBeenCalledWith('mattermost/index.md')
      },
      {
        name: 'plain markdown href',
        anchor: () => {
          const element = document.createElement('a')
          element.setAttribute('href', 'mattermost/index.md')
          return element
        },
        expected: () => expect(openLinkTargetWithAutosave).toHaveBeenCalledWith('docs/mattermost/index.md')
      },
      {
        name: 'external url',
        anchor: () => {
          const element = document.createElement('a')
          element.setAttribute('href', 'https://example.com')
          return element
        },
        expected: () => expect(openExternalUrl).toHaveBeenCalledWith('https://example.com')
      },
      {
        name: 'internal anchor',
        anchor: () => {
          const element = document.createElement('a')
          element.setAttribute('href', '#section')
          return element
        },
        expected: () => expect(revealAnchor).toHaveBeenCalledWith({ heading: 'section' })
      }
    ] as const

    for (const testCase of cases) {
      openLinkTargetWithAutosave.mockClear()
      openExternalUrl.mockClear()
      revealAnchor.mockClear()

      const click = editorOptions.editorProps.handleClick(view, 3, {
        target: testCase.anchor(),
        metaKey: false,
        ctrlKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      })

      expect(click).toBe(true)
      testCase.expected()
    }
  })

  it('opens relative markdown file links inside the app', () => {
    const openLinkTargetWithAutosave = vi.fn(async () => {})
    const { setup } = createSetup({ openLinkTargetWithAutosave })
    const editorOptions = setup.createEditorOptions('docs/current.md') as any

    const view = {
      state: { doc: { content: { size: 100 } } }
    } as any

    const relativeAnchor = document.createElement('a')
    relativeAnchor.setAttribute('href', './install_pc.md')
    const click = editorOptions.editorProps.handleClick(view, 3, {
      target: relativeAnchor,
      metaKey: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    })

    expect(click).toBe(true)
    expect(openLinkTargetWithAutosave).toHaveBeenCalledWith('docs/install_pc.md')
  })

  it('opens relative markdown links without a leading dot as internal targets', () => {
    const openLinkTargetWithAutosave = vi.fn(async () => {})
    const { setup } = createSetup({ openLinkTargetWithAutosave })
    const editorOptions = setup.createEditorOptions('docs/current.md') as any

    const view = {
      state: { doc: { content: { size: 100 } } }
    } as any

    const relativeAnchor = document.createElement('a')
    relativeAnchor.setAttribute('href', 'mattermost/index.md')

    const click = editorOptions.editorProps.handleClick(view, 3, {
      target: relativeAnchor,
      metaKey: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    })

    expect(click).toBe(true)
    expect(openLinkTargetWithAutosave).toHaveBeenCalledWith('docs/mattermost/index.md')
  })

  it('opens bare relative note links inside the app', () => {
    const openLinkTargetWithAutosave = vi.fn(async () => {})
    const { setup } = createSetup({ openLinkTargetWithAutosave })
    const editorOptions = setup.createEditorOptions('docs/current.md') as any

    const view = {
      state: { doc: { content: { size: 100 } } }
    } as any

    const relativeAnchor = document.createElement('a')
    relativeAnchor.setAttribute('href', 'creer_formulaire_glpi')
    const click = editorOptions.editorProps.handleClick(view, 3, {
      target: relativeAnchor,
      metaKey: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    })

    expect(click).toBe(true)
    expect(openLinkTargetWithAutosave).toHaveBeenCalledWith('docs/creer_formulaire_glpi')
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

  it('intercepts internal anchor DOM clicks before browser navigation', () => {
    const revealAnchor = vi.fn(async () => true)
    const { setup } = createSetup({ revealAnchor })
    const editorOptions = setup.createEditorOptions('a.md') as any

    const view = {
      state: { doc: { content: { size: 100 } } },
      posAtDOM: vi.fn(() => 14)
    } as any

    const internalAnchor = document.createElement('a')
    internalAnchor.setAttribute('href', '#1-scuriser-lexistant')
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()

    const click = editorOptions.editorProps.handleDOMEvents.click(view, {
      target: internalAnchor,
      metaKey: false,
      ctrlKey: false,
      preventDefault,
      stopPropagation
    })

    expect(click).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalledTimes(1)
    expect(revealAnchor).toHaveBeenCalledWith({ heading: '1-scuriser-lexistant' })
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

  it('promotes a heading when Linux reports Shift+Tab as ISO_Left_Tab', () => {
    const { setup } = createSetup()
    const editorOptions = setup.createEditorOptions('a.md') as any

    const setNodeMarkup = vi.fn(() => ({ step: 'setNodeMarkup' }))
    const dispatch = vi.fn()
    const event = {
      key: 'ISO_Left_Tab',
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

  it('marks @ macros as user activated on keydown', () => {
    const { setup, options } = createSetup()
    const editorOptions = setup.createEditorOptions('a.md') as any

    const handled = editorOptions.editorProps.handleKeyDown(
      {
        state: {
          selection: {
            empty: true,
            $from: {
              parent: {
                isTextblock: true,
                textContent: 'Draft @',
                type: { name: 'paragraph' }
              },
              parentOffset: 7,
              start: () => 1,
              end: () => 8,
              marks: () => []
            }
          }
        }
      } as any,
      {
        key: '@',
        metaKey: false,
        ctrlKey: false,
        altKey: false
      } as KeyboardEvent
    )

    expect(handled).toBe(false)
    expect(options.markAtActivatedByUser).toHaveBeenCalledTimes(1)
  })
})
