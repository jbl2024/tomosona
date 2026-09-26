import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppShellPaneRuntime } from './useAppShellPaneRuntime'

describe('useAppShellPaneRuntime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('switches sidebar mode through the injected workspace port', () => {
    const sidebarMode = ref<'explorer' | 'favorites' | 'search'>('explorer')
    const setSidebarMode = vi.fn((mode: 'explorer' | 'favorites' | 'search') => {
      sidebarMode.value = mode
    })
    const toggleSidebar = vi.fn()

    const api = useAppShellPaneRuntime({
      activeFilePath: ref(''),
      multiPane: {
        layout: ref({ activePaneId: 'pane-1', panesById: {} }),
        setActivePane: vi.fn(),
        setActiveTabInPane: vi.fn(),
        closeTabInPane: vi.fn(),
        closeOtherTabsInPane: vi.fn(() => []),
        closeTabsLeftInPane: vi.fn(() => []),
        closeTabsRightInPane: vi.fn(() => []),
        closeAllTabsInPane: vi.fn(),
        getActiveTab: () => null,
        getActiveDocumentPath: () => null
      },
      editorState: {
        updateStatus: vi.fn(),
        clearStatus: vi.fn(),
        setActiveOutline: vi.fn()
      },
      editorRef: ref(null),
      workspace: {
        sidebarMode,
        setSidebarMode,
        toggleSidebar
      },
      search: {
        selectGlobalSearchMode: vi.fn((mode: 'hybrid' | 'semantic' | 'lexical') => ({
          caret: mode === 'hybrid' ? 0 : 7
        }))
      },
      setActiveTabWithAutosave: vi.fn(async () => true),
      propertiesPreview: ref([]),
      propertyParseErrorCount: ref(0)
    })

    api.setSidebarMode('search')
    expect(setSidebarMode).toHaveBeenCalledWith('search')

    api.setSidebarMode('search')
    expect(toggleSidebar).toHaveBeenCalled()
  })
})
