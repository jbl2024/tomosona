import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { EditorBlock } from '../lib/markdownBlocks'
import type { DocumentSession } from './useDocumentEditorSessions'
import {
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
        setTextSelection: vi.fn()
      }
    } as unknown as DocumentSession['editor'],
    loadedText: '',
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
    restoreCaret: vi.fn(() => false),
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
    readVirtualTitle: () => 'Title',
    blockTextCandidate: () => 'Title',
    withVirtualTitle: (blocks, _title) => ({ blocks, changed: false }),
    stripVirtualTitle: (blocks) => blocks,
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

  it('renames path state before persisting when title-triggered rename occurs', async () => {
    const { options, sessions } = createOptions({
      ioPort: { renameFileFromTitle: vi.fn(async () => ({ path: 'b.md', title: 'Renamed' })) } as Partial<EditorFileLifecycleIoPort>
    })
    sessions['a.md'].loadedText = 'saved-before'
    options.ioPort.openFile = vi.fn(async () => 'saved-before')

    const lifecycle = useEditorFileLifecycle(options)
    await lifecycle.saveCurrentFile(false)

    expect(options.sessionPort.renameSessionPath).toHaveBeenCalledWith('a.md', 'b.md')
    expect(options.sessionPort.moveLifecyclePathState).toHaveBeenCalledWith('a.md', 'b.md')
    expect(options.documentPort.moveFrontmatterPathState).toHaveBeenCalledWith('a.md', 'b.md')
    expect(options.uiPort.emitPathRenamed).toHaveBeenCalledWith({ from: 'a.md', to: 'b.md', manual: false })
    expect(options.ioPort.saveFile).toHaveBeenCalledWith('b.md', expect.any(String), { explicit: false })

    const renameOrder = (options.sessionPort.renameSessionPath as any).mock.invocationCallOrder[0]
    const saveOrder = (options.ioPort.saveFile as any).mock.invocationCallOrder[0]
    expect(renameOrder).toBeLessThan(saveOrder)
  })

  it('reports save error and skips write when on-disk content changed', async () => {
    const { options, sessions } = createOptions()
    sessions['a.md'].loadedText = 'original'
    options.ioPort.openFile = vi.fn(async () => 'external-change')

    const lifecycle = useEditorFileLifecycle(options)
    await lifecycle.saveCurrentFile(false)
    await nextTick()

    expect(options.ioPort.saveFile).not.toHaveBeenCalled()
    expect(options.sessionPort.setSaveError).toHaveBeenCalledWith('a.md', 'File changed on disk. Reload before saving to avoid overwrite.')
    expect(options.sessionPort.setSaving).toHaveBeenCalledWith('a.md', false)
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

  it('does not force focus-to-end when no caret snapshot exists', async () => {
    const focusSpy = vi.fn()
    const { options } = createOptions({
      sessionPort: {
        restoreCaret: vi.fn(() => false),
        getEditor: () => ({ commands: { focus: focusSpy } } as any)
      } as Partial<EditorFileLifecycleSessionPort>
    })

    const lifecycle = useEditorFileLifecycle(options)
    await lifecycle.loadCurrentFile('a.md', { requestId: 1 })

    expect(focusSpy).not.toHaveBeenCalled()
    expect(options.sessionPort.restoreCaret).toHaveBeenCalledWith('a.md')
  })

  it('does not initialize first-character caret when persisted caret restore succeeds', async () => {
    const { options } = createOptions({
      sessionPort: {
        restoreCaret: vi.fn(() => true)
      } as Partial<EditorFileLifecycleSessionPort>
    })

    const lifecycle = useEditorFileLifecycle(options)
    await lifecycle.loadCurrentFile('a.md', { requestId: 1 })

    expect(options.sessionPort.restoreCaret).toHaveBeenCalledWith('a.md')
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

  it('keeps mounted-tab switch lightweight when session is already loaded', async () => {
    const { options, sessions } = createOptions()
    sessions['a.md'].isLoaded = true
    sessions['a.md'].scrollTop = 42

    const lifecycle = useEditorFileLifecycle(options)
    await lifecycle.loadCurrentFile('a.md', { requestId: 1 })

    expect(options.ioPort.openFile).not.toHaveBeenCalled()
    expect(options.sessionPort.restoreCaret).not.toHaveBeenCalled()
    expect(options.uiPort.clearAutosaveTimer).not.toHaveBeenCalled()
    expect(options.uiPort.resetTransientUiState).not.toHaveBeenCalled()
    expect(options.uiPort.emitOutlineSoon).toHaveBeenCalledWith('a.md')
    expect(options.uiPort.updateGutterHitboxStyle).toHaveBeenCalled()
    expect(options.sessionPort.holder.value?.scrollTop).toBe(42)
  })
})
