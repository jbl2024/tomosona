import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppShellKeyboard } from './useAppShellKeyboard'

function createKeyboard(isMacOs = false) {
  const state = {
    quickOpenVisible: ref(false),
    terminalVisible: ref(false),
    themePickerVisible: ref(false),
    historyMenuOpen: ref<null | 'back' | 'forward'>(null),
    overflowMenuOpen: ref(false),
    newFileModalVisible: ref(false),
    newFolderModalVisible: ref(false),
    openDateModalVisible: ref(false),
    settingsModalVisible: ref(false),
    designSystemDebugVisible: ref(false),
    aboutModalVisible: ref(false),
    shortcutsModalVisible: ref(false),
    workspaceSetupWizardVisible: ref(false),
    indexStatusModalVisible: ref(false),
  }
  const guards = {
    hasBlockingModalOpen: vi.fn(() => false),
    trapTabWithinActiveModal: vi.fn(() => false),
    shouldBlockGlobalShortcutsFromTarget: vi.fn(() => false),
    hasActiveTextSelectionInEditor: vi.fn(() => false)
  }
  const actions = {
    closeNewFileModal: vi.fn(),
    closeNewFolderModal: vi.fn(),
    closeOpenDateModal: vi.fn(),
    closeSettingsModal: vi.fn(),
    closeDesignSystemDebugModal: vi.fn(),
    closeAboutModal: vi.fn(),
    closeShortcutsModal: vi.fn(),
    closeWorkspaceSetupWizard: vi.fn(),
    closeIndexStatusModal: vi.fn(),
    closeThemePickerModal: vi.fn(),
    moveQuickOpenSelection: vi.fn(),
    onQuickOpenEnter: vi.fn(),
    moveThemePickerSelection: vi.fn(),
    onThemePickerEnter: vi.fn(),
    closeHistoryMenu: vi.fn(),
    closeOverflowMenu: vi.fn(),
    closeQuickOpen: vi.fn(),
    closeIntegratedTerminal: vi.fn(),
    goBackInHistory: vi.fn(),
    goForwardInHistory: vi.fn(),
    closeActiveTab: vi.fn(),
    createNewFileFromActiveDirectory: vi.fn(),
    openQuickOpen: vi.fn(),
    openCommandPalette: vi.fn(),
    openIntegratedTerminal: vi.fn(),
    openTodayNote: vi.fn(),
    openHomeView: vi.fn(),
    splitPane: vi.fn(),
    focusPane: vi.fn(),
    moveActiveTabToAdjacentPane: vi.fn(),
    openNextTab: vi.fn(),
    openSearchPanel: vi.fn(),
    showExplorerForActiveFile: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleRightPane: vi.fn(),
    saveActiveTab: vi.fn()
  }

  const scope = effectScope()
  const api = scope.run(() => useAppShellKeyboard({
    isMacOs,
    statePort: {
      ...state,
      quickOpenIsActionMode: ref(false)
    },
    guardsPort: guards,
    actionsPort: actions
  }))
  if (!api) throw new Error('Expected keyboard controller')

  return { api, scope, state, guards, actions }
}

