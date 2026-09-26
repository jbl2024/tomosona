import { nextTick, ref, watch, type Ref } from 'vue'
import { backlinksForPath } from '../../shared/api/indexApi'
import { formatIsoDate } from '../lib/appShellPaths'
import { parseWikilinkTarget, type WikilinkAnchor } from '../../domains/editor/lib/wikilinks'
import { type HeadingNode } from '../../domains/editor/composables/useEditorState'
import type { QuickOpenResult } from './useAppQuickOpen'
import type { SidebarMode } from './useWorkspaceState'
import { isAbsoluteWorkspacePath, normalizeWorkspacePath, toWorkspaceRelativePath } from '../../domains/explorer/lib/workspacePaths'

type VirtualDoc = {
  content: string
  titleLine: string
}

type EditorSurfacePort = {
  focusEditor: () => void
  revealSnippet: (snippet: string) => Promise<void>
  revealAnchor: (anchor: WikilinkAnchor) => Promise<boolean>
}

type ExplorerSurfacePort = {
  revealPathInView: (path: string, options?: { focusTree?: boolean; behavior?: ScrollBehavior }) => Promise<void>
}

/**
 * Module: useAppShellOpenFlow
 *
 * Purpose:
 * - Own the shell's note-open workflow, including active-note side effects,
 *   wikilink resolution, search-hit navigation, explorer reveal, and open
 *   tracing.
 *
 * Boundary:
 * - This composable coordinates multiple shell concerns, but it does not own
 *   domain logic for editor rendering, persistence, or workspace indexing.
 * - App.vue injects the ports and keeps the UI assembly and domain controllers
 *   outside this workflow.
 */

export type AppShellOpenFlowWorkspacePort = {
  workingFolderPath: Readonly<Ref<string>>
  sidebarVisible: Readonly<Ref<boolean>>
  setSidebarMode: (mode: SidebarMode) => void
  errorMessage: Ref<string>
}

export type AppShellOpenFlowEditorPort = {
  activeFilePath: Readonly<Ref<string>>
  editorState: {
    setActiveOutline: (outline: HeadingNode[]) => void
    consumeRevealSnippet: (path: string) => string
    setRevealSnippet: (path: string, snippet: string) => void
  }
  editorRef: Readonly<Ref<EditorSurfacePort | null>>
  virtualDocs: Ref<Record<string, VirtualDoc>>
  explorerRef: Readonly<Ref<ExplorerSurfacePort | null>>
}

export type AppShellOpenFlowContextPort = {
  resetForAnchor: (path: string) => void
}

export type AppShellOpenFlowWorkspaceDataPort = {
  refreshActiveFileMetadata: (path: string | null) => Promise<void>
  isMarkdownPath: (path: string) => boolean
  loadWikilinkTargets: () => Promise<string[]>
  pathExists: (path: string) => Promise<boolean>
  readTextFile: (path: string) => Promise<string>
  dailyNotePath: (root: string, date: string) => string
  isIsoDate: (value: string) => boolean
  sanitizeRelativePath: (value: string) => string
  resolveExistingWikilinkPath: (target: string, markdownFiles: string[]) => string | null
  extractHeadingsFromMarkdown: (content: string) => string[]
}

export type AppShellOpenFlowNavigationPort = {
  openTabWithAutosave: (path: string, options?: { recordHistory?: boolean; targetPaneId?: string; revealInTargetPane?: boolean }) => Promise<boolean>
  openDailyNote: (date: string, openPath: (path: string) => Promise<boolean>) => Promise<boolean>
}

export type AppShellOpenFlowUiPort = {
  closeQuickOpen: () => void
}

export type AppShellOpenFlowOptions = {
  workspacePort: AppShellOpenFlowWorkspacePort
  editorPort: AppShellOpenFlowEditorPort
  contextPort: AppShellOpenFlowContextPort
  dataPort: AppShellOpenFlowWorkspaceDataPort
  navigationPort: AppShellOpenFlowNavigationPort
  uiPort: AppShellOpenFlowUiPort
}

export type RefreshBacklinksOptions = {
  path?: string
  requestToken?: number
}

export type SearchHit = {
  path: string
  snippet: string
}

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

/**
 * Owns shell note-opening flows and the active-note refresh lifecycle.
 */
