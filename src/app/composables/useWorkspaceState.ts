import { computed, ref } from 'vue'

export type SidebarMode = 'explorer' | 'search'

export type WorkspaceTab = {
  path: string
  pinned: boolean
}

export function useWorkspaceState() {
  const openTabs = ref<WorkspaceTab[]>([])
  const activeTabPath = ref('')
  const sidebarMode = ref<SidebarMode>('explorer')
  const sidebarVisible = ref(true)
  const rightPaneVisible = ref(false)

  const activeTabIndex = computed(() => openTabs.value.findIndex((tab) => tab.path === activeTabPath.value))

  function setSidebarMode(mode: SidebarMode) {
    sidebarMode.value = mode
    if (!sidebarVisible.value) {
      sidebarVisible.value = true
    }
  }

  function toggleSidebar() {
    sidebarVisible.value = !sidebarVisible.value
  }

  function toggleRightPane() {
    rightPaneVisible.value = !rightPaneVisible.value
  }

  function openTab(path: string) {
    const existing = openTabs.value.find((tab) => tab.path === path)
    if (!existing) {
      openTabs.value.push({ path, pinned: false })
    }
    activeTabPath.value = path
  }

  function setActiveTab(path: string) {
    if (!openTabs.value.some((tab) => tab.path === path)) return
    activeTabPath.value = path
  }

  function closeTab(path: string) {
    const idx = openTabs.value.findIndex((tab) => tab.path === path)
    if (idx < 0) return

    const wasActive = activeTabPath.value === path
    openTabs.value.splice(idx, 1)

    if (!wasActive) return
    const fallback = openTabs.value[idx] ?? openTabs.value[idx - 1]
    activeTabPath.value = fallback?.path ?? ''
  }

  function closeOtherTabs(path: string) {
    const active = openTabs.value.find((tab) => tab.path === path)
    if (!active) return
    openTabs.value = [active]
    activeTabPath.value = path
  }

  function closeAllTabs() {
    openTabs.value = []
    activeTabPath.value = ''
  }

  function togglePin(path: string) {
    const tab = openTabs.value.find((entry) => entry.path === path)
    if (!tab) return
    tab.pinned = !tab.pinned
  }

  function closeCurrentTab() {
    if (!activeTabPath.value) return
    closeTab(activeTabPath.value)
  }

  function moveTab(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    if (fromIndex < 0 || toIndex < 0) return
    if (fromIndex >= openTabs.value.length || toIndex >= openTabs.value.length) return

    const [item] = openTabs.value.splice(fromIndex, 1)
    openTabs.value.splice(toIndex, 0, item)
  }

  function nextTab() {
    if (!openTabs.value.length) return
    const idx = activeTabIndex.value
    const nextIndex = idx < 0 ? 0 : (idx + 1) % openTabs.value.length
    activeTabPath.value = openTabs.value[nextIndex].path
  }

  function replaceTabPath(fromPath: string, toPath: string) {
    if (!fromPath || !toPath || fromPath === toPath) return

    let changed = false
    openTabs.value = openTabs.value.map((tab) => {
      if (tab.path !== fromPath) return tab
      changed = true
      return { ...tab, path: toPath }
    })

    if (activeTabPath.value === fromPath) {
      activeTabPath.value = toPath
    }

    if (!changed && activeTabPath.value === toPath && !openTabs.value.some((tab) => tab.path === toPath)) {
      openTabs.value.push({ path: toPath, pinned: false })
    }
  }

  return {
    openTabs,
    activeTabPath,
    activeTabIndex,
    sidebarMode,
    sidebarVisible,
    rightPaneVisible,
    setSidebarMode,
    toggleSidebar,
    toggleRightPane,
    openTab,
    setActiveTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    closeCurrentTab,
    togglePin,
    moveTab,
    nextTab,
    replaceTabPath
  }
}
