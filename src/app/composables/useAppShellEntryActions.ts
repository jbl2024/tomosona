import type { AppShellPaletteActionPort } from './useAppShellPaletteActions'
import type { UseAppShellLaunchpadActionPort } from './useAppShellLaunchpad'
import type { ThemePreference } from './useAppTheme'

/**
 * Module: useAppShellEntryActions
 *
 * Purpose:
 * - Own the shell-root entrypoint bridge for launchpad and palette actions.
 *
 * Boundary:
 * - Keeps `App.vue` from rebuilding large mutable adapter slabs inline.
 * - Exposes small ports that can be bound to the real shell workflows once they exist.
 */

/** Groups the theme picker callbacks used by palette entrypoints. */
export type AppShellEntryThemeActionPort = {
  openThemePickerFromPalette: () => boolean | Promise<boolean | void> | void
  setThemeFromPalette: (next: ThemePreference) => boolean | Promise<boolean | void> | void
}

/** Groups the mutable shell entrypoint adapters returned to `App.vue`. */
export type AppShellEntryActions = {
  launchpadActionPort: UseAppShellLaunchpadActionPort
  shellPaletteActionPort: AppShellPaletteActionPort
  bindLaunchpadActionPort: (actions: Partial<UseAppShellLaunchpadActionPort>) => void
  bindShellPaletteActionPort: (actions: Partial<AppShellPaletteActionPort>) => void
  bindThemeActionPort: (actions: Partial<AppShellEntryThemeActionPort>) => void
}

function createLaunchpadActionPort(): UseAppShellLaunchpadActionPort {
  return {
    openQuickOpen: async () => false,
    openCommandPalette: async () => false,
    openTodayNote: async () => false,
    openCosmosView: async () => false,
    openSecondBrainView: async () => false,
    openAltersView: async () => false
  }
}

function createShellPaletteActionPort(): AppShellPaletteActionPort {
  return {
    openHomeViewFromPalette: () => false,
    openFavoritesPanelFromPalette: () => false,
    openCosmosViewFromPalette: () => false,
    openSecondBrainViewFromPalette: () => false,
    openAltersViewFromPalette: () => false,
    addActiveNoteToSecondBrainFromPalette: () => false,
    addActiveNoteToFavoritesFromPalette: () => false,
    removeActiveNoteFromFavoritesFromPalette: () => false,
    openSettingsFromPalette: () => false,
    openNoteInCosmosFromPalette: () => false,
    openWorkspaceFromPalette: () => false,
    closeWorkspaceFromPalette: () => false,
    openShortcutsFromPalette: () => false,
    zoomInFromPalette: () => false,
    zoomOutFromPalette: () => false,
    resetZoomFromPalette: () => false,
    openThemePickerFromPalette: () => false,
    setThemeFromPalette: () => false,
    openTodayNote: () => false,
    openYesterdayNote: () => false,
    openSpecificDateNote: () => false,
    createNewFileFromPalette: () => false,
    closeAllTabsFromPalette: () => false,
    closeAllTabsOnCurrentPaneFromPalette: () => false,
    closeOtherTabsFromPalette: () => false,
    splitPaneFromPalette: () => false,
    focusPaneFromPalette: () => false,
    focusNextPaneFromPalette: () => false,
    moveTabToNextPaneFromPalette: () => false,
    closeActivePaneFromPalette: () => false,
    joinPanesFromPalette: () => false,
    resetPaneLayoutFromPalette: () => false,
    revealActiveInExplorer: () => false
  }
}

/**
 * Creates the shell entrypoint adapters and binds them to the real workflow implementations.
 */
export function useAppShellEntryActions(): AppShellEntryActions {
  const launchpadActionPort = createLaunchpadActionPort()
  const shellPaletteActionPort = createShellPaletteActionPort()

  function bindLaunchpadActionPort(actions: Partial<UseAppShellLaunchpadActionPort>) {
    Object.assign(launchpadActionPort, actions)
  }

  function bindShellPaletteActionPort(actions: Partial<AppShellPaletteActionPort>) {
    Object.assign(shellPaletteActionPort, actions)
  }

  function bindThemeActionPort(actions: Partial<AppShellEntryThemeActionPort>) {
    Object.assign(shellPaletteActionPort, actions)
  }

  return {
    launchpadActionPort,
    shellPaletteActionPort,
    bindLaunchpadActionPort,
    bindShellPaletteActionPort,
    bindThemeActionPort
  }
}