export function useAppShellOpenFlow(options: AppShellOpenFlowOptions) {
  const backlinks = ref<string[]>([])
  const backlinksLoading = ref(false)
  const backlinksError = ref('')

  let activeNoteEffectsRequestToken = 0
  let backlinksSourcePath = ''

  function isCurrentActiveNoteEffectsRequest(requestToken: number, path: string) {
    return requestToken === activeNoteEffectsRequestToken && options.editorPort.activeFilePath.value === path
  }

  async function refreshBacklinks(optionsOverride: RefreshBacklinksOptions = {}) {
    const root = options.workspacePort.workingFolderPath.value
    const path = optionsOverride.path ?? options.editorPort.activeFilePath.value
    if (!root || !path) {
      backlinks.value = []
      backlinksError.value = ''
      backlinksSourcePath = ''
      return
    }

    backlinksLoading.value = true
    backlinksError.value = ''
    try {
      const backlinksResult = await Promise.resolve(backlinksForPath(path))
      if (optionsOverride.requestToken && !isCurrentActiveNoteEffectsRequest(optionsOverride.requestToken, path)) {
        return
      }

      {
        backlinks.value = backlinksResult.map((item) => item.path)
        backlinksSourcePath = path
      }
    } catch {
      if (optionsOverride.requestToken && !isCurrentActiveNoteEffectsRequest(optionsOverride.requestToken, path)) {
        return
      }
      backlinksError.value = 'Could not load backlinks.'
      if (backlinksSourcePath !== path) {
        backlinks.value = []
        backlinksSourcePath = ''
      }
    } finally {
      if (!optionsOverride.requestToken || isCurrentActiveNoteEffectsRequest(optionsOverride.requestToken, path)) {
        backlinksLoading.value = false
      }
    }
  }

  async function openTodayNote() {
    return await options.navigationPort.openDailyNote(formatIsoDate(new Date()), options.navigationPort.openTabWithAutosave)
  }

  async function openYesterdayNote() {
    const value = new Date()
    value.setDate(value.getDate() - 1)
    return await options.navigationPort.openDailyNote(formatIsoDate(value), options.navigationPort.openTabWithAutosave)
  }

  async function showExplorerForActiveFile(optionsOverride: { focusTree?: boolean } = {}) {
    options.workspacePort.setSidebarMode('explorer')
    if (!options.workspacePort.sidebarVisible.value) return
    const activePath = options.editorPort.activeFilePath.value
    if (!activePath) return
    await nextTick()
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const revealPathInView = options.editorPort.explorerRef.value?.revealPathInView
      if (typeof revealPathInView === 'function') {
        await revealPathInView(activePath, {
          focusTree: optionsOverride.focusTree ?? false,
          behavior: 'auto'
        })
        return
      }
      await nextTick()
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  }

  async function openOrPrepareMarkdown(path: string, titleLine: string) {
    if (!options.workspacePort.workingFolderPath.value) {
      options.workspacePort.errorMessage.value = 'Working folder is not set.'
      return false
    }

    let exists = false
    try {
      exists = await options.dataPort.pathExists(path)
    } catch {
      exists = false
    }
    if (exists) {
      const nextVirtual = { ...options.editorPort.virtualDocs.value }
      delete nextVirtual[path]
      options.editorPort.virtualDocs.value = nextVirtual
      const opened = await options.navigationPort.openTabWithAutosave(path)
      if (!opened) return false
      return true
    }

    if (!options.editorPort.virtualDocs.value[path]) {
      options.editorPort.virtualDocs.value = {
        ...options.editorPort.virtualDocs.value,
        [path]: {
          content: '',
          titleLine
        }
      }
    }

    const opened = await options.navigationPort.openTabWithAutosave(path)
    if (!opened) return false
    await nextTick()
    return true
  }

  async function openWikilinkTarget(target: string) {
    const root = options.workspacePort.workingFolderPath.value
    if (!root) return false
    const parsed = parseWikilinkTarget(target)
    const anchor = parsed.anchor
    const rawTarget = normalizeWorkspacePath(parsed.notePath).trim()
    const currentDirectory = isAbsoluteWorkspacePath(options.editorPort.activeFilePath.value)
      ? workspaceDirectoryPath(options.editorPort.activeFilePath.value) ?? root
      : root
    const revealAnchor = async () => {
      if (!anchor) return true
      await nextTick()
      return await options.editorPort.editorRef.value?.revealAnchor(anchor) ?? false
    }

    if (!rawTarget) {
      if (!anchor || !options.editorPort.activeFilePath.value) return false
      return await revealAnchor()
    }

    if (options.dataPort.isIsoDate(rawTarget)) {
      const opened = await options.navigationPort.openDailyNote(rawTarget, options.navigationPort.openTabWithAutosave)
      if (!opened) return false
      return await revealAnchor()
    }

    const shouldResolveFromRoot =
      !rawTarget.startsWith('./') &&
      !rawTarget.startsWith('../') &&
      (rawTarget.includes('/') || rawTarget.includes('\\') || /\.(md|markdown)$/i.test(rawTarget))

    const targetPath = isAbsoluteWorkspacePath(rawTarget)
      ? rawTarget
      : resolveRelativeWorkspacePath(shouldResolveFromRoot ? root : currentDirectory, rawTarget)

    if (!targetPath) {
      options.workspacePort.errorMessage.value = 'Invalid link target.'
      return false
    }

    const markdownFiles = await options.dataPort.loadWikilinkTargets()
    const existing = findExistingMarkdownTarget(
      targetPath,
      root,
      markdownFiles,
      options.dataPort.resolveExistingWikilinkPath
    )

    if (existing) {
      const opened = await options.navigationPort.openTabWithAutosave(
        isAbsoluteWorkspacePath(existing) ? existing : `${root}/${existing}`
      )
      if (!opened) return false
      const revealed = await revealAnchor()
      if (!anchor || !revealed) {
        await options.navigationPort.openTabWithAutosave(
          isAbsoluteWorkspacePath(existing) ? existing : `${root}/${existing}`
        )
      }
      return true
    }

    const withExtension = /\.(md|markdown)$/i.test(targetPath) ? targetPath : `${targetPath}.md`
    const opened = await openOrPrepareMarkdown(withExtension, '')
    if (!opened) return false
    if (!anchor) return true
    return await revealAnchor()
  }

  async function loadWikilinkHeadings(target: string): Promise<string[]> {
    const root = options.workspacePort.workingFolderPath.value
    if (!root) return []
    const normalized = options.dataPort.sanitizeRelativePath(target)
    if (!normalized) return []
    if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) return []

    try {
      if (options.dataPort.isIsoDate(normalized)) {
        const path = options.dataPort.dailyNotePath(root, normalized)
        if (!(await options.dataPort.pathExists(path))) return []
        return options.dataPort.extractHeadingsFromMarkdown(await options.dataPort.readTextFile(path))
      }

      const markdownFiles = await options.dataPort.loadWikilinkTargets()
      const existing = options.dataPort.resolveExistingWikilinkPath(normalized, markdownFiles)
      if (!existing) return []
      return options.dataPort.extractHeadingsFromMarkdown(await options.dataPort.readTextFile(`${root}/${existing}`))
    } catch {
      return []
    }
  }

  async function openQuickResult(item: QuickOpenResult) {
    if (item.kind === 'file' || item.kind === 'recent') {
      options.uiPort.closeQuickOpen()
      const opened = await options.navigationPort.openTabWithAutosave(item.path)
      if (!opened) return
      return
    }
    void options.navigationPort.openDailyNote(item.date, options.navigationPort.openTabWithAutosave).then((opened) => {
      if (opened) options.uiPort.closeQuickOpen()
    })
  }

  async function onSearchResultOpen(hit: SearchHit) {
    const opened = await options.navigationPort.openTabWithAutosave(hit.path)
    if (!opened) return
    options.editorPort.editorState.setRevealSnippet(hit.path, hit.snippet)

    await nextTick()
    await options.editorPort.editorRef.value?.revealSnippet(hit.snippet)
  }

  async function onBacklinkOpen(path: string) {
    const opened = await options.navigationPort.openTabWithAutosave(path)
    if (!opened) return
  }

  async function onExplorerOpen(path: string) {
    const opened = await options.navigationPort.openTabWithAutosave(path)
    if (!opened) return
  }

  async function runActiveNoteEffects(path: string) {
    const requestToken = ++activeNoteEffectsRequestToken

    if (!path || !options.dataPort.isMarkdownPath(path)) {
      options.editorPort.editorState.setActiveOutline([])
      backlinks.value = []
      backlinksError.value = ''
      backlinksSourcePath = ''
      await options.dataPort.refreshActiveFileMetadata(path)
      return
    }

    try {
      await options.dataPort.refreshActiveFileMetadata(path)
      if (!isCurrentActiveNoteEffectsRequest(requestToken, path)) {
        return
      }

      const snippet = options.editorPort.editorState.consumeRevealSnippet(path)
      if (snippet) {
        await nextTick()
        await options.editorPort.editorRef.value?.revealSnippet(snippet)
      }
      if (!isCurrentActiveNoteEffectsRequest(requestToken, path)) {
        return
      }

      await refreshBacklinks({
        path,
        requestToken
      })
      if (!isCurrentActiveNoteEffectsRequest(requestToken, path)) {
        return
      }
    } catch {
    }
  }

  watch(
    () => options.editorPort.activeFilePath.value,
    (path) => {
      options.contextPort.resetForAnchor(path ?? '')
      const isInitialRun = activeNoteEffectsRequestToken === 0
      if (isInitialRun) {
        activeNoteEffectsRequestToken += 1
        if (!path) {
          options.editorPort.editorState.setActiveOutline([])
          backlinks.value = []
          backlinksError.value = ''
          backlinksSourcePath = ''
        }
        void options.dataPort.refreshActiveFileMetadata(path)
        return
      }
      void runActiveNoteEffects(path)
    },
    { immediate: true }
  )

  return {
    backlinks,
    backlinksLoading,
    backlinksError,
    refreshBacklinks,
    openTodayNote,
    openYesterdayNote,
    showExplorerForActiveFile,
    openWikilinkTarget,
    loadWikilinkHeadings,
    openQuickResult,
    onSearchResultOpen,
    onBacklinkOpen,
    onExplorerOpen,
    runActiveNoteEffects
  }
}
