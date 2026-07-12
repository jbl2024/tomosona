import { effectScope, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppShellPaletteActions } from './useAppShellPaletteActions'
import type { AppThemeDefinition } from '../../shared/lib/themeRegistry'

function createHarness(options: { isFavorite?: boolean; activeFilePath?: string } = {}) {
  const activeFilePath = ref(options.activeFilePath ?? '/vault/note.md')
  const quickOpenQuery = ref('query')
  const hasWorkspace = ref(true)
  const spellcheckEnabled = ref(false)
  const editorMinimapVisible = ref(false)
  const availableThemes: readonly AppThemeDefinition[] = [
    { id: 'tomosona-light', label: 'Tomosona Light', colorScheme: 'light', group: 'official' },
    { id: 'tokyo-night', label: 'Tokyo Night', colorScheme: 'dark', group: 'community' }
  ]

  const actionPort = {
    openHomeViewFromPalette: vi.fn(async () => true),
    openFavoritesPanelFromPalette: vi.fn(async () => true),
    openCosmosViewFromPalette: vi.fn(async () => true),
    openSecondBrainViewFromPalette: vi.fn(async () => true),
    openAlterExplorationViewFromPalette: vi.fn(async () => true),
    openAltersViewFromPalette: vi.fn(async () => true),
    addActiveNoteToSecondBrainFromPalette: vi.fn(async () => true),
    addActiveNoteToFavoritesFromPalette: vi.fn(async () => true),
    removeActiveNoteFromFavoritesFromPalette: vi.fn(async () => true),
    convertMarkdownToWord: vi.fn(async () => true),
    openSettingsFromPalette: vi.fn(async () => true),
    openNoteInCosmosFromPalette: vi.fn(async () => true),
    openWorkspaceFromPalette: vi.fn(async () => true),
    closeWorkspaceFromPalette: vi.fn(async () => true),
    openShortcutsFromPalette: vi.fn(async () => true),
    zoomInFromPalette: vi.fn(() => false),
    zoomOutFromPalette: vi.fn(() => false),
    resetZoomFromPalette: vi.fn(() => false),
    toggleSpellcheckFromPalette: vi.fn(() => false),
    toggleEditorMinimapFromPalette: vi.fn(() => false),
    openSpellcheckDictionaryFromPalette: vi.fn(() => false),
    openThemePickerFromPalette: vi.fn(() => false),
    setThemeFromPalette: vi.fn(() => false),
    openTodayNote: vi.fn(async () => true),
    openYesterdayNote: vi.fn(async () => true),
    openSpecificDateNote: vi.fn(async () => true),
    createNewFileFromPalette: vi.fn(async () => true),
    closeAllTabsFromPalette: vi.fn(() => true),
    closeAllTabsOnCurrentPaneFromPalette: vi.fn(() => true),
    closeOtherTabsFromPalette: vi.fn(() => true),
    splitPaneFromPalette: vi.fn(() => true),
    focusPaneFromPalette: vi.fn(() => true),
    focusNextPaneFromPalette: vi.fn(() => true),
    moveTabToNextPaneFromPalette: vi.fn(() => true),
    closeActivePaneFromPalette: vi.fn(() => true),
    joinPanesFromPalette: vi.fn(() => true),
    resetPaneLayoutFromPalette: vi.fn(() => true),
    revealActiveInExplorer: vi.fn(async () => true)
  }

  const documentPort = {
    isMarkdownPath: vi.fn((path: string) => path.endsWith('.md'))
  }
  const favoritesPort = {
    isFavorite: vi.fn(() => options.isFavorite ?? false)
  }

  const scope = effectScope()
  const api = scope.run(() => useAppShellPaletteActions({
    statePort: {
      activeFilePath,
      quickOpenQuery,
      hasWorkspace,
      spellcheckEnabled,
      editorMinimapVisible
    },
    documentPort,
    favoritesPort,
    themePort: {
      availableThemes
    },
    actionPort
  }))
  if (!api) throw new Error('Expected palette actions')

  return {
    api,
    scope,
    activeFilePath,
    quickOpenQuery,
    hasWorkspace,
    spellcheckEnabled,
    editorMinimapVisible,
    availableThemes,
    documentPort,
    favoritesPort,
    actionPort
  }
}

