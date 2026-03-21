import { nextTick, watch, type Ref } from 'vue'
import type { PaletteAction, QuickOpenActionGroup, QuickOpenBrowseItem, QuickOpenResult } from './useAppQuickOpen'
import type { ThemePickerItem } from '../lib/appShellPresentation'
import type { ThemePreference } from './useAppTheme'

/**
 * Module: useAppShellModalInteractions
 *
 * Purpose:
 * - Own the small interaction handlers for quick open and the theme picker.
 *
 * Boundary:
 * - Keeps input keydown handling and modal selection flows out of `App.vue`.
 * - Leaves modal visibility ownership and shell rendering in the shell composer.
 */

/** Groups the quick-open state used by modal interaction handlers. */
export type AppShellQuickOpenInteractionPort = {
  quickOpenVisible: Ref<boolean>
  quickOpenIsActionMode: Readonly<Ref<boolean>>
  quickOpenHasTextQuery: Readonly<Ref<boolean>>
  quickOpenActiveIndex: Ref<number>
  quickOpenActionGroups: Readonly<Ref<QuickOpenActionGroup[]>>
  quickOpenResults: Readonly<Ref<QuickOpenResult[]>>
  quickOpenBrowseItems: Readonly<Ref<QuickOpenBrowseItem[]>>
  paletteActions: Readonly<Ref<PaletteAction[]>>
  moveQuickOpenSelection: (delta: number) => void
  openQuickResult: (result: QuickOpenResult) => boolean | void | Promise<boolean | void>
}

/** Groups the theme picker state used by modal interaction handlers. */
export type AppShellThemePickerInteractionPort = {
  themePickerVisible: Ref<boolean>
  themePickerQuery: Ref<string>
  themePickerActiveIndex: Ref<number>
  themePickerItems: Readonly<Ref<ThemePickerItem[]>>
  themePickerHasPreview: Ref<boolean>
  themePreference: Ref<ThemePreference>
}

/** Declares the dependencies required by the shell modal interaction helpers. */
export type UseAppShellModalInteractionsOptions = {
  quickOpenPort: AppShellQuickOpenInteractionPort
  themePickerPort: AppShellThemePickerInteractionPort
  closeQuickOpen: (restoreFocus?: boolean) => void
  closeOverflowMenu: () => void
  rememberFocusBeforeModalOpen: () => void
  restoreFocusAfterModalClose: () => void
  focusEditor: () => void
  focusQuickOpenInput: () => void
  focusThemePickerInput: () => void
  scrollThemePickerActiveItemIntoView: () => void
  showLoadingState: (label: string) => void
  hideLoadingState: () => void
  setErrorMessage: (message: string) => void
  canRestoreEditorFocusAfterAction: () => boolean
  applyTheme: () => void
  applyThemePreview: (next: ThemePreference) => void
}

/**
 * Owns small modal-specific interaction flows for quick open and the theme
 * picker so `App.vue` stays focused on wiring and rendering.
 */
