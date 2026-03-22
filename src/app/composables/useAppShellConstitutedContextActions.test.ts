import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppShellConstitutedContextActions } from './useAppShellConstitutedContextActions'

describe('useAppShellConstitutedContextActions', () => {
  it('mutates constituted context and toggles the active note', () => {
    const activeFilePath = ref('/vault/active.md')
    const anchorPath = ref('')
    const paths = ref<string[]>([])
    const add = vi.fn((path: string) => {
      paths.value = Array.from(new Set([...paths.value, path]))
    })
    const remove = vi.fn((path: string) => {
      paths.value = paths.value.filter((item) => item !== path)
    })
    const removeLocal = vi.fn(remove)
    const removePinned = vi.fn(remove)
    const constitutedContext = {
      anchorPath,
      paths,
      contains: (path: string) => paths.value.includes(path),
      add,
      remove,
      removeLocal,
      removePinned
    }

    const api = useAppShellConstitutedContextActions({
      activeFilePath,
      constitutedContext,
      filesystem: {
        hasWorkspace: ref(true),
        workingFolderPath: ref('/vault'),
        errorMessage: ref(''),
        notifyError: vi.fn()
      },
      contextActionLoading: ref(false),
      noteTitleFromPath: (path) => path.split('/').pop() ?? path,
      normalizeContextPathsForUpdate: (_workspacePath, notePaths) => notePaths.map((path) => path.trim()),
      secondBrain: {
        resolveSecondBrainSessionForPath: vi.fn(async () => 'session-1'),
        replaceSessionContext: vi.fn(async () => {}),
        setSecondBrainSessionId: vi.fn(),
        setSecondBrainPrompt: vi.fn(),
        setSecondBrainAlterId: vi.fn(),
        openSecondBrainViewFromPalette: vi.fn(async () => true)
      },
      cosmos: {
        graph: ref({ nodes: [] }),
        error: ref(''),
        refreshGraph: vi.fn(async () => {}),
        selectNode: vi.fn(),
        openCosmosViewFromPalette: vi.fn(async () => true),
        recordCosmosHistorySnapshot: vi.fn()
      }
    })

    api.addPathToConstitutedContext('/vault/alpha.md')
    expect(add).toHaveBeenCalledWith(
      '/vault/alpha.md',
      '/vault/active.md',
      expect.any(Function)
    )

    api.toggleActiveNoteInConstitutedContext()
    expect(add).toHaveBeenCalledTimes(2)

    api.toggleActiveNoteInConstitutedContext()
    expect(remove).toHaveBeenCalledWith('/vault/active.md')

    api.removeLocalPathFromConstitutedContext('/vault/local.md')
    api.removePinnedPathFromConstitutedContext('/vault/pinned.md')
    expect(removeLocal).toHaveBeenCalledWith('/vault/local.md')
    expect(removePinned).toHaveBeenCalledWith('/vault/pinned.md')
  })

  it('routes constituted context into Second Brain and Cosmos', async () => {
    const activeFilePath = ref('/vault/active.md')
    const contextActionLoading = ref(false)
    const notifyError = vi.fn()
    const replaceSessionContext = vi.fn(async () => {})
    const resolveSecondBrainSessionForPath = vi.fn(async () => 'session-1')
    const openSecondBrainViewFromPalette = vi.fn(async () => true)
    const openCosmosViewFromPalette = vi.fn(async () => true)
    const selectNode = vi.fn()
    const recordCosmosHistorySnapshot = vi.fn()
    const refreshGraph = vi.fn(async () => {})
    const filesystem = {
      hasWorkspace: ref(true),
      workingFolderPath: ref('/vault'),
      errorMessage: ref(''),
      notifyError
    }
    const constitutedContext = {
      anchorPath: ref('/vault/active.md'),
      paths: ref(['/vault/context.md']),
      contains: (path: string) => path === '/vault/active.md',
      add: vi.fn(),
      remove: vi.fn(),
      removeLocal: vi.fn(),
      removePinned: vi.fn()
    }

    const api = useAppShellConstitutedContextActions({
      activeFilePath,
      constitutedContext,
      filesystem,
      contextActionLoading,
      noteTitleFromPath: (path) => path.split('/').pop() ?? path,
      normalizeContextPathsForUpdate: (_workspacePath, notePaths) => notePaths.map((path) => path.trim()),
      secondBrain: {
        resolveSecondBrainSessionForPath,
        replaceSessionContext,
        setSecondBrainSessionId: vi.fn(),
        setSecondBrainPrompt: vi.fn(),
        setSecondBrainAlterId: vi.fn(),
        openSecondBrainViewFromPalette
      },
      cosmos: {
        graph: ref({ nodes: [{ id: 'context-md', path: '/vault/context.md' }] }),
        error: ref(''),
        refreshGraph,
        selectNode,
        openCosmosViewFromPalette,
        recordCosmosHistorySnapshot
      }
    })

    await expect(api.openConstitutedContextInSecondBrain('Prompt')).resolves.toBe(true)
    expect(contextActionLoading.value).toBe(false)
    expect(resolveSecondBrainSessionForPath).toHaveBeenCalledWith('/vault/context.md')
    expect(replaceSessionContext).toHaveBeenCalledWith('session-1', ['/vault/context.md'])
    expect(openSecondBrainViewFromPalette).toHaveBeenCalled()

    await expect(api.openConstitutedContextInCosmos()).resolves.toBe(true)
    expect(openCosmosViewFromPalette).toHaveBeenCalled()
    expect(selectNode).toHaveBeenCalledWith('context-md')
    expect(recordCosmosHistorySnapshot).toHaveBeenCalled()

    await expect(api.openConstitutedContextInPulse()).resolves.toBe(true)
    await expect(api.openPulseContextInSecondBrain({
      contextPaths: ['/vault/context.md'],
      prompt: 'Pulse'
    })).resolves.toBe(true)
    await expect(api.openAlterInSecondBrain('alter-1')).resolves.toBe(true)
  })
})
