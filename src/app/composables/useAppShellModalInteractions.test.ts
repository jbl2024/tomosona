import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppShellModalInteractions } from './useAppShellModalInteractions'
import type { PaletteAction, PaletteResult, QuickOpenActionGroup, QuickOpenResult, QuickOpenTabMenu, QuickOpenTabMenuItem } from './useAppQuickOpen'
import type { ThemePreference } from './useAppTheme'
import type { ThemePickerItem } from '../lib/appShellPresentation'

function createHarness(overrides?: { paletteActions?: PaletteAction[] }) {
  const quickOpenVisible = ref(true)
  const quickOpenIsActionMode = ref(false)
  const quickOpenHasTextQuery = ref(true)
  const quickOpenActiveIndex = ref(0)
  const quickOpenActionGroups = ref<QuickOpenActionGroup[]>([])
  const quickOpenResults = ref<QuickOpenResult[]>([])
  const quickOpenPaletteResults = ref<PaletteResult[]>([])
  const quickOpenBrowseItems = ref<QuickOpenResult[]>([])
  const closeWorkspaceRun = vi.fn(async () => true)
  const paletteActions = ref<PaletteAction[]>(
    overrides?.paletteActions ?? [
    {
      id: 'open-settings',
      label: 'Open Settings',
      family: 'utilities',
      closeBeforeRun: true,
      run: vi.fn(async () => true)
    },
    {
      id: 'close-workspace',
      label: 'Close Workspace',
      family: 'workspace',
      run: closeWorkspaceRun
    }
    ]
  )

  const themePickerVisible = ref(false)
  const themePickerQuery = ref('tok')
  const themePickerActiveIndex = ref(1)
  const themePickerItems = ref<ThemePickerItem[]>([
    { kind: 'system', id: 'system', label: 'System', meta: 'System', previewThemeIds: [] as never[] },
    { kind: 'theme', id: 'tokyo-night', label: 'Tokyo Night', meta: 'Dark', colorScheme: 'dark', group: 'official' }
  ])
  const themePickerHasPreview = ref(false)
  const themePreference = ref<ThemePreference>('system')

  const closeQuickOpen = vi.fn()
  const closeOverflowMenu = vi.fn()
  const rememberFocusBeforeModalOpen = vi.fn()
  const restoreFocusAfterModalClose = vi.fn()
  const focusEditor = vi.fn()
  const focusQuickOpenInput = vi.fn()
  const focusThemePickerInput = vi.fn()
  const scrollThemePickerActiveItemIntoView = vi.fn()
  const setErrorMessage = vi.fn()
  const applyTheme = vi.fn()
  const applyThemePreview = vi.fn()
  const openQuickResult = vi.fn(async () => true)
  const selectPaletteResult = vi.fn()
  const openQuickResultAtTarget = vi.fn(async () => true)
  const quickOpenTabMenu = ref<QuickOpenTabMenu | null>(null)
  const quickOpenTabMenuItems = ref<QuickOpenTabMenuItem[]>([])
  const openQuickOpenTabMenu = vi.fn((path: string, title: string) => {
    quickOpenTabMenu.value = { path, title, itemIndex: 0 }
  })
  const closeQuickOpenTabMenu = vi.fn(() => {
    quickOpenTabMenu.value = null
  })
  const moveQuickOpenTabMenuSelection = vi.fn()
  const setQuickOpenTabMenuItemIndex = vi.fn()
  const runQuickOpenTabMenuAction = vi.fn()
  const recordQuickOpenCommandUsage = vi.fn()
  const moveQuickOpenSelection = vi.fn()
  const scope = effectScope()
  const api = scope.run(() =>
    useAppShellModalInteractions({
      quickOpenPort: {
        quickOpenVisible,
        quickOpenIsActionMode,
        quickOpenHasTextQuery,
        quickOpenActiveIndex,
        quickOpenActionGroups,
        quickOpenResults,
        quickOpenPaletteResults,
        quickOpenBrowseItems,
        paletteActions,
        moveQuickOpenSelection,
        openQuickResult,
        selectPaletteResult,
        openQuickResultAtTarget,
        quickOpenTabMenu,
        quickOpenTabMenuItems,
        openQuickOpenTabMenu,
        closeQuickOpenTabMenu,
        moveQuickOpenTabMenuSelection,
        setQuickOpenTabMenuItemIndex,
        runQuickOpenTabMenuAction,
        recordQuickOpenCommandUsage
      },
      themePickerPort: {
        themePickerVisible,
        themePickerQuery,
        themePickerActiveIndex,
        themePickerItems,
        themePickerHasPreview,
        themePreference
      },
      closeQuickOpen,
      closeOverflowMenu,
      rememberFocusBeforeModalOpen,
      restoreFocusAfterModalClose,
      focusEditor,
      focusQuickOpenInput,
      focusThemePickerInput,
      scrollThemePickerActiveItemIntoView,
      setErrorMessage,
      canRestoreEditorFocusAfterAction: () => true,
      applyTheme,
      applyThemePreview
    })
  )
  if (!api) throw new Error('Expected modal interactions controller')
  return {
    api,
    scope,
    closeQuickOpen,
    closeOverflowMenu,
    rememberFocusBeforeModalOpen,
    restoreFocusAfterModalClose,
    focusEditor,
    focusQuickOpenInput,
    focusThemePickerInput,
    scrollThemePickerActiveItemIntoView,
    setErrorMessage,
    applyTheme,
    applyThemePreview,
    openQuickResult,
    moveQuickOpenSelection,
    closeWorkspaceRun,
    quickOpenVisible,
    quickOpenIsActionMode,
    quickOpenHasTextQuery,
    quickOpenActiveIndex,
    quickOpenActionGroups,
    quickOpenResults,
    quickOpenPaletteResults,
    quickOpenBrowseItems,
    selectPaletteResult,
    openQuickResultAtTarget,
    quickOpenTabMenu,
    quickOpenTabMenuItems,
    openQuickOpenTabMenu,
    closeQuickOpenTabMenu,
    moveQuickOpenTabMenuSelection,
    setQuickOpenTabMenuItemIndex,
    runQuickOpenTabMenuAction,
    recordQuickOpenCommandUsage,
    themePickerVisible,
    themePickerQuery,
    themePickerActiveIndex,
    themePickerItems,
    themePickerHasPreview,
    themePreference
  }
}

