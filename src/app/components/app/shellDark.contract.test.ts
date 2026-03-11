import { describe, expect, it } from 'vitest'
import appSource from '../../App.vue?raw'
import sidebarSource from './SidebarSurface.vue?raw'
import topbarSource from './TopbarNavigationControls.vue?raw'
import statusBarSource from './WorkspaceStatusBar.vue?raw'
import searchPanelSource from './SearchSidebarPanel.vue?raw'
import quickOpenSource from './QuickOpenModal.vue?raw'
import paneTabsSource from '../panes/EditorPaneTabs.vue?raw'

describe('Shell dark theme contracts', () => {
  it('keeps shell chrome on shared semantic tokens', () => {
    expect(sidebarSource).toContain('var(--left-rail-bg)')
    expect(sidebarSource).toContain('var(--left-sidebar-border)')
    expect(sidebarSource).not.toContain(':global(.ide-root.dark)')

    expect(topbarSource).toContain('var(--topbar-command-bg)')
    expect(topbarSource).toContain('var(--topbar-border)')
    expect(topbarSource).not.toContain(':global(.ide-root.dark)')

    expect(statusBarSource).toContain('var(--footer-bg)')
    expect(statusBarSource).toContain('var(--footer-divider)')
    expect(statusBarSource).not.toContain(':global(.ide-root.dark)')

    expect(searchPanelSource).toContain('var(--search-chip-bg)')
    expect(searchPanelSource).toContain('var(--search-result-bg)')
    expect(searchPanelSource).not.toContain(':global(.ide-root.dark)')
  })

  it('keeps tabs and command palette on semantic shell tokens', () => {
    expect(paneTabsSource).toContain('var(--tabbar-bg)')
    expect(paneTabsSource).toContain('var(--tabbar-tab-active-pane-bg)')
    expect(paneTabsSource).not.toMatch(/#[0-9A-Fa-f]{3,8}/)

    expect(quickOpenSource).toContain('var(--command-palette-bg)')
    expect(quickOpenSource).toContain('var(--command-palette-item-active-bg)')
    expect(quickOpenSource).not.toMatch(/#[0-9A-Fa-f]{3,8}/)
  })

  it('keeps remaining shell globals on theme tokens', () => {
    expect(appSource).toContain('var(--shell-splitter)')
    expect(appSource).toContain('var(--toast-error-bg)')
    expect(appSource).toContain('var(--editor-progress-track)')
    expect(appSource).not.toContain('.ide-root.dark .splitter')
    expect(appSource).not.toContain('.ide-root.dark .toast-error')
  })
})
