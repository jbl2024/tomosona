import { ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/vue-3'

const slashMenuMock = {
  slashOpen: ref(false),
  slashIndex: ref(0),
  slashLeft: ref(0),
  slashTop: ref(0),
  slashQuery: ref(''),
  visibleSlashCommands: ref([] as Array<{ id: string }>),
  currentTextSelectionContext: vi.fn(() => ({ text: 'Alpha', nodeType: 'paragraph', from: 1, to: 2 })),
  readSlashContext: vi.fn(() => ({ from: 1, to: 2 })),
  closeSlashMenu: vi.fn(),
  dismissSlashMenu: vi.fn(),
  setSlashQuery: vi.fn(),
  markSlashActivatedByUser: vi.fn(),
  openSlashAtSelection: vi.fn(),
  syncSlashMenuFromSelection: vi.fn()
}

const navigationMock = {
  parseOutlineFromDoc: vi.fn(() => [{ text: 'Heading', level: 1, id: 'heading' }]),
  revealSnippet: vi.fn(),
  revealOutlineHeading: vi.fn(),
  revealAnchor: vi.fn()
}

const caretOutlineMock = {
  captureCaret: vi.fn(),
  restoreCaret: vi.fn(() => true),
  clearOutlineTimer: vi.fn(),
  emitOutlineSoon: vi.fn()
}

const wikilinkDataSourceMock = {
  loadWikilinkTargets: vi.fn(async () => ['Target']),
  loadWikilinkHeadings: vi.fn(async () => ['Heading']),
  resolveWikilinkTarget: vi.fn<(target: string) => Promise<boolean>>(async (target: string) => Boolean(target)),
  resetCache: vi.fn()
}

const wikilinkOverlayMock = {
  wikilinkOpen: ref(false),
  wikilinkIndex: ref(0),
  wikilinkLeft: ref(0),
  wikilinkTop: ref(0),
  wikilinkResults: ref([] as Array<{ label: string }>),
  closeWikilinkMenu: vi.fn(),
  syncWikilinkUiFromPluginState: vi.fn(),
  onWikilinkMenuSelect: vi.fn(),
  onWikilinkMenuIndexUpdate: vi.fn()
}

const slashInsertionMock = {
  insertBlockFromDescriptor: vi.fn(() => true)
}

const tiptapSetupMock = {
  createSessionEditor: vi.fn(() => ({ id: 'editor-stub' }))
}

const inputHandlersMock = {
  onEditorKeydown: vi.fn(),
  onEditorKeyup: vi.fn(),
  onEditorContextMenu: vi.fn(),
  onEditorPaste: vi.fn()
}

let capturedTiptapOptions: Record<string, any> | null = null

vi.mock('./useSlashMenu', () => ({
  useSlashMenu: () => slashMenuMock
}))

vi.mock('./useEditorNavigation', () => ({
  useEditorNavigation: () => navigationMock
}))

vi.mock('./useEditorCaretOutline', () => ({
  useEditorCaretOutline: () => caretOutlineMock
}))

vi.mock('./useEditorWikilinkDataSource', () => ({
  useEditorWikilinkDataSource: () => wikilinkDataSourceMock
}))

vi.mock('./useEditorWikilinkOverlayState', () => ({
  useEditorWikilinkOverlayState: () => wikilinkOverlayMock
}))

vi.mock('./useEditorSlashInsertion', () => ({
  useEditorSlashInsertion: () => slashInsertionMock
}))

vi.mock('./useEditorTiptapSetup', () => ({
  useEditorTiptapSetup: (options: Record<string, any>) => {
    capturedTiptapOptions = options
    return tiptapSetupMock
  }
}))

vi.mock('./useEditorInputHandlers', () => ({
  useEditorInputHandlers: () => inputHandlersMock
}))

import { useEditorInteractionRuntime } from './useEditorInteractionRuntime'

function createEditorStub() {
  return {
    state: {
      selection: { from: 1, to: 2, empty: false },
      doc: {
        textBetween: vi.fn(() => 'Alpha'),
        descendants: vi.fn()
      }
    },
    getText: vi.fn(() => 'Alpha'),
    chain: vi.fn(() => ({
      focus: vi.fn(() => ({
        setTextSelection: vi.fn(() => ({
          extendMarkRange: vi.fn(() => ({ run: vi.fn(() => true) })),
          insertContent: vi.fn(() => ({ run: vi.fn(() => true) }))
        })),
        insertContent: vi.fn(() => ({ run: vi.fn(() => true) }))
      }))
    })),
    commands: {
      focus: vi.fn()
    },
    isActive: vi.fn(() => true)
  } as unknown as Editor
}

function createRuntimeHarness(input?: {
  session?: { dirty?: boolean; editor?: Editor | null } | null
  currentPath?: string
  activeEditor?: Ref<Editor | null>
}) {
  const activeEditor = input?.activeEditor ?? (ref<Editor | null>(createEditorStub()) as Ref<Editor | null>)
  const holder = ref(document.createElement('div'))
  document.body.appendChild(holder.value)
  const saveCurrentFile = vi.fn(async () => {})
  const openLinkTarget = vi.fn(async () => true)
  const runtime = useEditorInteractionRuntime({
    interactionDocumentPort: {
      currentPath: ref(input?.currentPath ?? 'a.md'),
      holder,
      activeEditor,
      getSession: () => (input?.session ?? null) as any,
      saveCurrentFile,
      onEditorDocChanged: vi.fn()
    },
    interactionEditorPort: {
      emitOutline: vi.fn(),
      requestMermaidReplaceConfirm: vi.fn(async () => true),
      openMermaidPreview: vi.fn()
    },
    interactionChromePort: {
      menus: {
        blockMenuOpen: ref(false),
        tableToolbarOpen: ref(false),
        isDragMenuOpen: () => false,
        closeBlockMenu: vi.fn(),
        hideTableToolbar: vi.fn()
      },
      blockHandles: {
        syncSelectionTarget: vi.fn()
      },
      toolbars: {
        updateFormattingToolbar: vi.fn(),
        updateTableToolbar: vi.fn(),
        inlineFormatToolbar: {
          updateFormattingToolbar: vi.fn(),
          openLinkPopover: vi.fn(),
          linkPopoverOpen: ref(false),
          cancelLink: vi.fn()
        }
      },
      zoom: {
        zoomEditorBy: vi.fn(() => 1),
        resetEditorZoom: vi.fn(() => 1)
      }
    },
    interactionIoPort: {
      loadLinkTargets: async () => ['a.md'],
      loadLinkHeadings: async () => ['H1'],
      openLinkTarget,
      openExternalUrl: vi.fn(async () => {})
    }
  })

  return {
    runtime,
    holder,
    activeEditor,
    saveCurrentFile,
    openLinkTarget
  }
}

describe('useEditorInteractionRuntime', () => {
  beforeEach(() => {
    capturedTiptapOptions = null
    vi.clearAllMocks()
    navigationMock.parseOutlineFromDoc.mockReturnValue([{ text: 'Heading', level: 1, id: 'heading' }])
    wikilinkDataSourceMock.loadWikilinkTargets.mockResolvedValue(['Target'])
    wikilinkDataSourceMock.loadWikilinkHeadings.mockResolvedValue(['Heading'])
    wikilinkDataSourceMock.resolveWikilinkTarget.mockImplementation(async (target: string) => Boolean(target))
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('saves before opening a link target when the current session is dirty', async () => {
    const session = { dirty: true, editor: createEditorStub() }
    const harness = createRuntimeHarness({ session })
    harness.saveCurrentFile.mockImplementationOnce(async () => {
      session.dirty = false
    })

    await harness.runtime.openLinkTargetWithAutosave('b.md')

    expect(harness.saveCurrentFile).toHaveBeenCalledWith(false)
    expect(harness.openLinkTarget).toHaveBeenCalledWith('b.md')
  })

  it('does not open a link target when the active document stays dirty after autosave', async () => {
    const session = { dirty: true, editor: createEditorStub() }
    const harness = createRuntimeHarness({ session })

    await harness.runtime.openLinkTargetWithAutosave('b.md')

    expect(harness.saveCurrentFile).toHaveBeenCalledWith(false)
    expect(harness.openLinkTarget).not.toHaveBeenCalled()
  })

  it('opens a link target directly when there is no dirty active session', async () => {
    const harness = createRuntimeHarness({ session: null })

    await harness.runtime.openLinkTargetWithAutosave('b.md')

    expect(harness.saveCurrentFile).not.toHaveBeenCalled()
    expect(harness.openLinkTarget).toHaveBeenCalledWith('b.md')
  })

  it('tracks recent interaction time for caret capture gating', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-09T10:00:00Z'))
    const harness = createRuntimeHarness()

    harness.runtime.markEditorInteraction()

    expect(capturedTiptapOptions?.shouldCaptureCaret).toBeTypeOf('function')
    vi.useRealTimers()
  })

  it('allows caret capture only for the active focused editor within the interaction window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-09T10:00:00Z'))
    const harness = createRuntimeHarness()
    const focusTarget = document.createElement('button')
    harness.holder.value.appendChild(focusTarget)
    focusTarget.focus()

    harness.runtime.markEditorInteraction()
    expect(capturedTiptapOptions?.shouldCaptureCaret('a.md')).toBe(true)

    vi.advanceTimersByTime(1300)
    expect(capturedTiptapOptions?.shouldCaptureCaret('a.md')).toBe(false)
    expect(capturedTiptapOptions?.shouldCaptureCaret('other.md')).toBe(false)

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    harness.runtime.markEditorInteraction()
    expect(capturedTiptapOptions?.shouldCaptureCaret('a.md')).toBe(false)
    vi.useRealTimers()
  })

  it('builds wikilink candidates from targets, headings, current headings, and resolver', async () => {
    const harness = createRuntimeHarness()

    const candidates = await harness.runtime.getWikilinkCandidates('target#hea')

    expect(wikilinkDataSourceMock.loadWikilinkHeadings).toHaveBeenCalledWith('target')
    expect(navigationMock.parseOutlineFromDoc).not.toHaveBeenCalled()
    expect(candidates[0]?.target).toContain('#')
    expect(Array.isArray(candidates)).toBe(true)
  })

  it('tolerates empty wikilink sources', async () => {
    wikilinkDataSourceMock.loadWikilinkTargets.mockResolvedValueOnce([])
    wikilinkDataSourceMock.loadWikilinkHeadings.mockResolvedValueOnce([])
    navigationMock.parseOutlineFromDoc.mockReturnValueOnce([])
    const harness = createRuntimeHarness()

    const candidates = await harness.runtime.getWikilinkCandidates('x')

    expect(candidates).toEqual([
      expect.objectContaining({
        target: 'x',
        exists: false,
        isCreate: true
      })
    ])
  })

  it('delegates key, paste, and contextmenu handlers through the input runtime', () => {
    const harness = createRuntimeHarness()
    const keyboardEvent = new KeyboardEvent('keydown', { key: 'Escape' })
    const mouseEvent = new MouseEvent('contextmenu')
    const clipboardEvent = new Event('paste') as ClipboardEvent

    harness.runtime.onEditorKeydown(keyboardEvent)
    harness.runtime.onEditorKeyup()
    harness.runtime.onEditorContextMenu(mouseEvent)
    harness.runtime.onEditorPaste(clipboardEvent)

    expect(inputHandlersMock.onEditorKeydown).toHaveBeenCalledWith(keyboardEvent)
    expect(inputHandlersMock.onEditorKeyup).toHaveBeenCalled()
    expect(inputHandlersMock.onEditorContextMenu).toHaveBeenCalledWith(mouseEvent)
    expect(inputHandlersMock.onEditorPaste).toHaveBeenCalledWith(clipboardEvent)
  })

  it('keeps navigation helpers exposed and callable', () => {
    const harness = createRuntimeHarness()

    harness.runtime.revealSnippet('snippet')
    harness.runtime.revealOutlineHeading(0)
    harness.runtime.revealAnchor({ heading: 'anchor' })

    expect(navigationMock.revealSnippet).toHaveBeenCalledWith('snippet')
    expect(navigationMock.revealOutlineHeading).toHaveBeenCalledWith(0)
    expect(navigationMock.revealAnchor).toHaveBeenCalledWith({ heading: 'anchor' })
  })

  it('creates session editors through the tiptap setup runtime', () => {
    const harness = createRuntimeHarness()

    expect(harness.runtime.createSessionEditor('a.md')).toEqual({ id: 'editor-stub' })
    expect(tiptapSetupMock.createSessionEditor).toHaveBeenCalledWith('a.md')
  })
})
