import { watch, type Ref } from 'vue'
import { serializeLayout, type MultiPaneLayout } from './useMultiPaneWorkspaceState'
import type { SidebarMode } from './useWorkspaceState'
import type { ThemePreference } from './useAppTheme'
import {
  clampEditorZoom,
  normalizeSidebarMode,
  readPersistedEditorZoom,
  readPersistedSidebarMode,
  type AppShellStorageKeys
} from '../lib/appShellPersistence'

/**
 * Module: useAppShellPersistence
 *
 * Purpose:
 * - Own shell bootstrap and persistence side effects in one place.
 * - Keep App.vue focused on orchestration and rendering.
 */

export type UseAppShellPersistenceThemePort = {
  themePreference: Ref<ThemePreference>
  loadThemePreference: () => void
  persistThemePreference: () => void
  applyTheme: () => void
}

export type UseAppShellPersistenceWorkspacePort = {
  sidebarMode: Ref<SidebarMode>
  previousNonCosmosMode: Ref<SidebarMode>
}

export type UseAppShellPersistenceOptions = {
  theme: UseAppShellPersistenceThemePort
  workspace: UseAppShellPersistenceWorkspacePort
  layout: Ref<MultiPaneLayout>
  editorZoom: Ref<number>
  storageKeys: AppShellStorageKeys
}

/**
 * Owns shell persistence wiring for theme, sidebar mode, editor zoom, and pane layout.
 */
export function useAppShellPersistence(options: UseAppShellPersistenceOptions) {
  function loadSavedSidebarMode() {
    if (typeof window === 'undefined') return
    const mode = readPersistedSidebarMode(options.storageKeys.sidebarMode)
    if (mode) {
      options.workspace.sidebarMode.value = mode
    }
    const previousMode = normalizeSidebarMode(window.sessionStorage.getItem(options.storageKeys.previousNonCosmosMode))
    if (previousMode) {
      options.workspace.previousNonCosmosMode.value = previousMode
    }
  }

  function syncEditorZoom(getZoom?: () => number) {
    const viaEditor = getZoom?.()
    if (typeof viaEditor === 'number' && Number.isFinite(viaEditor)) {
      options.editorZoom.value = clampEditorZoom(viaEditor)
      return
    }
    options.editorZoom.value = readPersistedEditorZoom(options.storageKeys.editorZoom)
  }

  function initializeShellPersistence() {
    options.theme.loadThemePreference()
    loadSavedSidebarMode()
    options.theme.applyTheme()
    syncEditorZoom()
  }

  watch(
    () => options.theme.themePreference.value,
    () => {
      options.theme.persistThemePreference()
      options.theme.applyTheme()
    }
  )

  watch(
    () => options.workspace.sidebarMode.value,
    (mode) => {
      if (typeof window === 'undefined') return
      window.sessionStorage.setItem(options.storageKeys.sidebarMode, mode)
      options.workspace.previousNonCosmosMode.value = mode
      window.sessionStorage.setItem(options.storageKeys.previousNonCosmosMode, mode)
    }
  )

  watch(
    () => options.layout.value,
    (layout) => {
      if (typeof window === 'undefined') return
      window.sessionStorage.setItem(options.storageKeys.multiPane, JSON.stringify(serializeLayout(layout)))
    },
    { deep: true }
  )

  return {
    initializeShellPersistence,
    syncEditorZoom
  }
}
