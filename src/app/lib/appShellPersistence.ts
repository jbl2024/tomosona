import { hydrateLayout, type MultiPaneLayout } from '../composables/useMultiPaneWorkspaceState'
import type { SidebarMode } from '../composables/useWorkspaceState'

/**
 * Module: appShellPersistence
 *
 * Purpose:
 * - Keep shell persistence parsing and normalization pure and testable.
 */

export type AppShellStorageKeys = {
  sidebarMode: string
  previousNonCosmosMode: string
  editorZoom: string
  multiPane: string
}

/** Normalizes a persisted sidebar mode. */
export function normalizeSidebarMode(value: string | null): SidebarMode | null {
  if (value === 'explorer' || value === 'favorites' || value === 'search') {
    return value
  }
  return null
}

/** Reads the persisted sidebar mode from storage, if valid. */
export function readPersistedSidebarMode(storageKey: string): SidebarMode | null {
  if (typeof window === 'undefined') return null
  return normalizeSidebarMode(window.sessionStorage.getItem(storageKey))
}

/** Clamps the editor zoom to the supported UI range. */
export function clampEditorZoom(value: number): number {
  return Math.max(0.8, Math.min(1.6, Number(value.toFixed(2))))
}

/** Reads the persisted editor zoom from storage, defaulting to 1. */
export function readPersistedEditorZoom(storageKey: string): number {
  if (typeof window === 'undefined') return 1
  const raw = Number.parseFloat(window.localStorage.getItem(storageKey) ?? '1')
  return Number.isFinite(raw) ? clampEditorZoom(raw) : 1
}

/** Reads and hydrates the multi-pane layout from storage, when valid. */
export function readPersistedMultiPaneLayout(storageKey: string): MultiPaneLayout | null {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(storageKey)
  if (!raw) return null
  try {
    return hydrateLayout(JSON.parse(raw))
  } catch {
    return null
  }
}

