import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import type { PathMove } from '../../shared/api/apiTypes'

type NoteHistorySurface = {
  openNoteHistory: () => Promise<void>
  revealAnchor: (payload: { heading: string }) => Promise<boolean | void> | boolean | void
  revealOutlineHeading: (index: number) => Promise<void> | void
}

type RootRuntimeLifecyclePort = {
  start: () => Promise<void>
  dispose: () => void
}

type RootWorkspaceMutationPort = {
  handlePathRenamed: (payload: { from: string; to: string; manual: boolean }) => Promise<void>
  handlePathsMoved: (moves: PathMove[]) => Promise<void>
}

type RootIndexingPort = {
  indexRunning: Readonly<Ref<boolean>>
  indexStatusModalVisible: Readonly<Ref<boolean>>
  refreshIndexModalData: () => Promise<void>
  openIndexStatusModal: () => void
  closeIndexStatusModal: () => void
  onIndexPrimaryAction: () => Promise<void>
  rebuildIndex: () => Promise<void>
}

type RootModalPort = {
  rememberFocusBeforeModalOpen: () => void
  restoreFocusAfterModalClose: () => void
  spellcheckDictionaryModalVisible: Ref<boolean>
  toggleSpellcheckEnabled: () => void
}

type RootSurfacePort = {
  overflowMenuOpen: Readonly<Ref<boolean>>
  closeOverflowMenu: () => void
  onGlobalPointerDownInternal: (event: MouseEvent, overflowMenuOpen: boolean) => void
  openPathExternal: (path: string) => Promise<void>
  convertMarkdownToWord: (path: string) => Promise<string>
}

type RootFilesystemPort = {
  errorMessage: Ref<string>
  selectedCount: Ref<number>
  notifyError: (message: string) => void
  notifySuccess: (message: string) => void
  notifyInfo: (message: string) => void
  hasWorkspace: Readonly<Ref<boolean>>
}

type RootHistoryPort = {
  noteEchoesItems: Readonly<Ref<unknown[]>>
  noteEchoesDiscoverability: { markPackShown: () => void }
}

type RootExplorerPort = {
  favorites: { markFavoriteMissing: (path: string) => void }
  removeLaunchpadRecentNote: (path: string) => void
}

type RootEditorPort = {
  editorRef: Readonly<Ref<NoteHistorySurface | null>>
}

type RootOptions = {
  runtimeLifecycle: RootRuntimeLifecyclePort
  indexing: RootIndexingPort
  modal: RootModalPort
  surface: RootSurfacePort
  filesystem: RootFilesystemPort
  history: RootHistoryPort
  explorer: RootExplorerPort
  editor: RootEditorPort
  workspaceMutation: RootWorkspaceMutationPort
  reloadAllFiles: () => Promise<void>
  disposers?: Array<() => void>
}

/**
 * Owns the remaining root-shell glue so App.vue can stay an assembly component.
 *
 * This workflow absorbs the last local handlers, shell boot/teardown hooks, and
 * the tiny root watchers that do not belong to a domain controller.
 */
