import type { Ref } from 'vue'

/**
 * Module: useAppModalController
 *
 * Purpose:
 * - Centralize app-shell modal focus management and keyboard trapping.
 * - Keep `App.vue` free from repeated modal selector and focus restoration code.
 */

/** Declares the reactive visibility state consumed by the app modal controller. */
export type UseAppModalControllerOptions = {
  quickOpenVisible: Readonly<Ref<boolean>>
  themePickerVisible: Readonly<Ref<boolean>>
  cosmosCommandLoadingVisible: Readonly<Ref<boolean>>
  indexStatusModalVisible: Readonly<Ref<boolean>>
  newFileModalVisible: Readonly<Ref<boolean>>
  newFolderModalVisible: Readonly<Ref<boolean>>
  openDateModalVisible: Readonly<Ref<boolean>>
  settingsModalVisible: Readonly<Ref<boolean>>
  shortcutsModalVisible: Readonly<Ref<boolean>>
  aboutModalVisible: Readonly<Ref<boolean>>
  workspaceSetupWizardVisible: Readonly<Ref<boolean>>
  focusEditor: () => void
}

/** Owns modal selector derivation, focus restoration, and tab trapping for the shell. */
export function useAppModalController(options: UseAppModalControllerOptions) {
  let modalFocusReturnTarget: HTMLElement | null = null
  let modalOpenedFromEditor = false

  function focusWithoutScrolling(target: HTMLElement) {
    if (typeof target.focus !== 'function') return
    try {
      target.focus({ preventScroll: true })
    } catch {
      target.focus()
    }
  }

  /** Captures the currently focused element before opening a modal. */
  function rememberFocusBeforeModalOpen() {
    modalFocusReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
    modalOpenedFromEditor = Boolean(modalFocusReturnTarget?.closest('.editor-holder, .editor-header-shell'))
  }

  /** Returns the selector for the top-most blocking modal currently visible. */
  function activeModalSelector(): string | null {
    if (options.cosmosCommandLoadingVisible.value) return '[data-modal="cosmos-command-loading"]'
    if (options.indexStatusModalVisible.value) return '[data-modal="index-status"]'
    if (options.shortcutsModalVisible.value) return '[data-modal="shortcuts"]'
    if (options.aboutModalVisible.value) return '[data-modal="about"]'
    if (options.workspaceSetupWizardVisible.value) return '[data-modal="workspace-setup-wizard"]'
    if (options.settingsModalVisible.value) return '[data-modal="settings"]'
    if (options.openDateModalVisible.value) return '[data-modal="open-date"]'
    if (options.newFolderModalVisible.value) return '[data-modal="new-folder"]'
    if (options.newFileModalVisible.value) return '[data-modal="new-file"]'
    if (options.themePickerVisible.value) return '[data-modal="theme-picker"]'
    if (options.quickOpenVisible.value) return '[data-modal="quick-open"]'
    return null
  }

  /** Returns true when any blocking modal is currently open. */
  function hasBlockingModalOpen(): boolean {
    return Boolean(activeModalSelector())
  }

  /** Restores focus to the opener when no modal remains, otherwise falls back to the editor. */
  function restoreFocusAfterModalClose() {
    if (activeModalSelector()) return
    if (modalFocusReturnTarget && document.contains(modalFocusReturnTarget)) {
      focusWithoutScrolling(modalFocusReturnTarget)
    } else if (!modalOpenedFromEditor) {
      options.focusEditor()
    }
    modalFocusReturnTarget = null
    modalOpenedFromEditor = false
  }

  /** Keeps tab navigation trapped inside the currently active modal, if any. */
  function trapTabWithinActiveModal(event: KeyboardEvent): boolean {
    if (event.key !== 'Tab') return false
    const selector = activeModalSelector()
    if (!selector) return false
    const modal = document.querySelector<HTMLElement>(selector)
    if (!modal) return false

    const focusable = Array.from(
      modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.tabIndex >= 0 && !element.hasAttribute('disabled'))

    if (!focusable.length) {
      event.preventDefault()
      modal.focus()
      return true
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement as HTMLElement | null
    const isInsideModal = Boolean(active && modal.contains(active))

    if (event.shiftKey) {
      if (!isInsideModal || active === first) {
        event.preventDefault()
        last.focus()
        return true
      }
      return false
    }

    if (!isInsideModal || active === last) {
      event.preventDefault()
      first.focus()
      return true
    }
    return false
  }

  return {
    rememberFocusBeforeModalOpen,
    activeModalSelector,
    hasBlockingModalOpen,
    restoreFocusAfterModalClose,
    trapTabWithinActiveModal
  }
}
