import { nextTick, watch, type Ref } from 'vue'

/** Groups shell modal refs owned by `App.vue` but orchestrated by the shell. */
export type AppShellModalsStatePort = {
  quickOpenVisible: Ref<boolean>
  quickOpenQuery: Ref<string>
  quickOpenActiveIndex: Ref<number>
  quickOpenItemCount: Readonly<Ref<number>>
  newFileModalVisible: Ref<boolean>
  newFilePathInput: Ref<string>
  newFileModalError: Ref<string>
  newFileTemplatePath: Ref<string>
  newFolderModalVisible: Ref<boolean>
  newFolderPathInput: Ref<string>
  newFolderModalError: Ref<string>
  openDateModalVisible: Ref<boolean>
  openDateInput: Ref<string>
  openDateModalError: Ref<string>
  settingsModalVisible: Ref<boolean>
  designSystemDebugVisible: Ref<boolean>
  shortcutsModalVisible: Ref<boolean>
  shortcutsFilterQuery: Ref<string>
  aboutModalVisible: Ref<boolean>
  workspaceSetupWizardVisible: Ref<boolean>
  workspaceSetupWizardBusy: Ref<boolean>
}

/** Groups shell actions reused by modal open/close flows. */
export type AppShellModalsActionPort = {
  rememberFocusBeforeModalOpen: () => void
  restoreFocusAfterModalClose: () => void
  closeOverflowMenu: () => void
  resetQuickOpenState: (nextQuery?: string) => void
  ensureAllFilesLoaded: () => Promise<void>
  hasAllFilesLoaded: () => boolean
  syncEditorZoom: () => void
  submitNewFileFromModal: () => void | Promise<void>
  submitNewFolderFromModal: () => void | Promise<void>
  submitOpenDateFromModal: () => void | Promise<void>
}

/** Groups DOM selectors so modal orchestration stays testable and explicit. */
export type AppShellModalsDomPort = {
  focusQuickOpenInput: () => void
  focusShortcutsFilterInput: () => void
  focusOpenDateInput: () => void
  focusNewFileInput: () => void
  focusNewFolderInput: () => void
  scrollQuickOpenActiveItemIntoView: () => void
}

/** Declares the dependencies required by the shell modal orchestrator. */
export type UseAppShellModalsOptions = {
  statePort: AppShellModalsStatePort
  actionPort: AppShellModalsActionPort
  domPort: AppShellModalsDomPort
  currentIsoDate: () => string
}

/**
 * Owns shell modal open/close flows and modal-local UI watchers.
 *
 * Boundaries:
 * - Keeps focus choreography and small UI resets out of `App.vue`.
 * - Does not own modal business actions like file creation or date submission.
 */
