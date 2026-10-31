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

describe('useAppShellOpenFlow openNoteAtTarget', () => {
  it('opens at the active target through the quick-open flow', async () => {
    const options = createOptions()
    const flow = useAppShellOpenFlow(options)

    await flow.openNoteAtTarget('/vault/Note.md', 'active')

    expect(options.navigationPort.openTabWithAutosave).toHaveBeenCalledWith('/vault/Note.md')
    expect(options.uiPort.closeQuickOpen).toHaveBeenCalled()
  })

  it('reveals a new-tab target in the active pane and closes the palette', async () => {
    const options = createOptions()
    const flow = useAppShellOpenFlow(options)

    await flow.openNoteAtTarget('/vault/Note.md', 'new-tab')

    expect(options.navigationPort.openTabWithAutosave).toHaveBeenCalledWith('/vault/Note.md', {
      revealInTargetPane: true
    })
    expect(options.uiPort.closeQuickOpen).toHaveBeenCalled()
  })

  it('targets the adjacent pane when one is resolvable', async () => {
    const options = createOptions()
    options.navigationPort.resolveAdjacentPaneId = () => 'pane-2'
    const flow = useAppShellOpenFlow(options)

    await flow.openNoteAtTarget('/vault/Note.md', 'adjacent')

    expect(options.navigationPort.openTabWithAutosave).toHaveBeenCalledWith('/vault/Note.md', {
      targetPaneId: 'pane-2'
    })
    expect(options.uiPort.closeQuickOpen).toHaveBeenCalled()
  })

  it('falls back to a new tab when no adjacent pane exists', async () => {
    const options = createOptions()
    options.navigationPort.resolveAdjacentPaneId = () => null
    const flow = useAppShellOpenFlow(options)

    await flow.openNoteAtTarget('/vault/Note.md', 'adjacent')

    expect(options.navigationPort.openTabWithAutosave).toHaveBeenCalledWith('/vault/Note.md', {
      revealInTargetPane: true
    })
    expect(options.uiPort.closeQuickOpen).toHaveBeenCalled()
  })

  it('retries the passage reveal until the freshly opened document is ready', async () => {
    const options = createOptions()
    options.revealRetryDelayMs = 1
    // Realistic snippet storage: set stores, consume returns-and-clears.
    const storedSnippets: Record<string, string> = {}
    options.editorPort.editorState = {
      setActiveOutline: vi.fn(),
      setRevealSnippet: vi.fn((path: string, snippet: string) => {
        storedSnippets[path] = snippet
      }),
      consumeRevealSnippet: vi.fn((path: string) => {
        const snippet = storedSnippets[path] ?? ''
        delete storedSnippets[path]
        return snippet
      })
    }
    // The note's content is not loaded into the editor yet: reveal attempts
    // report failure until the load pipeline completes.
    let contentReady = false
    const revealOutcomes: boolean[] = []
    options.editorPort.editorRef = ref({
      focusEditor: () => {},
      revealSnippet: vi.fn(async () => {
        revealOutcomes.push(contentReady)
        return contentReady
      }),
      revealAnchor: vi.fn(async () => false)
    } as never)
    options.editorPort.activeFilePath = ref('')
    options.navigationPort.openTabWithAutosave = vi.fn(async (path: string) => {
      ;(options.editorPort.activeFilePath as unknown as { value: string }).value = path
      return true
    })
    const flow = useAppShellOpenFlow(options)

    await flow.onSearchResultOpen({ path: '/vault/note.md', snippet: 'une <b>granularité</b> fine' })
    await new Promise((resolve) => setTimeout(resolve, 3))

    // The document finishes loading while the reveal is still pending.
    contentReady = true
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(revealOutcomes.length).toBeGreaterThan(1)
    expect(revealOutcomes[revealOutcomes.length - 1]).toBe(true)
  })
})
