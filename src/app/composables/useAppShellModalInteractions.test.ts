import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppShellModalInteractions } from './useAppShellModalInteractions'
import type { PaletteAction, QuickOpenActionGroup, QuickOpenResult } from './useAppQuickOpen'
import type { ThemePreference } from './useAppTheme'
import type { ThemePickerItem } from '../lib/appShellPresentation'

function createHarness() {
  const quickOpenVisible = ref(true)
  const quickOpenIsActionMode = ref(false)
  const quickOpenHasTextQuery = ref(true)
  const quickOpenActiveIndex = ref(0)
  const quickOpenActionResults = ref<PaletteAction[]>([])
  const quickOpenActionGroups = ref<QuickOpenActionGroup[]>([])
  const quickOpenResults = ref<QuickOpenResult[]>([])
  const quickOpenBrowseItems = ref<QuickOpenResult[]>([])
  const closeWorkspaceRun = vi.fn(async () => true)
  const paletteActions = ref<PaletteAction[]>([
    {
      id: 'open-settings',
      label: 'Open Settings',
      family: 'utilities',
      closeBeforeRun: true,
      loadingLabel: 'Loading settings...',
      run: vi.fn(async () => true)
    },
    {
      id: 'close-workspace',
      label: 'Close Workspace',
      family: 'workspace',
      run: closeWorkspaceRun
    }
  ])

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
  const showLoadingState = vi.fn()
  const hideLoadingState = vi.fn()
  const setErrorMessage = vi.fn()
  const applyTheme = vi.fn()
  const applyThemePreview = vi.fn()
  const openQuickResult = vi.fn(async () => true)
  const moveQuickOpenSelection = vi.fn()
  const scope = effectScope()
  const api = scope.run(() =>
    useAppShellModalInteractions({
      quickOpenPort: {
        quickOpenVisible,
        quickOpenIsActionMode,
        quickOpenHasTextQuery,
        quickOpenActiveIndex,
        quickOpenActionResults,
        quickOpenActionGroups,
        quickOpenResults,
        quickOpenBrowseItems,
        paletteActions,
        moveQuickOpenSelection,
        openQuickResult
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
      showLoadingState,
      hideLoadingState,
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
    showLoadingState,
    hideLoadingState,
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
    quickOpenActionResults,
    quickOpenActionGroups,
    quickOpenResults,
    quickOpenBrowseItems,
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

  it('runs a quick-open action with loading and focus restoration', async () => {
    const { api, scope, closeQuickOpen, showLoadingState, hideLoadingState, focusEditor } = createHarness()

    api.runQuickOpenAction('open-settings')
    await Promise.resolve()
    await Promise.resolve()

    expect(closeQuickOpen).toHaveBeenCalledWith(false)
    expect(showLoadingState).toHaveBeenCalledWith('Loading settings...')
    expect(hideLoadingState).toHaveBeenCalled()
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
    const { api, scope, quickOpenIsActionMode, quickOpenActionResults, quickOpenActionGroups, quickOpenActiveIndex, closeWorkspaceRun } = createHarness()

    quickOpenIsActionMode.value = true
    quickOpenActionResults.value = [
      {
        id: 'close-other-tabs',
        label: 'Close Other Tabs',
        family: 'layout',
        run: vi.fn(async () => true)
      },
      {
        id: 'close-workspace',
        label: 'Close Workspace',
        family: 'workspace',
        run: closeWorkspaceRun
      }
    ]
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
    expect(quickOpenActionResults.value[0].id).toBe('close-other-tabs')
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
