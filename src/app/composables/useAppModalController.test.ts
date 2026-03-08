import { ref } from 'vue'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useAppModalController } from './useAppModalController'

function createController() {
  const quickOpenVisible = ref(false)
  const newFileModalVisible = ref(false)
  const focusEditor = vi.fn()

  const controller = useAppModalController({
    quickOpenVisible,
    cosmosCommandLoadingVisible: ref(false),
    indexStatusModalVisible: ref(false),
    newFileModalVisible,
    newFolderModalVisible: ref(false),
    openDateModalVisible: ref(false),
    settingsModalVisible: ref(false),
    shortcutsModalVisible: ref(false),
    workspaceSetupWizardVisible: ref(false),
    wikilinkRewriteVisible: ref(false),
    focusEditor
  })

  return {
    quickOpenVisible,
    newFileModalVisible,
    focusEditor,
    controller
  }
}

describe('useAppModalController', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('derives the active modal selector from visible state', () => {
    const { controller, quickOpenVisible } = createController()

    expect(controller.activeModalSelector()).toBeNull()
    quickOpenVisible.value = true
    expect(controller.activeModalSelector()).toBe('[data-modal="quick-open"]')
  })

  it('restores focus to the opener after modal close', () => {
    const { controller, newFileModalVisible, focusEditor } = createController()
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()

    controller.rememberFocusBeforeModalOpen()
    newFileModalVisible.value = true
    newFileModalVisible.value = false
    controller.restoreFocusAfterModalClose()

    expect(document.activeElement).toBe(button)
    expect(focusEditor).not.toHaveBeenCalled()
  })

  it('restores focus without allowing the browser to scroll the opener into view', () => {
    const { controller, newFileModalVisible } = createController()
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()
    const focusSpy = vi.fn()
    button.focus = focusSpy as typeof button.focus

    controller.rememberFocusBeforeModalOpen()
    newFileModalVisible.value = true
    newFileModalVisible.value = false
    controller.restoreFocusAfterModalClose()

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('traps tab within the active modal', () => {
    const { controller, quickOpenVisible } = createController()
    quickOpenVisible.value = true

    const modal = document.createElement('div')
    modal.setAttribute('data-modal', 'quick-open')
    const first = document.createElement('button')
    const last = document.createElement('button')
    modal.append(first, last)
    document.body.appendChild(modal)

    last.focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() })

    const trapped = controller.trapTabWithinActiveModal(event)

    expect(trapped).toBe(true)
    expect(document.activeElement).toBe(first)
  })
})