export function useAppShellRootWorkflow(options: RootOptions) {
  function openIndexStatusModal() {
    options.modal.rememberFocusBeforeModalOpen()
    options.indexing.openIndexStatusModal()
  }

  function closeIndexStatusModal() {
    options.indexing.closeIndexStatusModal()
    void nextTick(() => {
      options.modal.restoreFocusAfterModalClose()
    })
  }

  function openSpellcheckDictionaryModal() {
    if (!options.filesystem.hasWorkspace.value) {
      options.filesystem.notifyError('Open a workspace first.')
      return false
    }
    options.modal.rememberFocusBeforeModalOpen()
    options.modal.spellcheckDictionaryModalVisible.value = true
    return true
  }

  function closeSpellcheckDictionaryModal() {
    options.modal.spellcheckDictionaryModalVisible.value = false
    void nextTick(() => {
      options.modal.restoreFocusAfterModalClose()
    })
  }

  function onIndexPrimaryAction() {
    return (async () => {
      const shouldReloadFiles = !options.indexing.indexRunning.value
      await options.indexing.onIndexPrimaryAction()
      if (shouldReloadFiles) {
        await options.reloadAllFiles()
      }
    })()
  }

  function rebuildIndexFromOverflow() {
    options.surface.closeOverflowMenu()
    return (async () => {
      await options.indexing.rebuildIndex()
      await options.reloadAllFiles()
    })()
  }

  function onGlobalPointerDown(event: MouseEvent) {
    options.surface.onGlobalPointerDownInternal(event, options.surface.overflowMenuOpen.value)
  }

  function onExplorerError(message: string) {
    options.filesystem.errorMessage.value = message
  }

  function onExplorerSelection(paths: string[]) {
    options.filesystem.selectedCount.value = paths.length
  }

  function onExplorerPathsDeleted(paths: string[]) {
    for (const path of paths) {
      options.explorer.favorites.markFavoriteMissing(path)
      options.explorer.removeLaunchpadRecentNote(path)
    }
  }

  function onExplorerConvertToWord(path: string) {
    void options.surface.convertMarkdownToWord(path)
  }

  async function openPathNatively(path: string): Promise<void> {
    const target = path.trim()
    if (!target) return
    try {
      await options.surface.openPathExternal(target)
    } catch (err) {
      options.filesystem.notifyError(err instanceof Error ? err.message : 'Could not open file natively.')
    }
  }

  function onEditorPathRenamed(payload: { from: string; to: string; manual: boolean }) {
    void options.workspaceMutation.handlePathRenamed(payload).catch((err) => {
      options.filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not update wikilinks.'
    })
  }

  function onExplorerPathRenamed(payload: { from: string; to: string }) {
    void options.workspaceMutation.handlePathRenamed({ ...payload, manual: false }).catch((err) => {
      options.filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not update wikilinks.'
    })
  }

  function onExplorerPathsMoved(moves: PathMove[]) {
    void options.workspaceMutation.handlePathsMoved(moves).catch((err) => {
      options.filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not update wikilinks.'
    })
  }

  async function openActiveNoteHistory() {
    await options.editor.editorRef.value?.openNoteHistory()
  }

  async function onOutlineHeadingClick(payload: { index: number; heading: { level: 1 | 2 | 3; text: string } }) {
    const heading = payload.heading.text.trim()
    if (heading) {
      const revealed = await options.editor.editorRef.value?.revealAnchor({ heading })
      if (revealed) return
    }
    await options.editor.editorRef.value?.revealOutlineHeading(payload.index)
  }

  function toggleSpellcheckFromPalette() {
    options.modal.toggleSpellcheckEnabled()
    return true
  }

  function openSpellcheckDictionaryFromPalette() {
    return openSpellcheckDictionaryModal()
  }

  watch(
    () => options.history.noteEchoesItems.value.length,
    (count, previousCount = 0) => {
      if (count > 0 && previousCount === 0) {
        options.history.noteEchoesDiscoverability.markPackShown()
      }
    }
  )

  watch(
    () => options.indexing.indexStatusModalVisible.value,
    (visible) => {
      if (!visible) return
      void options.indexing.refreshIndexModalData()
    }
  )

  onMounted(() => {
    void options.runtimeLifecycle.start()
  })

  onBeforeUnmount(() => {
    options.runtimeLifecycle.dispose()
    for (const dispose of options.disposers ?? []) {
      dispose()
    }
  })

  return {
    openIndexStatusModal,
    closeIndexStatusModal,
    openSpellcheckDictionaryModal,
    closeSpellcheckDictionaryModal,
    onIndexPrimaryAction,
    rebuildIndexFromOverflow,
    onGlobalPointerDown,
    onExplorerError,
    onExplorerSelection,
    onExplorerPathsDeleted,
    onExplorerConvertToWord,
    openPathNatively,
    onEditorPathRenamed,
    onExplorerPathRenamed,
    onExplorerPathsMoved,
    openActiveNoteHistory,
    onOutlineHeadingClick,
    toggleSpellcheckFromPalette,
    openSpellcheckDictionaryFromPalette
  }
}
