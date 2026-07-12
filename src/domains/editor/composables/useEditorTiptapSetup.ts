import { Editor } from '@tiptap/vue-3'
import type { Ref } from 'vue'
import type { Transaction } from '@tiptap/pm/state'
import type { EditorView as ProseMirrorEditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { ListKit } from '@tiptap/extension-list'
import Placeholder from '@tiptap/extension-placeholder'
import { CalloutNode } from '../lib/tiptap/extensions/CalloutNode'
import { AssetNode } from '../lib/tiptap/extensions/AssetNode'
import { MermaidNode } from '../lib/tiptap/extensions/MermaidNode'
import { QuoteNode } from '../lib/tiptap/extensions/QuoteNode'
import { HtmlNode } from '../lib/tiptap/extensions/HtmlNode'
import { WikilinkNode } from '../lib/tiptap/extensions/WikilinkNode'
import { NoteEmbedNode } from '../lib/tiptap/extensions/NoteEmbedNode'
import { CodeBlockNode } from '../lib/tiptap/extensions/CodeBlockNode'
import { TableCellAlign } from '../lib/tiptap/extensions/TableCellAlign'
import { EditorFindExtension } from '../lib/tiptap/extensions/EditorFind'
import { SpellcheckExtension, refreshSpellcheckDecorations } from '../lib/tiptap/extensions/Spellcheck'
import { adjustHeadingLevelFromTab, adjustListLevelFromTab } from '../lib/editorInteractions'
import { decodeWorkspacePathSegments, isAbsoluteWorkspacePath, normalizeWorkspacePath } from '../../explorer/lib/workspacePaths'
import { parseRelativeMarkdownHref } from '../lib/markdownBlocks'
import type { SpellcheckLanguage } from '../lib/spellcheck'
import { WIKILINK_STATE_KEY, type WikilinkCandidate } from '../lib/tiptap/plugins/wikilinkState'
import { enterWikilinkEditFromNode } from '../lib/tiptap/extensions/wikilinkCommands'
import type { RevealAnchorRequest } from './useEditorNavigation'
import type { MermaidPreviewPayload } from './useMermaidPreviewDialog'
import type { AssetPreviewPayload } from './useAssetPreviewDialog'
import type { AssetBrowserDropdownItem } from '../lib/tiptap/assetBrowser'

/**
 * Module: useEditorTiptapSetup
 *
 * Owns Tiptap extension wiring and editor event-hook translation for EditorView sessions.
 */

/**
 * Dependencies required by {@link useEditorTiptapSetup}.
 */
export type UseEditorTiptapSetupOptions = {
  currentPath: Ref<string>
  getCurrentEditor: () => Editor | null
  getSessionEditor: (path: string) => Editor | null
  markSlashActivatedByUser: () => void
  markAtActivatedByUser: () => void
  syncSlashMenuFromSelection: (options?: { preserveIndex?: boolean }) => void
  syncAtMenuFromSelection: (options?: { preserveIndex?: boolean }) => void
  syncBlockHandleFromSelection: () => void
  updateTableToolbar: () => void
  syncWikilinkUiFromPluginState: () => void
  captureCaret: (path: string) => void
  /**
   * Optional gate used to avoid persisting programmatic/non-user selection changes.
   */
  shouldCaptureCaret?: (path: string) => boolean
  updateFormattingToolbar: () => void
  onEditorDocChanged: (path: string) => void
  requestMermaidReplaceConfirm: (payload: { templateLabel: string }) => Promise<boolean>
  openMermaidPreview: (payload: MermaidPreviewPayload) => void
  openAssetPreview: (payload: AssetPreviewPayload) => void
  getAssetBrowserItems?: () => AssetBrowserDropdownItem[]
  importAssetFiles?: () => Promise<string[]>
  getWikilinkCandidates: (query: string) => Promise<WikilinkCandidate[]>
  openLinkTargetWithAutosave: (target: string) => Promise<void>
  loadEmbeddedNotePreview: (target: string) => Promise<{ path: string; html: string } | null>
  openEmbeddedNote?: (target: string) => Promise<void>
  restoreEmbeddedNoteInline?: (target: string, editor: Editor, getPos: () => number) => Promise<void>
  revealAnchor: (anchor: RevealAnchorRequest) => Promise<boolean>
  resolveWikilinkTarget: (target: string) => Promise<boolean>
  sanitizeExternalHref: (value: string) => string | null
  openExternalUrl: (value: string) => Promise<void>
  getSpellcheckLanguage: (path: string) => SpellcheckLanguage
  spellcheckEnabled: Ref<boolean>
  isSpellcheckWordIgnored: (path: string, word: string) => boolean
  inlineFormatToolbar: {
    updateFormattingToolbar: () => void
    openLinkPopover: () => void
  }
}

/**
 * useEditorTiptapSetup
 *
 * Purpose:
 * - Encapsulate Tiptap extension and event-hook setup for EditorView sessions.
 *
 * Responsibilities:
 * - Build stable extension contract for each session editor.
 * - Route link clicks (wikilink/edit/open external) consistently.
 * - Dispatch update/selection/transaction callbacks to host ports.
 */
export function useEditorTiptapSetup(options: UseEditorTiptapSetupOptions) {
  const ISO_DATE_TOKEN_REGEX = /^\d{4}-\d{2}-\d{2}$/
  const EDITOR_LANGUAGE = 'fr'

  function closestAnchorFromEventTarget(target: EventTarget | null): HTMLAnchorElement | null {
    const element = target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null
    return element?.closest('a') as HTMLAnchorElement | null
  }

  function markdownTargetFromAnchor(anchor: HTMLAnchorElement): string {
    return (anchor.getAttribute('data-markdown-target') ?? '').trim()
  }

  function splitPath(path: string): { prefix: string; segments: string[] } | null {
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

  function resolveRelativeAssetPath(notePath: string, assetPath: string): string | null {
    const base = splitPath(notePath)
    if (!base) return null
    const segments = base.segments.slice(0, -1)

    for (const segment of decodeWorkspacePathSegments(assetPath).split('/')) {
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
      : `${base.prefix}${segments.join('/')}`
  }

  function resolveRelativeMarkdownTarget(notePath: string, href: string): string | null {
    const parsed = parseRelativeMarkdownHref(href)
    if (!parsed) return null
    const base = splitPath(notePath)
    if (!base) return null

    const segments = base.segments.slice(0, -1)
    const relativePath = decodeWorkspacePathSegments(parsed.path)
    for (const segment of relativePath.split('/')) {
      if (!segment || segment === '.') continue
      if (segment === '..') {
        if (!segments.length) return null
        segments.pop()
        continue
      }
      segments.push(segment)
    }

    const resolvedPath = base.prefix === '/'
      ? `/${segments.join('/')}`
      : `${base.prefix}${segments.join('/')}`
    return parsed.fragment ? `${resolvedPath}#${parsed.fragment}` : resolvedPath
  }

  function resolveAssetPreviewSrc(notePath: string, rawSrc: string): string | null {
    const src = normalizeWorkspacePath(rawSrc)
    if (!src) return null
    if (/^(?:https?|data|blob|asset|tauri):/i.test(src)) return src

    const absolutePath = isAbsoluteWorkspacePath(src)
      ? decodeWorkspacePathSegments(src)
      : resolveRelativeAssetPath(notePath, src)
    if (!absolutePath) return null
    return absolutePath
  }

  function readIsoDateTokenAtPos(view: ProseMirrorEditorView, pos: number): string | null {
    const size = view.state.doc.content.size
    if (size <= 0) return null
    const boundedPos = Math.max(0, Math.min(pos, size))
    const from = Math.max(0, boundedPos - 16)
    const to = Math.min(size, boundedPos + 16)
    const nearby = view.state.doc.textBetween(from, to, '\n', '\0')
    if (!nearby) return null
    const offset = Math.max(0, Math.min(nearby.length, boundedPos - from))
    const isDateChar = (value: string) => /[0-9-]/.test(value)

    let start = offset
    while (start > 0 && isDateChar(nearby[start - 1])) start -= 1
    let end = offset
    while (end < nearby.length && isDateChar(nearby[end])) end += 1

    const token = nearby.slice(start, end).trim()
    return ISO_DATE_TOKEN_REGEX.test(token) ? token : null
  }

  /**
   * Parses current-document anchor hrefs such as `#section-1` or `#^todo-12`.
   */
  function parseInternalAnchorHref(href: string): RevealAnchorRequest | null {
    const value = String(href ?? '').trim()
    if (!value.startsWith('#')) return null
    const fragment = value.slice(1).trim()
    if (!fragment) return null
    if (fragment.startsWith('^')) {
      const blockId = fragment.slice(1).trim()
      return blockId ? { blockId } : null
    }
    return { heading: fragment }
  }

  function openLinkPopoverFromAnchorSelection(
    view: ProseMirrorEditorView,
    path: string,
    anchor: HTMLAnchorElement,
    pos: number
  ) {
    const targetEditor = options.getSessionEditor(path) ?? options.getCurrentEditor()
    if (!targetEditor) return true

    let domPos = 0
    try {
      domPos = view.posAtDOM(anchor, 0)
    } catch {
      domPos = 0
    }

    const candidates = [pos, pos + 1, pos - 1, domPos, domPos + 1, domPos - 1]
    for (const candidate of candidates) {
      if (candidate < 0 || candidate > view.state.doc.content.size) continue
      targetEditor.chain().focus().setTextSelection(candidate).extendMarkRange('link').run()
      const { from, to, empty } = targetEditor.state.selection
      if (empty || from === to || !targetEditor.isActive('link')) continue
      options.inlineFormatToolbar.updateFormattingToolbar()
      options.inlineFormatToolbar.openLinkPopover()
      return true
    }
    return true
  }

  function resolveAnchorPos(view: ProseMirrorEditorView, anchor: HTMLAnchorElement): number {
    try {
      return view.posAtDOM(anchor, 0)
    } catch {
      return -1
    }
  }

  function handleAnchorClick(
    view: ProseMirrorEditorView,
    path: string,
    pos: number,
    event: MouseEvent
  ): boolean {
    const anchor = closestAnchorFromEventTarget(event.target)
    if (!anchor) return false

    const modifierPressed = event.metaKey || event.ctrlKey
    const anchorPos = pos >= 0 ? pos : resolveAnchorPos(view, anchor)

    const markdownTarget = markdownTargetFromAnchor(anchor)
    if (markdownTarget) {
      if (modifierPressed) {
        event.preventDefault()
        event.stopPropagation()
        return openLinkPopoverFromAnchorSelection(view, path, anchor, anchorPos)
      }
      event.preventDefault()
      event.stopPropagation()
      void options.openLinkTargetWithAutosave(markdownTarget)
      return true
    }

    const wikilinkTarget = (
      anchor.getAttribute('data-target') ??
      anchor.getAttribute('data-wikilink-target') ??
      ''
    ).trim()
    if (wikilinkTarget) {
      if (modifierPressed) {
        event.preventDefault()
        event.stopPropagation()
        const targetEditor = options.getSessionEditor(path) ?? options.getCurrentEditor()
        if (!targetEditor) return true
        const candidates = [anchorPos, anchorPos - 1, anchorPos + 1]
        for (const candidate of candidates) {
          if (candidate < 0 || candidate > view.state.doc.content.size) continue
          const range = enterWikilinkEditFromNode(targetEditor, candidate)
          if (!range) continue
          view.dispatch(view.state.tr.setMeta(WIKILINK_STATE_KEY, { type: 'startEditing', range }))
          return true
        }
        return true
      }
      event.preventDefault()
      event.stopPropagation()
      void options.openLinkTargetWithAutosave(wikilinkTarget)
      return true
    }

    const href = anchor.getAttribute('href')?.trim() ?? ''
    const internalAnchor = parseInternalAnchorHref(href)
    if (internalAnchor) {
      if (modifierPressed) {
        event.preventDefault()
        event.stopPropagation()
        return openLinkPopoverFromAnchorSelection(view, path, anchor, anchorPos)
      }
      event.preventDefault()
      event.stopPropagation()
      void options.revealAnchor(internalAnchor)
      return true
    }

    const resolvedMarkdownTarget = resolveRelativeMarkdownTarget(path, href)
    if (resolvedMarkdownTarget) {
      if (modifierPressed) {
        event.preventDefault()
        event.stopPropagation()
        return openLinkPopoverFromAnchorSelection(view, path, anchor, anchorPos)
      }
      event.preventDefault()
      event.stopPropagation()
      void options.openLinkTargetWithAutosave(resolvedMarkdownTarget)
      return true
    }

    const safe = options.sanitizeExternalHref(href)
    if (!safe) return false
    if (modifierPressed) {
      event.preventDefault()
      event.stopPropagation()
      return openLinkPopoverFromAnchorSelection(view, path, anchor, anchorPos)
    }
    event.preventDefault()
    event.stopPropagation()
    void options.openExternalUrl(safe)
    return true
  }

  function createEditorOptions(path: string) {
    return {
      autofocus: false,
      injectCSS: false,
      extensions: [
        StarterKit.configure({
          blockquote: false,
          codeBlock: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          listKeymap: false,
          link: false
        }),
        Link.configure({
          openOnClick: false,
          HTMLAttributes: {
            target: null,
            rel: null,
            class: null
          },
          isAllowedUri: (url, ctx) => {
            const value = String(url ?? '').trim()
            if (!value) return false
            if (parseInternalAnchorHref(value)) return true
            if (parseRelativeMarkdownHref(value)) return true
            return ctx.defaultValidate(value)
          }
        }),
        ListKit.configure({
          taskItem: {
            nested: true
          }
        }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        TableCellAlign,
        Placeholder.configure({ placeholder: 'Write here...' }),
        CalloutNode,
        AssetNode.configure({
          resolvePreviewSrc: (src: string) => resolveAssetPreviewSrc(path, src),
          openPreview: options.openAssetPreview,
          getAssetBrowserItems: options.getAssetBrowserItems,
          importAssetFiles: options.importAssetFiles
        }),
        MermaidNode.configure({
          confirmReplace: options.requestMermaidReplaceConfirm,
          openPreview: options.openMermaidPreview
        }),
        QuoteNode,
        HtmlNode,
        NoteEmbedNode.configure({
          loadEmbeddedNotePreview: options.loadEmbeddedNotePreview,
          openEmbeddedNote: options.openEmbeddedNote,
          restoreEmbeddedNoteInline: options.restoreEmbeddedNoteInline,
          openLinkTarget: (target: string) => options.openLinkTargetWithAutosave(target),
          openExternalUrl: (value: string) => options.openExternalUrl(value)
        }),
        CodeBlockNode,
        SpellcheckExtension.configure({
          getLanguage: () => options.getSpellcheckLanguage(path),
          isEnabled: () => options.spellcheckEnabled.value,
          isWordIgnored: (word: string) => options.isSpellcheckWordIgnored(path, word)
        }),
        EditorFindExtension,
        WikilinkNode.configure({
          getCandidates: (query: string) => options.getWikilinkCandidates(query),
          onNavigate: (target: string) => options.openLinkTargetWithAutosave(target),
          onCreate: async (_target: string) => {},
          resolve: (target: string) => options.resolveWikilinkTarget(target)
        })
      ],
      editorProps: {
        attributes: {
          class: 'ProseMirror tomosona-prosemirror',
          spellcheck: 'true',
          lang: EDITOR_LANGUAGE
        },
        handleDOMEvents: {
          click: (view: ProseMirrorEditorView, event: MouseEvent) => handleAnchorClick(view, path, -1, event)
        },
        handleKeyDown: (view: ProseMirrorEditorView, event: KeyboardEvent) => {
          if (adjustListLevelFromTab(view, event)) return true
          if (adjustHeadingLevelFromTab(view, event)) return true
          if (
            event.key === '/' &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
          ) {
            options.markSlashActivatedByUser()
          }
          if (event.key === '@' && !event.metaKey && !event.ctrlKey) {
            options.markAtActivatedByUser()
          }
          return false
        },
        handleClick: (view: ProseMirrorEditorView, pos: number, event: MouseEvent) => {
          if (handleAnchorClick(view, path, pos, event)) return true

          const modifierPressed = event.metaKey || event.ctrlKey
          if (!modifierPressed) return false
          const isoDateTarget = readIsoDateTokenAtPos(view, pos)
          if (!isoDateTarget) return false
          event.preventDefault()
          event.stopPropagation()
          void options.openLinkTargetWithAutosave(isoDateTarget)
          return true
        }
      },
      onUpdate: () => {
        if (options.currentPath.value !== path) return
        options.syncSlashMenuFromSelection({ preserveIndex: true })
        options.syncAtMenuFromSelection({ preserveIndex: true })
        options.updateTableToolbar()
        options.syncWikilinkUiFromPluginState()
      },
      onSelectionUpdate: () => {
        if (options.currentPath.value !== path) return
        const activePath = options.currentPath.value
        const allowCapture = activePath
          ? (options.shouldCaptureCaret ? options.shouldCaptureCaret(activePath) : true)
          : false
        if (activePath && allowCapture) options.captureCaret(activePath)
        options.syncBlockHandleFromSelection()
        options.syncSlashMenuFromSelection({ preserveIndex: true })
        options.syncAtMenuFromSelection({ preserveIndex: true })
        options.updateFormattingToolbar()
        options.updateTableToolbar()
        options.syncWikilinkUiFromPluginState()
      },
      onTransaction: (payload: { transaction: Transaction }) => {
        const { transaction } = payload
        if (transaction.docChanged) {
          options.onEditorDocChanged(path)
          options.syncBlockHandleFromSelection()
        }
        if (options.currentPath.value !== path) return
        options.updateTableToolbar()
        options.syncWikilinkUiFromPluginState()
      }
    }
  }

  /**
   * Creates a session editor instance bound to the setup contract.
   */
  function createSessionEditor(path: string): Editor {
    return new Editor({
      content: '',
      element: document.createElement('div'),
      ...createEditorOptions(path)
    })
  }

  /**
   * Refreshes spellcheck decorations after a language change or frontmatter edit.
   */
  function refreshSpellcheckForPath(path: string) {
    const editor = options.getSessionEditor(path) ?? options.getCurrentEditor()
    if (!editor) return
    refreshSpellcheckDecorations(editor, options.getSpellcheckLanguage(path))
  }

  return {
    createEditorOptions,
    createSessionEditor,
    refreshSpellcheckForPath
  }
}
