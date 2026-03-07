import { nextTick, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { EditorBlock } from '../lib/markdownBlocks'
import { editorDataToMarkdown, markdownToEditorData } from '../lib/markdownBlocks'
import { composeMarkdownDocument, serializeFrontmatter, type FrontmatterEnvelope } from '../lib/frontmatter'
import { toTiptapDoc } from '../lib/tiptap/editorBlocksToTiptapDoc'
import type { DocumentSession } from './useDocumentEditorSessions'

/**
 * Adapter contract for waiting on async heavy node rendering (for example Mermaid node views).
 *
 * Failure behavior:
 * - Resolves `false` when the wait times out; callers should continue deterministic load completion.
 */
export type WaitForHeavyRenderIdle = (options?: { timeoutMs?: number; settleMs?: number }) => Promise<boolean>
export type HasPendingHeavyRender = () => boolean

// Regex-driven heavy render detection:
// - Mermaid example detected: "```mermaid\nflowchart TD\nA-->B\n```"
const MERMAID_FENCE_RE = /```[ \t]*mermaid\b/i
const MERMAID_FENCE_GLOBAL_RE = /```[ \t]*mermaid\b/gi
const MARKDOWN_TABLE_SEPARATOR_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|){1,}\s*$/gm
const MARKDOWN_TABLE_ROW_RE = /^\s*\|.+\|\s*$/gm

function isHeavyRenderMarkdown(source: string): boolean {
  if (MERMAID_FENCE_RE.test(source)) return true
  const separatorCount = source.match(MARKDOWN_TABLE_SEPARATOR_RE)?.length ?? 0
  if (separatorCount === 0) return false
  const rowCount = source.match(MARKDOWN_TABLE_ROW_RE)?.length ?? 0
  return rowCount >= 6
}

/**
 * Computes a coarse complexity score to trigger loading UI for render-heavy docs
 * even when byte length is below the large-document threshold.
 */
function heavyRenderComplexityScore(source: string): number {
  const mermaidCount = source.match(MERMAID_FENCE_GLOBAL_RE)?.length ?? 0
  const separatorCount = source.match(MARKDOWN_TABLE_SEPARATOR_RE)?.length ?? 0
  const rowCount = source.match(MARKDOWN_TABLE_ROW_RE)?.length ?? 0
  const tableLoadScore = separatorCount > 0 ? Math.ceil(rowCount / 8) : 0
  return (mermaidCount * 3) + tableLoadScore
}

/**
 * Mutable loading-overlay refs controlled by file load orchestration.
 *
 * Invariant:
 * - These refs are always reset in `finally` after `loadCurrentFile` unless a newer request
 *   supersedes the current one and exits early through request-id guards.
 */
export type EditorLoadUiState = {
  isLoadingLargeDocument: Ref<boolean>
  loadStageLabel: Ref<string>
  loadProgressPercent: Ref<number>
  loadProgressIndeterminate: Ref<boolean>
  loadDocumentStats: Ref<{ chars: number; lines: number } | null>
}

/**
 * Session/runtime ownership callbacks used by file lifecycle orchestration.
 */
export type EditorFileLifecycleSessionPort = {
  currentPath: Ref<string>
  holder: Ref<HTMLDivElement | null>
  getEditor: () => Editor | null
  getSession: (path: string) => DocumentSession | null
  ensureSession: (path: string) => DocumentSession
  renameSessionPath: (from: string, to: string) => void
  moveLifecyclePathState: (from: string, to: string) => void
  setSuppressOnChange: (value: boolean) => void
  restoreCaret: (path: string) => boolean
  setDirty: (path: string, dirty: boolean) => void
  setSaving: (path: string, saving: boolean) => void
  setSaveError: (path: string, message: string) => void
}

/**
 * Document parsing/serialization and title/frontmatter callbacks.
 */