describe('useAppShellKeyboard', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('closes the top-most modal on Escape before shell menus', () => {
    const { scope, state, actions } = createKeyboard()
    state.settingsModalVisible.value = true
    state.quickOpenVisible.value = true

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(event)

    expect(actions.closeSettingsModal).toHaveBeenCalledTimes(1)
    expect(actions.closeQuickOpen).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    scope.stop()
  })

  it('focuses an already visible terminal on Escape outside the panel', () => {
    const { scope, state, actions } = createKeyboard()
    state.terminalVisible.value = true

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    expect(actions.openIntegratedTerminal).toHaveBeenCalledTimes(1)
    expect(actions.closeIntegratedTerminal).not.toHaveBeenCalled()
    scope.stop()
  })

  it('passes Escape through to the terminal program', () => {
    const { scope, state, actions } = createKeyboard(true)
    state.terminalVisible.value = true
    const panel = document.createElement('section')
    panel.className = 'integrated-terminal'
    const input = document.createElement('textarea')
    panel.appendChild(input)
    document.body.appendChild(panel)
    const received = vi.fn()
    input.addEventListener('keydown', received)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    expect(received).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
    expect(actions.closeIntegratedTerminal).not.toHaveBeenCalled()
    expect(actions.openIntegratedTerminal).not.toHaveBeenCalled()
    scope.stop()
  })

  it('toggles the panel with Cmd+J from a terminal input and preserves Ctrl+J on Mac', () => {
    const { scope, state, guards, actions } = createKeyboard(true)
    guards.shouldBlockGlobalShortcutsFromTarget.mockReturnValue(true)
    const input = document.createElement('textarea')
    document.body.appendChild(input)
    const received = vi.fn()
    input.addEventListener('keydown', received)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true, cancelable: true }))
    expect(actions.openIntegratedTerminal).toHaveBeenCalledTimes(1)
    state.terminalVisible.value = true
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true, cancelable: true }))
    expect(actions.closeIntegratedTerminal).toHaveBeenCalledTimes(1)
    expect(received).not.toHaveBeenCalled()
    const ctrlJ = new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true, cancelable: true })
    input.dispatchEvent(ctrlJ)
    expect(received).toHaveBeenCalledTimes(1)
    expect(ctrlJ.defaultPrevented).toBe(false)
    scope.stop()
  })

  it('opens the integrated terminal on Escape outside a modal', () => {
    const { scope, actions } = createKeyboard()

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(event)

    expect(actions.openIntegratedTerminal).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    scope.stop()
  })

  it('does not open the terminal behind a blocking modal', () => {
    const { scope, guards, actions } = createKeyboard()
    guards.hasBlockingModalOpen.mockReturnValue(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    expect(actions.openIntegratedTerminal).not.toHaveBeenCalled()
    scope.stop()
  })

  it('opens the integrated terminal with Mod+backtick', () => {
    const { scope, actions } = createKeyboard()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', ctrlKey: true, bubbles: true, cancelable: true }))

    expect(actions.openIntegratedTerminal).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('navigates quick open with arrows and Enter while the modal is open', () => {
    const { scope, state, actions } = createKeyboard()
    state.quickOpenVisible.value = true

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(actions.moveQuickOpenSelection).toHaveBeenNthCalledWith(1, 1)
    expect(actions.moveQuickOpenSelection).toHaveBeenNthCalledWith(2, -1)
    expect(actions.onQuickOpenEnter).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('navigates the theme picker with arrows and Enter while the modal is open', () => {
    const { scope, state, actions } = createKeyboard()
    state.themePickerVisible.value = true

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(actions.moveThemePickerSelection).toHaveBeenNthCalledWith(1, 1)
    expect(actions.moveThemePickerSelection).toHaveBeenNthCalledWith(2, -1)
    expect(actions.onThemePickerEnter).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('always intercepts Mod+W, even from input targets', () => {
    const { scope, actions } = createKeyboard()
    const input = document.createElement('input')
    document.body.appendChild(input)

    const event = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true })
    input.dispatchEvent(event)

    expect(actions.closeActiveTab).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    scope.stop()
  })

  it('defers Mod+B when editor text is selected', () => {
    const { scope, guards, actions } = createKeyboard()
    guards.hasActiveTextSelectionInEditor.mockReturnValue(true)

    const event = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true })
    window.dispatchEvent(event)

    expect(actions.toggleSidebar).not.toHaveBeenCalled()
    expect(guards.hasActiveTextSelectionInEditor).toHaveBeenCalled()
    scope.stop()
  })

  it('opens the command palette from a blocked terminal-like target', () => {
    const { scope, guards, actions } = createKeyboard()
    guards.shouldBlockGlobalShortcutsFromTarget.mockReturnValue(true)

    const terminalInput = document.createElement('textarea')
    document.body.appendChild(terminalInput)
    const event = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true })
    terminalInput.dispatchEvent(event)
    expect(actions.openCommandPalette).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)

    guards.shouldBlockGlobalShortcutsFromTarget.mockReturnValue(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true }))

    expect(actions.goBackInHistory).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('opens the new note modal with Mod+N', () => {
    const { scope, actions } = createKeyboard()

    const event = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true })
    window.dispatchEvent(event)

    expect(actions.createNewFileFromActiveDirectory).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    scope.stop()
  })

  it('stops reacting after disposal', () => {
    const { scope, actions } = createKeyboard()
    scope.stop()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }))

    expect(actions.openQuickOpen).not.toHaveBeenCalled()
  })
})
