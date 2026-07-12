import { computed, type Ref } from 'vue'
import type { AppThemeDefinition } from '../../shared/lib/themeRegistry'
import type { PaletteAction, PaletteActionFamily } from './useAppQuickOpen'
import type { ThemePreference } from './useAppTheme'

/**
 * Module: useAppShellPaletteActions
 *
 * Purpose:
 * - Build the shell command-palette catalog used by quick-open.
 *
 * Boundary:
 * - Keeps palette ordering and conditional action inclusion out of `App.vue`.
 * - Owns only the palette-facing wrappers, not the underlying command workflows.
 */

/** Groups the palette state that affects conditional action inclusion. */
export type AppShellPaletteStatePort = {
  activeFilePath: Readonly<Ref<string>>
  quickOpenQuery: Ref<string>
  hasWorkspace: Readonly<Ref<boolean>>
  spellcheckEnabled: Readonly<Ref<boolean>>
  editorMinimapVisible: Readonly<Ref<boolean>>
}

/** Groups the document helpers required by the palette catalog. */
export type AppShellPaletteDocumentPort = {
  isMarkdownPath: (path: string) => boolean
}

/** Groups the favorites helpers required by the palette catalog. */
export type AppShellPaletteFavoritesPort = {
  isFavorite: (path: string) => boolean
}

/** Groups the theme data used to build palette theme actions. */
export type AppShellPaletteThemePort = {
  availableThemes: readonly AppThemeDefinition[]
}

/** Groups palette-facing command wrappers owned by the shell. */
export type AppShellPaletteActionPort = {
  openHomeViewFromPalette: () => boolean | Promise<boolean>
  openFavoritesPanelFromPalette: () => boolean | Promise<boolean>
  openCosmosViewFromPalette: () => boolean | Promise<boolean>
  openSecondBrainViewFromPalette: () => boolean | Promise<boolean>
  openAlterExplorationViewFromPalette: () => boolean | Promise<boolean>
  openAltersViewFromPalette: () => boolean | Promise<boolean>
  addActiveNoteToSecondBrainFromPalette: () => boolean | Promise<boolean>
  addActiveNoteToFavoritesFromPalette: () => boolean | Promise<boolean>
  removeActiveNoteFromFavoritesFromPalette: () => boolean | Promise<boolean>
  convertMarkdownToWord: (path: string) => boolean | Promise<boolean>
  openSettingsFromPalette: () => boolean | Promise<boolean>
  openNoteInCosmosFromPalette: () => boolean | Promise<boolean>
  openWorkspaceFromPalette: () => boolean | Promise<boolean>
  closeWorkspaceFromPalette: () => boolean | Promise<boolean>
  openShortcutsFromPalette: () => boolean | Promise<boolean>
  zoomInFromPalette: () => boolean | Promise<boolean>
  zoomOutFromPalette: () => boolean | Promise<boolean>
  resetZoomFromPalette: () => boolean | Promise<boolean>
  toggleSpellcheckFromPalette: () => boolean | Promise<boolean>
  toggleEditorMinimapFromPalette: () => boolean | Promise<boolean>
  openSpellcheckDictionaryFromPalette: () => boolean | Promise<boolean>
  openThemePickerFromPalette: () => boolean | Promise<boolean>
  setThemeFromPalette: (next: ThemePreference) => boolean | Promise<boolean>
  openTodayNote: () => boolean | Promise<boolean>
  openYesterdayNote: () => boolean | Promise<boolean>
  openSpecificDateNote: () => boolean | Promise<boolean>
  createNewFileFromPalette: () => boolean | Promise<boolean>
  closeAllTabsFromPalette: () => boolean | Promise<boolean>
  closeAllTabsOnCurrentPaneFromPalette: () => boolean | Promise<boolean>
  closeOtherTabsFromPalette: () => boolean | Promise<boolean>
  splitPaneFromPalette: (axis: 'row' | 'column') => boolean | Promise<boolean>
  focusPaneFromPalette: (index: number) => boolean | Promise<boolean>
  focusNextPaneFromPalette: () => boolean | Promise<boolean>
  moveTabToNextPaneFromPalette: () => boolean | Promise<boolean>
  closeActivePaneFromPalette: () => boolean | Promise<boolean>
  joinPanesFromPalette: () => boolean | Promise<boolean>
  resetPaneLayoutFromPalette: () => boolean | Promise<boolean>
  revealActiveInExplorer: () => boolean | Promise<boolean>
}

