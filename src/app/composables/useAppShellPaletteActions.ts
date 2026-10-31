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
  editorRulerVisible: Readonly<Ref<boolean>>
  /** Frozen at palette open: file highlighted in the explorer sidebar. */
  explorerSelectionPath: Readonly<Ref<string | null>>
  /** Frozen at palette open: text selected in the editor, if any. */
  editorSelectionText: Readonly<Ref<string>>
  /** Frozen at palette open: markdown of the editor selection, if any. */
  editorSelectionMarkdown: Readonly<Ref<string>>
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
  addActiveNoteToFavoritesFromPalette: () => boolean | Promise<boolean>
  removeActiveNoteFromFavoritesFromPalette: () => boolean | Promise<boolean>
  convertMarkdownToWord: (path: string) => boolean | Promise<boolean>
  openIntegratedTerminal: () => boolean | Promise<boolean>
  openWorkspaceFromPalette: () => boolean | Promise<boolean>
  closeWorkspaceFromPalette: () => boolean | Promise<boolean>
  openShortcutsFromPalette: () => boolean | Promise<boolean>
  zoomInFromPalette: () => boolean | Promise<boolean>
  zoomOutFromPalette: () => boolean | Promise<boolean>
  resetZoomFromPalette: () => boolean | Promise<boolean>
  toggleSpellcheckFromPalette: () => boolean | Promise<boolean>
  toggleEditorRulerFromPalette: () => boolean | Promise<boolean>
  openSpellcheckDictionaryFromPalette: () => boolean | Promise<boolean>
  openThemePickerFromPalette: () => boolean | Promise<boolean>
  openSettings: () => boolean | Promise<boolean>
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
  openExplorerSelection: (path: string) => boolean | Promise<boolean>
  copyExplorerSelectionLink: (path: string) => boolean | Promise<boolean>
  addExplorerSelectionToFavorites: (path: string) => boolean | Promise<boolean>
  removeExplorerSelectionFromFavorites: (path: string) => boolean | Promise<boolean>
  revealExplorerSelection: (path: string) => boolean | Promise<boolean>
  extractSelectionToLinkedNote: () => boolean | Promise<boolean>
  copySelectionAsMarkdown: (markdown: string) => boolean | Promise<boolean>
  transformSelectionToHeading: () => boolean | Promise<boolean>
  transformSelectionToList: () => boolean | Promise<boolean>
}

/** Declares the dependencies required to build the palette catalog. */
export type UseAppShellPaletteActionsOptions = {
  statePort: AppShellPaletteStatePort
  documentPort: AppShellPaletteDocumentPort
  favoritesPort: AppShellPaletteFavoritesPort
  themePort: AppShellPaletteThemePort
  actionPort: AppShellPaletteActionPort
}

/**
 * Favorite toggle for the explorer selection: exactly one of add/remove is
 * included, matching how the active-note favorite actions are conditioned.
 */
