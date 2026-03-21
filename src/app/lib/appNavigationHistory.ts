import type { CosmosHistorySnapshot, HomeHistorySnapshot, SecondBrainHistorySnapshot } from '../composables/useAppNavigationController'

/**
 * Module: appNavigationHistory
 *
 * Purpose:
 * - Keep shell history snapshot codecs and labels as small, pure helpers.
 *
 * Boundary:
 * - This module only handles snapshot shape validation, serialization keys,
 *   and display labels.
 * - Shell orchestration, pane switching, and history replay stay in the shell
 *   controllers that own those workflows.
 */

/** Reads a Cosmos history snapshot from persisted history payload. */
export function readCosmosHistorySnapshot(payload: unknown): CosmosHistorySnapshot | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as Partial<CosmosHistorySnapshot>
  if (
    typeof value.query !== 'string' ||
    typeof value.selectedNodeId !== 'string' ||
    typeof value.focusMode !== 'boolean' ||
    typeof value.focusDepth !== 'number'
  ) {
    return null
  }
  return {
    query: value.query,
    selectedNodeId: value.selectedNodeId,
    focusMode: value.focusMode,
    focusDepth: Math.max(1, Math.min(8, Math.round(value.focusDepth)))
  }
}

/** Builds the current Cosmos snapshot from shell state. */
export function buildCosmosHistorySnapshot(options: {
  query: string
  selectedNodeId: string
  focusMode: boolean
  focusDepth: number
}): CosmosHistorySnapshot {
  return {
    query: options.query.trim(),
    selectedNodeId: options.selectedNodeId,
    focusMode: options.focusMode,
    focusDepth: options.focusDepth
  }
}

/** Serializes a Cosmos history snapshot into a stable replay key. */
export function cosmosSnapshotStateKey(snapshot: CosmosHistorySnapshot): string {
  return JSON.stringify(snapshot)
}

/** Formats the Cosmos history row label using the current graph lookup. */
export function cosmosHistoryLabel(
  snapshot: CosmosHistorySnapshot,
  resolveNodeLabel: (nodeId: string) => string | null
): string {
  if (snapshot.query) return `Cosmos: ${snapshot.query}`
  if (snapshot.selectedNodeId) {
    const label = resolveNodeLabel(snapshot.selectedNodeId)
    if (label) return `Cosmos: ${label}`
  }
  return 'Cosmos'
}

/** Reads a Second Brain history snapshot from persisted history payload. */
export function readSecondBrainHistorySnapshot(payload: unknown): SecondBrainHistorySnapshot | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as { surface?: string }
  if (value.surface !== 'chat' && value.surface !== 'sessions') return null
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
