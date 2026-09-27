import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { TextSelection } from '@tiptap/pm/state'
import { CalloutNode } from '../lib/tiptap/extensions/CalloutNode'
import type { EditorBlock } from '../lib/markdownBlocks'
import type { DocumentSession } from './useDocumentEditorSessions'
import {
  type CaptureHeavyRenderEpoch,
  type EditorFileLifecycleDocumentPort,
  type HasPendingHeavyRender,
  useEditorFileLifecycle,
  type EditorFileLifecycleIoPort,
  type EditorFileLifecycleRequestPort,
  type EditorFileLifecycleSessionPort,
  type EditorFileLifecycleUiPort,
  type WaitForHeavyRenderIdle,
  type UseEditorFileLifecycleOptions
} from './useEditorFileLifecycle'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function createSession(path: string): DocumentSession {
  return {
    path,
    editor: {
      commands: {
        setContent: vi.fn(),
        command: vi.fn(),
        setTextSelection: vi.fn()
      }
    } as unknown as DocumentSession['editor'],
    loadedText: '',
    baseVersion: null,
    currentDiskVersion: null,
    conflict: null,
    isLoaded: false,
    dirty: false,
    saving: false,
    saveError: '',
    scrollTop: 0,
    caret: null,
    autosaveTimer: null,
    outlineTimer: null
  }
}

type UseEditorFileLifecycleOverrides = {
  sessionPort?: Partial<EditorFileLifecycleSessionPort>
  documentPort?: Partial<EditorFileLifecycleDocumentPort>
  uiPort?: Partial<EditorFileLifecycleUiPort>
  ioPort?: Partial<EditorFileLifecycleIoPort>
  requestPort?: Partial<EditorFileLifecycleRequestPort>
  waitForHeavyRenderIdle?: WaitForHeavyRenderIdle
  hasPendingHeavyRender?: HasPendingHeavyRender
  captureHeavyRenderEpoch?: CaptureHeavyRenderEpoch
  minLargeDocOverlayVisibleMs?: number
  heavyRenderIdleTimeoutMs?: number
  heavyRenderIdleSettleMs?: number
  heavyOverlayDelayMs?: number
  heavyRenderComplexityThreshold?: number
}

