import type { WorkspaceFsChange } from '../../lib/apiTypes'
import { normalizeWorkspacePath } from '../../lib/workspacePaths'

export type WorkspaceFsActionPlan = {
  dirsToRefresh: Set<string>
  pathsToPrune: Set<string>
}

export function normalizeFsPath(path: string): string {
  return normalizeWorkspacePath(path)
}

export function parentPath(path: string): string {
  const normalized = normalizeFsPath(path)
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return ''
  return normalized.slice(0, idx)
}

export function planWorkspaceFsActions(
  rootPath: string,
  loadedDirs: Set<string>,
  changes: WorkspaceFsChange[]
): WorkspaceFsActionPlan {
  const root = normalizeFsPath(rootPath)
  const dirsToRefresh = new Set<string>()
  const pathsToPrune = new Set<string>()

  for (const change of changes) {
    if (change.kind === 'created') {
      const parent = normalizeFsPath(change.parent || (change.path ? parentPath(change.path) : ''))
      if (!parent) {
        continue
      }
      if (parent === root || loadedDirs.has(parent)) {
        dirsToRefresh.add(parent)
      }
      continue
    }

    if (change.kind === 'removed') {
      if (change.path) {
        pathsToPrune.add(normalizeFsPath(change.path))
      }

      const parent = normalizeFsPath(change.parent || (change.path ? parentPath(change.path) : ''))
      if (!parent) {
        continue
      }
      if (parent === root || loadedDirs.has(parent)) {
        dirsToRefresh.add(parent)
      }
      continue
    }

    if (change.kind === 'modified') {
      if (change.path) {
        const changedPath = normalizeFsPath(change.path)
        if (changedPath === root || loadedDirs.has(changedPath)) {
          dirsToRefresh.add(changedPath)
        }
      }

      const parent = normalizeFsPath(change.parent || (change.path ? parentPath(change.path) : ''))
      if (!parent) {
        continue
      }
      if (parent === root || loadedDirs.has(parent)) {
        dirsToRefresh.add(parent)
      }
      continue
    }

    if (change.kind === 'renamed') {
      if (change.old_path) {
        pathsToPrune.add(normalizeFsPath(change.old_path))
      }

      if (change.old_parent) {
        const oldParent = normalizeFsPath(change.old_parent)
        if (oldParent === root || loadedDirs.has(oldParent)) {
          dirsToRefresh.add(oldParent)
        }
      }

      if (change.new_parent) {
        const newParent = normalizeFsPath(change.new_parent)
        if (newParent === root || loadedDirs.has(newParent)) {
          dirsToRefresh.add(newParent)
        }
      }
    }
  }

  if (changes.length > 0) {
    dirsToRefresh.add(root)
  }

  return {
    dirsToRefresh,
    pathsToPrune
  }
}
