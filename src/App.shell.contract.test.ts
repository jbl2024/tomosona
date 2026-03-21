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
})