function createOptions(overrides: UseEditorFileLifecycleOverrides = {}) {
  const currentPath = ref('a.md')
  const holder = ref<HTMLDivElement | null>(document.createElement('div'))
  const activeEditor = {
    commands: {
      focus: vi.fn()
    }
  } as unknown as DocumentSession['editor']
  const sessions: Record<string, DocumentSession> = {
    'a.md': createSession('a.md')
  }

  const sessionPort: EditorFileLifecycleSessionPort = {
    currentPath,
    holder,
    getEditor: () => activeEditor,
    getSession: (path) => sessions[path] ?? null,
    ensureSession: (path) => {
      if (!sessions[path]) sessions[path] = createSession(path)
      return sessions[path]
    },
    renameSessionPath: vi.fn((from: string, to: string) => {
      const session = sessions[from]
      if (!session) return
      delete sessions[from]
      session.path = to
      sessions[to] = session
    }),
    moveLifecyclePathState: vi.fn(),
    setSuppressOnChange: vi.fn(),
    setDirty: vi.fn(),
    setSaving: vi.fn(),
    setSaveError: vi.fn()
  }

  const documentPort: EditorFileLifecycleDocumentPort = {
    ensurePropertySchemaLoaded: async () => {},
    parseAndStoreFrontmatter: vi.fn(),
    frontmatterByPath: ref({}),
    propertyEditorMode: ref<'structured' | 'raw'>('structured'),
    rawYamlByPath: ref({}),
    serializableFrontmatterFields: (fields) => fields,
    moveFrontmatterPathState: vi.fn(),
    countLines: (input) => input.split('\n').length,
    noteTitleFromPath: () => 'Title',
    getCurrentTitle: () => 'Title',
    syncLoadedTitle: vi.fn(),
    commitTitle: () => 'Title',
    moveTitlePathState: vi.fn(),
    serializeCurrentDocBlocks: () => [{ id: 'b1', type: 'paragraph', data: { text: 'Body' } }] as EditorBlock[],
    renderBlocks: vi.fn(async () => {})
  }

  const uiPort: EditorFileLifecycleUiPort = {
    clearAutosaveTimer: vi.fn(),
    clearOutlineTimer: vi.fn(),
    emitOutlineSoon: vi.fn(),
    emitPathRenamed: vi.fn(),
    resetTransientUiState: vi.fn(),
    updateGutterHitboxStyle: vi.fn(),
    syncWikilinkUiFromPluginState: vi.fn(),
    largeDocThreshold: 50_000,
    ui: {
      isLoadingLargeDocument: ref(false),
      loadStageLabel: ref(''),
      loadProgressPercent: ref(0),
      loadProgressIndeterminate: ref(false),
      loadDocumentStats: ref(null)
    }
  }

  const ioPort: EditorFileLifecycleIoPort = {
    openFile: vi.fn(async () => '# Title\n\nBody'),
    saveFile: vi.fn(async () => ({ persisted: true })),
    renameFileFromTitle: vi.fn(async (path, title) => ({ path, title }))
  }

  const requestPort: EditorFileLifecycleRequestPort = {
    isCurrentRequest: vi.fn(() => true)
  }

  const base: UseEditorFileLifecycleOptions = {
    sessionPort,
    documentPort,
    uiPort,
    ioPort,
    requestPort
  }

  return {
    options: {
      ...base,
      sessionPort: { ...sessionPort, ...(overrides.sessionPort ?? {}) },
      documentPort: { ...documentPort, ...(overrides.documentPort ?? {}) },
      uiPort: { ...uiPort, ...(overrides.uiPort ?? {}) },
      ioPort: { ...ioPort, ...(overrides.ioPort ?? {}) },
      requestPort: { ...requestPort, ...(overrides.requestPort ?? {}) },
      waitForHeavyRenderIdle: overrides.waitForHeavyRenderIdle,
      hasPendingHeavyRender: overrides.hasPendingHeavyRender,
      captureHeavyRenderEpoch: overrides.captureHeavyRenderEpoch,
      minLargeDocOverlayVisibleMs: overrides.minLargeDocOverlayVisibleMs,
      heavyRenderIdleTimeoutMs: overrides.heavyRenderIdleTimeoutMs,
      heavyRenderIdleSettleMs: overrides.heavyRenderIdleSettleMs,
      heavyOverlayDelayMs: overrides.heavyOverlayDelayMs,
      heavyRenderComplexityThreshold: overrides.heavyRenderComplexityThreshold
    },
    sessions,
    currentPath
  }
}

