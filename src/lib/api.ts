/**
 * Transitional frontend IPC compatibility facade.
 *
 * New code should import from domain modules such as `workspaceApi`,
 * `indexApi`, `settingsApi`, `secondBrainIpcApi`, and `pulseIpcApi`.
 * This file intentionally contains re-exports only.
 */

export * from './apiTypes'
export * from './workspaceApi'
export * from './indexApi'
export * from './settingsApi'
export * from './secondBrainIpcApi'
export * from './pulseIpcApi'
