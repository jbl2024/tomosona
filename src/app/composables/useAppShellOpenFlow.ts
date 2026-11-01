import { nextTick, ref, watch, type Ref } from 'vue'
import { backlinksForPath } from '../../shared/api/indexApi'
import { formatIsoDate } from '../lib/appShellPaths'
import { noteTitleFromPath, sanitizeTitleForFileName } from '../lib/appShellDocuments'
import { parseWikilinkTarget, type WikilinkAnchor } from '../../domains/editor/lib/wikilinks'
import { type HeadingNode } from '../../domains/editor/composables/useEditorState'
import type { PaletteOpenTarget } from './useAppQuickOpen'
import type { QuickOpenResult } from './useAppQuickOpen'
import type { SidebarMode } from './useWorkspaceState'
import { isAbsoluteWorkspacePath, normalizeWorkspacePath } from '../../domains/explorer/lib/workspacePaths'
import { resolveNoteLinkPath } from '../lib/noteLinkResolution'

/** Attempts and delay for the passage-reveal retry budget (~1.8s at defaults). */
const REVEAL_RETRY_ATTEMPTS = 12
const REVEAL_RETRY_DELAY_MS = 150

type VirtualDoc = {
  content: string
  titleLine: string
}

type EditorSurfacePort = {
  focusEditor: () => void
  revealSnippet: (snippet: string) => Promise<boolean>
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
  /** Reading-order adjacent pane after the active one, or null when none exists. */
  resolveAdjacentPaneId?: () => string | null
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
  /** Delay between passage-reveal retries while a freshly opened document loads. */
  revealRetryDelayMs?: number
}

export type RefreshBacklinksOptions = {
  path?: string
  requestToken?: number
}

export type SearchHit = {
  path: string
  snippet: string
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
          // The seeded title line is the whole initial content: the load
          // pipeline hides it as the note title, and the title-only autosave
          // skip keeps the note unpersisted until real body content exists.
          content: titleLine,
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

    const sourcePath = options.editorPort.activeFilePath.value
    const candidate = resolveNoteLinkPath(rawTarget, root, sourcePath, [], options.dataPort.resolveExistingWikilinkPath)
    if (!candidate) {
      options.workspacePort.errorMessage.value = 'Invalid link target.'
      return false
    }
    const markdownFiles = await options.dataPort.loadWikilinkTargets()
    const resolution = resolveNoteLinkPath(rawTarget, root, sourcePath, markdownFiles, options.dataPort.resolveExistingWikilinkPath)
    const { targetPath, existing } = resolution ?? candidate

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
    // Seed the not-yet-existing note with a `# <file name>` first line so the
    // title heading sync engages from creation.
    const opened = await openOrPrepareMarkdown(withExtension, `# ${noteTitleFromPath(withExtension)}`)
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
    if (item.kind === 'file' || item.kind === 'recent' || item.kind === 'favorite') {
      options.uiPort.closeQuickOpen()
      const opened = await options.navigationPort.openTabWithAutosave(item.path)
      if (!opened) return
      return
    }
    void options.navigationPort.openDailyNote(item.date, options.navigationPort.openTabWithAutosave).then((opened) => {
      if (opened) options.uiPort.closeQuickOpen()
    })
  }

  /**
   * Opens a palette note result at the requested target. `new-tab` reveals
   * the note as a tab of the active pane (moving it there when it already
   * lives in another pane); `adjacent` targets the reading-order neighbor
   * and degrades to a new tab in the active pane when no other pane exists.
   */
  async function openNoteAtTarget(path: string, target: PaletteOpenTarget) {
    if (target === 'active') {
      await openQuickResult({ kind: 'file', path, label: path })
      return
    }
    if (target === 'adjacent') {
      const adjacentPaneId = options.navigationPort.resolveAdjacentPaneId?.() ?? null
      if (adjacentPaneId) {
        const opened = await options.navigationPort.openTabWithAutosave(path, { targetPaneId: adjacentPaneId })
        if (opened) options.uiPort.closeQuickOpen()
        return
      }
    }
    const opened = await options.navigationPort.openTabWithAutosave(path, { revealInTargetPane: true })
    if (opened) options.uiPort.closeQuickOpen()
  }

  async function onSearchResultOpen(hit: SearchHit) {
    // Stored before opening: the active-file effects can fire during the open
    // await, so the snippet must already be available to them.
    options.editorPort.editorState.setRevealSnippet(hit.path, hit.snippet)
    const opened = await options.navigationPort.openTabWithAutosave(hit.path)
    if (!opened) {
      options.editorPort.editorState.consumeRevealSnippet(hit.path)
      return
    }
    // Fast path for documents already loaded in the editor; freshly opened
    // ones are revealed by the retry loop in the active-note effects.
    const revealed = await options.editorPort.editorRef.value?.revealSnippet(hit.snippet)
    if (revealed) options.editorPort.editorState.consumeRevealSnippet(hit.path)
  }

  async function onBacklinkOpen(path: string) {
    const opened = await options.navigationPort.openTabWithAutosave(path)
    if (!opened) return
  }

  async function onExplorerOpen(path: string) {
    const opened = await options.navigationPort.openTabWithAutosave(path)
    if (!opened) return
  }

  /**
   * Reveals a stored passage once the freshly opened document has loaded.
   * Early attempts typically miss while the content is still being read, so
   * reveal results are retried for a bounded budget, aborting if the active
   * note changed in the meantime.
   */
  async function revealSnippetWhenReady(path: string, snippet: string) {
    for (let attempt = 0; attempt < REVEAL_RETRY_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.revealRetryDelayMs ?? REVEAL_RETRY_DELAY_MS))
        if (options.editorPort.activeFilePath.value !== path) return
      }
      const revealed = await options.editorPort.editorRef.value?.revealSnippet(snippet)
      if (revealed) return
    }
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
        void revealSnippetWhenReady(path, snippet)
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

  /**
   * Creates a note from a palette query: the typed text becomes the title
   * (sanitized into the file name), the note is seeded with its title heading
   * and opened immediately. An existing note at the target is opened instead
   * of overwritten.
   */
  async function createNoteFromPaletteTitle(rawTitle: string) {
    const root = options.workspacePort.workingFolderPath.value
    const title = rawTitle.trim()
    if (!root || !title) return false
    const stem = sanitizeTitleForFileName(title)
    if (!stem) return false
    return await openOrPrepareMarkdown(`${root}/${stem}.md`, `# ${stem}`)
  }

  return {
    backlinks,
    backlinksLoading,
    backlinksError,
    refreshBacklinks,
    openTodayNote,
    openYesterdayNote,
    showExplorerForActiveFile,
    openWikilinkTarget,
    createNoteFromPaletteTitle,
    openNoteAtTarget,
    loadWikilinkHeadings,
    openQuickResult,
    onSearchResultOpen,
    onBacklinkOpen,
    onExplorerOpen,
    runActiveNoteEffects
  }
}
