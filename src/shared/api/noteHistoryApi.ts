import { invoke } from '@tauri-apps/api/core'
import type { MoveHistoryPath, NoteHistoryEntry, NoteHistorySnapshot, SaveNoteResult } from './apiTypes'

/**
 * Frontend IPC wrappers for local note-history operations.
 *
 * The history UI talks to these wrappers only; direct invoke calls stay out of
 * components so the contract remains easy to review and test.
 */

/** Reads the local history entries for a note, newest first. */
export async function listNoteHistory(path: string): Promise<NoteHistoryEntry[]> {
  return await invoke('list_note_history', { path })
}

/** Reads the full snapshot content for a note history entry. */
export async function readNoteHistorySnapshot(path: string, snapshotId: string, password?: string): Promise<NoteHistorySnapshot> {
  return await invoke('read_note_history_snapshot', { path, snapshotId, password })
}

/** Restores a historical snapshot into the current note file. */
export async function restoreNoteHistorySnapshot(path: string, snapshotId: string, password?: string): Promise<SaveNoteResult> {
  return await invoke('restore_note_history_snapshot', { path, snapshotId, password })
}

/** Moves note history metadata after filesystem rename/move operations. */
export async function moveNoteHistoryEntries(moves: MoveHistoryPath[]): Promise<void> {
  await invoke('move_note_history_entries', {
    moves: moves.map((move) => ({
      from: move.from,
      to: move.to
    }))
  })
}
