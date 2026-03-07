import { describe, expect, it } from 'vitest'
import appSource from '../../App.vue?raw'
import sidebarSource from './SidebarSurface.vue?raw'
import topbarSource from './TopbarNavigationControls.vue?raw'
import statusBarSource from './WorkspaceStatusBar.vue?raw'
import searchPanelSource from './SearchSidebarPanel.vue?raw'

describe('Shell dark theme contracts', () => {
  it('keeps shell chrome on shared semantic tokens', () => {
    expect(sidebarSource).toContain('var(--shell-chrome-bg)')
    expect(sidebarSource).toContain('var(--shell-chrome-border)')
    expect(sidebarSource).not.toContain(':global(.ide-root.dark)')

    expect(topbarSource).toContain('var(--shell-command-bg)')
    expect(topbarSource).toContain('var(--menu-bg)')
    expect(topbarSource).not.toContain(':global(.ide-root.dark)')

    expect(statusBarSource).toContain('var(--shell-status-bg)')
    expect(statusBarSource).toContain('var(--shell-status-divider)')
    expect(statusBarSource).not.toContain(':global(.ide-root.dark)')

    expect(searchPanelSource).toContain('var(--search-chip-bg)')
    expect(searchPanelSource).toContain('var(--search-result-bg)')
    expect(searchPanelSource).not.toContain(':global(.ide-root.dark)')
  })

  it('keeps remaining shell globals on theme tokens', () => {
    expect(appSource).toContain('var(--shell-splitter)')
    expect(appSource).toContain('var(--toast-error-bg)')
    expect(appSource).toContain('var(--editor-progress-track)')
    expect(appSource).not.toContain('.ide-root.dark .splitter')
    expect(appSource).not.toContain('.ide-root.dark .toast-error')
  })
})
