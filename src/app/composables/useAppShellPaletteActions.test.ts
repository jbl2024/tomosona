import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppShellPaletteActions, type AppShellPaletteActionPort } from './useAppShellPaletteActions'

function createActionPort(overrides: Partial<AppShellPaletteActionPort> = {}): AppShellPaletteActionPort {
  const noop = () => true
  return {
    openHomeViewFromPalette: noop,
    openFavoritesPanelFromPalette: noop,
    addActiveNoteToFavoritesFromPalette: noop,
    removeActiveNoteFromFavoritesFromPalette: noop,
    convertMarkdownToWord: noop,
    openIntegratedTerminal: noop,
    openWorkspaceFromPalette: noop,
    closeWorkspaceFromPalette: noop,
    openShortcutsFromPalette: noop,
    zoomInFromPalette: noop,
    zoomOutFromPalette: noop,
    resetZoomFromPalette: noop,
    toggleSpellcheckFromPalette: noop,
    toggleEditorRulerFromPalette: noop,
    openSpellcheckDictionaryFromPalette: noop,
    openThemePickerFromPalette: noop,
    openSettings: noop,
    setThemeFromPalette: noop,
    openTodayNote: noop,
    openYesterdayNote: noop,
    openSpecificDateNote: noop,
    createNewFileFromPalette: noop,
    closeAllTabsFromPalette: noop,
    closeAllTabsOnCurrentPaneFromPalette: noop,
    closeOtherTabsFromPalette: noop,
    reopenLastClosedTabFromPalette: noop,
    splitPaneFromPalette: noop,
    focusPaneFromPalette: noop,
    focusNextPaneFromPalette: noop,
    moveTabToNextPaneFromPalette: noop,
    closeActivePaneFromPalette: noop,
    joinPanesFromPalette: noop,
    resetPaneLayoutFromPalette: noop,
    revealActiveInExplorer: noop,
    openExplorerSelection: noop,
    copyExplorerSelectionLink: noop,
    addExplorerSelectionToFavorites: noop,
    removeExplorerSelectionFromFavorites: noop,
    revealExplorerSelection: noop,
    extractSelectionToLinkedNote: noop,
    copySelectionAsMarkdown: noop,
    transformSelectionToHeading: noop,
    transformSelectionToList: noop,
    ...overrides
  }
}

function createPalette(actionPort: AppShellPaletteActionPort) {
  return useAppShellPaletteActions({
    statePort: {
      activeFilePath: ref('/vault/a.md'),
      quickOpenQuery: ref(''),
      hasWorkspace: ref(true),
      spellcheckEnabled: ref(false),
      editorRulerVisible: ref(false),
      explorerSelectionPath: ref(null),
      editorSelectionText: ref(''),
      editorSelectionMarkdown: ref('')
    },
    documentPort: { isMarkdownPath: (path) => path.endsWith('.md') },
    favoritesPort: { isFavorite: () => false },
    themePort: { availableThemes: [] },
    actionPort
  })
}

describe('useAppShellPaletteActions', () => {
  it('exposes a reopen-closed-tab command that runs the reopen port', async () => {
    const reopenLastClosedTabFromPalette = vi.fn(() => true)
    const palette = createPalette(createActionPort({ reopenLastClosedTabFromPalette }))

    const action = palette.paletteActions.value.find((item) => item.id === 'reopen-closed-tab')
    expect(action).toBeTruthy()
    expect(action?.label).toBe('Reopen Closed Tab')
    expect(action?.family).toBe('layout')

    await action?.run()
    expect(reopenLastClosedTabFromPalette).toHaveBeenCalledTimes(1)
  })

  it('keeps the existing close commands alongside the reopen command', () => {
    const palette = createPalette(createActionPort())
    const ids = palette.paletteActions.value.map((item) => item.id)

    expect(ids).toContain('close-other-tabs')
    expect(ids).toContain('close-all-tabs')
    expect(ids).toContain('close-all-tabs-current-pane')
    expect(ids).toContain('reopen-closed-tab')
  })
})
