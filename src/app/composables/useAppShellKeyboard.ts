import { onScopeDispose, type Ref } from 'vue'

export type AppShellKeyboardHistoryMenuSide = 'back' | 'forward'

/** Groups the shell visibility refs that affect global keyboard routing. */
export type AppShellKeyboardStatePort = {
  quickOpenVisible: Readonly<Ref<boolean>>
  quickOpenIsActionMode: Readonly<Ref<boolean>>
  themePickerVisible: Readonly<Ref<boolean>>
  historyMenuOpen: Readonly<Ref<AppShellKeyboardHistoryMenuSide | null>>
  overflowMenuOpen: Readonly<Ref<boolean>>
  newFileModalVisible: Readonly<Ref<boolean>>
  newFolderModalVisible: Readonly<Ref<boolean>>
  openDateModalVisible: Readonly<Ref<boolean>>
  settingsModalVisible: Readonly<Ref<boolean>>
  designSystemDebugVisible: Readonly<Ref<boolean>>
  aboutModalVisible: Readonly<Ref<boolean>>
  shortcutsModalVisible: Readonly<Ref<boolean>>
  workspaceSetupWizardVisible: Readonly<Ref<boolean>>
  indexStatusModalVisible: Readonly<Ref<boolean>>
  cosmosCommandLoadingVisible: Readonly<Ref<boolean>>
}

/** Groups the shell-level guards that decide whether shortcuts should be ignored. */
export type AppShellKeyboardGuardsPort = {
  hasBlockingModalOpen: () => boolean
  trapTabWithinActiveModal: (event: KeyboardEvent) => boolean
  shouldBlockGlobalShortcutsFromTarget: (target: EventTarget | null) => boolean
  hasActiveTextSelectionInEditor: (target: EventTarget | null) => boolean
}

/** Groups the intent callbacks used by the global keyboard controller. */
export type AppShellKeyboardActionsPort = {
  closeNewFileModal: () => void
  closeNewFolderModal: () => void
  closeOpenDateModal: () => void
  closeSettingsModal: () => void
  closeDesignSystemDebugModal: () => void
  closeAboutModal: () => void
  closeShortcutsModal: () => void
  closeWorkspaceSetupWizard: () => void
  closeIndexStatusModal: () => void
  closeThemePickerModal: () => void
  moveQuickOpenSelection: (delta: number) => void
  onQuickOpenEnter: () => void
  moveThemePickerSelection: (delta: number) => void
  onThemePickerEnter: () => void
  closeHistoryMenu: () => void
  closeOverflowMenu: () => void
  closeQuickOpen: () => void
  goBackInHistory: () => boolean | void | Promise<boolean | void>
  goForwardInHistory: () => boolean | void | Promise<boolean | void>
  closeActiveTab: () => void
  openQuickOpen: () => boolean | void | Promise<boolean | void>
  openCommandPalette: () => void
  openTodayNote: () => boolean | void | Promise<boolean | void>
  openHomeView: () => boolean | void | Promise<boolean | void>
  splitPane: (axis: 'row' | 'column') => boolean | void | Promise<boolean | void>
  focusPane: (index: number) => boolean | void | Promise<boolean | void>
  moveActiveTabToAdjacentPane: (direction: 'next' | 'previous') => boolean | void | Promise<boolean | void>
  openNextTab: () => boolean | void | Promise<boolean | void>
  openSearchPanel: () => void
  showExplorerForActiveFile: (options: { focusTree?: boolean }) => boolean | void | Promise<boolean | void>
  toggleSidebar: () => void
  toggleRightPane: () => void
  saveActiveTab: () => boolean | void | Promise<boolean | void>
}

/** Declares the dependencies required by the shell global keyboard controller. */
export type UseAppShellKeyboardOptions = {
  isMacOs: boolean
  statePort: AppShellKeyboardStatePort
  guardsPort: AppShellKeyboardGuardsPort
  actionsPort: AppShellKeyboardActionsPort
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>
}

