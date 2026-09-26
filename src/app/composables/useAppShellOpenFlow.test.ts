import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppShellOpenFlow } from './useAppShellOpenFlow'
import type { QuickOpenResult } from './useAppQuickOpen'

const indexApiMocks = vi.hoisted(() => ({
  backlinksForPath: vi.fn(),
  semanticLinksForPath: vi.fn()
}))

vi.mock('../../shared/api/indexApi', () => indexApiMocks)

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createHarness() {
  const workingFolderPath = ref('/vault')
  const sidebarVisible = ref(true)
  const errorMessage = ref('')
  const activeFilePath = ref('')
  const virtualDocs = ref<Record<string, { content: string; titleLine: string }>>({})
  const revealSnippetByPath: Record<string, string> = {}

  const focusEditor = vi.fn()
  const revealSnippet = vi.fn(async () => {})
  const revealAnchor = vi.fn(async () => true)
  const revealPathInView = vi.fn(async () => {})

  const editorState = {
    setActiveOutline: vi.fn(),
    consumeRevealSnippet: vi.fn((path: string) => {
      const next = revealSnippetByPath[path] ?? ''
      delete revealSnippetByPath[path]
      return next
    }),
    setRevealSnippet: vi.fn((path: string, snippet: string) => {
      revealSnippetByPath[path] = snippet
    })
  }

  const editorRef = ref({
    focusEditor,
    revealSnippet,
    revealAnchor,
  })

  const explorerRef = ref({
    revealPathInView
  })

  const refreshActiveFileMetadata = vi.fn(async () => {})
  const loadWikilinkTargets = vi.fn(async () => ['/vault/existing.md'])
  const pathExists = vi.fn(async (path: string) => path !== '/vault/missing.md')
  const readTextFile = vi.fn(async () => '# Heading\n\nBody')
  const dailyNotePath = (root: string, date: string) => `${root}/journal/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.md`
  const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  const sanitizeRelativePath = (value: string) => value.trim().replace(/\\/g, '/')
  const resolveExistingWikilinkPath = vi.fn((target: string, markdownFiles: string[]) => {
    const normalizedTarget = target.replace(/^\.\//, '').replace(/\.(md|markdown)$/i, '').toLowerCase()
    const exact = markdownFiles.find((candidate) => candidate.replace(/\.(md|markdown)$/i, '').toLowerCase() === normalizedTarget)
    if (exact) return exact

    const indexMatch = markdownFiles.find((candidate) => candidate.replace(/\.(md|markdown)$/i, '').toLowerCase() === `${normalizedTarget}/index`)
    if (indexMatch) return indexMatch

    const basenameMatches = markdownFiles.filter((candidate) => {
      const normalized = candidate.replace(/\.(md|markdown)$/i, '').toLowerCase()
      const stem = normalized.split('/').pop() ?? normalized
      return stem === normalizedTarget
    })
    if (basenameMatches.length === 1) return basenameMatches[0]

    const suffixMatches = markdownFiles.filter((candidate) => {
      const normalized = candidate.replace(/\.(md|markdown)$/i, '').toLowerCase()
      return normalized.endsWith(`/${normalizedTarget}`)
    })
    if (suffixMatches.length === 1) return suffixMatches[0]

    return null
  })
  const extractHeadingsFromMarkdown = vi.fn(() => ['Heading'])

  const openTabWithAutosave = vi.fn(async (_path: string) => true)
  const openDailyNote = vi.fn(async (date: string, openPath: (path: string) => Promise<boolean>) => {
    return await openPath(dailyNotePath(workingFolderPath.value, date))
  })
  const closeQuickOpen = vi.fn()
  const resetForAnchor = vi.fn()

  const scope = effectScope()
  const api = scope.run(() => useAppShellOpenFlow({
    workspacePort: {
      workingFolderPath,
      sidebarVisible,
      setSidebarMode: vi.fn(() => {
        sidebarVisible.value = true
      }),
      errorMessage
    },
    editorPort: {
      activeFilePath,
      editorState,
      editorRef,
      virtualDocs,
      explorerRef
    },
    contextPort: {
      resetForAnchor
    },
    dataPort: {
      refreshActiveFileMetadata,
      isMarkdownPath: (path: string) => path.endsWith('.md') || path.endsWith('.markdown'),
      loadWikilinkTargets,
      pathExists,
      readTextFile,
      dailyNotePath,
      isIsoDate,
      sanitizeRelativePath,
      resolveExistingWikilinkPath,
      extractHeadingsFromMarkdown
    },
    navigationPort: {
      openTabWithAutosave,
      openDailyNote,
    },
    uiPort: {
      closeQuickOpen
    }
  }))
  if (!api) throw new Error('Expected open flow api')

  return {
    api,
    scope,
    workingFolderPath,
    sidebarVisible,
    errorMessage,
    activeFilePath,
    virtualDocs,
    editorState,
    editorRef,
    explorerRef,
    refreshActiveFileMetadata,
    loadWikilinkTargets,
    pathExists,
    readTextFile,
    resolveExistingWikilinkPath,
    extractHeadingsFromMarkdown,
    openTabWithAutosave,
    openDailyNote,
    closeQuickOpen,
    resetForAnchor,
    focusEditor,
    revealSnippet,
    revealAnchor,
    revealPathInView
  }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

describe('useAppShellOpenFlow', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('covers representative wikilink resolution paths exhaustively', async () => {
    type Scenario = {
      target: string
      activeFilePath: string
      markdownFiles: string[]
      expectedPath: string
      virtualDoc?: { content: string; titleLine: string }
    }

    const scenarios: Scenario[] = [
      {
        target: 'creer_formulaire_glpi',
        activeFilePath: '/vault/notes/current.md',
        markdownFiles: [],
        expectedPath: '/vault/notes/creer_formulaire_glpi.md',
        virtualDoc: { content: '', titleLine: '' }
      },
      {
        target: 'tools',
        activeFilePath: '/vault/notes/current.md',
        markdownFiles: ['/vault/notes/tools/index.md'],
        expectedPath: '/vault/notes/tools/index.md'
      },
      {
        target: './tools',
        activeFilePath: '/vault/notes/current.md',
        markdownFiles: ['notes/tools/index.md'],
        expectedPath: '/vault/notes/tools/index.md'
      },
      {
        target: 'Projets/Supervision.md',
        activeFilePath: '/vault/notes/current.md',
        markdownFiles: ['Projets/Supervision.md'],
        expectedPath: '/vault/Projets/Supervision.md'
      }
    ]

    for (const scenario of scenarios) {
      const harness = createHarness()
      harness.activeFilePath.value = scenario.activeFilePath
      harness.loadWikilinkTargets.mockResolvedValue([...scenario.markdownFiles])
      harness.resolveExistingWikilinkPath.mockClear()
      harness.pathExists.mockResolvedValue(false)

      await expect(harness.api.openWikilinkTarget(scenario.target)).resolves.toBe(true)
      expect(harness.openTabWithAutosave).toHaveBeenCalledWith(scenario.expectedPath)
      if (scenario.virtualDoc) {
        expect(harness.virtualDocs.value[scenario.expectedPath]).toEqual(scenario.virtualDoc)
      } else {
        expect(harness.virtualDocs.value[scenario.expectedPath]).toBeUndefined()
      }
      harness.scope.stop()
    }
  })

  it('opens an existing quick-open file without forcing a caret move', async () => {
    const harness = createHarness()

    const item: QuickOpenResult = {
      kind: 'file',
      path: '/vault/existing.md',
      label: 'Existing'
    }

    await harness.api.openQuickResult(item)
    await flushMicrotasks()

    expect(harness.openTabWithAutosave).toHaveBeenCalledWith('/vault/existing.md')
    expect(harness.closeQuickOpen).toHaveBeenCalledTimes(1)
    harness.scope.stop()
  })

  it('opens a recent quick-open result without forcing a caret move', async () => {
    const harness = createHarness()

    const item: QuickOpenResult = {
      kind: 'recent',
      path: '/vault/recent.md',
      label: 'Recent note',
      recencyLabel: '2 hours ago'
    }

    await harness.api.openQuickResult(item)
    await flushMicrotasks()

    expect(harness.openTabWithAutosave).toHaveBeenCalledWith('/vault/recent.md')
    expect(harness.closeQuickOpen).toHaveBeenCalledTimes(1)
    harness.scope.stop()
  })

  it('opens an explorer file without forcing a caret move', async () => {
    const harness = createHarness()

    await harness.api.onExplorerOpen('/vault/existing.md')
    await flushMicrotasks()

    expect(harness.openTabWithAutosave).toHaveBeenCalledWith('/vault/existing.md')
    harness.scope.stop()
  })

  it('creates a virtual buffer when opening a missing wikilink target', async () => {
    const harness = createHarness()
    harness.pathExists.mockImplementation(async (path: string) => path !== '/vault/missing.md')
    harness.loadWikilinkTargets.mockResolvedValue([])
    harness.resolveExistingWikilinkPath.mockReturnValue(null)

    await expect(harness.api.openWikilinkTarget('missing.md')).resolves.toBe(true)

    expect(harness.pathExists).toHaveBeenCalledWith('/vault/missing.md')
    expect(harness.openTabWithAutosave).toHaveBeenCalledWith('/vault/missing.md')
    harness.scope.stop()
  })

  it('resolves bare wikilink targets against the current note directory and adds md when missing', async () => {
    const harness = createHarness()
    harness.activeFilePath.value = '/vault/notes/current.md'
    harness.loadWikilinkTargets.mockResolvedValue([])
    harness.resolveExistingWikilinkPath.mockReturnValue(null)
    harness.pathExists.mockResolvedValue(false)

    await expect(harness.api.openWikilinkTarget('creer_formulaire_glpi')).resolves.toBe(true)

    expect(harness.virtualDocs.value['/vault/notes/creer_formulaire_glpi.md']).toEqual({
      content: '',
      titleLine: ''
    })
    expect(harness.openTabWithAutosave).toHaveBeenCalledWith('/vault/notes/creer_formulaire_glpi.md')
    harness.scope.stop()
  })

  it('prefers tools.md over tools/index.md when both exist', async () => {
    const harness = createHarness()
    harness.activeFilePath.value = '/vault/notes/current.md'
    harness.loadWikilinkTargets.mockResolvedValue([
      '/vault/notes/tools/index.md',
      '/vault/notes/tools.md'
    ])

    await expect(harness.api.openWikilinkTarget('tools')).resolves.toBe(true)

    expect(harness.resolveExistingWikilinkPath).toHaveBeenCalledWith(
      '/vault/notes/tools',
      ['/vault/notes/tools/index.md', '/vault/notes/tools.md']
    )
    expect(harness.openTabWithAutosave).toHaveBeenCalledWith('/vault/notes/tools.md')
    expect(harness.virtualDocs.value['/vault/notes/tools.md']).toBeUndefined()
    harness.scope.stop()
  })

  it('opens tools/index.md when the direct markdown file is missing', async () => {
    const harness = createHarness()
    harness.activeFilePath.value = '/vault/notes/current.md'
    harness.loadWikilinkTargets.mockResolvedValue(['/vault/notes/tools/index.md'])

    await expect(harness.api.openWikilinkTarget('tools')).resolves.toBe(true)

    expect(harness.resolveExistingWikilinkPath).toHaveBeenCalledWith(
      '/vault/notes/tools',
      ['/vault/notes/tools/index.md']
    )
    expect(harness.openTabWithAutosave).toHaveBeenCalledWith('/vault/notes/tools/index.md')
    expect(harness.virtualDocs.value['/vault/notes/tools.md']).toBeUndefined()
    harness.scope.stop()
  })

  it('opens tools/index.md for a relative ./tools target when workspace markdown files are relative', async () => {
    const harness = createHarness()
    harness.activeFilePath.value = '/vault/notes/current.md'
    harness.loadWikilinkTargets.mockResolvedValue(['notes/tools/index.md'])

    await expect(harness.api.openWikilinkTarget('./tools')).resolves.toBe(true)

    expect(harness.resolveExistingWikilinkPath).toHaveBeenNthCalledWith(
      1,
      '/vault/notes/tools',
      ['notes/tools/index.md']
    )
    expect(harness.resolveExistingWikilinkPath).toHaveBeenNthCalledWith(
      2,
      'notes/tools',
      ['notes/tools/index.md']
    )
    expect(harness.openTabWithAutosave).toHaveBeenCalledWith('/vault/notes/tools/index.md')
    expect(harness.virtualDocs.value['/vault/notes/tools.md']).toBeUndefined()
    harness.scope.stop()
  })

  it('opens tools/index.md for a bare tools target when workspace markdown files are relative', async () => {
    const harness = createHarness()
    harness.activeFilePath.value = '/vault/notes/current.md'
    harness.loadWikilinkTargets.mockResolvedValue(['notes/tools/index.md'])

    await expect(harness.api.openWikilinkTarget('tools')).resolves.toBe(true)

    expect(harness.resolveExistingWikilinkPath).toHaveBeenNthCalledWith(
      1,
      '/vault/notes/tools',
      ['notes/tools/index.md']
    )
    expect(harness.resolveExistingWikilinkPath).toHaveBeenNthCalledWith(
      2,
      'notes/tools',
      ['notes/tools/index.md']
    )
    expect(harness.openTabWithAutosave).toHaveBeenCalledWith('/vault/notes/tools/index.md')
    expect(harness.virtualDocs.value['/vault/notes/tools.md']).toBeUndefined()
    harness.scope.stop()
  })

  it('opens a workspace-root wikilink path with a folder and markdown extension', async () => {
    const harness = createHarness()
    harness.activeFilePath.value = '/vault/notes/current.md'
    harness.loadWikilinkTargets.mockResolvedValue(['Projets/Supervision.md'])

    await expect(harness.api.openWikilinkTarget('Projets/Supervision.md')).resolves.toBe(true)

    expect(harness.resolveExistingWikilinkPath).toHaveBeenNthCalledWith(
      1,
      '/vault/Projets/Supervision.md',
      ['Projets/Supervision.md']
    )
    expect(harness.openTabWithAutosave).toHaveBeenCalledWith('/vault/Projets/Supervision.md')
    expect(harness.virtualDocs.value['/vault/Projets/Supervision.md']).toBeUndefined()
    harness.scope.stop()
  })

  it('creates tools.md when neither tools.md nor tools/index.md exists', async () => {
    const harness = createHarness()
    harness.activeFilePath.value = '/vault/notes/current.md'
    harness.loadWikilinkTargets.mockResolvedValue([])
    harness.resolveExistingWikilinkPath.mockReturnValue(null)
    harness.pathExists.mockResolvedValue(false)

    await expect(harness.api.openWikilinkTarget('tools')).resolves.toBe(true)

    expect(harness.openTabWithAutosave).toHaveBeenCalledWith('/vault/notes/tools.md')
    expect(harness.virtualDocs.value['/vault/notes/tools.md']).toEqual({
      content: '',
      titleLine: ''
    })
    harness.scope.stop()
  })

  it('opens a wikilink target with an anchor and reveals the anchor', async () => {
    const harness = createHarness()
    harness.resolveExistingWikilinkPath.mockReturnValue('existing.md')

    await expect(harness.api.openWikilinkTarget('existing.md#Heading')).resolves.toBe(true)

    expect(harness.openTabWithAutosave).toHaveBeenCalledWith('/vault/existing.md')
    expect(harness.revealAnchor).toHaveBeenCalledWith({ heading: 'Heading' })
    expect(harness.focusEditor).not.toHaveBeenCalled()
    harness.scope.stop()
  })

  it('retries the existing wikilink target without forcing a caret move when anchor navigation fails', async () => {
    const harness = createHarness()
    harness.resolveExistingWikilinkPath.mockReturnValue('existing.md')
    harness.revealAnchor.mockResolvedValueOnce(false)

    await expect(harness.api.openWikilinkTarget('existing.md#Heading')).resolves.toBe(true)

    expect(harness.openTabWithAutosave).toHaveBeenNthCalledWith(1, '/vault/existing.md')
    expect(harness.revealAnchor).toHaveBeenCalledWith({ heading: 'Heading' })
    expect(harness.openTabWithAutosave).toHaveBeenNthCalledWith(2, '/vault/existing.md')
    harness.scope.stop()
  })

  it('fails cleanly when no workspace is open', async () => {
    const harness = createHarness()
    harness.workingFolderPath.value = ''

    await expect(harness.api.openWikilinkTarget('note.md')).resolves.toBe(false)

    expect(harness.openTabWithAutosave).not.toHaveBeenCalled()
    expect(harness.errorMessage.value).toBe('')
    harness.scope.stop()
  })

  it('refreshes backlinks and semantic links when the active note changes', async () => {
    const harness = createHarness()
    harness.editorState.consumeRevealSnippet.mockReturnValue('')
    indexApiMocks.backlinksForPath.mockResolvedValue([{ path: '/vault/back.md' }])
    indexApiMocks.semanticLinksForPath.mockResolvedValue([
      { path: '/vault/related.md', score: 0.91, direction: 'incoming' }
    ])

    harness.activeFilePath.value = '/vault/existing.md'
    await flushMicrotasks()

    expect(harness.refreshActiveFileMetadata).toHaveBeenCalledWith('/vault/existing.md')
    expect(harness.editorState.consumeRevealSnippet).toHaveBeenCalledWith('/vault/existing.md')
    expect(harness.api.backlinks.value).toEqual(['/vault/back.md'])
    expect(harness.api.semanticLinks.value).toEqual([
      { path: '/vault/related.md', score: 0.91, direction: 'incoming' }
    ])
    expect(harness.api.backlinksError.value).toBe('')
    expect(harness.api.semanticLinksError.value).toBe('')
    harness.scope.stop()
  })

  it('keeps the last valid backlinks when a transient refresh fails and exposes an error', async () => {
    const harness = createHarness()
    harness.editorState.consumeRevealSnippet.mockReturnValue('')

    indexApiMocks.backlinksForPath.mockResolvedValueOnce([{ path: '/vault/back.md' }])
    indexApiMocks.semanticLinksForPath.mockResolvedValueOnce([
      { path: '/vault/related.md', score: 0.91, direction: 'incoming' }
    ])

    await harness.api.refreshBacklinks({ path: '/vault/existing.md' })

    indexApiMocks.backlinksForPath.mockRejectedValueOnce(new Error('database failed'))
    indexApiMocks.semanticLinksForPath.mockResolvedValueOnce([
      { path: '/vault/related-2.md', score: 0.5, direction: 'outgoing' }
    ])

    await harness.api.refreshBacklinks({ path: '/vault/existing.md' })

    expect(harness.api.backlinks.value).toEqual(['/vault/back.md'])
    expect(harness.api.semanticLinks.value).toEqual([
      { path: '/vault/related-2.md', score: 0.5, direction: 'outgoing' }
    ])
    expect(harness.api.backlinksError.value).toBe('Could not load backlinks.')
    expect(harness.api.semanticLinksError.value).toBe('')
    harness.scope.stop()
  })

  it('keeps the latest active-note refresh when a newer request arrives', async () => {
    const harness = createHarness()
    harness.editorState.consumeRevealSnippet.mockReturnValue('')

    const firstBacklinks = createDeferred<Array<{ path: string }>>()
    const secondBacklinks = createDeferred<Array<{ path: string }>>()
    const firstSemantic = createDeferred<Array<{ path: string; score: number | null; direction: 'incoming' | 'outgoing' }>>()
    const secondSemantic = createDeferred<Array<{ path: string; score: number | null; direction: 'incoming' | 'outgoing' }>>()

    indexApiMocks.backlinksForPath.mockImplementation((path: string) => {
      return path.includes('first') ? firstBacklinks.promise : secondBacklinks.promise
    })
    indexApiMocks.semanticLinksForPath.mockImplementation((path: string) => {
      return path.includes('first') ? firstSemantic.promise : secondSemantic.promise
    })

    harness.activeFilePath.value = '/vault/first.md'
    await flushMicrotasks()
    harness.activeFilePath.value = '/vault/second.md'
    await flushMicrotasks()

    secondBacklinks.resolve([{ path: '/vault/second-back.md' }])
    secondSemantic.resolve([{ path: '/vault/second-related.md', score: 0.7, direction: 'incoming' }])
    await flushMicrotasks()

    firstBacklinks.resolve([{ path: '/vault/first-back.md' }])
    firstSemantic.resolve([{ path: '/vault/first-related.md', score: 0.4, direction: 'incoming' }])
    await flushMicrotasks()

    expect(harness.api.backlinks.value).toEqual(['/vault/second-back.md'])
    expect(harness.api.semanticLinks.value).toEqual([
      { path: '/vault/second-related.md', score: 0.7, direction: 'incoming' }
    ])
    harness.scope.stop()
  })

})