export function useAppShellModalInteractions(options: UseAppShellModalInteractionsOptions) {
  function pickVisibleItem<T>(items: readonly T[], index: number) {
    if (!items.length) return undefined
    return items[index] ?? items[0]
  }

  function runQuickOpenAction(id: string) {
    const action = options.quickOpenPort.paletteActions.value.find((item) => item.id === id)
    if (!action) return
    const closesBeforeRun = Boolean(action.closeBeforeRun)
    const hasLoadingModal = Boolean(action.loadingLabel)
    if (closesBeforeRun && options.quickOpenPort.quickOpenVisible.value) {
      options.closeQuickOpen(false)
    }
    if (hasLoadingModal) {
      options.showLoadingState(action.loadingLabel ?? 'Loading graph...')
    }
    void (async () => {
      try {
        const shouldClose = await action.run()
        if (!closesBeforeRun && shouldClose) {
          options.closeQuickOpen()
        }
        if (!shouldClose) return
        nextTick(() => {
          if (options.canRestoreEditorFocusAfterAction()) {
            options.focusEditor()
          }
        })
      } catch (err) {
        options.setErrorMessage(err instanceof Error ? err.message : 'Command failed.')
        if (!closesBeforeRun) {
          options.closeQuickOpen()
        }
      } finally {
        if (hasLoadingModal) {
          options.hideLoadingState()
        }
      }
    })()
  }

  function onQuickOpenEnter() {
    if (options.quickOpenPort.quickOpenIsActionMode.value) {
      const visibleActionItems = options.quickOpenPort.quickOpenActionGroups.value.flatMap((group) => group.items)
      const action = pickVisibleItem(visibleActionItems, options.quickOpenPort.quickOpenActiveIndex.value)
      if (action) {
        runQuickOpenAction(action.id)
      }
      return
    }

    if (options.quickOpenPort.quickOpenHasTextQuery.value) {
      const item = options.quickOpenPort.quickOpenResults.value[options.quickOpenPort.quickOpenActiveIndex.value]
      if (item) {
        void options.quickOpenPort.openQuickResult(item)
      }
      return
    }

    const browseItem = options.quickOpenPort.quickOpenBrowseItems.value[options.quickOpenPort.quickOpenActiveIndex.value]
    if (!browseItem) return
    if (browseItem.kind === 'action') {
      runQuickOpenAction(browseItem.id)
      return
    }
    void options.quickOpenPort.openQuickResult(browseItem)
  }

  function onQuickOpenInputKeydown(event: KeyboardEvent) {
    if (event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.stopPropagation()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      options.quickOpenPort.moveQuickOpenSelection(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      options.quickOpenPort.moveQuickOpenSelection(-1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      onQuickOpenEnter()
    }
  }

  function syncThemePickerActiveIndex() {
    if (options.themePickerPort.themePickerItems.value.length <= 0) {
      options.themePickerPort.themePickerActiveIndex.value = 0
      return
    }
    if (
      options.themePickerPort.themePickerActiveIndex.value < 0 ||
      options.themePickerPort.themePickerActiveIndex.value >= options.themePickerPort.themePickerItems.value.length
    ) {
      options.themePickerPort.themePickerActiveIndex.value = 0
    }
  }

  function previewThemePickerItem(next: ThemePreference) {
    options.themePickerPort.themePickerHasPreview.value = true
    options.applyThemePreview(next)
  }

  function previewThemePickerItemAtIndex(index: number) {
    const item = options.themePickerPort.themePickerItems.value[index]
    if (!item) return
    previewThemePickerItem(item.id)
  }

  function moveThemePickerSelection(delta: number) {
    const count = options.themePickerPort.themePickerItems.value.length
    if (!count) return
    options.themePickerPort.themePickerActiveIndex.value = (
      options.themePickerPort.themePickerActiveIndex.value + delta + count
    ) % count
    previewThemePickerItemAtIndex(options.themePickerPort.themePickerActiveIndex.value)
  }

  async function openThemePickerModal() {
    options.rememberFocusBeforeModalOpen()
    options.themePickerPort.themePickerVisible.value = true
    options.themePickerPort.themePickerQuery.value = ''
    options.themePickerPort.themePickerActiveIndex.value = 0
    options.themePickerPort.themePickerHasPreview.value = false
    await nextTick()
    options.focusThemePickerInput()
  }

  function closeThemePickerModal(restoreTheme = true) {
    if (restoreTheme && options.themePickerPort.themePickerHasPreview.value) {
      options.applyTheme()
    }
    options.themePickerPort.themePickerVisible.value = false
    options.themePickerPort.themePickerQuery.value = ''
    options.themePickerPort.themePickerActiveIndex.value = 0
    options.themePickerPort.themePickerHasPreview.value = false
    void nextTick(() => {
      options.restoreFocusAfterModalClose()
    })
  }

  function selectThemeFromModal(next: ThemePreference) {
    options.themePickerPort.themePreference.value = next
    closeThemePickerModal(false)
  }

  function onThemePickerEnter() {
    const item = options.themePickerPort.themePickerItems.value[options.themePickerPort.themePickerActiveIndex.value]
    if (!item) return
    selectThemeFromModal(item.id)
  }

  function onThemePickerInputKeydown(event: KeyboardEvent) {
    if (event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.stopPropagation()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      moveThemePickerSelection(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      moveThemePickerSelection(-1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      onThemePickerEnter()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeThemePickerModal()
    }
  }

  function openThemePickerFromOverflow() {
    options.closeOverflowMenu()
    void openThemePickerModal()
  }

  function openThemePickerFromPalette() {
    if (options.quickOpenPort.quickOpenVisible.value) {
      options.closeQuickOpen(false)
    }
    void openThemePickerModal()
    return true
  }

  function setThemeFromPalette(next: ThemePreference) {
    options.themePickerPort.themePreference.value = next
    return true
  }
  watch(options.themePickerPort.themePickerQuery, () => {
    options.themePickerPort.themePickerActiveIndex.value = 0
  })

  watch(options.themePickerPort.themePickerActiveIndex, () => {
    syncThemePickerActiveIndex()
    options.scrollThemePickerActiveItemIntoView()
  })

  watch(options.themePickerPort.themePickerVisible, (visible) => {
    if (!visible) return
    syncThemePickerActiveIndex()
    options.scrollThemePickerActiveItemIntoView()
  })

  return {
    runQuickOpenAction,
    onQuickOpenEnter,
    onQuickOpenInputKeydown,
    moveThemePickerSelection,
    syncThemePickerActiveIndex,
    previewThemePickerItem,
    previewThemePickerItemAtIndex,
    openThemePickerModal,
    closeThemePickerModal,
    selectThemeFromModal,
    onThemePickerEnter,
    onThemePickerInputKeydown,
    openThemePickerFromOverflow,
    openThemePickerFromPalette,
    setThemeFromPalette
  }
}