export type EditorFileLifecycleDocumentPort = {
  ensurePropertySchemaLoaded: () => Promise<void>
  parseAndStoreFrontmatter: (path: string, sourceMarkdown: string) => void
  frontmatterByPath: Ref<Record<string, FrontmatterEnvelope>>
  propertyEditorMode: Ref<'structured' | 'raw'>
  rawYamlByPath: Ref<Record<string, string>>
  serializableFrontmatterFields: (fields: FrontmatterEnvelope['fields']) => FrontmatterEnvelope['fields']
  moveFrontmatterPathState: (from: string, to: string) => void
  countLines: (input: string) => number
  noteTitleFromPath: (path: string) => string
  readVirtualTitle: (blocks: EditorBlock[]) => string
  blockTextCandidate: (block: EditorBlock | undefined) => string
  withVirtualTitle: (blocks: EditorBlock[], title: string) => { blocks: EditorBlock[]; changed: boolean }
  stripVirtualTitle: (blocks: EditorBlock[]) => EditorBlock[]
  serializeCurrentDocBlocks: () => EditorBlock[]
  renderBlocks: (blocks: EditorBlock[]) => Promise<void>
}

/**
 * Host UI side effects and emits coordinated during load/save flows.
 */
export type EditorFileLifecycleUiPort = {
  clearAutosaveTimer: () => void
  clearOutlineTimer: (path: string) => void
  emitOutlineSoon: (path: string) => void
  emitPathRenamed: (payload: { from: string; to: string; manual: boolean }) => void
  resetTransientUiState: () => void
  updateGutterHitboxStyle: () => void
  syncWikilinkUiFromPluginState: () => void
  ui: EditorLoadUiState
  largeDocThreshold: number
}

/**
 * Read/write IO adapters for markdown documents.
 */
export type EditorFileLifecycleIoPort = {
  openFile: (path: string) => Promise<string>
  saveFile: (path: string, text: string, options: { explicit: boolean }) => Promise<{ persisted: boolean }>
  renameFileFromTitle: (path: string, title: string) => Promise<{ path: string; title: string }>
}

/**
 * Request-token guard adapter.
 */
export type EditorFileLifecycleRequestPort = {
  isCurrentRequest: (requestId: number) => boolean
}

/**
 * Runtime dependencies required by {@link useEditorFileLifecycle}.
 *
 * Boundary:
 * - This composable delegates host ownership through grouped ports.
 * - Grouped ports keep the top-level contract stable and reviewable.
 */
export type UseEditorFileLifecycleOptions = {
  sessionPort: EditorFileLifecycleSessionPort
  documentPort: EditorFileLifecycleDocumentPort
  uiPort: EditorFileLifecycleUiPort
  ioPort: EditorFileLifecycleIoPort
  requestPort: EditorFileLifecycleRequestPort
  /**
   * Optional hook that waits for async heavy node rendering to settle.
   */
  waitForHeavyRenderIdle?: WaitForHeavyRenderIdle
  /**
   * Optional hook that reports whether heavy async rendering is currently in-flight.
   */
  hasPendingHeavyRender?: HasPendingHeavyRender
  /**
   * Minimum overlay visibility once large-document loading is shown.
   *
   * Why/invariant:
   * - Fast machines can complete parse/render inside one frame; enforcing a short
   *   minimum prevents imperceptible flash and keeps loading feedback discoverable.
   */
  minLargeDocOverlayVisibleMs?: number
  /**
   * Timeout for optional heavy-render idle wait.
   */
  heavyRenderIdleTimeoutMs?: number
  /**
   * Settle window for optional heavy-render idle wait.
   */
  heavyRenderIdleSettleMs?: number
  /**
   * Delay before escalating to full loading overlay when runtime heavy rendering remains pending.
   */
  heavyOverlayDelayMs?: number
  /**
   * Minimum heavy-render complexity score that triggers loading overlay regardless of file size.
   */
  heavyRenderComplexityThreshold?: number
}

