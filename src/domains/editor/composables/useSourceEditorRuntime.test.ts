import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSourceEditorRuntime } from './useSourceEditorRuntime'

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function createHarness(options: {
  path?: string
  openPaths?: string[]
  openFile?: (path: string) => Promise<string>
  saveFile?: (path: string, text: string, options: { explicit: boolean }) => Promise<{ persisted: boolean }>
} = {}) {
  const path = ref(options.path ?? 'notes/a.txt')
  const openPaths = ref(options.openPaths ?? [path.value])
  const emitStatus = vi.fn()
  const emitOutline = vi.fn()
  let runtime!: ReturnType<typeof useSourceEditorRuntime>

  const app = createApp(defineComponent({
    setup() {
      runtime = useSourceEditorRuntime({
        path,
        openPaths,
        openFile: options.openFile ?? (async () => 'line1\r\nline2\r\n'),
        saveFile: options.saveFile ?? (async () => ({ persisted: true })),
        emitStatus,
        emitOutline,
        isSourceMode: () => true,
        isEditingTitle: () => false
      })
      return () => h('div')
    }
  }))

  return {
    app,
    path,
    openPaths,
    emitStatus,
    emitOutline,
    get runtime() {
      return runtime
    }
  }
}

describe('useSourceEditorRuntime', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
  })

  it('loads raw text and preserves the source buffer for autosave', async () => {
    const saveFile = vi.fn(async () => ({ persisted: true }))
    const harness = createHarness({ saveFile })
    harness.app.mount(document.createElement('div'))
    await flushUi()

    const session = harness.runtime.getSession('notes/a.txt')
    expect(session?.text).toBe('line1\r\nline2\r\n')
    expect(session?.dirty).toBe(false)

    harness.runtime.setText('notes/a.txt', 'line1\nline2')
    await flushUi()
    await harness.runtime.saveCurrentFile(true)

    expect(saveFile).toHaveBeenCalledWith('notes/a.txt', 'line1\r\nline2', { explicit: true })
    expect(harness.runtime.getSession('notes/a.txt')?.dirty).toBe(false)

    harness.app.unmount()
  })

  it('keeps source presentation state with its file session', async () => {
    const harness = createHarness()
    harness.app.mount(document.createElement('div'))
    await flushUi()

    harness.runtime.setViewState('notes/a.txt', { scrollTop: 96, scrollLeft: 24, wordWrap: false })

    expect(harness.runtime.getSession('notes/a.txt')).toMatchObject({
      scrollTop: 96,
      scrollLeft: 24,
      wordWrap: false
    })
    harness.app.unmount()
  })

  it('uses markdown snapshot loading for raw markdown source mode', async () => {
    const readNoteSnapshot = vi.fn(async () => ({
      path: 'notes/a.md',
      content: '# Title\r\n\r\nBody',
      version: { mtimeMs: 1, size: 14 }
    }))
    const saveNoteBuffer = vi.fn(async () => ({
      ok: true as const,
      version: { mtimeMs: 2, size: 16 }
    }))
    let runtime!: ReturnType<typeof useSourceEditorRuntime>
    const app = createApp(defineComponent({
      setup() {
        const path = ref('notes/a.md')
        const openPaths = ref(['notes/a.md'])
        runtime = useSourceEditorRuntime({
          path,
          openPaths,
          readNoteSnapshot,
          saveNoteBuffer,
          emitStatus: vi.fn(),
          emitOutline: vi.fn(),
          isSourceMode: () => true,
          isEditingTitle: () => false
        })
        return () => h('div')
      }
    }))

    app.mount(document.createElement('div'))
    await flushUi()

    expect(runtime.getSession('notes/a.md')?.text).toBe('# Title\r\n\r\nBody')
    runtime.setText('notes/a.md', '# Title\n\nBody\n')
    await flushUi()
    await runtime.saveCurrentFile(true)

    expect(saveNoteBuffer).toHaveBeenCalledWith(
      'notes/a.md',
      '# Title\r\n\r\nBody\r\n',
      expect.objectContaining({ explicit: true })
    )
    app.unmount()
  })
})
