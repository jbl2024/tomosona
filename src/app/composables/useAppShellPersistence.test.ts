import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialLayout, useMultiPaneWorkspaceState } from './useMultiPaneWorkspaceState'
import { type ThemePreference } from './useAppTheme'
import { useAppShellPersistence } from './useAppShellPersistence'
import {
  clampEditorZoom,
  normalizeSidebarMode,
  readPersistedEditorZoom,
  readPersistedMultiPaneLayout,
  readPersistedSidebarMode
} from '../lib/appShellPersistence'
import { SYSTEM_DARK_THEME_ID } from '../../shared/lib/themeRegistry'

function resetStorage() {
  window.sessionStorage.clear()
  window.localStorage.clear()
}

describe('useAppShellPersistence', () => {
  afterEach(() => {
    resetStorage()
    vi.restoreAllMocks()
  })

  it('hydrates stored shell state and keeps persistence in sync', async () => {
    window.sessionStorage.setItem('shell:sidebar', 'favorites')
    window.sessionStorage.setItem('shell:previous', 'search')
    window.localStorage.setItem('shell:zoom', '1.25')

    const themePreference = ref<ThemePreference>('system')
    const themeLoad = vi.fn(() => {
      themePreference.value = SYSTEM_DARK_THEME_ID
    })
    const themePersist = vi.fn()
    const themeApply = vi.fn()
    const sidebarMode = ref<'explorer' | 'favorites' | 'search'>('explorer')
    const previousNonCosmosMode = ref<'explorer' | 'favorites' | 'search'>('explorer')
    const editorZoom = ref(1)
    const layout = useMultiPaneWorkspaceState(createInitialLayout()).layout

    const scope = effectScope()
    const api = scope.run(() => useAppShellPersistence({
      theme: {
        themePreference,
        loadThemePreference: themeLoad,
        persistThemePreference: themePersist,
        applyTheme: themeApply
      },
      workspace: {
        sidebarMode,
        previousNonCosmosMode
      },
      layout,
      editorZoom,
      storageKeys: {
        sidebarMode: 'shell:sidebar',
        previousNonCosmosMode: 'shell:previous',
        editorZoom: 'shell:zoom',
        multiPane: 'shell:layout'
      }
    }))

    api?.initializeShellPersistence()
    expect(themeLoad).toHaveBeenCalled()
    expect(themePreference.value).toBe('tomosona-dark')
    expect(sidebarMode.value).toBe('favorites')
    expect(previousNonCosmosMode.value).toBe('search')
    expect(editorZoom.value).toBe(1.25)
    expect(themeApply).toHaveBeenCalled()

    sidebarMode.value = 'search'
    await nextTick()
    expect(window.sessionStorage.getItem('shell:sidebar')).toBe('search')
    expect(window.sessionStorage.getItem('shell:previous')).toBe('search')

    layout.value = createInitialLayout()
    await nextTick()
    expect(window.sessionStorage.getItem('shell:layout')).toContain('"activePaneId"')

    expect(api?.syncEditorZoom(() => 1.789)).toBeUndefined()
    expect(editorZoom.value).toBe(1.6)

    scope.stop()
  })

  it('parses persisted shell storage with sane fallbacks', () => {
    window.sessionStorage.setItem('shell:sidebar', 'favorites')
    window.localStorage.setItem('shell:zoom', '1.789')
    window.sessionStorage.setItem('shell:layout', JSON.stringify(createInitialLayout()))

    expect(normalizeSidebarMode('search')).toBe('search')
    expect(normalizeSidebarMode('bogus')).toBeNull()
    expect(readPersistedSidebarMode('shell:sidebar')).toBe('favorites')
    expect(readPersistedEditorZoom('shell:zoom')).toBe(1.6)
    expect(clampEditorZoom(0.1)).toBe(0.8)
    expect(readPersistedMultiPaneLayout('shell:layout')).not.toBeNull()
  })
})
