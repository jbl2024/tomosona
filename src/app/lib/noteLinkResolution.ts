/** Shared path resolution for note navigation and safe reference planning. */
import { isAbsoluteWorkspacePath, normalizeWorkspacePath, toWorkspaceRelativePath } from '../../domains/explorer/lib/workspacePaths'

function splitWorkspacePath(path: string): { prefix: string; segments: string[] } | null {
  const normalized = normalizeWorkspacePath(path)
  if (!normalized) return null
  if (/^[A-Za-z]:\//.test(normalized)) {
    return {
      prefix: normalized.slice(0, 3),
      segments: normalized.slice(3).split('/').filter(Boolean)
    }
  }
  if (normalized.startsWith('/')) {
    return {
      prefix: '/',
      segments: normalized.slice(1).split('/').filter(Boolean)
    }
  }
  return {
    prefix: '',
    segments: normalized.split('/').filter(Boolean)
  }
}

function workspaceDirectoryPath(path: string): string | null {
  const base = splitWorkspacePath(path)
  if (!base) return null
  const segments = base.segments.slice(0, -1)
  return base.prefix === '/'
    ? `/${segments.join('/')}`
    : base.prefix
      ? `${base.prefix}${segments.join('/')}`
      : segments.join('/')
}

function resolveRelativeWorkspacePath(basePath: string, relativePath: string): string | null {
  const base = splitWorkspacePath(basePath)
  if (!base) return null

  const segments = base.segments.slice()
  for (const segment of normalizeWorkspacePath(relativePath).split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!segments.length) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  return base.prefix === '/'
    ? `/${segments.join('/')}`
    : base.prefix
      ? `${base.prefix}${segments.join('/')}`
      : segments.join('/')
}

function findExistingMarkdownTarget(
  targetPath: string,
  root: string,
  markdownFiles: string[],
  resolveExistingWikilinkPath: (target: string, markdownFiles: string[]) => string | null
): string | null {
  const exact = resolveExistingWikilinkPath(targetPath, markdownFiles)
  if (exact) return exact

  if (!isAbsoluteWorkspacePath(targetPath)) return null
  const relativeTarget = toWorkspaceRelativePath(root, targetPath)
  if (!relativeTarget || relativeTarget === targetPath) return null
  return resolveExistingWikilinkPath(relativeTarget, markdownFiles)
}

/** Resolves a note target using the same root, relative and ambiguity rules as navigation. */
export function resolveNoteLinkPath(
  rawTarget: string,
  root: string,
  sourcePath: string,
  markdownFiles: string[],
  resolveExisting: (target: string, markdownFiles: string[]) => string | null
): { targetPath: string; existing: string | null } | null {
  const raw = normalizeWorkspacePath(rawTarget).trim()
  if (!raw || !root) return null
  const currentDirectory = isAbsoluteWorkspacePath(sourcePath) ? workspaceDirectoryPath(sourcePath) ?? root : root
  const fromRoot = !raw.startsWith('./') && !raw.startsWith('../') && (raw.includes('/') || /\.(md|markdown)$/i.test(raw))
  const targetPath = isAbsoluteWorkspacePath(raw) ? raw : resolveRelativeWorkspacePath(fromRoot ? root : currentDirectory, raw)
  if (!targetPath) return null
  return { targetPath, existing: findExistingMarkdownTarget(targetPath, root, markdownFiles, resolveExisting) }
}