export function useAppShellModals(options: UseAppShellModalsOptions) {
  const { statePort, actionPort, domPort } = options

  function onDateOrPathInputKeydown(event: KeyboardEvent, onEscape: () => void, onEnter: () => void | Promise<void>) {
    if (event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.stopPropagation()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onEscape()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      void onEnter()
    }
  }

  function closeWithFocusRestore(assign: () => void) {
    assign()
    void nextTick(() => {
      actionPort.restoreFocusAfterModalClose()
    })
  }

  function openAboutModal() {
    actionPort.rememberFocusBeforeModalOpen()
    statePort.aboutModalVisible.value = true
  }

  function closeAboutModal() {
    closeWithFocusRestore(() => {
      statePort.aboutModalVisible.value = false
    })
  }

  function openShortcutsModal() {
    actionPort.rememberFocusBeforeModalOpen()
    statePort.shortcutsFilterQuery.value = ''
    statePort.shortcutsModalVisible.value = true
    void nextTick(() => {
      domPort.focusShortcutsFilterInput()
    })
  }

  function closeShortcutsModal() {
    closeWithFocusRestore(() => {
      statePort.shortcutsModalVisible.value = false
    })
  }

  async function openSettingsModal() {
    actionPort.rememberFocusBeforeModalOpen()
    statePort.settingsModalVisible.value = true
    await nextTick()
  }

  function closeSettingsModal() {
    closeWithFocusRestore(() => {
      statePort.settingsModalVisible.value = false
    })
  }

  function openDesignSystemDebugModal() {
    actionPort.rememberFocusBeforeModalOpen()
    statePort.designSystemDebugVisible.value = true
  }

  function closeDesignSystemDebugModal() {
    closeWithFocusRestore(() => {
      statePort.designSystemDebugVisible.value = false
    })
  }

  async function openWorkspaceSetupWizard() {
    actionPort.rememberFocusBeforeModalOpen()
    statePort.workspaceSetupWizardVisible.value = true
    statePort.workspaceSetupWizardBusy.value = false
    await nextTick()
  }

  function closeWorkspaceSetupWizard() {
    closeWithFocusRestore(() => {
      statePort.workspaceSetupWizardVisible.value = false
      statePort.workspaceSetupWizardBusy.value = false
    })
  }

  async function openQuickOpen(initialQuery = '') {
    actionPort.rememberFocusBeforeModalOpen()
    statePort.quickOpenVisible.value = true
    actionPort.resetQuickOpenState(initialQuery)
    if (!actionPort.hasAllFilesLoaded()) {
      await actionPort.ensureAllFilesLoaded()
    }
    await nextTick()
    domPort.focusQuickOpenInput()
  }

  function closeQuickOpen(restoreFocus = true) {
    statePort.quickOpenVisible.value = false
    actionPort.resetQuickOpenState('')
    if (!restoreFocus) return
    void nextTick(() => {
      actionPort.restoreFocusAfterModalClose()
    })
  }

  async function openNewFileModal(prefill = '') {
    actionPort.rememberFocusBeforeModalOpen()
    statePort.newFilePathInput.value = prefill
    statePort.newFileModalError.value = ''
    statePort.newFileTemplatePath.value = ''
    statePort.newFileModalVisible.value = true
    await nextTick()
    domPort.focusNewFileInput()
  }

  function closeNewFileModal() {
    closeWithFocusRestore(() => {
      statePort.newFileModalVisible.value = false
      statePort.newFilePathInput.value = ''
      statePort.newFileModalError.value = ''
      statePort.newFileTemplatePath.value = ''
    })
  }

  async function openNewFolderModal(prefill = '') {
    actionPort.rememberFocusBeforeModalOpen()
    statePort.newFolderPathInput.value = prefill
    statePort.newFolderModalError.value = ''
    statePort.newFolderModalVisible.value = true
    await nextTick()
    domPort.focusNewFolderInput()
  }

  function closeNewFolderModal() {
    closeWithFocusRestore(() => {
      statePort.newFolderModalVisible.value = false
      statePort.newFolderPathInput.value = ''
      statePort.newFolderModalError.value = ''
    })
  }

  async function openOpenDateModal() {
    actionPort.rememberFocusBeforeModalOpen()
    statePort.openDateInput.value = options.currentIsoDate()
    statePort.openDateModalError.value = ''
    statePort.openDateModalVisible.value = true
    await nextTick()
    domPort.focusOpenDateInput()
  }

  function closeOpenDateModal() {
    closeWithFocusRestore(() => {
      statePort.openDateModalVisible.value = false
      statePort.openDateInput.value = ''
      statePort.openDateModalError.value = ''
    })
  }

  function openShortcutsFromOverflow() {
    actionPort.closeOverflowMenu()
    openShortcutsModal()
  }

  function openAboutFromOverflow() {
    actionPort.closeOverflowMenu()
    openAboutModal()
  }

  async function openSettingsFromOverflow() {
    actionPort.closeOverflowMenu()
    await openSettingsModal()
  }

  function openShortcutsFromPalette() {
    openShortcutsModal()
    return true
  }

  function onNewFileInputKeydown(event: KeyboardEvent) {
    onDateOrPathInputKeydown(event, closeNewFileModal, actionPort.submitNewFileFromModal)
  }

  function onNewFolderInputKeydown(event: KeyboardEvent) {
    onDateOrPathInputKeydown(event, closeNewFolderModal, actionPort.submitNewFolderFromModal)
  }

  function onOpenDateInputKeydown(event: KeyboardEvent) {
    onDateOrPathInputKeydown(event, closeOpenDateModal, actionPort.submitOpenDateFromModal)
  }

  watch(statePort.quickOpenQuery, () => {
    statePort.quickOpenActiveIndex.value = 0
  })

  watch(statePort.quickOpenActiveIndex, () => {
    domPort.scrollQuickOpenActiveItemIntoView()
  })

  watch(statePort.quickOpenVisible, (visible) => {
    if (!visible) return
    domPort.scrollQuickOpenActiveItemIntoView()
  })

  watch(statePort.newFilePathInput, () => {
    if (statePort.newFileModalError.value) {
      statePort.newFileModalError.value = ''
    }
  })

  watch(statePort.newFolderPathInput, () => {
    if (statePort.newFolderModalError.value) {
      statePort.newFolderModalError.value = ''
    }
  })

  watch(statePort.openDateInput, () => {
    if (statePort.openDateModalError.value) {
      statePort.openDateModalError.value = ''
    }
  })

  watch(statePort.quickOpenItemCount, (count) => {
    if (count <= 0) {
      statePort.quickOpenActiveIndex.value = 0
      return
    }
    if (statePort.quickOpenActiveIndex.value >= count) {
      statePort.quickOpenActiveIndex.value = count - 1
    }
  })

  return {
    openAboutModal,
    closeAboutModal,
    openShortcutsModal,
    closeShortcutsModal,
    openSettingsModal,
    closeSettingsModal,
    openDesignSystemDebugModal,
    closeDesignSystemDebugModal,
    openWorkspaceSetupWizard,
    closeWorkspaceSetupWizard,
    openQuickOpen,
    closeQuickOpen,
    openNewFileModal,
    closeNewFileModal,
    openNewFolderModal,
    closeNewFolderModal,
    openOpenDateModal,
    closeOpenDateModal,
    openShortcutsFromOverflow,
    openAboutFromOverflow,
    openSettingsFromOverflow,
    openShortcutsFromPalette,
    onNewFileInputKeydown,
    onNewFolderInputKeydown,
    onOpenDateInputKeydown
  }
}