/** Declares the dependencies required to build the palette catalog. */
export type UseAppShellPaletteActionsOptions = {
  statePort: AppShellPaletteStatePort
  documentPort: AppShellPaletteDocumentPort
  favoritesPort: AppShellPaletteFavoritesPort
  themePort: AppShellPaletteThemePort
  actionPort: AppShellPaletteActionPort
}

function createPaletteAction(
  family: PaletteActionFamily,
  action: Omit<PaletteAction, 'family'>
): PaletteAction {
  return { family, ...action }
}

// Palette ranking keeps action ordering stable as the shell grows.
export const PALETTE_ACTION_PRIORITY: Record<string, number> = {
  'open-file': 0,
  'open-workspace': 1,
  'open-home-view': 2,
  'open-favorites': 3,
  'open-today': 4,
  'open-yesterday': 5,
  'open-specific-date': 6,
  'open-cosmos-view': 7,
  'open-second-brain-view': 8,
  'open-alter-exploration-view': 9,
  'open-alters-view': 10,
  'add-active-note-to-second-brain': 10,
  'add-active-note-to-favorites': 11,
  'remove-active-note-from-favorites': 12,
  'open-settings': 13,
  'open-note-in-cosmos': 14,
  'reveal-in-explorer': 15,
  'convert-to-word': 15.5,
  'show-shortcuts': 16,
  'toggle-spellcheck': 16.5,
  'toggle-editor-minimap': 16.6,
  'manage-spellcheck-dictionary': 16.75,
  'create-new-file': 17,
  'close-other-tabs': 18,
  'close-all-tabs': 19,
  'close-all-tabs-current-pane': 20,
  'split-pane-right': 21,
  'split-pane-down': 22,
  'focus-pane-1': 23,
  'focus-pane-2': 24,
  'focus-pane-3': 25,
  'focus-pane-4': 26,
  'focus-next-pane': 27,
  'move-tab-next-pane': 28,
  'close-active-pane': 29,
  'join-panes': 30,
  'reset-pane-layout': 31,
  'zoom-in': 32,
  'zoom-out': 33,
  'zoom-reset': 34,
  'theme-select': 35,
  'theme-system': 36,
  'theme-tomosona-light': 37,
  'theme-tomosona-dark': 38,
  'theme-github-light': 39,
  'theme-tokyo-night': 40,
  'theme-catppuccin-latte': 41,
  'theme-catppuccin-mocha': 42,
  'close-workspace': 43
}

/**
 * Builds the command-palette action list and ordering metadata consumed by quick-open.
 */
