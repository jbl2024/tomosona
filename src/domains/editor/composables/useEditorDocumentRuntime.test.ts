import { createApp, defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/vue-3'
import { useEditorDocumentRuntime } from './useEditorDocumentRuntime'

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

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

async function flushMicrotasks() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function createEditorStub() {
  return {
    commands: {
      setContent: vi.fn(),
      focus: vi.fn(),
      setMeta: vi.fn()
    },
    destroy: vi.fn(),
    getJSON: vi.fn(() => ({ type: 'doc', content: [] })),
    state: {
      doc: {
        descendants: vi.fn()
      }
    },
    chain: vi.fn(() => ({
      focus: vi.fn(() => ({
        setTextSelection: vi.fn(() => ({ run: vi.fn() }))
      }))
    }))
  } as unknown as Editor
}

function createLoadingState() {
  return {
    isLoadingLargeDocument: ref(false),
    loadStageLabel: ref(''),
    loadProgressPercent: ref(0),
    loadProgressIndeterminate: ref(false),
    loadDocumentStats: ref(null)
  }
}

function createHarness(options: {
  path?: string
  openPaths?: string[]
  openFile?: (path: string) => Promise<string>
  saveFile?: (path: string, text: string, options: { explicit: boolean }) => Promise<{ persisted: boolean }>
  renameFileFromTitle?: (path: string, title: string) => Promise<{ path: string; title: string }>
  initializeUi?: () => Promise<void>
  disposeUi?: () => Promise<void>
  isEditingTitle?: () => boolean
} = {}) {
  const path = ref(options.path ?? 'a.md')
  const openPaths = ref(options.openPaths ?? [path.value])
  const activeEditor = ref<Editor | null>(null) as Ref<Editor | null>
  const holderEl = document.createElement('div')
  const openFile = vi.fn(options.openFile ?? (async () => '# A\n\nAlpha'))
  const saveFile = vi.fn(options.saveFile ?? (async () => ({ persisted: true })))
  const renameFileFromTitle = vi.fn(options.renameFileFromTitle ?? (async (valuePath: string, title: string) => ({ path: valuePath, title })))
  const emitStatus = vi.fn()
  const emitOutline = vi.fn()
  const emitProperties = vi.fn()
  const emitPathRenamed = vi.fn()
  const syncAfterSessionChange = vi.fn()
  const syncAfterDocumentChange = vi.fn()
  const initializeUi = vi.fn(options.initializeUi ?? (async () => {}))
  const disposeUi = vi.fn(options.disposeUi ?? (async () => {}))
  const interaction = {
    captureCaret: vi.fn(),
    restoreCaret: vi.fn(() => false),
    clearOutlineTimer: vi.fn(),
    emitOutlineSoon: vi.fn(),
    closeSlashMenu: vi.fn(),
    closeWikilinkMenu: vi.fn(),
    syncWikilinkUiFromPluginState: vi.fn()
  }

  let runtime!: ReturnType<typeof useEditorDocumentRuntime>
  const app = createApp(defineComponent({
    setup() {
      runtime = useEditorDocumentRuntime({
        documentInputPort: {
          path,
          openPaths,
          openFile,
          saveFile,
          renameFileFromTitle,
          loadPropertyTypeSchema: async () => ({}),
          savePropertyTypeSchema: async () => {}
        },
        documentOutputPort: {
          emitStatus,
          emitOutline,
          emitProperties,
          emitPathRenamed
        },
        documentSessionPort: {
          holder: ref(holderEl),
          activeEditor,
          isEditingTitle: options.isEditingTitle ?? (() => false),
          createSessionEditor: () => createEditorStub()
        },
        documentUiPort: {
          loading: createLoadingState(),
          largeDocThreshold: 40_000,
          resetTransientUi: vi.fn(),
          syncLayout: vi.fn(),
          hideTableToolbarAnchor: vi.fn(),
          closeCompetingMenus: vi.fn(),
          syncAfterSessionChange,
          syncAfterDocumentChange,
          initializeUi,
          disposeUi,
          interaction
        }
      })
      return () => h('div')
    }
  }))

  return {
    app,
    path,
    openPaths,
    activeEditor,
    holderEl,
    openFile,
    saveFile,
    renameFileFromTitle,
    emitStatus,
    emitOutline,
    emitProperties,
    emitPathRenamed,
    syncAfterSessionChange,
    syncAfterDocumentChange,
    initializeUi,
    disposeUi,
    interaction,
    get runtime() {
      return runtime
    }
  }
}

describe('useEditorDocumentRuntime', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('loads the active file on mount, activates the session, and tracks render paths', async () => {
    const harness = createHarness({
      openPaths: ['a.md', 'b.md'],
      openFile: async (valuePath: string) => (valuePath === 'a.md' ? '# A\n\nAlpha' : '# B\n\nBeta')
    })

    harness.app.mount(document.createElement('div'))
    await flushUi()

    expect(harness.openFile).toHaveBeenCalledWith('a.md')
    expect(harness.runtime.currentPath.value).toBe('a.md')
    expect(harness.runtime.renderPaths.value).toEqual(['a.md', 'b.md'])
    expect(harness.runtime.getSession('a.md')).toBeTruthy()
    expect(harness.activeEditor.value).toBe(harness.runtime.getSession('a.md')?.editor ?? null)
    expect(harness.syncAfterSessionChange).toHaveBeenCalled()

    harness.app.unmount()
  })

  it('clears the active editor and emits empty document state when the path becomes empty', async () => {
    const harness = createHarness()

    harness.app.mount(document.createElement('div'))
    await flushUi()

    harness.path.value = ''
    harness.openPaths.value = []
    await flushUi()

    expect(harness.activeEditor.value).toBeNull()
    expect(harness.runtime.currentPath.value).toBe('')
    expect(harness.emitOutline).toHaveBeenLastCalledWith([])
    expect(harness.emitProperties).toHaveBeenLastCalledWith({ path: '', items: [], parseErrorCount: 0 })
    expect(harness.interaction.closeWikilinkMenu).toHaveBeenCalled()

    harness.app.unmount()
  })

  it('drops stale load completion when the active path switches before the first load resolves', async () => {
    const aLoad = deferred<string>()
    const harness = createHarness({
      openPaths: ['a.md', 'b.md'],
      openFile: async (valuePath: string) => {
        if (valuePath === 'a.md') return aLoad.promise
        return '# B\n\nBeta'
      }
    })

    harness.app.mount(document.createElement('div'))
    await flushUi()

    harness.path.value = 'b.md'
    await flushUi()
    aLoad.resolve('# A\n\nAlpha')
    await flushUi()

    expect(harness.runtime.currentPath.value).toBe('b.md')
    expect(harness.runtime.getSession('b.md')?.isLoaded).toBe(true)
    expect(harness.runtime.getSession('b.md')?.loadedText).toContain('Beta')
    expect(harness.runtime.getSession('a.md')?.isLoaded).toBe(false)
    expect(harness.runtime.getSession('a.md')?.loadedText).toBe('')

    harness.app.unmount()
  })

  it('cancels in-flight loads when the runtime unmounts', async () => {
    const aLoad = deferred<string>()
    const harness = createHarness({
      openFile: async () => aLoad.promise
    })

    harness.app.mount(document.createElement('div'))
    await flushUi()

    const sessionBeforeUnmount = harness.runtime.getSession('a.md')
    expect(sessionBeforeUnmount).toBeTruthy()
    harness.app.unmount()

    aLoad.resolve('# A\n\nAlpha')
    await flushUi()

    expect(sessionBeforeUnmount?.isLoaded).toBe(false)
    expect(sessionBeforeUnmount?.loadedText).toBe('')
    expect(harness.activeEditor.value).toBeNull()
  })

  it('marks title edits dirty, clears save errors, and autosaves after the idle window', async () => {
    vi.useFakeTimers()
    const harness = createHarness()

    harness.app.mount(document.createElement('div'))
    await flushMicrotasks()
    harness.emitStatus.mockClear()
    harness.saveFile.mockClear()

    harness.runtime.onTitleInput('Renamed title')
    await flushMicrotasks()

    expect(harness.emitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a.md', dirty: true, saveError: '' })
    )

    await vi.advanceTimersByTimeAsync(1_900)
    await flushMicrotasks()

    expect(harness.saveFile).toHaveBeenCalled()
    harness.app.unmount()
  })

  it('marks editor changes dirty and schedules autosave plus outline sync', async () => {
    vi.useFakeTimers()
    const harness = createHarness()

    harness.app.mount(document.createElement('div'))
    await flushMicrotasks()
    harness.emitStatus.mockClear()
    harness.saveFile.mockClear()

    harness.runtime.onEditorDocChanged('a.md')
    await flushMicrotasks()

    expect(harness.emitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a.md', dirty: true, saveError: '' })
    )
    expect(harness.interaction.emitOutlineSoon).toHaveBeenCalledWith('a.md')
    expect(harness.syncAfterDocumentChange).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_900)
    await flushMicrotasks()

    expect(harness.saveFile).toHaveBeenCalled()
    harness.app.unmount()
  })

  it('renders blocks without re-emitting updates and restores holder scroll', async () => {
    const harness = createHarness()

    harness.app.mount(document.createElement('div'))
    await flushUi()

    const editor = harness.activeEditor.value as ReturnType<typeof createEditorStub>
    harness.holderEl.scrollTop = 128

    await harness.runtime.renderBlocks([{ id: 'b1', type: 'paragraph', data: { text: 'Hello' } } as any])

    expect(editor.commands.setContent).toHaveBeenCalledWith(expect.any(Object), { emitUpdate: false })
    expect(harness.holderEl.scrollTop).toBe(128)
    expect(harness.syncAfterDocumentChange).toHaveBeenCalled()

    harness.app.unmount()
  })

  it('initializes UI before document loading and disposes UI plus sessions on unmount', async () => {
    const harness = createHarness()

    harness.app.mount(document.createElement('div'))
    await flushUi()

    const initOrder = harness.initializeUi.mock.invocationCallOrder[0]
    const loadOrder = harness.openFile.mock.invocationCallOrder[0]
    expect(initOrder).toBeLessThan(loadOrder)

    harness.app.unmount()
    await flushUi()

    expect(harness.disposeUi).toHaveBeenCalled()
    expect(harness.activeEditor.value).toBeNull()
    expect(harness.runtime.sessionStore.listPaths()).toEqual([])
  })
})
