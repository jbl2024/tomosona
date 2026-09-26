import type { HomeHistorySnapshot } from '../composables/useAppNavigationController'

/** Reads a Home history snapshot from persisted history payload. */
export function readHomeHistorySnapshot(payload: unknown): HomeHistorySnapshot | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as { surface?: string }
  if (value.surface !== 'hub') return null
  return { surface: 'hub' }
}

/** Builds the current Home snapshot from shell state. */
export function buildHomeHistorySnapshot(): HomeHistorySnapshot {
  return { surface: 'hub' }
}

/** Serializes a Home history snapshot into a stable replay key. */
export function homeSnapshotStateKey(snapshot: HomeHistorySnapshot): string {
  return snapshot.surface
}

/** Formats the Home history row label. */
export function homeHistoryLabel(_snapshot: HomeHistorySnapshot): string {
  return 'Home'
}