/**
 * Owns shell-global keyboard routing and priority ordering.
 *
 * Invariants:
 * - `Escape` closes the top-most shell modal before any global shortcut runs.
 * - `Mod+W` is always intercepted to avoid native window-close behavior.
 * - Domain behavior stays outside this controller; it only invokes injected shell intents.
 */
export function useAppShellKeyboard(options: UseAppShellKeyboardOptions) {
  const target = options.eventTarget ?? (typeof window !== 'undefined' ? window : null)

  function consume(event: KeyboardEvent) {
    event.preventDefault()
    event.stopPropagation()
  }

  function isEscapeKey(event: KeyboardEvent) {
    return event.key === 'Escape' || event.key === 'Esc' || event.code === 'Escape'
  }

  function handleEscape(event: KeyboardEvent): boolean {
    if (!isEscapeKey(event)) return false
    if (options.statePort.newFileModalVisible.value) {
      consume(event)
      options.actionsPort.closeNewFileModal()
      return true
    }
    if (options.statePort.newFolderModalVisible.value) {
      consume(event)
      options.actionsPort.closeNewFolderModal()
      return true
    }
    if (options.statePort.openDateModalVisible.value) {
      consume(event)
      options.actionsPort.closeOpenDateModal()
      return true
    }
    if (options.statePort.settingsModalVisible.value) {
      consume(event)
      options.actionsPort.closeSettingsModal()
      return true
    }
    if (options.statePort.designSystemDebugVisible.value) {
      consume(event)
      options.actionsPort.closeDesignSystemDebugModal()
      return true
    }
    if (options.statePort.aboutModalVisible.value) {
      consume(event)
      options.actionsPort.closeAboutModal()
      return true
    }
    if (options.statePort.shortcutsModalVisible.value) {
      consume(event)
      options.actionsPort.closeShortcutsModal()
      return true
    }
    if (options.statePort.workspaceSetupWizardVisible.value) {
      consume(event)
      options.actionsPort.closeWorkspaceSetupWizard()
      return true
    }
    if (options.statePort.indexStatusModalVisible.value) {
      consume(event)
      options.actionsPort.closeIndexStatusModal()
      return true
    }
    if (options.statePort.themePickerVisible.value) {
      consume(event)
      options.actionsPort.closeThemePickerModal()
      return true
    }
    if (options.statePort.cosmosCommandLoadingVisible.value) {
      consume(event)
      return true
    }

    if (options.statePort.historyMenuOpen.value) {
      consume(event)
      options.actionsPort.closeHistoryMenu()
      return true
    }
    if (options.statePort.overflowMenuOpen.value) {
      consume(event)
      options.actionsPort.closeOverflowMenu()
      return true
    }
    if (options.statePort.quickOpenVisible.value) {
      consume(event)
      options.actionsPort.closeQuickOpen()
      return true
    }

    return false
  }

  function handleQuickOpenNavigation(event: KeyboardEvent): boolean {
    if (!options.statePort.quickOpenVisible.value) return false

    if (event.key === 'ArrowDown') {
      consume(event)
      options.actionsPort.moveQuickOpenSelection(1)
      return true
    }
    if (event.key === 'ArrowUp') {
      consume(event)
      options.actionsPort.moveQuickOpenSelection(-1)
      return true
    }
    if (event.key === 'Enter') {
      consume(event)
      options.actionsPort.onQuickOpenEnter()
      return true
    }

    return false
  }

  function handleThemePickerNavigation(event: KeyboardEvent): boolean {
    if (!options.statePort.themePickerVisible.value) return false

    if (event.key === 'ArrowDown') {
      consume(event)
      options.actionsPort.moveThemePickerSelection(1)
      return true
    }
    if (event.key === 'ArrowUp') {
      consume(event)
      options.actionsPort.moveThemePickerSelection(-1)
      return true
    }
    if (event.key === 'Enter') {
      consume(event)
      options.actionsPort.onThemePickerEnter()
      return true
    }

    return false
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (handleEscape(event)) return
    if (handleQuickOpenNavigation(event)) return
    if (handleThemePickerNavigation(event)) return

    if (options.guardsPort.trapTabWithinActiveModal(event)) {
      event.stopPropagation()
      return
    }

    const key = event.key.toLowerCase()
    const isMod = event.metaKey || event.ctrlKey
    const isBackHistoryShortcut = options.isMacOs
      ? isMod && !event.altKey && !event.shiftKey && key === '['
      : event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && key === 'arrowleft'
    const isForwardHistoryShortcut = options.isMacOs
      ? isMod && !event.altKey && !event.shiftKey && key === ']'
      : event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && key === 'arrowright'

    if (isMod && key === 'w') {
      event.preventDefault()
      options.actionsPort.closeActiveTab()
      return
    }

    if (options.guardsPort.hasBlockingModalOpen()) return
    if (options.guardsPort.shouldBlockGlobalShortcutsFromTarget(event.target)) return

    if (isBackHistoryShortcut) {
      event.preventDefault()
      void options.actionsPort.goBackInHistory()
      return
    }
    if (isForwardHistoryShortcut) {
      event.preventDefault()
      void options.actionsPort.goForwardInHistory()
      return
    }
    if (!isMod) return

    if (key === 'p' && !event.shiftKey) {
      event.preventDefault()
      void options.actionsPort.openQuickOpen()
      return
    }
    if (key === 'p' && event.shiftKey) {
      event.preventDefault()
      options.actionsPort.openCommandPalette()
      return
    }
    if (key === 'd') {
      event.preventDefault()
      void options.actionsPort.openTodayNote()
      return
    }
    if (key === 'h' && event.shiftKey) {
      event.preventDefault()
      void options.actionsPort.openHomeView()
      return
    }
    if (key === '\\' && !event.shiftKey) {
      event.preventDefault()
      void options.actionsPort.splitPane('row')
      return
    }
    if (key === '\\' && event.shiftKey) {
      event.preventDefault()
      void options.actionsPort.splitPane('column')
      return
    }
    if (key >= '1' && key <= '4') {
      event.preventDefault()
      void options.actionsPort.focusPane(Number.parseInt(key, 10))
      return
    }
    if (event.altKey && event.shiftKey && key === 'arrowright') {
      event.preventDefault()
      void options.actionsPort.moveActiveTabToAdjacentPane('next')
      return
    }
    if (event.altKey && event.shiftKey && key === 'arrowleft') {
      event.preventDefault()
      void options.actionsPort.moveActiveTabToAdjacentPane('previous')
      return
    }
    if (key === 'tab') {
      event.preventDefault()
      void options.actionsPort.openNextTab()
      return
    }
    if (key === 'f' && event.shiftKey) {
      event.preventDefault()
      options.actionsPort.openSearchPanel()
      return
    }
    if (key === 'e') {
      event.preventDefault()
      void options.actionsPort.showExplorerForActiveFile({ focusTree: true })
      return
    }
    if (key === 'b') {
      if (options.guardsPort.hasActiveTextSelectionInEditor(event.target)) return
      event.preventDefault()
      options.actionsPort.toggleSidebar()
      return
    }
    if (key === 'j') {
      event.preventDefault()
      options.actionsPort.toggleRightPane()
      return
    }
    if (key === 's') {
      event.preventDefault()
      void options.actionsPort.saveActiveTab()
      return
    }
    if (key === 'k') {
      event.preventDefault()
      options.actionsPort.openCommandPalette()
    }
  }

  if (target) {
    target.addEventListener('keydown', onWindowKeydown, true)
  }

  function dispose() {
    if (!target) return
    target.removeEventListener('keydown', onWindowKeydown, true)
  }

  onScopeDispose(dispose)

  return {
    onWindowKeydown,
    dispose
  }
}
