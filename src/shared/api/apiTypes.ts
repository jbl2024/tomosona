/**
 * Shared frontend IPC types used by the Tauri command wrappers.
 *
 * This file contains types only. Domain-specific invoke/listen wrappers live
 * in dedicated modules so consumers can depend on smaller contracts.
 */

export type TreeNode = {
  name: string
  path: string
  is_dir: boolean
  is_markdown: boolean
  has_children: boolean
}

export type ConflictStrategy = 'fail' | 'rename' | 'overwrite'
export type EntryKind = 'file' | 'folder'
export type WorkspaceFsChangeKind = 'created' | 'removed' | 'renamed' | 'modified'

export type FileVersion = {
  mtimeMs: number
  size: number
}

export type WorkspaceFsChange = {
  kind: WorkspaceFsChangeKind
  path?: string
  old_path?: string
  new_path?: string
  parent?: string
  old_parent?: string
  new_parent?: string
  is_dir?: boolean
  version?: FileVersion
}

export type WorkspaceFsChangedPayload = {
  session_id: number
  root: string
  changes: WorkspaceFsChange[]
  ts_ms: number
}

export type FileMetadata = {
  created_at_ms: number | null
  updated_at_ms: number | null
}

export type CreateExtractedNoteResult = {
  path: string
  link_target: string
}

export type ReadNoteSnapshotResult = {
  path: string
  content: string
  version: FileVersion | null
}

export type SaveNoteSuccess = {
  ok: true
  version: FileVersion | null
}

export type SaveNoteConflict = {
  ok: false
  reason: 'CONFLICT'
  diskVersion: FileVersion
  diskContent: string
}

export type SaveNoteError = {
  ok: false
  reason: 'NOT_FOUND' | 'IO_ERROR'
  message: string
}

export type SaveNoteResult = SaveNoteSuccess | SaveNoteConflict | SaveNoteError

export type NoteHistoryEntry = {
  snapshotId: string
  notePath: string
  createdAtMs: number
  reason: string
  contentSize: number
  contentHash: string
}

export type NoteHistorySnapshot = {
  entry: NoteHistoryEntry
  content: string
}

export type MoveHistoryPath = {
  from: string
  to: string
}

export type AboutMetadata = {
  version: string
  build_commit: string | null
  build_channel: string
  platform_label: string
  app_support_dir: string
  tauri_version: string | null
}

export type FavoriteEntry = {
  path: string
  added_at_ms: number
  exists: boolean
}

export type IndexOverviewStats = {
  processed_notes_count: number
  workspace_notes_count: number
  last_run_finished_at_ms: number | null
  last_run_title: string | null
  last_run_duration_ms: number | null
}

export type IndexLogEntry = {
  ts_ms: number
  message: string
}

export type PathMove = {
  from: string
  to: string
}

export type PathMoveRewriteResult = {
  updated_files: number
  reindexed_files: number
  moved_markdown_files: number
  expanded_markdown_moves: PathMove[]
}
