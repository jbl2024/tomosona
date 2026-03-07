import { toWorkspacePathKey } from '../domains/explorer/lib/workspacePaths'

export type RecentWorkspaceItem = {
  path: string
  label: string
  lastOpenedAtMs: number
}

const MAX_RECENT_WORKSPACES = 5

function safeJsonParse(raw: string | null): unknown {
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function sanitizeEntry(value: unknown): RecentWorkspaceItem | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<RecentWorkspaceItem>
  if (typeof entry.path !== 'string' || typeof entry.label !== 'string' || typeof entry.lastOpenedAtMs !== 'number') {
    return null
  }
  const path = entry.path.trim()
  const label = entry.label.trim()
  if (!path || !label || !Number.isFinite(entry.lastOpenedAtMs)) return null
  return {
    path,
    label,
    lastOpenedAtMs: Math.max(0, Math.round(entry.lastOpenedAtMs))
  }
}

/**
 * Reads and normalizes recent workspace entries from local storage.
 */
export function readRecentWorkspaces(storageKey: string): RecentWorkspaceItem[] {
  const payload = safeJsonParse(window.localStorage.getItem(storageKey))
  if (!Array.isArray(payload)) return []
  return payload
    .map((item) => sanitizeEntry(item))
    .filter((item): item is RecentWorkspaceItem => Boolean(item))
    .sort((left, right) => right.lastOpenedAtMs - left.lastOpenedAtMs)
    .slice(0, MAX_RECENT_WORKSPACES)
}

/**
 * Persists the provided recent workspace list after enforcing ordering and size.
 */
export function writeRecentWorkspaces(storageKey: string, items: RecentWorkspaceItem[]) {
  const normalized = items
    .map((item) => sanitizeEntry(item))
    .filter((item): item is RecentWorkspaceItem => Boolean(item))
    .sort((left, right) => right.lastOpenedAtMs - left.lastOpenedAtMs)
    .slice(0, MAX_RECENT_WORKSPACES)
  window.localStorage.setItem(storageKey, JSON.stringify(normalized))
}

/**
 * Inserts or refreshes one workspace entry and keeps the list deduplicated.
 */
export function upsertRecentWorkspace(
  storageKey: string,
  item: RecentWorkspaceItem
): RecentWorkspaceItem[] {
  const candidate = sanitizeEntry(item)
  if (!candidate) return readRecentWorkspaces(storageKey)
  const next = readRecentWorkspaces(storageKey).filter(
    (entry) => toWorkspacePathKey(entry.path) !== toWorkspacePathKey(candidate.path)
  )
  next.unshift(candidate)
  writeRecentWorkspaces(storageKey, next)
  return readRecentWorkspaces(storageKey)
}

/**
 * Removes one workspace entry by path and returns the persisted list.
 */
export function removeRecentWorkspace(storageKey: string, path: string): RecentWorkspaceItem[] {
  const target = toWorkspacePathKey(path)
  const next = readRecentWorkspaces(storageKey).filter(
    (entry) => toWorkspacePathKey(entry.path) !== target
  )
  writeRecentWorkspaces(storageKey, next)
  return next
}