describe('useAppShellPaletteActions', () => {
  it('keeps palette ordering and priority stable', () => {
    const { api, scope } = createHarness()
    const actionIds = api.paletteActions.value.map((item) => item.id)

    expect(actionIds.slice(0, 5)).toEqual([
      'open-home-view',
      'open-favorites',
      'open-cosmos-view',
      'open-second-brain-view',
      'open-alter-exploration-view'
    ])
    expect(actionIds).toContain('open-alters-view')
    expect(actionIds).toContain('theme-select')
    expect(actionIds).toContain('theme-system')
    expect(actionIds.indexOf('theme-system')).toBeLessThan(actionIds.indexOf('theme-tomosona-light'))
    expect(actionIds).toContain('convert-to-word')
    expect(actionIds).toContain('toggle-spellcheck')
    expect(actionIds).toContain('toggle-editor-minimap')
    expect(actionIds).toContain('manage-spellcheck-dictionary')
    expect(actionIds[actionIds.length - 2]).toBe('open-file')
    expect(actionIds[actionIds.length - 1]).toBe('reveal-in-explorer')
    expect(api.paletteActionPriority['open-file']).toBe(0)
    expect(api.paletteActionPriority['close-workspace']).toBe(43)
    scope.stop()
  })

  it('toggles favorite actions based on the active file state', () => {
    const addHarness = createHarness({ activeFilePath: '/vault/photo.png', isFavorite: false })
    const addActionIds = addHarness.api.paletteActions.value.map((item) => item.id)
    expect(addActionIds).toContain('add-active-note-to-favorites')
    expect(addActionIds).not.toContain('remove-active-note-from-favorites')
    addHarness.scope.stop()

    const removeHarness = createHarness({ activeFilePath: '/vault/photo.png', isFavorite: true })
    const removeActionIds = removeHarness.api.paletteActions.value.map((item) => item.id)
    expect(removeActionIds).toContain('remove-active-note-from-favorites')
    expect(removeActionIds).not.toContain('add-active-note-to-favorites')
    removeHarness.scope.stop()
  })

  it('labels the spellcheck toggle according to the global preference', () => {
    const disabledHarness = createHarness()
    const disabledToggle = disabledHarness.api.paletteActions.value.find((item) => item.id === 'toggle-spellcheck')
    expect(disabledToggle?.label).toBe('Enable Spellcheck')
    disabledHarness.scope.stop()

    const enabledHarness = createHarness()
    enabledHarness.spellcheckEnabled.value = true
    const enabledToggle = enabledHarness.api.paletteActions.value.find((item) => item.id === 'toggle-spellcheck')
    expect(enabledToggle?.label).toBe('Disable Spellcheck')
    enabledHarness.scope.stop()
  })

  it('labels the minimap toggle according to the global preference', () => {
    const harness = createHarness()
    const findToggle = () => harness.api.paletteActions.value.find((item) => item.id === 'toggle-editor-minimap')
    expect(findToggle()?.label).toBe('Show Editor Minimap')
    harness.editorMinimapVisible.value = true
    expect(findToggle()?.label).toBe('Hide Editor Minimap')
    harness.scope.stop()
  })

  it('wires palette actions to the underlying command handlers', async () => {
    const { api, scope, actionPort, quickOpenQuery } = createHarness()

    const openHome = api.paletteActions.value.find((item) => item.id === 'open-home-view')
    const openFile = api.paletteActions.value.find((item) => item.id === 'open-file')
    const convertToWord = api.paletteActions.value.find((item) => item.id === 'convert-to-word')
    const toggleSpellcheck = api.paletteActions.value.find((item) => item.id === 'toggle-spellcheck')
    const toggleMinimap = api.paletteActions.value.find((item) => item.id === 'toggle-editor-minimap')
    const manageSpellcheckDictionary = api.paletteActions.value.find((item) => item.id === 'manage-spellcheck-dictionary')
    const themeSelect = api.paletteActions.value.find((item) => item.id === 'theme-select')

    expect(openHome).toBeTruthy()
    expect(openFile).toBeTruthy()
    expect(convertToWord).toBeTruthy()
    expect(toggleSpellcheck).toBeTruthy()
    expect(toggleMinimap).toBeTruthy()
    expect(manageSpellcheckDictionary).toBeTruthy()
    expect(themeSelect).toBeTruthy()

    await openHome?.run()
    expect(actionPort.openHomeViewFromPalette).toHaveBeenCalledTimes(1)

    expect(openFile?.run()).toBe(false)
    expect(quickOpenQuery.value).toBe('')

    await convertToWord?.run()
    expect(actionPort.convertMarkdownToWord).toHaveBeenCalledWith('/vault/note.md')

    expect(toggleSpellcheck?.run()).toBe(false)
    expect(actionPort.toggleSpellcheckFromPalette).toHaveBeenCalledTimes(1)
    expect(toggleMinimap?.run()).toBe(false)
    expect(actionPort.toggleEditorMinimapFromPalette).toHaveBeenCalledTimes(1)

    expect(manageSpellcheckDictionary?.run()).toBe(false)
    expect(actionPort.openSpellcheckDictionaryFromPalette).toHaveBeenCalledTimes(1)

    expect(themeSelect?.run()).toBe(false)
    expect(actionPort.openThemePickerFromPalette).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('hides the spellcheck dictionary manager when no workspace is open', () => {
    const harness = createHarness()
    harness.hasWorkspace.value = false

    expect(harness.api.paletteActions.value.map((item) => item.id)).not.toContain('manage-spellcheck-dictionary')
    harness.scope.stop()
  })

  it('hides convert to Word when the active file is not markdown', () => {
    const { api, scope } = createHarness()
    const next = createHarness({ activeFilePath: '/vault/note.txt' })

    expect(api.paletteActions.value.map((item) => item.id)).toContain('convert-to-word')
    expect(next.api.paletteActions.value.map((item) => item.id)).not.toContain('convert-to-word')
    scope.stop()
    next.scope.stop()
  })
})
