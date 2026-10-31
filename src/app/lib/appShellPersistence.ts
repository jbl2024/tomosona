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


/** Command usage habits for palette personalization. */
export type CommandUsage = {
  counts: Record<string, number>
  recent: string[]
}

export const COMMAND_USAGE_RECENT_LIMIT = 10

/** Normalizes raw persisted usage: counts stay numbers, recent ids stay strings. */
export function normalizeCommandUsage(value: unknown): CommandUsage {
  const raw = (value ?? {}) as { counts?: unknown; recent?: unknown }
  const countsSource = typeof raw.counts === 'object' && raw.counts !== null ? raw.counts : {}
  const counts: Record<string, number> = {}
  for (const [id, count] of Object.entries(countsSource)) {
    const parsed = Number(count)
    if (Number.isFinite(parsed) && parsed > 0) counts[id] = Math.floor(parsed)
  }
  const recent = Array.isArray(raw.recent)
    ? raw.recent.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, COMMAND_USAGE_RECENT_LIMIT)
    : []
  return { counts, recent }
}

/** Reads persisted command usage, defaulting to empty habits. */
export function readPersistedCommandUsage(storageKey: string): CommandUsage {
  if (typeof window === 'undefined') return { counts: {}, recent: [] }
  try {
    return normalizeCommandUsage(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}'))
  } catch {
    return { counts: {}, recent: [] }
  }
}

/** Persists command usage as JSON. */
export function persistCommandUsage(storageKey: string, usage: CommandUsage): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(normalizeCommandUsage(usage)))
  } catch {
    // Storage may be unavailable; habits are a nicety, never a blocker.
  }
}