function explorerSelectionFavoriteActions(options: UseAppShellPaletteActionsOptions): PaletteAction[] {
  const path = options.statePort.explorerSelectionPath.value
  if (!path) return []
  const family: PaletteActionFamily = 'notes'
  if (options.favoritesPort.isFavorite(path)) {
    return [
      createPaletteAction(family, {
        id: 'remove-explorer-selection-from-favorites',
        label: 'Remove Selected File from Favorites',
        keywords: ['favorites', 'remove', 'selected', 'explorer'],
        run: () => options.actionPort.removeExplorerSelectionFromFavorites(path)
      })
    ]
  }
  return [
    createPaletteAction(family, {
      id: 'add-explorer-selection-to-favorites',
      label: 'Add Selected File to Favorites',
      keywords: ['favorites', 'add', 'selected', 'explorer'],
      run: () => options.actionPort.addExplorerSelectionToFavorites(path)
    })
  ]
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
  'add-active-note-to-favorites': 11,
  'remove-active-note-from-favorites': 12,
  'open-integrated-terminal': 13.5,
  'reveal-in-explorer': 15,
  'convert-to-word': 15.5,
  'show-shortcuts': 16,
  'toggle-spellcheck': 16.5,
  'toggle-editor-ruler': 16.6,
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
  'open-settings': 35.5,
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
      description: 'Show the launchpad view',
      keywords: ['home', 'accueil', 'launchpad'],
      run: () => options.actionPort.openHomeViewFromPalette(),
      closeBeforeRun: true
    }),
    createPaletteAction('navigation', {
      id: 'open-favorites',
      label: 'Open Favorites',
      description: 'Browse favorite notes',
      keywords: ['favoris', 'favorites', 'star'],
      run: () => options.actionPort.openFavoritesPanelFromPalette(),
      closeBeforeRun: true
    }),
    createPaletteAction('notes', {
      id: 'convert-to-word',
      label: 'Convert to Word',
      description: 'Convert the active note to DOCX',
      keywords: ['word', 'docx', 'convertir', 'export'],
      isEnabled: () => Boolean(options.statePort.activeFilePath.value)
        && options.documentPort.isMarkdownPath(options.statePort.activeFilePath.value),
      unavailableReason: 'Open a note to convert it',
      run: () => options.actionPort.convertMarkdownToWord(options.statePort.activeFilePath.value)
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
      id: 'open-integrated-terminal',
      label: 'Open Integrated Terminal',
      description: 'Open a terminal panel',
      keywords: ['terminal', 'shell', 'console'],
      shortcutLabel: 'Cmd+J',
      isEnabled: () => options.statePort.hasWorkspace.value,
      unavailableReason: 'Open a workspace first',
      run: () => options.actionPort.openIntegratedTerminal(),
      closeBeforeRun: true
    }),
    createPaletteAction('utilities', {
      id: 'toggle-spellcheck',
      label: options.statePort.spellcheckEnabled.value ? 'Disable Spellcheck' : 'Enable Spellcheck',
      description: 'Turn spellcheck on or off',
      keywords: ['orthographe', 'spellcheck'],
      run: () => options.actionPort.toggleSpellcheckFromPalette()
    }),
    createPaletteAction('view', {
      id: 'toggle-editor-ruler',
      label: options.statePort.editorRulerVisible.value ? 'Hide Editor Ruler' : 'Show Editor Ruler',
      description: 'Show or hide the editor ruler',
      keywords: ['ruler', 'regle'],
      run: () => options.actionPort.toggleEditorRulerFromPalette()
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
    createPaletteAction('workspace', {
      id: 'open-workspace',
      label: 'Open Workspace',
      description: 'Pick a workspace folder',
      keywords: ['dossier', 'folder', 'vault'],
      run: () => options.actionPort.openWorkspaceFromPalette()
    }),
    createPaletteAction('workspace', {
      id: 'close-workspace',
      label: 'Close Workspace',
      description: 'Close the current workspace',
      run: () => options.actionPort.closeWorkspaceFromPalette()
    }),
    createPaletteAction('utilities', {
      id: 'show-shortcuts',
      label: 'Show Keyboard Shortcuts',
      description: 'List every keyboard shortcut',
      keywords: ['raccourcis', 'shortcuts', 'aide', 'help'],
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
    createPaletteAction('utilities', {
      id: 'open-settings',
      label: 'Open settings',
      description: 'Customize the app',
      keywords: ['reglages', 'preferences'],
      shortcutLabel: 'Cmd+,',
      run: () => options.actionPort.openSettings(),
      closeBeforeRun: true
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
      description: 'Open the daily note',
      keywords: ['journal', 'today', 'daily'],
      shortcutLabel: 'Cmd+D',
      run: () => options.actionPort.openTodayNote()
    }),
    createPaletteAction('notes', {
      id: 'open-yesterday',
      label: 'Open Yesterday',
      description: 'Open yesterday daily note',
      keywords: ['journal', 'yesterday', 'hier'],
      run: () => options.actionPort.openYesterdayNote()
    }),
    createPaletteAction('notes', {
      id: 'open-specific-date',
      label: 'Open Specific Date',
      description: 'Open the daily note of a chosen date',
      keywords: ['journal', 'date'],
      run: () => options.actionPort.openSpecificDateNote()
    }),
    createPaletteAction('notes', {
      id: 'create-new-file',
      label: 'New Note',
      description: 'Create a note in the active folder',
      keywords: ['nouvelle', 'create', 'note'],
      shortcutLabel: 'Cmd+N',
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
    }),
    createPaletteAction('notes', {
      id: 'open-explorer-selection',
      label: 'Open Selected File',
      description: 'Open the file highlighted in the explorer',
      keywords: ['open', 'selected', 'explorer', 'selection'],
      isEnabled: () => Boolean(options.statePort.explorerSelectionPath.value),
      unavailableReason: 'Select a file in the explorer first',
      run: () => {
        const path = options.statePort.explorerSelectionPath.value
        return path ? options.actionPort.openExplorerSelection(path) : false
      }
    }),
    createPaletteAction('notes', {
      id: 'copy-explorer-selection-link',
      label: 'Copy Selected File Link',
      description: 'Copy a wikilink to the file highlighted in the explorer',
      keywords: ['copy', 'link', 'wikilink', 'selected', 'explorer'],
      isEnabled: () => Boolean(options.statePort.explorerSelectionPath.value),
      unavailableReason: 'Select a file in the explorer first',
      run: () => {
        const path = options.statePort.explorerSelectionPath.value
        return path ? options.actionPort.copyExplorerSelectionLink(path) : false
      }
    }),
    ...explorerSelectionFavoriteActions(options),
    createPaletteAction('utilities', {
      id: 'reveal-explorer-selection',
      label: 'Reveal Selected File',
      description: 'Reveal the file highlighted in the explorer',
      keywords: ['reveal', 'selected', 'explorer', 'finder'],
      isEnabled: () => Boolean(options.statePort.explorerSelectionPath.value),
      unavailableReason: 'Select a file in the explorer first',
      run: () => {
        const path = options.statePort.explorerSelectionPath.value
        return path ? options.actionPort.revealExplorerSelection(path) : false
      }
    }),
    createPaletteAction('notes', {
      id: 'extract-selection-to-note',
      label: 'Extract Selection to New Note',
      description: 'Create a note from the selection, keep it, and link it here',
      keywords: ['extract', 'selection', 'note', 'extraire', 'refactor'],
      isEnabled: () => Boolean(options.statePort.editorSelectionText.value.trim()),
      unavailableReason: 'Select text in the editor first',
      run: () => options.actionPort.extractSelectionToLinkedNote()
    }),
    createPaletteAction('notes', {
      id: 'copy-selection-as-markdown',
      label: 'Copy Selection as Markdown',
      description: 'Copy the selected text as Markdown source',
      keywords: ['copy', 'markdown', 'selection', 'copier'],
      isEnabled: () => Boolean(options.statePort.editorSelectionText.value.trim()),
      unavailableReason: 'Select text in the editor first',
      run: () => options.actionPort.copySelectionAsMarkdown(options.statePort.editorSelectionMarkdown.value)
    }),
    createPaletteAction('notes', {
      id: 'transform-selection-heading',
      label: 'Turn Selection into Heading',
      description: 'Transform the selected block into a level-2 heading',
      keywords: ['heading', 'title', 'transform', 'titre'],
      isEnabled: () => Boolean(options.statePort.editorSelectionText.value.trim()),
      unavailableReason: 'Select text in the editor first',
      run: () => options.actionPort.transformSelectionToHeading()
    }),
    createPaletteAction('notes', {
      id: 'transform-selection-list',
      label: 'Turn Selection into List',
      description: 'Transform the selected block into a bullet list',
      keywords: ['list', 'bullet', 'transform', 'liste'],
      isEnabled: () => Boolean(options.statePort.editorSelectionText.value.trim()),
      unavailableReason: 'Select text in the editor first',
      run: () => options.actionPort.transformSelectionToList()
    })
  ])

  return {
    paletteActions,
    paletteActionPriority: PALETTE_ACTION_PRIORITY
  }
}
