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
})