describe('useEditorFileLifecycle', () => {
  it.each([
    'Body\n\n> [!INFO]\n> Last callout',
    '> [!INFO]\n> First callout\n\nBody\n\n> [!INFO]\n> Last callout',
    '> [!INFO]\n> Only callout',
    '- First item\n\n> [!INFO]\n> Last callout',
    'Body\n\n---',
    ''
  ])('opens a note at its first text cursor without selecting the trailing block: %s', async (markdown) => {
    const editor = new Editor({ extensions: [StarterKit, CalloutNode] })
    const { options, sessions } = createOptions({
      ioPort: { openFile: vi.fn(async () => markdown) }
    })
    sessions['a.md'].editor = editor
    const lifecycle = useEditorFileLifecycle(options)

    try {
      await lifecycle.loadCurrentFile('a.md')

      expect(editor.state.selection).toBeInstanceOf(TextSelection)
      expect(editor.state.selection.empty).toBe(true)
      expect(editor.state.selection.$from.parent.isTextblock).toBe(true)
      expect(editor.state.selection.$from.parentOffset).toBe(0)
      expect(editor.isFocused).toBe(false)

      editor.commands.setTextSelection(editor.state.selection.from + (markdown ? 2 : 0))
      const rememberedSelection = editor.state.selection.toJSON()
      await lifecycle.loadCurrentFile('a.md')
      expect(editor.state.selection.toJSON()).toEqual(rememberedSelection)
    } finally {
      editor.destroy()
    }
  })

  it('does not reset the selection when force-reloading an existing session', async () => {
    const { options, sessions } = createOptions()
    sessions['a.md'].isLoaded = true

    await useEditorFileLifecycle(options).loadCurrentFile('a.md', { forceReload: true })

    expect(sessions['a.md'].editor.commands.setContent).toHaveBeenCalled()
    expect(sessions['a.md'].editor.commands.command).not.toHaveBeenCalled()
  })

  it('drops stale load completion when request token changes before content apply', async () => {
    const openFileDeferred = deferred<string>()
    const isCurrentRequest = vi.fn((requestId: number) => requestId === 1)
    const { options } = createOptions({
      ioPort: { openFile: vi.fn(() => openFileDeferred.promise) } as Partial<EditorFileLifecycleIoPort>,
      requestPort: { isCurrentRequest } as Partial<EditorFileLifecycleRequestPort>
    })

    const lifecycle = useEditorFileLifecycle(options)
    const loadPromise = lifecycle.loadCurrentFile('a.md', { requestId: 1 })
    isCurrentRequest.mockImplementation((requestId: number) => requestId === 2)
    openFileDeferred.resolve('# Title\n\nBody')
    await loadPromise

    expect(options.documentPort.parseAndStoreFrontmatter).not.toHaveBeenCalled()
    expect(options.sessionPort.setSuppressOnChange).not.toHaveBeenCalled()
  })

  it('loads empty notes with a leading editable paragraph so focus has a target', async () => {
    const { options, sessions } = createOptions({
      ioPort: { openFile: vi.fn(async () => '') } as Partial<EditorFileLifecycleIoPort>
    })

    const lifecycle = useEditorFileLifecycle(options)
    await lifecycle.loadCurrentFile('a.md', { requestId: 1 })

    expect(sessions['a.md'].editor.commands.setContent).toHaveBeenCalledWith(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: []
          }
        ]
      },
      { emitUpdate: false }
    )
  })

  it('renames path state before persisting when title-triggered rename occurs', async () => {
    const { options, sessions } = createOptions({
      ioPort: {
        renameFileFromTitle: vi.fn(async () => ({ path: 'b.md', title: 'Renamed' })),
        saveNoteBuffer: vi.fn(async () => ({ ok: true, version: { mtimeMs: 8, size: 15 } }))
      } as Partial<EditorFileLifecycleIoPort>
    })
    sessions['a.md'].loadedText = 'saved-before'
    sessions['a.md'].baseVersion = { mtimeMs: 4, size: 12 }

    const lifecycle = useEditorFileLifecycle(options)
    await lifecycle.saveCurrentFile(false)

    expect(options.sessionPort.renameSessionPath).toHaveBeenCalledWith('a.md', 'b.md')
    expect(options.sessionPort.moveLifecyclePathState).toHaveBeenCalledWith('a.md', 'b.md')
    expect(options.documentPort.moveFrontmatterPathState).toHaveBeenCalledWith('a.md', 'b.md')
    expect(options.uiPort.emitPathRenamed).toHaveBeenCalledWith({ from: 'a.md', to: 'b.md', manual: false })
    expect(options.ioPort.saveNoteBuffer).toHaveBeenCalledWith('b.md', expect.any(String), {
      explicit: false,
      expectedBaseVersion: { mtimeMs: 4, size: 12 },
      force: false
    })

    const renameOrder = (options.sessionPort.renameSessionPath as any).mock.invocationCallOrder[0]
    const saveOrder = (options.ioPort.saveNoteBuffer as any).mock.invocationCallOrder[0]
    expect(renameOrder).toBeLessThan(saveOrder)
  })

  it('stores conflict state when the backend rejects a stale base version', async () => {
    const { options, sessions } = createOptions()
    sessions['a.md'].loadedText = 'original'
    sessions['a.md'].baseVersion = { mtimeMs: 2, size: 8 }
    options.ioPort.saveNoteBuffer = vi.fn(async () => ({
      ok: false,
      reason: 'CONFLICT',
      diskVersion: { mtimeMs: 9, size: 15 },
      diskContent: 'external-change'
    } as const))

    const lifecycle = useEditorFileLifecycle(options)
    await lifecycle.saveCurrentFile(false)
    await nextTick()

    expect(sessions['a.md'].conflict).toEqual({
      kind: 'modified',
      diskVersion: { mtimeMs: 9, size: 15 },
      diskContent: 'external-change',
      detectedAt: expect.any(Number)
    })
    expect(options.sessionPort.setDirty).toHaveBeenCalledWith('a.md', true)
    expect(options.sessionPort.setSaveError).toHaveBeenCalledWith('a.md', 'File changed on disk. Resolve the conflict before saving.')
    expect(options.sessionPort.setSaving).toHaveBeenCalledWith('a.md', false)
  })

  it('stores base and disk version from the loaded snapshot', async () => {
    const { options, sessions } = createOptions({
      ioPort: {
        readNoteSnapshot: vi.fn(async () => ({
          path: 'a.md',
          content: '# Title\n\nBody',
          version: { mtimeMs: 123, size: 14 }
        }))
      } as Partial<EditorFileLifecycleIoPort>
    })

    const lifecycle = useEditorFileLifecycle(options)
    await lifecycle.loadCurrentFile('a.md', { requestId: 1 })

    expect(sessions['a.md'].baseVersion).toEqual({ mtimeMs: 123, size: 14 })
    expect(sessions['a.md'].currentDiskVersion).toEqual({ mtimeMs: 123, size: 14 })
    expect(sessions['a.md'].conflict).toBeNull()
  })

  it('updates synchronized version and clears conflict after a forced overwrite', async () => {
    const { options, sessions } = createOptions()
    sessions['a.md'].loadedText = 'draft'
    sessions['a.md'].baseVersion = { mtimeMs: 1, size: 5 }
    sessions['a.md'].conflict = {
      kind: 'modified',
      detectedAt: 10
    }
    options.ioPort.saveNoteBuffer = vi.fn(async () => ({
      ok: true,
      version: { mtimeMs: 22, size: 14 }
    } as const))

    const lifecycle = useEditorFileLifecycle(options)
    await lifecycle.saveCurrentFile(true, { force: true })

    expect(options.ioPort.saveNoteBuffer).toHaveBeenCalledWith('a.md', expect.any(String), {
      explicit: true,
      expectedBaseVersion: { mtimeMs: 1, size: 5 },
      force: true
    })
    expect(sessions['a.md'].baseVersion).toEqual({ mtimeMs: 22, size: 14 })
    expect(sessions['a.md'].currentDiskVersion).toEqual({ mtimeMs: 22, size: 14 })
    expect(sessions['a.md'].conflict).toBeNull()
  })

  it('keeps large-doc overlay visible for minimum duration to avoid imperceptible flash', async () => {
    vi.useFakeTimers()
    const largeDoc = 'x'.repeat(60_000)
    const { options } = createOptions({
      ioPort: { openFile: vi.fn(async () => largeDoc) } as Partial<EditorFileLifecycleIoPort>,
      uiPort: { largeDocThreshold: 50_000 } as Partial<EditorFileLifecycleUiPort>
    })

    const lifecycle = useEditorFileLifecycle({
      ...options,
      minLargeDocOverlayVisibleMs: 1_000
    })
    const loadPromise = lifecycle.loadCurrentFile('a.md', { requestId: 1 })

    await vi.advanceTimersByTimeAsync(20)
    expect(options.uiPort.ui.isLoadingLargeDocument.value).toBe(true)

    await vi.advanceTimersByTimeAsync(400)
    expect(options.uiPort.ui.isLoadingLargeDocument.value).toBe(true)

    await vi.advanceTimersByTimeAsync(700)
    await loadPromise
    expect(options.uiPort.ui.isLoadingLargeDocument.value).toBe(false)
    vi.useRealTimers()
  })

  it('shows large-doc overlay when file length crosses configured threshold', async () => {
    vi.useFakeTimers()
    const mediumDoc = 'x'.repeat(42_428)
    const { options } = createOptions({
      ioPort: { openFile: vi.fn(async () => mediumDoc) } as Partial<EditorFileLifecycleIoPort>,
      uiPort: { largeDocThreshold: 40_000 } as Partial<EditorFileLifecycleUiPort>
    })

    const lifecycle = useEditorFileLifecycle(options)
    const loadPromise = lifecycle.loadCurrentFile('a.md', { requestId: 1 })
    await vi.advanceTimersByTimeAsync(20)

    expect(options.uiPort.ui.isLoadingLargeDocument.value).toBe(true)
    expect(options.uiPort.ui.loadStageLabel.value.length).toBeGreaterThan(0)

    await vi.runAllTimersAsync()
    await loadPromise
    vi.useRealTimers()
  })

  it('waits for heavy async render idle before hiding large-doc overlay', async () => {
    vi.useFakeTimers()
    const waitDeferred = deferred<boolean>()
    const waitForHeavyRenderIdle = vi.fn(() => waitDeferred.promise)
    const heavyDoc = `${'x'.repeat(60_000)}\n\`\`\`mermaid\nflowchart TD\nA --> B\n\`\`\``
    const { options } = createOptions({
      ioPort: { openFile: vi.fn(async () => heavyDoc) } as Partial<EditorFileLifecycleIoPort>,
      uiPort: { largeDocThreshold: 40_000 } as Partial<EditorFileLifecycleUiPort>,
      waitForHeavyRenderIdle,
      minLargeDocOverlayVisibleMs: 0
    })
    const lifecycle = useEditorFileLifecycle(options)

    const loadPromise = lifecycle.loadCurrentFile('a.md', { requestId: 1 })
    await vi.advanceTimersByTimeAsync(120)
    expect(waitForHeavyRenderIdle).toHaveBeenCalledTimes(1)
    expect(options.uiPort.ui.isLoadingLargeDocument.value).toBe(true)

    await vi.advanceTimersByTimeAsync(500)
    expect(options.uiPort.ui.isLoadingLargeDocument.value).toBe(true)

    waitDeferred.resolve(true)
    await vi.runAllTimersAsync()
    await loadPromise
    expect(options.uiPort.ui.isLoadingLargeDocument.value).toBe(false)
    vi.useRealTimers()
  })

  it('still hides large-doc overlay when heavy render idle wait reports timeout', async () => {
    vi.useFakeTimers()
    const heavyDoc = `${'x'.repeat(60_000)}\n\`\`\`mermaid\nflowchart TD\nA --> B\n\`\`\``
    const waitForHeavyRenderIdle = vi.fn(async () => false)
    const { options } = createOptions({
      ioPort: { openFile: vi.fn(async () => heavyDoc) } as Partial<EditorFileLifecycleIoPort>,
      uiPort: { largeDocThreshold: 40_000 } as Partial<EditorFileLifecycleUiPort>,
      waitForHeavyRenderIdle,
      minLargeDocOverlayVisibleMs: 0
    })
    const lifecycle = useEditorFileLifecycle(options)

    const loadPromise = lifecycle.loadCurrentFile('a.md', { requestId: 1 })
    await vi.runAllTimersAsync()
    await loadPromise

    expect(waitForHeavyRenderIdle).toHaveBeenCalledTimes(1)
    expect(options.uiPort.ui.isLoadingLargeDocument.value).toBe(false)
    vi.useRealTimers()
  })

  it('does not wait for heavy render idle when content is not a heavy markdown shape', async () => {
    const waitForHeavyRenderIdle = vi.fn(async () => true)
    const largePlainDoc = 'x'.repeat(60_000)
    const { options } = createOptions({
      ioPort: { openFile: vi.fn(async () => largePlainDoc) } as Partial<EditorFileLifecycleIoPort>,
      uiPort: { largeDocThreshold: 40_000 } as Partial<EditorFileLifecycleUiPort>,
      waitForHeavyRenderIdle
    })
    const lifecycle = useEditorFileLifecycle(options)

    await lifecycle.loadCurrentFile('a.md', { requestId: 1 })
    expect(waitForHeavyRenderIdle).not.toHaveBeenCalled()
  })

  it('shows overlay for below-threshold docs when heavy complexity score is high', async () => {
    vi.useFakeTimers()
    const waitDeferred = deferred<boolean>()
    const waitForHeavyRenderIdle = vi.fn(() => waitDeferred.promise)
    const hasPendingHeavyRender = vi.fn(() => false)
    const mermaidHeavyDoc = [
      '# Title',
      '```mermaid',
      'flowchart TD',
      'A --> B',
      '```',
      '```mermaid',
      'flowchart TD',
      'C --> D',
      '```'
    ].join('\n')
    const { options } = createOptions({
      ioPort: { openFile: vi.fn(async () => mermaidHeavyDoc) } as Partial<EditorFileLifecycleIoPort>,
      uiPort: { largeDocThreshold: 200_000 } as Partial<EditorFileLifecycleUiPort>,
      waitForHeavyRenderIdle,
      hasPendingHeavyRender,
      minLargeDocOverlayVisibleMs: 0
    })
    const lifecycle = useEditorFileLifecycle(options)

    const loadPromise = lifecycle.loadCurrentFile('a.md', { requestId: 1 })
    await vi.advanceTimersByTimeAsync(120)
    expect(options.uiPort.ui.isLoadingLargeDocument.value).toBe(true)
    expect(waitForHeavyRenderIdle).toHaveBeenCalledTimes(1)
    waitDeferred.resolve(true)
    await vi.runAllTimersAsync()
    await loadPromise
    vi.useRealTimers()
  })

  it('escalates to overlay after delay when runtime heavy render remains pending', async () => {
    vi.useFakeTimers()
    const waitDeferred = deferred<boolean>()
    const waitForHeavyRenderIdle = vi.fn(() => waitDeferred.promise)
    const hasPendingHeavyRender = vi.fn(() => true)
    const oneMermaidDoc = [
      '# Title',
      '```mermaid',
      'flowchart TD',
      'A --> B',
      '```'
    ].join('\n')
    const { options } = createOptions({
      ioPort: { openFile: vi.fn(async () => oneMermaidDoc) } as Partial<EditorFileLifecycleIoPort>,
      uiPort: { largeDocThreshold: 200_000 } as Partial<EditorFileLifecycleUiPort>,
      waitForHeavyRenderIdle,
      hasPendingHeavyRender,
      heavyRenderComplexityThreshold: 99,
      heavyOverlayDelayMs: 100,
      minLargeDocOverlayVisibleMs: 0
    })
    const lifecycle = useEditorFileLifecycle(options)

    const loadPromise = lifecycle.loadCurrentFile('a.md', { requestId: 1 })
    await vi.advanceTimersByTimeAsync(80)
    expect(options.uiPort.ui.isLoadingLargeDocument.value).toBe(false)
    await vi.advanceTimersByTimeAsync(40)
    expect(options.uiPort.ui.isLoadingLargeDocument.value).toBe(true)
    expect(options.uiPort.ui.loadStageLabel.value).toBe('Finalizing rich blocks...')

    waitDeferred.resolve(true)
    await vi.runAllTimersAsync()
    await loadPromise
    expect(options.uiPort.ui.isLoadingLargeDocument.value).toBe(false)
    vi.useRealTimers()
  })

  it('waits only for heavy renders started after the captured epoch', async () => {
    const waitForHeavyRenderIdle = vi.fn(async () => true)
    const captureHeavyRenderEpoch = vi.fn(() => 41)
    const heavyDoc = ['# Title', '```mermaid', 'flowchart TD', 'A --> B', '```'].join('\n')
    const { options } = createOptions({
      ioPort: { openFile: vi.fn(async () => heavyDoc) } as Partial<EditorFileLifecycleIoPort>,
      waitForHeavyRenderIdle,
      captureHeavyRenderEpoch
    })

    const lifecycle = useEditorFileLifecycle(options)
    await lifecycle.loadCurrentFile('a.md', { requestId: 1 })

    expect(captureHeavyRenderEpoch).toHaveBeenCalledTimes(1)
    expect(waitForHeavyRenderIdle).toHaveBeenCalledWith({
      timeoutMs: 1_200,
      settleMs: 48,
      sinceSeq: 41
    })
  })

  it('keeps mounted-tab switch lightweight when session is already loaded', async () => {
    const { options, sessions } = createOptions()
    sessions['a.md'].isLoaded = true
    sessions['a.md'].scrollTop = 42

    const lifecycle = useEditorFileLifecycle(options)
    await lifecycle.loadCurrentFile('a.md', { requestId: 1 })

    expect(options.ioPort.openFile).not.toHaveBeenCalled()
    expect(options.uiPort.clearAutosaveTimer).not.toHaveBeenCalled()
    expect(options.uiPort.resetTransientUiState).not.toHaveBeenCalled()
    expect(options.uiPort.emitOutlineSoon).toHaveBeenCalledWith('a.md')
    expect(options.uiPort.updateGutterHitboxStyle).toHaveBeenCalled()
    expect(options.sessionPort.holder.value?.scrollTop).toBe(42)
  })
})
