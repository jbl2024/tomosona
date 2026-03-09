import { nextTick, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/vue-3'

const previewMarkdown = ref('')
const provenancePaths = ref<string[]>([])
const previewTitle = ref('')
const running = ref(false)
const error = ref('')
const requestId = ref('')
const outputId = ref('')
const runMock = vi.fn(async () => ({ request_id: 'pulse-test', output_id: 'pulse-output' }))
const cancelMock = vi.fn(async () => {})
const resetMock = vi.fn(() => {
  previewMarkdown.value = ''
  provenancePaths.value = []
  previewTitle.value = ''
  running.value = false
  error.value = ''
})
const extractSelectionClipboardPayloadMock = vi.fn<
  (root: HTMLElement) => { plain: string; html: string; markdown: string } | null
>(() => null)
const writeSelectionPayloadToClipboardMock = vi.fn<(payload: unknown, format: unknown) => Promise<void>>(async () => {})

vi.mock('../../pulse/composables/usePulseTransformation', () => ({
  usePulseTransformation: () => ({
    requestId,
    outputId,
    previewMarkdown,
    provenancePaths,
    previewTitle,
    running,
    error,
    run: runMock,
    cancel: cancelMock,
    reset: resetMock
  })
}))

vi.mock('../lib/editorClipboard', () => ({
  extractSelectionClipboardPayload: (root: HTMLElement) => extractSelectionClipboardPayloadMock(root),
  writeSelectionPayloadToClipboard: (payload: unknown, format: unknown) => writeSelectionPayloadToClipboardMock(payload, format)
}))

import { useEditorChromeRuntime } from './useEditorChromeRuntime'

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function createEditorStub(selection = { from: 1, to: 2, empty: false }) {
  return {
    commands: {
      focus: vi.fn(),
      setMeta: vi.fn()
    },
    state: {
      selection,
      tr: {
        setMeta: vi.fn(() => ({}))
      },
      doc: {
        textBetween: vi.fn(() => 'Alpha')
      }
    },
    view: {
      dispatch: vi.fn()
    },
    getText: vi.fn(() => 'Alpha'),
    chain: vi.fn(() => ({
      focus: vi.fn(() => ({
        setTextSelection: vi.fn(() => ({
          insertContent: vi.fn(() => ({ run: vi.fn(() => true) }))
        })),
        insertContent: vi.fn(() => ({ run: vi.fn(() => true) }))
      }))
    }))
  } as unknown as Editor
}

function createClipboardEvent() {
  const event = new Event('copy', { bubbles: true }) as ClipboardEvent
  Object.defineProperty(event, 'preventDefault', {
    configurable: true,
    value: vi.fn()
  })
  Object.defineProperty(event, 'stopPropagation', {
    configurable: true,
    value: vi.fn()
  })
  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: { setData: vi.fn() }
  })
  return event
}

function createRuntimeHarness(input?: {
  activeEditor?: Ref<Editor | null>
  currentPath?: string
}) {
  const activeEditor = input?.activeEditor ?? (ref<Editor | null>(createEditorStub()) as Ref<Editor | null>)
  const holder = ref(document.createElement('div'))
  const contentShell = ref(document.createElement('div'))
  const pulsePanelWrap = ref(document.createElement('div'))
  document.body.appendChild(holder.value)
  document.body.appendChild(contentShell.value)
  document.body.appendChild(pulsePanelWrap.value)
  const interactionMocks = {
    closeSlashMenu: vi.fn(),
    dismissSlashMenu: vi.fn(),
    closeWikilinkMenu: vi.fn(),
    openSlashAtSelection: vi.fn(),
    onEditorKeydown: vi.fn(),
    onEditorKeyup: vi.fn(),
    onEditorContextMenu: vi.fn(),
    onEditorPaste: vi.fn(),
    markEditorInteraction: vi.fn(),
    resetWikilinkDataCache: vi.fn()
  }
  const emitPulseOpenSecondBrain = vi.fn()
  const runtime = useEditorChromeRuntime({
    chromeHostPort: {
      holder,
      contentShell,
      pulsePanelWrap,
      getCurrentPath: () => input?.currentPath ?? 'a.md',
      getEditor: () => activeEditor.value,
      getSession: vi.fn(() => null)
    },
    chromeInteractionPort: {
      menus: {
        closeSlashMenu: interactionMocks.closeSlashMenu,
        dismissSlashMenu: interactionMocks.dismissSlashMenu,
        closeWikilinkMenu: interactionMocks.closeWikilinkMenu,
        openSlashAtSelection: interactionMocks.openSlashAtSelection
      },
      editorEvents: {
        onEditorKeydown: interactionMocks.onEditorKeydown,
        onEditorKeyup: interactionMocks.onEditorKeyup,
        onEditorContextMenu: interactionMocks.onEditorContextMenu,
        onEditorPaste: interactionMocks.onEditorPaste,
        markEditorInteraction: interactionMocks.markEditorInteraction
      },
      caches: {
        resetWikilinkDataCache: interactionMocks.resetWikilinkDataCache
      }
    },
    chromeOutputPort: {
      emitPulseOpenSecondBrain
    }
  })

  return {
    runtime,
    activeEditor,
    holder,
    contentShell,
    pulsePanelWrap,
    interactionMocks,
    emitPulseOpenSecondBrain
  }
}

