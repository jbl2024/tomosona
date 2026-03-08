import { ref, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/vue-3'
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

describe('useEditorInteractionRuntime', () => {
  it('saves before opening a link target when the current session is dirty', async () => {
    const activeEditor = ref<Editor | null>(createEditorStub()) as Ref<Editor | null>
    const session = { dirty: true, editor: activeEditor.value } as any
    const saveCurrentFile = vi.fn(async () => {
      session.dirty = false
    })
    const openLinkTarget = vi.fn(async () => true)

    const runtime = useEditorInteractionRuntime({
      documentPort: {
        currentPath: ref('a.md'),
        holder: ref(document.createElement('div')),
        activeEditor,
        getSession: () => session,
        saveCurrentFile,
        onEditorDocChanged: vi.fn()
      },
      chromePort: {
        blockMenuOpen: ref(false),
        tableToolbarOpen: ref(false),
        isDragMenuOpen: () => false,
        closeBlockMenu: vi.fn(),
        hideTableToolbar: vi.fn(),
        updateFormattingToolbar: vi.fn(),
        updateTableToolbar: vi.fn(),
        zoomEditorBy: vi.fn(() => 1),
        resetEditorZoom: vi.fn(() => 1),
        inlineFormatToolbar: {
          updateFormattingToolbar: vi.fn(),
          openLinkPopover: vi.fn(),
          linkPopoverOpen: ref(false),
          cancelLink: vi.fn()
        }
      },
      ioPort: {
        loadLinkTargets: async () => ['a.md'],
        loadLinkHeadings: async () => ['H1'],
        openLinkTarget,
        openExternalUrl: vi.fn(async () => {})
      },
      emitPort: {
        emitOutline: vi.fn()
      },
      requestMermaidReplaceConfirm: vi.fn(async () => true)
    })

    await runtime.openLinkTargetWithAutosave('b.md')

    expect(saveCurrentFile).toHaveBeenCalledWith(false)
    expect(openLinkTarget).toHaveBeenCalledWith('b.md')
  })

  it('creates session editors through the tiptap setup runtime', () => {
    const activeEditor = ref<Editor | null>(createEditorStub()) as Ref<Editor | null>
    const runtime = useEditorInteractionRuntime({
      documentPort: {
        currentPath: ref('a.md'),
        holder: ref(document.createElement('div')),
        activeEditor,
        getSession: () => null,
        saveCurrentFile: vi.fn(async () => {}),
        onEditorDocChanged: vi.fn()
      },
      chromePort: {
        blockMenuOpen: ref(false),
        tableToolbarOpen: ref(false),
        isDragMenuOpen: () => false,
        closeBlockMenu: vi.fn(),
        hideTableToolbar: vi.fn(),
        updateFormattingToolbar: vi.fn(),
        updateTableToolbar: vi.fn(),
        zoomEditorBy: vi.fn(() => 1),
        resetEditorZoom: vi.fn(() => 1),
        inlineFormatToolbar: {
          updateFormattingToolbar: vi.fn(),
          openLinkPopover: vi.fn(),
          linkPopoverOpen: ref(false),
          cancelLink: vi.fn()
        }
      },
      ioPort: {
        loadLinkTargets: async () => ['a.md'],
        loadLinkHeadings: async () => ['H1'],
        openLinkTarget: vi.fn(async () => true),
        openExternalUrl: vi.fn(async () => {})
      },
      emitPort: {
        emitOutline: vi.fn()
      },
      requestMermaidReplaceConfirm: vi.fn(async () => true)
    })

    expect(runtime.createSessionEditor('a.md')).toBeTruthy()
  })
})