/**
 * useEditorFileLifecycle
 *
 * Purpose:
 * - Own file load/save orchestration for per-path editor sessions.
 *
 * Responsibilities:
 * - Guard async operations with request-token checks.
 * - Apply frontmatter + markdown conversions for load/save.
 * - Coordinate transient UI reset, loading overlay state, and status updates.
 *
 * Boundaries:
 * - Does not define editor schema/interaction behavior.
 * - Consumes grouped ports for path/session state ownership.
 *
 * Side effects:
 * - Reads/writes session state through injected callbacks.
 * - Performs filesystem IO via `openFile` and `saveFile`.
 * - Emits path rename + outline refresh via injected callbacks.
 */
export function useEditorFileLifecycle(options: UseEditorFileLifecycleOptions) {
  const { sessionPort, documentPort, uiPort, ioPort, requestPort } = options
  const minLargeDocOverlayVisibleMs = options.minLargeDocOverlayVisibleMs ?? 220
  const heavyRenderIdleTimeoutMs = options.heavyRenderIdleTimeoutMs ?? 1_200
  const heavyRenderIdleSettleMs = options.heavyRenderIdleSettleMs ?? 48
  const heavyOverlayDelayMs = options.heavyOverlayDelayMs ?? 160
  const heavyRenderComplexityThreshold = options.heavyRenderComplexityThreshold ?? 4

  async function flushUiFrame() {
    await nextTick()
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  }

  async function flushPaintBarrier() {
    await nextTick()
    await new Promise<void>((resolve) => {
      const raf = window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16))
      raf(() => resolve())
    })
  }

  function showLoadingOverlay(body: string, stageLabel: string, progressPercent: number, indeterminate = false) {
    if (!uiPort.ui.isLoadingLargeDocument.value) {
      uiPort.ui.isLoadingLargeDocument.value = true
      uiPort.ui.loadDocumentStats.value = { chars: body.length, lines: documentPort.countLines(body) }
    }
    uiPort.ui.loadStageLabel.value = stageLabel
    uiPort.ui.loadProgressPercent.value = progressPercent
    uiPort.ui.loadProgressIndeterminate.value = indeterminate
  }

  /**
   * Loads a file into the active session editor.
   *
   * Invariants:
   * - Drops stale completions using `requestId` guard checks before and after async steps.
   * - Never applies loaded content when `currentPath` changed mid-flight.
   *
   * Failure behavior:
   * - Catches read/parse errors and stores a user-safe message via `setSaveError`.
   */
  async function loadCurrentFile(path: string, loadOptions?: { forceReload?: boolean; requestId?: number }) {
    if (!path) return
    await documentPort.ensurePropertySchemaLoaded()
    if (typeof loadOptions?.requestId === 'number' && !requestPort.isCurrentRequest(loadOptions.requestId)) return

    const session = sessionPort.ensureSession(path)
    const editor = sessionPort.getEditor()
    if (!editor) return
    const shouldReloadContent = !session.isLoaded || Boolean(loadOptions?.forceReload)

    if (shouldReloadContent) {
      sessionPort.setSaveError(path, '')
      uiPort.clearAutosaveTimer()
      uiPort.clearOutlineTimer(path)
      uiPort.resetTransientUiState()
      uiPort.ui.isLoadingLargeDocument.value = false
      uiPort.ui.loadStageLabel.value = ''
      uiPort.ui.loadProgressPercent.value = 0
      uiPort.ui.loadProgressIndeterminate.value = false
      uiPort.ui.loadDocumentStats.value = null
    }

    let largeDocOverlayShownAt = 0
    try {
      if (shouldReloadContent) {
        const txt = await ioPort.openFile(path)
        if (typeof loadOptions?.requestId === 'number' && !requestPort.isCurrentRequest(loadOptions.requestId)) return

        documentPort.parseAndStoreFrontmatter(path, txt)
        const body = documentPort.frontmatterByPath.value[path]?.body ?? txt
        const isLargeDocument = txt.length >= uiPort.largeDocThreshold
        const heavyComplexityScore = heavyRenderComplexityScore(body)
        const shouldShowOverlayEarly = isLargeDocument || heavyComplexityScore >= heavyRenderComplexityThreshold

        if (shouldShowOverlayEarly) {
          largeDocOverlayShownAt = Date.now()
          showLoadingOverlay(body, 'Parsing markdown blocks...', 35, false)
          await flushUiFrame()
        }

        const parsed = markdownToEditorData(body)
        const normalized = documentPort.withVirtualTitle(parsed.blocks as EditorBlock[], documentPort.noteTitleFromPath(path)).blocks
        const shouldWaitForHeavyRender = isHeavyRenderMarkdown(body) && typeof options.waitForHeavyRenderIdle === 'function'

        if (uiPort.ui.isLoadingLargeDocument.value) {
          uiPort.ui.loadStageLabel.value = 'Rendering blocks in editor...'
          uiPort.ui.loadProgressPercent.value = 70
          await flushUiFrame()
        }

        sessionPort.setSuppressOnChange(true)
        session.editor.commands.setContent(toTiptapDoc(normalized), { emitUpdate: false })
        sessionPort.setSuppressOnChange(false)

        if (
          shouldWaitForHeavyRender &&
          !uiPort.ui.isLoadingLargeDocument.value &&
          typeof options.hasPendingHeavyRender === 'function' &&
          options.hasPendingHeavyRender()
        ) {
          // Why/invariant: below-threshold docs can still trigger expensive async node renders.
          // Delay escalation prevents unnecessary blocking for near-instant renders.
          await new Promise<void>((resolve) => window.setTimeout(resolve, heavyOverlayDelayMs))
          if (typeof loadOptions?.requestId === 'number' && !requestPort.isCurrentRequest(loadOptions.requestId)) return
          if (options.hasPendingHeavyRender()) {
            largeDocOverlayShownAt = Date.now()
            showLoadingOverlay(body, 'Finalizing rich blocks...', 90, true)
            await flushUiFrame()
          }
        }

        if (shouldWaitForHeavyRender) {
          // Why/invariant: Mermaid/table node views may resolve asynchronously after setContent.
          // Waiting for heavy render idle avoids first-load reveal flicker on complex documents.
          if (uiPort.ui.isLoadingLargeDocument.value) {
            uiPort.ui.loadStageLabel.value = 'Finalizing rich blocks...'
            uiPort.ui.loadProgressPercent.value = 90
            uiPort.ui.loadProgressIndeterminate.value = true
          }
          await options.waitForHeavyRenderIdle?.({
            timeoutMs: heavyRenderIdleTimeoutMs,
            settleMs: heavyRenderIdleSettleMs
          })
          if (typeof loadOptions?.requestId === 'number' && !requestPort.isCurrentRequest(loadOptions.requestId)) return
          await flushPaintBarrier()
          if (uiPort.ui.isLoadingLargeDocument.value) {
            uiPort.ui.loadProgressIndeterminate.value = false
          }
        }

        session.loadedText = txt
        session.isLoaded = true
        sessionPort.setDirty(path, false)
      }

      await nextTick()
      if (typeof loadOptions?.requestId === 'number' && !requestPort.isCurrentRequest(loadOptions.requestId)) return
      if (sessionPort.currentPath.value !== path) return

      const remembered = session.scrollTop
      if (sessionPort.holder.value && typeof remembered === 'number') {
        sessionPort.holder.value.scrollTop = remembered
      }
      // Invariant: mounted tab switches should keep in-memory selection untouched.
      // Only reload/reopen flows restore persisted caret snapshots.
      if (shouldReloadContent) {
        sessionPort.restoreCaret(path)
      }

      uiPort.emitOutlineSoon(path)
      uiPort.syncWikilinkUiFromPluginState()
      uiPort.updateGutterHitboxStyle()
    } catch (error) {
      sessionPort.setSaveError(path, error instanceof Error ? error.message : 'Could not read file.')
    } finally {
      if (typeof loadOptions?.requestId === 'number' && !requestPort.isCurrentRequest(loadOptions.requestId)) return
      if (shouldReloadContent && largeDocOverlayShownAt > 0) {
        const elapsed = Date.now() - largeDocOverlayShownAt
        const remaining = minLargeDocOverlayVisibleMs - elapsed
        if (remaining > 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, remaining))
        }
      }
      if (shouldReloadContent) {
        uiPort.ui.isLoadingLargeDocument.value = false
        uiPort.ui.loadStageLabel.value = ''
        uiPort.ui.loadProgressPercent.value = 0
        uiPort.ui.loadProgressIndeterminate.value = false
        uiPort.ui.loadDocumentStats.value = null
      }
    }
  }

  /**
   * Saves active editor content and reconciles title-driven rename before persistence.
   *
   * Why/invariant:
   * - Save validates on-disk text equality before rename/write to avoid overwriting concurrent
   *   external edits.
   * - Rename state transfer (`renameSessionPath`/`move*PathState`) occurs before writing so
   *   subsequent state updates are attributed to the final path.
   *
   * Failure behavior:
   * - Any step failure records an error with `setSaveError` and still clears `saving` in `finally`.
   */
  async function saveCurrentFile(manual = true) {
    const editor = sessionPort.getEditor()
    const initialPath = sessionPort.currentPath.value
    const initialSession = sessionPort.getSession(initialPath)
    if (!initialPath || !editor || !initialSession || initialSession.saving) return

    let savePath = initialPath
    sessionPort.setSaving(savePath, true)
    if (manual) sessionPort.setSaveError(savePath, '')

    try {
      const rawBlocks = documentPort.serializeCurrentDocBlocks()
      const requestedTitle = documentPort.readVirtualTitle(rawBlocks) || documentPort.blockTextCandidate(rawBlocks[0]) || documentPort.noteTitleFromPath(initialPath)
      const lastLoaded = initialSession.loadedText

      const latestOnDisk = await ioPort.openFile(initialPath)
      if (latestOnDisk !== lastLoaded) {
        throw new Error('File changed on disk. Reload before saving to avoid overwrite.')
      }

      const renameResult = await ioPort.renameFileFromTitle(initialPath, requestedTitle)
      savePath = renameResult.path
      const normalized = documentPort.withVirtualTitle(rawBlocks, renameResult.title)
      const markdownBlocks = documentPort.stripVirtualTitle(normalized.blocks)
      const bodyMarkdown = editorDataToMarkdown({ blocks: markdownBlocks })
      const frontmatterState = documentPort.frontmatterByPath.value[savePath] ?? documentPort.frontmatterByPath.value[initialPath]
      const frontmatterYaml = documentPort.propertyEditorMode.value === 'raw'
        ? (documentPort.rawYamlByPath.value[savePath] ?? documentPort.rawYamlByPath.value[initialPath] ?? '')
        : serializeFrontmatter(documentPort.serializableFrontmatterFields(frontmatterState?.fields ?? []))
      const markdown = composeMarkdownDocument(bodyMarkdown, frontmatterYaml)

      if (!manual && savePath === initialPath && markdown === lastLoaded) {
        sessionPort.setDirty(savePath, false)
        return
      }

      if (savePath !== initialPath) {
        sessionPort.renameSessionPath(initialPath, savePath)
        sessionPort.moveLifecyclePathState(initialPath, savePath)
        documentPort.moveFrontmatterPathState(initialPath, savePath)
        uiPort.emitPathRenamed({ from: initialPath, to: savePath, manual })
      }

      if (normalized.changed) {
        await documentPort.renderBlocks(normalized.blocks)
      }

      const result = await ioPort.saveFile(savePath, markdown, { explicit: manual })
      if (!result.persisted) {
        sessionPort.setDirty(savePath, true)
        return
      }

      const savedSession = sessionPort.getSession(savePath)
      if (savedSession) {
        savedSession.loadedText = markdown
        savedSession.isLoaded = true
      }

      documentPort.parseAndStoreFrontmatter(savePath, markdown)
      sessionPort.setDirty(savePath, false)
    } catch (error) {
      sessionPort.setSaveError(savePath, error instanceof Error ? error.message : 'Could not save file.')
    } finally {
      sessionPort.setSaving(savePath, false)
      uiPort.emitOutlineSoon(savePath)
    }
  }

  return {
    loadCurrentFile,
    saveCurrentFile
  }
}