describe('useEditorChromeRuntime', () => {
  beforeEach(() => {
    previewMarkdown.value = ''
    provenancePaths.value = []
    previewTitle.value = ''
    running.value = false
    error.value = ''
    requestId.value = ''
    outputId.value = ''
    runMock.mockClear()
    cancelMock.mockClear()
    resetMock.mockClear()
    extractSelectionClipboardPayloadMock.mockReset()
    writeSelectionPayloadToClipboardMock.mockReset()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('delegates focus to the active editor', () => {
    const { runtime, activeEditor } = createRuntimeHarness()

    runtime.focusEditor()

    expect(activeEditor.value?.commands.focus).toHaveBeenCalled()
  })

  it('exposes loading overlay refs for document orchestration', () => {
    const { runtime } = createRuntimeHarness()

    expect(runtime.loadUiState.isLoadingLargeDocument.value).toBe(false)
    runtime.loadUiState.isLoadingLargeDocument.value = true
    runtime.loadUiState.loadStageLabel.value = 'Parsing'

    expect(runtime.loadUiState.loadStageLabel.value).toBe('Parsing')
  })

  it('resetTransientUiState closes menus, toolbars, and transient caches', async () => {
    const { runtime, interactionMocks } = createRuntimeHarness()
    runtime.dragHandleUiState.value = {
      ...runtime.dragHandleUiState.value,
      activeTarget: { pos: 12, node: null, dom: null } as any
    }
    runtime.blockMenuTarget.value = { pos: 3, node: null, dom: null } as any
    runtime.findToolbar.openToolbar()
    await flushUi()

    runtime.resetTransientUiState()

    expect(interactionMocks.dismissSlashMenu).toHaveBeenCalled()
    expect(interactionMocks.closeWikilinkMenu).toHaveBeenCalled()
    expect(interactionMocks.resetWikilinkDataCache).toHaveBeenCalled()
    expect(runtime.blockMenuTarget.value).toBeNull()
    expect(runtime.dragHandleUiState.value.activeTarget).toBeNull()
    expect(runtime.findToolbar.open.value).toBe(false)
  })

  it('onHolderKeydown opens find on Cmd/Ctrl+F and otherwise delegates to editor input', async () => {
    const { runtime, holder, interactionMocks } = createRuntimeHarness()
    await runtime.onMountInit()

    holder.value?.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
    await flushUi()
    expect(runtime.findToolbar.open.value).toBe(true)
    expect(interactionMocks.markEditorInteraction).toHaveBeenCalled()
    expect(interactionMocks.onEditorKeydown).not.toHaveBeenCalled()

    holder.value?.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    await flushUi()
    expect(interactionMocks.onEditorKeydown).toHaveBeenCalled()

    await runtime.onUnmountCleanup()
  })

  it('onHolderCopy is a safe no-op without payload and writes all clipboard formats when present', async () => {
    const { runtime, holder, interactionMocks } = createRuntimeHarness()
    await runtime.onMountInit()

    extractSelectionClipboardPayloadMock.mockReturnValueOnce(null)
    holder.value?.dispatchEvent(createClipboardEvent())
    expect(interactionMocks.markEditorInteraction).toHaveBeenCalled()

    const clipboardEvent = createClipboardEvent()
    extractSelectionClipboardPayloadMock.mockReturnValueOnce({
      plain: 'Plain',
      html: '<p>Plain</p>',
      markdown: '**Plain**'
    })
    holder.value?.dispatchEvent(clipboardEvent)

    expect(clipboardEvent.preventDefault).toHaveBeenCalled()
    expect(clipboardEvent.stopPropagation).toHaveBeenCalled()
    const clipboardData = clipboardEvent.clipboardData as unknown as { setData: ReturnType<typeof vi.fn> }
    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', 'Plain')
    expect(clipboardData.setData).toHaveBeenCalledWith('text/html', '<p>Plain</p>')
    expect(clipboardData.setData).toHaveBeenCalledWith('text/markdown', '**Plain**')

    await runtime.onUnmountCleanup()
  })

  it('closePulsePanel cancels a running request and resets the preview state', () => {
    const { runtime } = createRuntimeHarness()
    runtime.pulseOpen.value = true
    previewMarkdown.value = 'Draft'
    running.value = true

    runtime.closePulsePanel()

    expect(cancelMock).toHaveBeenCalled()
    expect(resetMock).toHaveBeenCalled()
    expect(runtime.pulseOpen.value).toBe(false)
  })

  it('openPulseForSelection ignores missing or empty selections and initializes pulse state when valid', () => {
    const inactive = createRuntimeHarness({ activeEditor: ref<Editor | null>(null) as Ref<Editor | null> })
    inactive.runtime.openPulseForSelection()
    expect(inactive.runtime.pulseOpen.value).toBe(false)

    const emptySelectionEditor = ref<Editor | null>(createEditorStub({ from: 1, to: 1, empty: true })) as Ref<Editor | null>
    const emptySelection = createRuntimeHarness({ activeEditor: emptySelectionEditor })
    emptySelection.runtime.openPulseForSelection()
    expect(emptySelection.runtime.pulseOpen.value).toBe(false)

    const valid = createRuntimeHarness()
    valid.runtime.openPulseForSelection()
    expect(valid.runtime.pulseOpen.value).toBe(true)
    expect(valid.runtime.pulseSourceKind.value).toBe('editor_selection')
    expect(valid.runtime.pulseSelectionRange.value).toEqual({ from: 1, to: 2 })
    expect(valid.runtime.pulseSourceText.value).toBe('Alpha')
  })

  it('sendPulseContextToSecondBrain emits and closes Pulse, but ignores note mode without currentPath', () => {
    const noPath = createRuntimeHarness({ currentPath: '' })
    noPath.runtime.pulseOpen.value = true
    noPath.runtime.pulseSourceKind.value = 'editor_note'
    noPath.runtime.sendPulseContextToSecondBrain()
    expect(noPath.emitPulseOpenSecondBrain).not.toHaveBeenCalled()
    expect(noPath.runtime.pulseOpen.value).toBe(true)

    const valid = createRuntimeHarness()
    valid.runtime.pulseOpen.value = true
    valid.runtime.pulseSourceKind.value = 'editor_note'
    valid.runtime.pulseSourceText.value = 'Alpha'
    valid.runtime.sendPulseContextToSecondBrain()
    expect(valid.emitPulseOpenSecondBrain).toHaveBeenCalledWith({
      contextPaths: ['a.md'],
      prompt: expect.stringContaining('Source material:')
    })
    expect(valid.runtime.pulseOpen.value).toBe(false)
  })

  it('mount and unmount lifecycle bind listeners and resolve pending mermaid confirmations', async () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
    const holder = document.createElement('div')
    const holderAddEventListenerSpy = vi.spyOn(holder, 'addEventListener')
    const holderRemoveEventListenerSpy = vi.spyOn(holder, 'removeEventListener')
    const harness = createRuntimeHarness()
    harness.holder.value = holder
    let resolved = false
    harness.runtime.mermaidReplaceDialog.value.resolve = (approved) => {
      resolved = approved
    }

    await harness.runtime.onMountInit()
    await harness.runtime.onUnmountCleanup()

    expect(holderAddEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    expect(holderRemoveEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    expect(resolved).toBe(false)
  })
})
