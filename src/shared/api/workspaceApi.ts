import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  ConflictStrategy,
  EntryKind,
  FileMetadata,
  TreeNode,
  WorkspaceFsChangedPayload
} from './apiTypes'

/**
 * Frontend IPC wrappers for workspace, filesystem, and shell-native path
 * operations. This module intentionally contains transport-only helpers.
 */

/** Opens the native folder picker and returns the selected workspace path. */
export async function selectWorkingFolder(): Promise<string | null> {
  return await invoke('select_working_folder')
}

/** Clears the active workspace on the backend. */
export async function clearWorkingFolder(): Promise<void> {
  await invoke('clear_working_folder')
}

/** Sets the active workspace and returns its canonicalized absolute path. */
export async function setWorkingFolder(path: string): Promise<string> {
  return await invoke('set_working_folder', { path })
}

/** Lists immediate children of a workspace directory. */
export async function listChildren(dirPath: string): Promise<TreeNode[]> {
  return await invoke('list_children', { dirPath })
}

/** Lists every markdown file tracked under the active workspace. */
export async function listMarkdownFiles(): Promise<string[]> {
  return await invoke('list_markdown_files')
}

/** Returns `true` when a workspace path exists. */
export async function pathExists(path: string): Promise<boolean> {
  return await invoke('path_exists', { path })
}

/** Reads a UTF-8 text file from the active workspace. */
export async function readTextFile(path: string): Promise<string> {
  return await invoke('read_text_file', { path })
}

/** Reads created/updated timestamps for a workspace file. */
export async function readFileMetadata(path: string): Promise<FileMetadata> {
  return await invoke('read_file_metadata', { path })
}

/** Writes UTF-8 text content to a workspace file. */
export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke('write_text_file', { path, content })
}

/** Creates a file or folder entry under the provided parent path. */
export async function createEntry(
  parentPath: string,
  name: string,
  kind: EntryKind,
  conflictStrategy: ConflictStrategy
): Promise<string> {
  return await invoke('create_entry', { parentPath, name, kind, conflictStrategy })
}

/** Renames a workspace file or folder. */
export async function renameEntry(
  path: string,
  newName: string,
  conflictStrategy: ConflictStrategy
): Promise<string> {
  return await invoke('rename_entry', { path, newName, conflictStrategy })
}

/** Duplicates a workspace file or folder. */
export async function duplicateEntry(
  path: string,
  conflictStrategy: ConflictStrategy
): Promise<string> {
  return await invoke('duplicate_entry', { path, conflictStrategy })
}

/** Copies a workspace entry into another directory. */
export async function copyEntry(
  sourcePath: string,
  targetDirPath: string,
  conflictStrategy: ConflictStrategy
): Promise<string> {
  return await invoke('copy_entry', { sourcePath, targetDirPath, conflictStrategy })
}

/** Moves a workspace entry into another directory. */
export async function moveEntry(
  sourcePath: string,
  targetDirPath: string,
  conflictStrategy: ConflictStrategy
): Promise<string> {
  return await invoke('move_entry', { sourcePath, targetDirPath, conflictStrategy })
}

/** Moves a workspace entry to the application-managed trash. */
export async function trashEntry(path: string): Promise<string> {
  return await invoke('trash_entry', { path })
}

/** Opens a workspace path using the host operating system. */
export async function openPathExternal(path: string): Promise<void> {
  await invoke('open_path_external', { path })
}

/** Opens an external URL using the host operating system. */
export async function openExternalUrl(url: string): Promise<void> {
  await invoke('open_external_url', { url })
}

/** Reveals a workspace path in the native file manager. */
export async function revealInFileManager(path: string): Promise<void> {
  await invoke('reveal_in_file_manager', { path })
}

/** Subscribes to workspace filesystem watcher notifications. */
export async function listenWorkspaceFsChanged(
  handler: (payload: WorkspaceFsChangedPayload) => void
): Promise<UnlistenFn> {
  return await listen<WorkspaceFsChangedPayload>('workspace://fs-changed', (event) => {
    handler(event.payload)
  })
}
