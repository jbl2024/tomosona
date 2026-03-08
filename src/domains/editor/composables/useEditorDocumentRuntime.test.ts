import { createApp, defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/vue-3'
import { useEditorDocumentRuntime } from './useEditorDocumentRuntime'

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
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

describe('useEditorDocumentRuntime', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('loads the active file on mount and tracks render paths', async () => {
    const path = ref('a.md')
    const openPaths = ref(['a.md', 'b.md'])
    const activeEditor = ref<Editor | null>(null) as Ref<Editor | null>
    const openFile = vi.fn(async (valuePath: string) => (valuePath === 'a.md' ? '# A\n\nAlpha' : '# B\n\nBeta'))
    let runtime!: ReturnType<typeof useEditorDocumentRuntime>

    const app = createApp(defineComponent({
      setup() {
        runtime = useEditorDocumentRuntime({
          propsPort: {
            path,
            openPaths,
            openFile,
            saveFile: async () => ({ persisted: true }),
            renameFileFromTitle: async (valuePath: string, title: string) => ({ path: valuePath, title }),
            loadPropertyTypeSchema: async () => ({}),
            savePropertyTypeSchema: async () => {}
          },
          emitPort: {
            emitStatus: vi.fn(),
            emitOutline: vi.fn(),
            emitProperties: vi.fn(),
            emitPathRenamed: vi.fn()
          },
          sessionPort: {
            holder: ref(document.createElement('div')),
            activeEditor,
            isEditingTitle: () => false,
            createSessionEditor: () => createEditorStub()
          },
          interactionPort: {
            captureCaret: vi.fn(),
            restoreCaret: vi.fn(() => false),
            clearOutlineTimer: vi.fn(),
            emitOutlineSoon: vi.fn(),
            closeSlashMenu: vi.fn(),
            closeWikilinkMenu: vi.fn(),
            syncWikilinkUiFromPluginState: vi.fn()
          },
          chromePort: {
            largeDocThreshold: 40_000,
            loadUiState: {
              isLoadingLargeDocument: ref(false),
              loadStageLabel: ref(''),
              loadProgressPercent: ref(0),
              loadProgressIndeterminate: ref(false),
              loadDocumentStats: ref(null)
            },
            resetTransientUiState: vi.fn(),
            updateGutterHitboxStyle: vi.fn(),
            hideTableToolbarAnchor: vi.fn(),
            closeBlockMenu: vi.fn(),
            onActiveSessionChanged: vi.fn(),
            onDocumentContentChanged: vi.fn(),
            onMountInit: async () => {},
            onUnmountCleanup: async () => {}
          }
        })
        return () => h('div')
      }
    }))

    app.mount(document.createElement('div'))
    await flushUi()

    expect(openFile).toHaveBeenCalledWith('a.md')
    expect(runtime.renderPaths.value).toEqual(['a.md', 'b.md'])
    expect(activeEditor.value).toBeTruthy()

    app.unmount()
  })

  it('clears the active editor and empties document state when the path becomes empty', async () => {
    const path = ref('a.md')
    const openPaths = ref(['a.md'])
    const activeEditor = ref<Editor | null>(null) as Ref<Editor | null>
    const emitOutline = vi.fn()
    const emitProperties = vi.fn()
    let runtime!: ReturnType<typeof useEditorDocumentRuntime>

    const app = createApp(defineComponent({
      setup() {
        runtime = useEditorDocumentRuntime({
          propsPort: {
            path,
            openPaths,
            openFile: async () => '# A\n\nAlpha',
            saveFile: async () => ({ persisted: true }),
            renameFileFromTitle: async (valuePath: string, title: string) => ({ path: valuePath, title }),
            loadPropertyTypeSchema: async () => ({}),
            savePropertyTypeSchema: async () => {}
          },
          emitPort: {
            emitStatus: vi.fn(),
            emitOutline,
            emitProperties,
            emitPathRenamed: vi.fn()
          },
          sessionPort: {
            holder: ref(document.createElement('div')),
            activeEditor,
            isEditingTitle: () => false,
            createSessionEditor: () => createEditorStub()
          },
          interactionPort: {
            captureCaret: vi.fn(),
            restoreCaret: vi.fn(() => false),
            clearOutlineTimer: vi.fn(),
            emitOutlineSoon: vi.fn(),
            closeSlashMenu: vi.fn(),
            closeWikilinkMenu: vi.fn(),
            syncWikilinkUiFromPluginState: vi.fn()
          },
          chromePort: {
            largeDocThreshold: 40_000,
            loadUiState: {
              isLoadingLargeDocument: ref(false),
              loadStageLabel: ref(''),
              loadProgressPercent: ref(0),
              loadProgressIndeterminate: ref(false),
              loadDocumentStats: ref(null)
            },
            resetTransientUiState: vi.fn(),
            updateGutterHitboxStyle: vi.fn(),
            hideTableToolbarAnchor: vi.fn(),
            closeBlockMenu: vi.fn(),
            onActiveSessionChanged: vi.fn(),
            onDocumentContentChanged: vi.fn(),
            onMountInit: async () => {},
            onUnmountCleanup: async () => {}
          }
        })
        return () => h('div')
      }
    }))

    app.mount(document.createElement('div'))
    await flushUi()

    path.value = ''
    openPaths.value = []
    await flushUi()

    expect(activeEditor.value).toBeNull()
    expect(runtime.currentPath.value).toBe('')
    expect(emitOutline).toHaveBeenLastCalledWith([])
    expect(emitProperties).toHaveBeenLastCalledWith({ path: '', items: [], parseErrorCount: 0 })

    app.unmount()
  })
})