describe('useAppShellModalInteractions', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('runs a quick-open action and restores editor focus', async () => {
    const { api, scope, closeQuickOpen, focusEditor } = createHarness()

    api.runQuickOpenAction('open-settings')
    await Promise.resolve()
    await Promise.resolve()

    expect(closeQuickOpen).toHaveBeenCalledWith(false)
    expect(focusEditor).toHaveBeenCalled()
    scope.stop()
  })

  it('restores focus after a workspace-close action resolves', async () => {
    const { api, scope, closeQuickOpen, focusEditor, closeWorkspaceRun } = createHarness()

    api.runQuickOpenAction('close-workspace')
    await Promise.resolve()
    await Promise.resolve()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(closeQuickOpen).toHaveBeenCalled()
    expect(closeWorkspaceRun).toHaveBeenCalled()
    expect(focusEditor).toHaveBeenCalled()
    scope.stop()
  })

  it('runs the first visible action on Enter in grouped action mode', async () => {
    const { api, scope, quickOpenIsActionMode, quickOpenActionGroups, quickOpenActiveIndex, closeWorkspaceRun } = createHarness()

    quickOpenIsActionMode.value = true
    quickOpenActionGroups.value = [
      {
        family: 'workspace',
        label: 'Workspace',
        items: [
          {
            id: 'close-workspace',
            label: 'Close Workspace',
            family: 'workspace',
            run: closeWorkspaceRun
          }
        ]
      },
      {
        family: 'layout',
        label: 'Layout',
        items: [
          {
            id: 'close-other-tabs',
            label: 'Close Other Tabs',
            family: 'layout',
            run: vi.fn(async () => true)
          }
        ]
      }
    ]
    quickOpenActiveIndex.value = 0

    api.onQuickOpenEnter()
    await Promise.resolve()
    await Promise.resolve()

    expect(closeWorkspaceRun).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('routes quick-open input arrows to the selection helper', () => {
    const { api, scope, moveQuickOpenSelection } = createHarness()
    const event = {
      key: 'ArrowDown',
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as KeyboardEvent

    api.onQuickOpenInputKeydown(event)

    expect(moveQuickOpenSelection).toHaveBeenCalledWith(1)
    scope.stop()
  })

  it('updates and clears the theme picker selection flow', async () => {
    const { api, scope, themePickerVisible, themePickerQuery, themePickerActiveIndex, themePickerHasPreview, themePreference, applyThemePreview } =
      createHarness()

    await api.openThemePickerModal()
    expect(themePickerVisible.value).toBe(true)

    api.previewThemePickerItem('tokyo-night')
    expect(themePickerHasPreview.value).toBe(true)
    expect(applyThemePreview).toHaveBeenCalledWith('tokyo-night')
    expect(themePreference.value).toBe('system')

    api.selectThemeFromModal('tokyo-night')
    expect(themePreference.value).toBe('tokyo-night')
    expect(themePickerVisible.value).toBe(false)
    expect(themePickerQuery.value).toBe('')
    expect(themePickerActiveIndex.value).toBe(0)
    scope.stop()
  })
})

describe('useAppShellModalInteractions palette availability guard', () => {
  it('refuses to run an unavailable command', async () => {
    const run = vi.fn(() => true)
    const { api, scope, closeQuickOpen } = createHarness({
      paletteActions: [
        {
          id: 'convert-to-word',
          label: 'Convert to Word',
          family: 'notes',
          isEnabled: () => false,
          unavailableReason: 'Open a note to convert it',
          run
        }
      ]
    })

    try {
      api.runQuickOpenAction('convert-to-word')
      await Promise.resolve()
      await Promise.resolve()

      expect(run).not.toHaveBeenCalled()
      expect(closeQuickOpen).not.toHaveBeenCalled()
    } finally {
      scope.stop()
    }
  })
})

describe('useAppShellModalInteractions palette keyboard', () => {
  it('selects the unified palette result at the active index on Enter', () => {
    const {
      api,
      scope,
      quickOpenIsActionMode,
      quickOpenHasTextQuery,
      quickOpenActiveIndex,
      quickOpenPaletteResults,
      selectPaletteResult
    } = createHarness()
    quickOpenIsActionMode.value = false
    quickOpenHasTextQuery.value = true
    quickOpenPaletteResults.value = [
      { kind: 'note', path: '/vault/a.md', title: 'A', folder: '', matchKind: 'partial' },
      { kind: 'create', title: 'a' }
    ]
    quickOpenActiveIndex.value = 1

    api.onQuickOpenInputKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))

    expect(selectPaletteResult).toHaveBeenCalledWith({ kind: 'create', title: 'a' }, 'active')
    scope.stop()
  })

  it('opens a palette result in a new tab on Cmd+Enter', () => {
    const {
      api,
      scope,
      quickOpenIsActionMode,
      quickOpenHasTextQuery,
      quickOpenActiveIndex,
      quickOpenPaletteResults,
      selectPaletteResult
    } = createHarness()
    quickOpenIsActionMode.value = false
    quickOpenHasTextQuery.value = true
    quickOpenPaletteResults.value = [{ kind: 'note', path: '/vault/a.md', title: 'A', folder: '', matchKind: 'partial' }]
    quickOpenActiveIndex.value = 0

    api.onQuickOpenInputKeydown(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, cancelable: true }))

    expect(selectPaletteResult).toHaveBeenCalledWith(
      { kind: 'note', path: '/vault/a.md', title: 'A', folder: '', matchKind: 'partial' },
      'new-tab'
    )
    scope.stop()
  })

  it('opens a palette result in the adjacent pane on Alt+Enter', () => {
    const {
      api,
      scope,
      quickOpenIsActionMode,
      quickOpenHasTextQuery,
      quickOpenActiveIndex,
      quickOpenPaletteResults,
      selectPaletteResult
    } = createHarness()
    quickOpenIsActionMode.value = false
    quickOpenHasTextQuery.value = true
    quickOpenPaletteResults.value = [{ kind: 'note', path: '/vault/a.md', title: 'A', folder: '', matchKind: 'partial' }]
    quickOpenActiveIndex.value = 0

    api.onQuickOpenInputKeydown(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, cancelable: true }))

    expect(selectPaletteResult).toHaveBeenCalledWith(
      { kind: 'note', path: '/vault/a.md', title: 'A', folder: '', matchKind: 'partial' },
      'adjacent'
    )
    scope.stop()
  })

  it('opens a browsed recent note at the keyboard target', () => {
    const {
      api,
      scope,
      quickOpenIsActionMode,
      quickOpenHasTextQuery,
      quickOpenActiveIndex,
      quickOpenBrowseItems,
      openQuickResultAtTarget
    } = createHarness()
    quickOpenIsActionMode.value = false
    quickOpenHasTextQuery.value = false
    quickOpenBrowseItems.value = [{ kind: 'recent', path: '/vault/a.md', label: 'A', recencyLabel: 'today' }]
    quickOpenActiveIndex.value = 0

    api.onQuickOpenInputKeydown(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, cancelable: true }))
    api.onQuickOpenInputKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))

    expect(openQuickResultAtTarget).toHaveBeenNthCalledWith(1, '/vault/a.md', 'new-tab')
    expect(openQuickResultAtTarget).toHaveBeenNthCalledWith(2, '/vault/a.md', 'active')
    scope.stop()
  })

  it('opens the Tab menu for the active note result on Tab', () => {
    const {
      api,
      scope,
      quickOpenIsActionMode,
      quickOpenHasTextQuery,
      quickOpenActiveIndex,
      quickOpenPaletteResults,
      openQuickOpenTabMenu
    } = createHarness()
    quickOpenIsActionMode.value = false
    quickOpenHasTextQuery.value = true
    quickOpenPaletteResults.value = [
      { kind: 'note', path: '/vault/a.md', title: 'A', folder: '', matchKind: 'partial' },
      { kind: 'create', title: 'a' }
    ]
    quickOpenActiveIndex.value = 0

    api.onQuickOpenInputKeydown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))

    expect(openQuickOpenTabMenu).toHaveBeenCalledWith('/vault/a.md', 'A')

    // Non-note rows and action mode stay Enter-only.
    openQuickOpenTabMenu.mockClear()
    quickOpenActiveIndex.value = 1
    api.onQuickOpenInputKeydown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))
    quickOpenActiveIndex.value = 0
    quickOpenIsActionMode.value = true
    api.onQuickOpenInputKeydown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))
    expect(openQuickOpenTabMenu).not.toHaveBeenCalled()
    scope.stop()
  })

  it('routes menu navigation, execution, and close keys while the Tab menu is open', () => {
    const {
      api,
      scope,
      quickOpenIsActionMode,
      quickOpenHasTextQuery,
      quickOpenTabMenu,
      quickOpenTabMenuItems,
      openQuickOpenTabMenu,
      closeQuickOpenTabMenu,
      moveQuickOpenTabMenuSelection,
      runQuickOpenTabMenuAction,
      closeQuickOpen
    } = createHarness()
    quickOpenIsActionMode.value = false
    quickOpenHasTextQuery.value = true
    quickOpenTabMenuItems.value = [
      { id: 'copy-link', label: 'Copy note link' },
      { id: 'toggle-favorite', label: 'Add to favorites' }
    ]
    openQuickOpenTabMenu('/vault/a.md', 'A')

    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    api.onQuickOpenInputKeydown(down)
    expect(moveQuickOpenTabMenuSelection).toHaveBeenCalledWith(1)

    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    api.onQuickOpenInputKeydown(enter)
    expect(runQuickOpenTabMenuAction).toHaveBeenCalledWith(quickOpenTabMenu.value, 'copy-link')

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    api.onQuickOpenInputKeydown(escape)
    expect(closeQuickOpenTabMenu).toHaveBeenCalled()
    expect(closeQuickOpen).not.toHaveBeenCalled()
    expect(enter.defaultPrevented).toBe(true)
    scope.stop()
  })

  it('lets native text-editing keys pass through untouched (Cmd+A, Backspace)', () => {
    const { api, scope } = createHarness()

    const cmdA = new KeyboardEvent('keydown', { key: 'a', metaKey: true, cancelable: true })
    api.onQuickOpenInputKeydown(cmdA)
    expect(cmdA.defaultPrevented).toBe(false)

    const backspace = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true })
    api.onQuickOpenInputKeydown(backspace)
    expect(backspace.defaultPrevented).toBe(false)

    scope.stop()
  })
})
