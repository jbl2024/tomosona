import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppShellOpenFlow, type AppShellOpenFlowOptions } from './useAppShellOpenFlow'

function createOptions() {
  const options: AppShellOpenFlowOptions = {
    workspacePort: {
      workingFolderPath: ref('/vault'),
      sidebarVisible: ref(true),
      setSidebarMode: vi.fn(),
      errorMessage: ref('')
    },
    editorPort: {
      activeFilePath: ref(''),
      editorState: {
        setActiveOutline: vi.fn(),
        consumeRevealSnippet: vi.fn(() => ''),
        setRevealSnippet: vi.fn()
      },
      editorRef: ref(null),
      virtualDocs: ref({}),
      explorerRef: ref(null)
    },
    contextPort: {
      resetForAnchor: vi.fn()
    },
    dataPort: {
      refreshActiveFileMetadata: vi.fn(async () => {}),
      isMarkdownPath: () => true,
      loadWikilinkTargets: vi.fn(async () => []),
      pathExists: vi.fn(async () => false),
      readTextFile: vi.fn(async () => ''),
      dailyNotePath: () => '',
      isIsoDate: () => false,
      sanitizeRelativePath: vi.fn((value: string) => value),
      resolveExistingWikilinkPath: vi.fn(() => null),
      extractHeadingsFromMarkdown: vi.fn(() => [])
    },
    navigationPort: {
      openTabWithAutosave: vi.fn(async () => true),
      openDailyNote: vi.fn(async () => true)
    },
    uiPort: {
      closeQuickOpen: vi.fn()
    }
  }
  return options
}

describe('useAppShellOpenFlow', () => {
  it('seeds a wikilink-created note with its title heading', async () => {
    const options = createOptions()
    const flow = useAppShellOpenFlow(options)

    const opened = await flow.openWikilinkTarget('New Idea')

    expect(opened).toBe(true)
    const virtualDoc = options.editorPort.virtualDocs.value['/vault/New Idea.md']
    expect(virtualDoc).toEqual({ content: '# New Idea', titleLine: '# New Idea' })
    expect(options.navigationPort.openTabWithAutosave).toHaveBeenCalledWith('/vault/New Idea.md')
  })

  it('creates a note from a palette title, seeded and sanitized', async () => {
    const options = createOptions()
    const flow = useAppShellOpenFlow(options)

    const opened = await flow.createNoteFromPaletteTitle(' Idées: moteur de recherche ')

    expect(opened).toBe(true)
    const virtualDoc = options.editorPort.virtualDocs.value['/vault/Idées moteur de recherche.md']
    expect(virtualDoc).toEqual({
      content: '# Idées moteur de recherche',
      titleLine: '# Idées moteur de recherche'
    })
    expect(options.navigationPort.openTabWithAutosave).toHaveBeenCalledWith('/vault/Idées moteur de recherche.md')
  })

  it('opens the existing note instead of overwriting when the target exists', async () => {
    const options = createOptions()
    options.dataPort.pathExists = vi.fn(async () => true)
    const flow = useAppShellOpenFlow(options)

    const opened = await flow.createNoteFromPaletteTitle('Existing')

    expect(opened).toBe(true)
    expect(options.editorPort.virtualDocs.value).toEqual({})
    expect(options.navigationPort.openTabWithAutosave).toHaveBeenCalledWith('/vault/Existing.md')
  })
})
