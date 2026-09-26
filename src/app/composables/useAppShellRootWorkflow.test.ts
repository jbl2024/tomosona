import { createApp, defineComponent, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppShellRootWorkflow } from './useAppShellRootWorkflow'

function mountRootWorkflow() {
  const runtimeLifecycle = {
    start: vi.fn(async () => {}),
    dispose: vi.fn()
  }
  const indexing = {
    indexRunning: ref(false),
    indexStatusModalVisible: ref(false),
    refreshIndexModalData: vi.fn(async () => {}),
    openIndexStatusModal: vi.fn(),
    closeIndexStatusModal: vi.fn(),
    onIndexPrimaryAction: vi.fn(async () => {}),
    rebuildIndex: vi.fn(async () => {})
  }
  const rememberFocusBeforeModalOpen = vi.fn()
  const restoreFocusAfterModalClose = vi.fn()
  const spellcheckDictionaryModalVisible = ref(false)
  const toggleSpellcheckEnabled = vi.fn()
  const overflowMenuOpen = ref(false)
  const closeOverflowMenu = vi.fn(() => {
    overflowMenuOpen.value = false
  })
  const onGlobalPointerDownInternal = vi.fn()
  const openPathExternal = vi.fn(async () => {})
  const convertMarkdownToWord = vi.fn(async () => 'converted.docx')
  const errorMessage = ref('')
  const selectedCount = ref(0)
  const notifyError = vi.fn((message: string) => {
    errorMessage.value = message
  })
  const notifySuccess = vi.fn()
  const notifyInfo = vi.fn()
  const hasWorkspace = ref(true)
  const noteEchoesItems = ref<unknown[]>([])
  const markPackShown = vi.fn()
  const favorites = {
    markFavoriteMissing: vi.fn()
  }
  const removeLaunchpadRecentNote = vi.fn()
  const editorRef = ref({
    openNoteHistory: vi.fn(async () => {}),
    revealAnchor: vi.fn(async () => false),
    revealOutlineHeading: vi.fn(async () => {})
  })
  const handlePathRenamed = vi.fn(async () => {})
  const handlePathsMoved = vi.fn(async () => {})
  const reloadAllFiles = vi.fn(async () => {})
  const disposers = [vi.fn(), vi.fn()]

  let api: any = null
  const app = createApp(defineComponent({
    setup() {
      api = useAppShellRootWorkflow({
        runtimeLifecycle,
        indexing,
        modal: {
          rememberFocusBeforeModalOpen,
          restoreFocusAfterModalClose,
          spellcheckDictionaryModalVisible,
          toggleSpellcheckEnabled
        },
        surface: {
          overflowMenuOpen,
          closeOverflowMenu,
          onGlobalPointerDownInternal,
          openPathExternal,
          convertMarkdownToWord
        },
        filesystem: {
          errorMessage,
          selectedCount,
          notifyError,
          notifySuccess,
          notifyInfo,
          hasWorkspace
        },
        history: {
          noteEchoesItems,
          noteEchoesDiscoverability: { markPackShown }
        },
        explorer: {
          favorites,
          removeLaunchpadRecentNote
        },
        editor: {
          editorRef
        },
        workspaceMutation: {
          handlePathRenamed,
          handlePathsMoved
        },
        reloadAllFiles,
        disposers
      })
      return () => null
    }
  }))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)

  if (!api) throw new Error('Expected root workflow')

  return {
    app,
    api,
    runtimeLifecycle,
    indexing,
    rememberFocusBeforeModalOpen,
    restoreFocusAfterModalClose,
    spellcheckDictionaryModalVisible,
    toggleSpellcheckEnabled,
    overflowMenuOpen,
    closeOverflowMenu,
    onGlobalPointerDownInternal,
    openPathExternal,
    convertMarkdownToWord,
    errorMessage,
    selectedCount,
    notifyError,
    notifySuccess,
    notifyInfo,
    hasWorkspace,
    noteEchoesItems,
    markPackShown,
    favorites,
    removeLaunchpadRecentNote,
    editorRef,
    handlePathRenamed,
    handlePathsMoved,
    reloadAllFiles,
    disposers
  }
}

