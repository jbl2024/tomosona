import type { Editor } from '@tiptap/vue-3'
import type { Ref } from 'vue'
import type { ReadNoteSnapshotResult } from '../../../shared/api/apiTypes'
import { parseWikilinkTarget } from '../lib/wikilinks'
import { embeddedNoteMarkdownToTiptapDoc, resolveEmbeddedNoteMarkdown } from '../lib/embeddedNoteRestoration'

/**
 * Embedded note action helpers.
 *
 * Purpose:
 * - Resolve note embeds against workspace files.
 * - Load preview HTML for note embeds.
 * - Restore embed content inline inside the current editor.
 *
 * Boundary:
 * - This composable owns the note-embed file lookup and content resolution logic.
 * - UI rendering and editor wiring stay in the caller.
 */
export type EmbeddedNoteActionsOptions = {
  workspacePath: Ref<string>
  readNoteSnapshot?: (path: string) => Promise<ReadNoteSnapshotResult>
  openFile?: (path: string) => Promise<string>
  saveCurrentFile?: (manual?: boolean) => Promise<void>
}

export type EmbeddedNotePreview = {
  path: string
  html: string
}

function normalizeWorkspacePath(value: string): string {
  return String(value ?? '').trim().replace(/[\\/]+$/, '')
}

function normalizeEmbeddedNoteTarget(target: string): string {
  return parseWikilinkTarget(target).notePath
    .trim()
    .replace(/^[\\/]+/, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
}

function resolveEmbeddedNotePath(workspacePath: string, target: string): string {
  const cleanedTarget = normalizeEmbeddedNoteTarget(target)
  if (!workspacePath || !cleanedTarget) return ''
  const notePath = cleanedTarget.replace(/\.(md|markdown)$/i, '')
  return `${workspacePath}/${notePath}.md`
}

export function useEmbeddedNoteActions(options: EmbeddedNoteActionsOptions) {
  async function readEmbeddedNoteSnapshot(target: string): Promise<ReadNoteSnapshotResult | null> {
    const workspacePath = normalizeWorkspacePath(options.workspacePath.value)
    const path = resolveEmbeddedNotePath(workspacePath, target)
    if (!path) return null

    try {
      return options.readNoteSnapshot
        ? await options.readNoteSnapshot(path)
        : options.openFile
          ? {
              path,
              content: await options.openFile(path),
              version: null
            } satisfies ReadNoteSnapshotResult
          : null
    } catch {
      return null
    }
  }

  async function loadEmbeddedNotePreview(target: string): Promise<EmbeddedNotePreview | null> {
    const snapshot = await readEmbeddedNoteSnapshot(target)
    if (!snapshot?.content) return null

    const resolvedMarkdown = resolveEmbeddedNoteMarkdown(snapshot.content, target)
    if (resolvedMarkdown === null) return null

    return {
      path: snapshot.path,
      html: resolvedMarkdown
    }
  }

  async function restoreEmbeddedNoteInline(target: string, editor: Editor, getPos: () => number) {
    if (!editor?.isEditable) return
    const snapshot = await readEmbeddedNoteSnapshot(target)
    if (!snapshot?.content) {
      console.warn('[editor] restore-embed skipped: target note is unavailable')
      return
    }

    const replacementDoc = embeddedNoteMarkdownToTiptapDoc(snapshot.content, target)
    if (!replacementDoc) {
      console.warn('[editor] restore-embed skipped: target could not be resolved')
      return
    }

    try {
      const replacementNode = editor.state.schema.nodeFromJSON(replacementDoc)
      const pos = getPos()
      const node = editor.state.doc.nodeAt(pos)
      if (!node) {
        console.warn('[editor] restore-embed skipped: node position is no longer valid')
        return
      }

      editor.view.dispatch(
        editor.state.tr.replaceWith(pos, pos + node.nodeSize, replacementNode.content)
      )
      await options.saveCurrentFile?.(false)
    } catch (error) {
      console.error('[editor] restore-embed failed', error)
    }
  }

  return {
    loadEmbeddedNotePreview,
    restoreEmbeddedNoteInline
  }
}