export function useAppShellPaletteActions(options: UseAppShellPaletteActionsOptions) {
  const paletteActions = computed<PaletteAction[]>(() => [
    createPaletteAction('navigation', {
      id: 'open-home-view',
      label: 'Open Home',
      run: () => options.actionPort.openHomeViewFromPalette(),
      closeBeforeRun: true
    }),
    createPaletteAction('navigation', {
      id: 'open-favorites',
      label: 'Open Favorites',
      run: () => options.actionPort.openFavoritesPanelFromPalette(),
      closeBeforeRun: true
    }),
    createPaletteAction('navigation', {
      id: 'open-cosmos-view',
      label: 'Open Cosmos View',
      run: () => options.actionPort.openCosmosViewFromPalette(),
      closeBeforeRun: true,
      loadingLabel: 'Loading graph...'
    }),
    createPaletteAction('navigation', {
      id: 'open-second-brain-view',
      label: 'Open Second Brain View',
      run: () => options.actionPort.openSecondBrainViewFromPalette(),
      closeBeforeRun: true
    }),
    createPaletteAction('navigation', {
      id: 'open-alter-exploration-view',
      label: 'Open Alter Exploration',
      run: () => options.actionPort.openAlterExplorationViewFromPalette(),
      closeBeforeRun: true
    }),
    createPaletteAction('navigation', {
      id: 'open-alters-view',
      label: 'Open Alters View',
      run: () => options.actionPort.openAltersViewFromPalette(),
      closeBeforeRun: true
    }),
    ...(
      options.statePort.activeFilePath.value &&
      options.documentPort.isMarkdownPath(options.statePort.activeFilePath.value)
        ? [createPaletteAction('notes', {
            id: 'convert-to-word',
            label: 'Convert to Word',
            run: () => options.actionPort.convertMarkdownToWord(options.statePort.activeFilePath.value)
          })]
        : []
    ),
    createPaletteAction('notes', {
      id: 'add-active-note-to-second-brain',
      label: 'Add Active Note to Second Brain',
      run: () => options.actionPort.addActiveNoteToSecondBrainFromPalette()
    }),
    ...(
      options.statePort.activeFilePath.value &&
      !options.favoritesPort.isFavorite(options.statePort.activeFilePath.value)
        ? [createPaletteAction('notes', {
            id: 'add-active-note-to-favorites',
            label: 'Add Active File to Favorites',
            run: () => options.actionPort.addActiveNoteToFavoritesFromPalette()
          })]
        : []
    ),
    ...(
      options.statePort.activeFilePath.value &&
      options.favoritesPort.isFavorite(options.statePort.activeFilePath.value)
        ? [createPaletteAction('notes', {
            id: 'remove-active-note-from-favorites',
            label: 'Remove Active File from Favorites',
            run: () => options.actionPort.removeActiveNoteFromFavoritesFromPalette()
          })]
        : []
    ),
    createPaletteAction('utilities', {
      id: 'open-settings',
      label: 'Open Settings',
      run: () => options.actionPort.openSettingsFromPalette(),
      closeBeforeRun: true
    }),
    createPaletteAction('utilities', {
      id: 'toggle-spellcheck',
      label: options.statePort.spellcheckEnabled.value ? 'Disable Spellcheck' : 'Enable Spellcheck',
      run: () => options.actionPort.toggleSpellcheckFromPalette()
    }),
    createPaletteAction('view', {
      id: 'toggle-editor-minimap',
      label: options.statePort.editorMinimapVisible.value ? 'Hide Editor Minimap' : 'Show Editor Minimap',
      run: () => options.actionPort.toggleEditorMinimapFromPalette()
    }),
    ...(
      options.statePort.hasWorkspace.value
        ? [createPaletteAction('utilities', {
            id: 'manage-spellcheck-dictionary',
            label: 'Manage Spellcheck Dictionary',
            run: () => options.actionPort.openSpellcheckDictionaryFromPalette(),
            closeBeforeRun: true
          })]
        : []
    ),
    createPaletteAction('navigation', {
      id: 'open-note-in-cosmos',
      label: 'Open Note in Cosmos',
      run: () => options.actionPort.openNoteInCosmosFromPalette(),
      closeBeforeRun: true,
      loadingLabel: 'Loading graph and locating active note...'
    }),
    createPaletteAction('workspace', {
      id: 'open-workspace',
      label: 'Open Workspace',
      run: () => options.actionPort.openWorkspaceFromPalette()
    }),
    createPaletteAction('workspace', {
      id: 'close-workspace',
      label: 'Close Workspace',
      run: () => options.actionPort.closeWorkspaceFromPalette()
    }),
    createPaletteAction('utilities', {
      id: 'show-shortcuts',
      label: 'Show Keyboard Shortcuts',
      run: () => options.actionPort.openShortcutsFromPalette()
    }),
    createPaletteAction('view', {
      id: 'zoom-in',
      label: 'Zoom In (Editor)',
      run: () => options.actionPort.zoomInFromPalette()
    }),
    createPaletteAction('view', {
      id: 'zoom-out',
      label: 'Zoom Out (Editor)',
      run: () => options.actionPort.zoomOutFromPalette()
    }),
    createPaletteAction('view', {
      id: 'zoom-reset',
      label: 'Reset Zoom (Editor)',
      run: () => options.actionPort.resetZoomFromPalette()
    }),
    createPaletteAction('theme', {
      id: 'theme-select',
      label: 'Theme: Select Theme…',
      run: () => options.actionPort.openThemePickerFromPalette()
    }),
    createPaletteAction('theme', {
      id: 'theme-system',
      label: 'Theme: System',
      run: () => options.actionPort.setThemeFromPalette('system')
    }),
    ...options.themePort.availableThemes.map((theme) =>
      createPaletteAction('theme', {
        id: `theme-${theme.id}`,
        label: `Theme: ${theme.label}`,
        run: () => options.actionPort.setThemeFromPalette(theme.id)
      })
    ),
    createPaletteAction('notes', {
      id: 'open-today',
      label: 'Open Today',
      run: () => options.actionPort.openTodayNote()
    }),
    createPaletteAction('notes', {
      id: 'open-yesterday',
      label: 'Open Yesterday',
      run: () => options.actionPort.openYesterdayNote()
    }),
    createPaletteAction('notes', {
      id: 'open-specific-date',
      label: 'Open Specific Date',
      run: () => options.actionPort.openSpecificDateNote()
    }),
    createPaletteAction('notes', {
      id: 'create-new-file',
      label: 'New Note',
      run: () => options.actionPort.createNewFileFromPalette()
    }),
    createPaletteAction('layout', {
      id: 'close-all-tabs',
      label: 'Close All Tabs (All Panes)',
      run: () => options.actionPort.closeAllTabsFromPalette()
    }),
    createPaletteAction('layout', {
      id: 'close-all-tabs-current-pane',
      label: 'Close All Tabs on Current Pane',
      run: () => options.actionPort.closeAllTabsOnCurrentPaneFromPalette()
    }),
    createPaletteAction('layout', {
      id: 'close-other-tabs',
      label: 'Close Other Tabs',
      run: () => options.actionPort.closeOtherTabsFromPalette()
    }),
    createPaletteAction('layout', {
      id: 'split-pane-right',
      label: 'Split Pane Right',
      run: () => options.actionPort.splitPaneFromPalette('row')
    }),
    createPaletteAction('layout', {
      id: 'split-pane-down',
      label: 'Split Pane Down',
      run: () => options.actionPort.splitPaneFromPalette('column')
    }),
    createPaletteAction('layout', {
      id: 'focus-pane-1',
      label: 'Focus Pane 1',
      run: () => options.actionPort.focusPaneFromPalette(1)
    }),
    createPaletteAction('layout', {
      id: 'focus-pane-2',
      label: 'Focus Pane 2',
      run: () => options.actionPort.focusPaneFromPalette(2)
    }),
    createPaletteAction('layout', {
      id: 'focus-pane-3',
      label: 'Focus Pane 3',
      run: () => options.actionPort.focusPaneFromPalette(3)
    }),
    createPaletteAction('layout', {
      id: 'focus-pane-4',
      label: 'Focus Pane 4',
      run: () => options.actionPort.focusPaneFromPalette(4)
    }),
    createPaletteAction('layout', {
      id: 'focus-next-pane',
      label: 'Focus Next Pane',
      run: () => options.actionPort.focusNextPaneFromPalette()
    }),
    createPaletteAction('layout', {
      id: 'move-tab-next-pane',
      label: 'Move Active Tab to Next Pane',
      run: () => options.actionPort.moveTabToNextPaneFromPalette()
    }),
    createPaletteAction('layout', {
      id: 'close-active-pane',
      label: 'Close Active Pane',
      run: () => options.actionPort.closeActivePaneFromPalette()
    }),
    createPaletteAction('layout', {
      id: 'join-panes',
      label: 'Join Panes',
      run: () => options.actionPort.joinPanesFromPalette()
    }),
    createPaletteAction('layout', {
      id: 'reset-pane-layout',
      label: 'Reset Pane Layout',
      run: () => options.actionPort.resetPaneLayoutFromPalette()
    }),
    createPaletteAction('search', {
      id: 'open-file',
      label: 'Open File',
      run: () => {
        options.statePort.quickOpenQuery.value = ''
        return false
      }
    }),
    createPaletteAction('utilities', {
      id: 'reveal-in-explorer',
      label: 'Reveal in Explorer',
      run: () => options.actionPort.revealActiveInExplorer()
    })
  ])

  return {
    paletteActions,
    paletteActionPriority: PALETTE_ACTION_PRIORITY
  }
}