describe('useAppShellRootWorkflow', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('boots the runtime, watches root state, and disposes extras', async () => {
    const mounted = mountRootWorkflow()

    await nextTick()
    expect(mounted.runtimeLifecycle.start).toHaveBeenCalledTimes(1)

    mounted.noteEchoesItems.value = ['pack']
    await nextTick()
    expect(mounted.markPackShown).toHaveBeenCalledTimes(1)

    mounted.indexing.indexStatusModalVisible.value = true
    await nextTick()
    expect(mounted.indexing.refreshIndexModalData).toHaveBeenCalledTimes(1)

    mounted.app.unmount()

    expect(mounted.runtimeLifecycle.dispose).toHaveBeenCalledTimes(1)
    expect(mounted.disposers[0]).toHaveBeenCalledTimes(1)
    expect(mounted.disposers[1]).toHaveBeenCalledTimes(1)
  })

  it('owns modal focus, spellcheck, and index primary actions', async () => {
    const mounted = mountRootWorkflow()

    mounted.api.openIndexStatusModal()
    expect(mounted.rememberFocusBeforeModalOpen).toHaveBeenCalledTimes(1)
    expect(mounted.indexing.openIndexStatusModal).toHaveBeenCalledTimes(1)

    mounted.api.closeIndexStatusModal()
    await nextTick()
    expect(mounted.restoreFocusAfterModalClose).toHaveBeenCalledTimes(1)

    mounted.hasWorkspace.value = false
    expect(mounted.api.openSpellcheckDictionaryModal()).toBe(false)
    expect(mounted.notifyError).toHaveBeenCalledWith('Open a workspace first.')

    mounted.hasWorkspace.value = true
    expect(mounted.api.openSpellcheckDictionaryModal()).toBe(true)
    expect(mounted.spellcheckDictionaryModalVisible.value).toBe(true)
    expect(mounted.api.closeSpellcheckDictionaryModal()).toBeUndefined()
    await nextTick()
    expect(mounted.spellcheckDictionaryModalVisible.value).toBe(false)

    mounted.indexing.indexRunning.value = false
    await mounted.api.onIndexPrimaryAction()
    expect(mounted.indexing.onIndexPrimaryAction).toHaveBeenCalledTimes(1)
    expect(mounted.reloadAllFiles).toHaveBeenCalledTimes(1)

    mounted.indexing.indexRunning.value = true
    await mounted.api.onIndexPrimaryAction()
    expect(mounted.indexing.onIndexPrimaryAction).toHaveBeenCalledTimes(2)
    expect(mounted.reloadAllFiles).toHaveBeenCalledTimes(1)

    mounted.app.unmount()
  })

  it('routes explorer, history, rename, and notification actions', async () => {
    const mounted = mountRootWorkflow()
    const pointerEvent = {} as MouseEvent

    mounted.api.onGlobalPointerDown(pointerEvent)
    expect(mounted.onGlobalPointerDownInternal).toHaveBeenCalledWith(pointerEvent, false)

    mounted.api.onExplorerError('broken')
    expect(mounted.errorMessage.value).toBe('broken')

    mounted.api.onExplorerSelection(['a', 'b'])
    expect(mounted.selectedCount.value).toBe(2)

    mounted.api.onExplorerPathsDeleted(['/a.md', '/b.md'])
    expect(mounted.favorites.markFavoriteMissing).toHaveBeenCalledWith('/a.md')
    expect(mounted.removeLaunchpadRecentNote).toHaveBeenCalledWith('/b.md')

    await mounted.api.openPathNatively('  /vault/note.md  ')
    expect(mounted.openPathExternal).toHaveBeenCalledWith('/vault/note.md')

    mounted.openPathExternal.mockRejectedValueOnce(new Error('denied'))
    await mounted.api.openPathNatively('/vault/private.md')
    expect(mounted.notifyError).toHaveBeenCalledWith('denied')

    await mounted.api.openActiveNoteHistory()
    expect(mounted.editorRef.value?.openNoteHistory).toHaveBeenCalled()

    mounted.editorRef.value!.revealAnchor = vi.fn(async () => false)
    mounted.editorRef.value!.revealOutlineHeading = vi.fn(async () => {})
    await mounted.api.onOutlineHeadingClick({
      index: 4,
      heading: { level: 2, text: '  Heading  ' }
    })
    expect(mounted.editorRef.value?.revealAnchor).toHaveBeenCalledWith({ heading: 'Heading' })
    expect(mounted.editorRef.value?.revealOutlineHeading).toHaveBeenCalledWith(4)

    mounted.api.onExplorerConvertToWord('/vault/report.md')
    expect(mounted.convertMarkdownToWord).toHaveBeenCalledWith('/vault/report.md')

    mounted.api.onEditorPathRenamed({ from: '/old.md', to: '/new.md', manual: true })
    mounted.api.onExplorerPathRenamed({ from: '/old.md', to: '/new.md' })
    mounted.api.onExplorerPathsMoved([{ from: '/a.md', to: '/b.md' }])
    await nextTick()
    expect(mounted.handlePathRenamed).toHaveBeenNthCalledWith(1, {
      from: '/old.md',
      to: '/new.md',
      manual: true
    })
    expect(mounted.handlePathRenamed).toHaveBeenNthCalledWith(2, {
      from: '/old.md',
      to: '/new.md',
      manual: false
    })
    expect(mounted.handlePathsMoved).toHaveBeenCalledWith([{ from: '/a.md', to: '/b.md' }])

    expect(mounted.api.toggleSpellcheckFromPalette()).toBe(true)
    expect(mounted.toggleSpellcheckEnabled).toHaveBeenCalledTimes(1)
    expect(mounted.api.openSpellcheckDictionaryFromPalette()).toBe(true)

    mounted.app.unmount()
  })

  it('closes the overflow menu before rebuilding the index', async () => {
    const mounted = mountRootWorkflow()

    await mounted.api.rebuildIndexFromOverflow()

    expect(mounted.closeOverflowMenu).toHaveBeenCalledTimes(1)
    expect(mounted.indexing.rebuildIndex).toHaveBeenCalledTimes(1)
    expect(mounted.reloadAllFiles).toHaveBeenCalledTimes(1)

    mounted.app.unmount()
  })
})
