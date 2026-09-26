import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppShellModals } from './useAppShellModals'

function createModals() {
  const statePort = {
    quickOpenVisible: ref(false),
    quickOpenQuery: ref(''),
    quickOpenActiveIndex: ref(0),
    quickOpenItemCount: ref(0),
    newFileModalVisible: ref(false),
    newFilePathInput: ref(''),
    newFileModalError: ref(''),
    newFileTemplatePath: ref(''),
    newFolderModalVisible: ref(false),
    newFolderPathInput: ref(''),
    newFolderModalError: ref(''),
    openDateModalVisible: ref(false),
    openDateInput: ref(''),
    openDateModalError: ref(''),
    settingsModalVisible: ref(false),
    designSystemDebugVisible: ref(false),
    shortcutsModalVisible: ref(false),
    shortcutsFilterQuery: ref('stale'),
    aboutModalVisible: ref(false),
    workspaceSetupWizardVisible: ref(false),
    workspaceSetupWizardBusy: ref(true)
  }
  const actionPort = {
    rememberFocusBeforeModalOpen: vi.fn(),
    restoreFocusAfterModalClose: vi.fn(),
    closeOverflowMenu: vi.fn(),
    resetQuickOpenState: vi.fn((next = '') => {
      statePort.quickOpenQuery.value = next
      statePort.quickOpenActiveIndex.value = 0
    }),
    ensureAllFilesLoaded: vi.fn(async () => {}),
    hasAllFilesLoaded: vi.fn(() => false),
    syncEditorZoom: vi.fn(),
    submitNewFileFromModal: vi.fn(),
    submitNewFolderFromModal: vi.fn(),
    submitOpenDateFromModal: vi.fn()
  }
  const domPort = {
    focusQuickOpenInput: vi.fn(),
    focusShortcutsFilterInput: vi.fn(),
    focusOpenDateInput: vi.fn(),
    focusNewFileInput: vi.fn(),
    focusNewFolderInput: vi.fn(),
    scrollQuickOpenActiveItemIntoView: vi.fn()
  }

  const scope = effectScope()
  const api = scope.run(() => useAppShellModals({
    statePort,
    actionPort,
    domPort,
    currentIsoDate: () => '2026-03-11'
  }))
  if (!api) throw new Error('Expected shell modals')

  return { api, scope, statePort, actionPort, domPort }
}

describe('useAppShellModals', () => {
  it('opens quick open, ensures files are loaded, and focuses the input', async () => {
    const { api, scope, statePort, actionPort, domPort } = createModals()

    await api.openQuickOpen('>')

    expect(actionPort.rememberFocusBeforeModalOpen).toHaveBeenCalled()
    expect(statePort.quickOpenVisible.value).toBe(true)
    expect(actionPort.ensureAllFilesLoaded).toHaveBeenCalled()
    expect(domPort.focusQuickOpenInput).toHaveBeenCalled()
    scope.stop()
  })

  it('resets the new note template selection when opening and closing the modal', async () => {
    const { api, scope, statePort } = createModals()
    statePort.newFileTemplatePath.value = '/vault/_templates/meetings/regular.md'

    await api.openNewFileModal('notes/')
    expect(statePort.newFileTemplatePath.value).toBe('')

    api.closeNewFileModal()
    await nextTick()
    expect(statePort.newFileTemplatePath.value).toBe('')
    scope.stop()
  })

  it('opens shortcuts modal and resets the filter query', async () => {
    const { api, scope, statePort, domPort } = createModals()

    api.openShortcutsModal()
    await nextTick()

    expect(statePort.shortcutsModalVisible.value).toBe(true)
    expect(statePort.shortcutsFilterQuery.value).toBe('')
    expect(domPort.focusShortcutsFilterInput).toHaveBeenCalled()
    scope.stop()
  })

  it('closes overflow before opening overflow-routed modals', async () => {
    const { api, scope, actionPort } = createModals()

    api.openShortcutsFromOverflow()
    api.openAboutFromOverflow()
    await api.openSettingsFromOverflow()

    expect(actionPort.closeOverflowMenu).toHaveBeenCalledTimes(3)
    scope.stop()
  })

  it('opens the date modal with today prefilled and clears state on close', async () => {
    const { api, scope, statePort, actionPort, domPort } = createModals()

    await api.openOpenDateModal()
    expect(statePort.openDateModalVisible.value).toBe(true)
    expect(statePort.openDateInput.value).toBe('2026-03-11')
    expect(domPort.focusOpenDateInput).toHaveBeenCalled()

    api.closeOpenDateModal()
    await nextTick()
    expect(statePort.openDateModalVisible.value).toBe(false)
    expect(statePort.openDateInput.value).toBe('')
    expect(actionPort.restoreFocusAfterModalClose).toHaveBeenCalled()
    scope.stop()
  })

  it('clears modal field errors when inputs change', async () => {
    const { scope, statePort } = createModals()

    statePort.newFileModalError.value = 'bad'
    statePort.newFilePathInput.value = 'notes/a'
    await nextTick()
    expect(statePort.newFileModalError.value).toBe('')

    statePort.newFolderModalError.value = 'bad'
    statePort.newFolderPathInput.value = 'notes'
    await nextTick()
    expect(statePort.newFolderModalError.value).toBe('')

    statePort.openDateModalError.value = 'bad'
    statePort.openDateInput.value = '2026-03-10'
    await nextTick()
    expect(statePort.openDateModalError.value).toBe('')
    scope.stop()
  })

  it('keeps quick open selection inside visible bounds and scrolls active rows', async () => {
    const { scope, statePort, domPort } = createModals()

    statePort.quickOpenItemCount.value = 3
    statePort.quickOpenActiveIndex.value = 10
    await nextTick()
    expect(statePort.quickOpenActiveIndex.value).toBe(2)
    expect(domPort.scrollQuickOpenActiveItemIntoView).toHaveBeenCalled()

    statePort.quickOpenQuery.value = 'abc'
    await nextTick()
    expect(statePort.quickOpenActiveIndex.value).toBe(0)
    scope.stop()
  })

  it('routes modal input Enter and Escape keys through the modal controller', async () => {
    const { api, scope, actionPort, statePort } = createModals()

    const enterEvent = {
      key: 'Enter',
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as KeyboardEvent
    api.onNewFileInputKeydown(enterEvent)
    expect(actionPort.submitNewFileFromModal).toHaveBeenCalled()

    const escapeEvent = {
      key: 'Escape',
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as KeyboardEvent
    api.onOpenDateInputKeydown(escapeEvent)
    await nextTick()
    expect(statePort.openDateModalVisible.value).toBe(false)
    expect(actionPort.restoreFocusAfterModalClose).toHaveBeenCalled()
    expect(actionPort.submitOpenDateFromModal).not.toHaveBeenCalled()

    scope.stop()
  })
})
