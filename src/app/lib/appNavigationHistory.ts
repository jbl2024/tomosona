import type { HomeHistorySnapshot, SecondBrainHistorySnapshot } from '../composables/useAppNavigationController'

/** Reads a Second Brain history snapshot from persisted history payload. */
export function readSecondBrainHistorySnapshot(payload: unknown): SecondBrainHistorySnapshot | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as { surface?: string }
  if (value.surface !== 'chat') return null
  return { surface: 'chat' }
}

/** Builds the current Second Brain snapshot from shell state. */
export function buildSecondBrainHistorySnapshot(): SecondBrainHistorySnapshot {
  return { surface: 'chat' }
}

/** Serializes a Second Brain history snapshot into a stable replay key. */
export function secondBrainSnapshotStateKey(snapshot: SecondBrainHistorySnapshot): string {
  return snapshot.surface
}

/** Formats the Second Brain history row label. */
export function secondBrainHistoryLabel(_snapshot: SecondBrainHistorySnapshot): string {
  return 'Second Brain'
}

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
