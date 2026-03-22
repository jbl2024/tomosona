import { describe, expect, it } from 'vitest'
import appSource from './app/App.vue?raw'

describe('App shell contract', () => {
  it('keeps derived shell view models out of App.vue', () => {
    expect(appSource).not.toContain('const shortcutSections = computed(()')
    expect(appSource).not.toContain('const metadataRows = computed(()')
    expect(appSource).not.toContain('const cosmosPaneViewModel = computed<')
    expect(appSource).not.toContain('const backHistoryItems = computed(()')
    expect(appSource).toContain('useAppShellViewModels')
  })

  it('keeps the workspace setup wizard workflow in a dedicated composable', () => {
    expect(appSource).not.toContain('async function applyWorkspaceSetupWizard')
    expect(appSource).not.toContain('async function ensureRelativeFolder')
    expect(appSource).toContain('useAppShellWorkspaceSetup')
  })

  it('keeps workspace filesystem watcher wiring out of App.vue', () => {
    expect(appSource).not.toContain('listenWorkspaceFsChanged')
    expect(appSource).toContain('useAppShellWorkspaceLifecycle')
  })

  it('keeps the app-shell runtime boot and teardown behind a dedicated composable', () => {
    expect(appSource).not.toContain('onMounted(() => {\n  shellPersistence.initializeShellPersistence()')
    expect(appSource).not.toContain('onMounted(() => {\n  installOpenDebugLongTaskObserver()')
    expect(appSource).not.toContain('disposeOpenTraceActivitySubscription')
    expect(appSource).not.toContain("mediaQuery?.addEventListener('change'")
    expect(appSource).not.toContain("window.addEventListener('mousedown'")
    expect(appSource).not.toContain("window.removeEventListener('mousedown'")
    expect(appSource).not.toContain('void syncAlterSettingsFromDisk()')
    expect(appSource).not.toContain('onMounted(() => {\n  void workspaceLifecycle.start()')
    expect(appSource).not.toContain('onBeforeUnmount(() => {\n  workspaceLifecycle.dispose()')
    expect(appSource).toContain('useAppShellRuntimeLifecycle')
  })

  it('keeps shell chrome runtime helpers out of App.vue', () => {
    expect(appSource).not.toContain('function beginResize(')
    expect(appSource).not.toContain('function toggleOverflowMenu(')
    expect(appSource).not.toContain('function openDesignSystemDebugFromOverflow(')
    expect(appSource).not.toContain('function zoomInFromOverflow(')
    expect(appSource).not.toContain('function zoomOutFromOverflow(')
    expect(appSource).not.toContain('function resetZoomFromOverflow(')
    expect(appSource).toContain('useAppShellChromeRuntime')
  })

  it('keeps the command palette catalog in a dedicated helper', () => {
    expect(appSource).not.toContain('createPaletteAction(')
    expect(appSource).not.toContain('paletteActionPriority: Record<string, number> = {')
    expect(appSource).not.toContain('const paletteActions = computed<PaletteAction[]>')
    expect(appSource).toContain('useAppShellPaletteActions')
  })

  it('keeps launchpad quick-start routing and theme picker proxies out of App.vue', () => {
    expect(appSource).not.toContain('launchpadActionPort.openQuickOpen =')
    expect(appSource).not.toContain('shellPaletteActionPort.openHomeViewFromPalette =')
    expect(appSource).not.toContain('shellPaletteActionPort.openThemePickerFromPalette =')
    expect(appSource).toContain('useAppShellEntryActions')
  })

  it('keeps workspace entrypoint routing out of App.vue', () => {
    expect(appSource).not.toContain('@select-working-folder="void onSelectWorkingFolder()"')
    expect(appSource).not.toContain('@launchpad-open-workspace="void onSelectWorkingFolder()"')
    expect(appSource).not.toContain('@launchpad-open-wizard="void openWorkspaceSetupWizard()"')
    expect(appSource).not.toContain('@launchpad-open-recent-workspace="void openRecentWorkspace($event)"')
    expect(appSource).not.toContain('@cancel="closeWorkspaceSetupWizard"')
    expect(appSource).not.toContain('@submit="void applyWorkspaceSetupWizard($event)"')
    expect(appSource).toContain('useAppShellWorkspaceRouting')
  })
})
