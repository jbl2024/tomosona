import { describe, expect, it } from 'vitest'
import { useWorkspaceState } from './useWorkspaceState'

describe('useWorkspaceState', () => {
  it('supports explorer/favorites/search sidebar modes', () => {
    const workspace = useWorkspaceState()
    workspace.setSidebarMode('favorites')
    expect(workspace.sidebarMode.value).toBe('favorites')
    workspace.setSidebarMode('search')
    expect(workspace.sidebarMode.value).toBe('search')
    expect(workspace.sidebarVisible.value).toBe(true)
  })

  it('manages tabs, pinning, and active tab fallbacks', () => {
    const workspace = useWorkspaceState()

    workspace.openTab('a.md')
    workspace.openTab('b.md')
    workspace.openTab('a.md')
    expect(workspace.openTabs.value).toEqual([
      { path: 'a.md', pinned: false },
      { path: 'b.md', pinned: false }
    ])
    expect(workspace.activeTabPath.value).toBe('a.md')

    workspace.togglePin('a.md')
    expect(workspace.openTabs.value[0]?.pinned).toBe(true)

    workspace.setActiveTab('b.md')
    expect(workspace.activeTabPath.value).toBe('b.md')

    workspace.closeTab('b.md')
    expect(workspace.activeTabPath.value).toBe('a.md')

    workspace.replaceTabPath('a.md', 'c.md')
    expect(workspace.openTabs.value).toEqual([{ path: 'c.md', pinned: true }])
    expect(workspace.activeTabPath.value).toBe('c.md')

    workspace.moveTab(0, 0)
    expect(workspace.openTabs.value).toEqual([{ path: 'c.md', pinned: true }])

    workspace.closeCurrentTab()
    expect(workspace.openTabs.value).toEqual([])
    expect(workspace.activeTabPath.value).toBe('')
  })

  it('supports closing other tabs, closing all tabs, cycling, and right pane toggles', () => {
    const workspace = useWorkspaceState()

    workspace.openTab('a.md')
    workspace.openTab('b.md')
    workspace.openTab('c.md')
    workspace.setActiveTab('b.md')

    workspace.nextTab()
    expect(workspace.activeTabPath.value).toBe('c.md')

    workspace.toggleRightPane()
    expect(workspace.rightPaneVisible.value).toBe(true)

    workspace.closeOtherTabs('c.md')
    expect(workspace.openTabs.value).toEqual([{ path: 'c.md', pinned: false }])

    workspace.closeAllTabs()
    expect(workspace.openTabs.value).toEqual([])
    expect(workspace.activeTabPath.value).toBe('')

    workspace.setActiveTab('missing.md')
    expect(workspace.activeTabPath.value).toBe('')
  })
})
