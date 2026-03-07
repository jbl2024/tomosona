import { Extension, Editor } from '@tiptap/vue-3'
import type { Ref } from 'vue'
import type { Transaction } from '@tiptap/pm/state'
import type { EditorView as ProseMirrorEditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { ListKit } from '@tiptap/extension-list'
import Placeholder from '@tiptap/extension-placeholder'
import { CalloutNode } from '../lib/tiptap/extensions/CalloutNode'
import { MermaidNode } from '../lib/tiptap/extensions/MermaidNode'
import { QuoteNode } from '../lib/tiptap/extensions/QuoteNode'
import { HtmlNode } from '../lib/tiptap/extensions/HtmlNode'
import { WikilinkNode } from '../lib/tiptap/extensions/WikilinkNode'
import { VirtualTitleGuard } from '../lib/tiptap/extensions/VirtualTitleGuard'
import { CodeBlockNode } from '../lib/tiptap/extensions/CodeBlockNode'
import { TableCellAlign } from '../lib/tiptap/extensions/TableCellAlign'
import { WIKILINK_STATE_KEY, type WikilinkCandidate } from '../lib/tiptap/plugins/wikilinkState'
import { enterWikilinkEditFromNode } from '../lib/tiptap/extensions/wikilinkCommands'

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
  syncSlashMenuFromSelection: (options?: { preserveIndex?: boolean }) => void
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
  getWikilinkCandidates: (query: string) => Promise<WikilinkCandidate[]>
  openLinkTargetWithAutosave: (target: string) => Promise<void>
  resolveWikilinkTarget: (target: string) => Promise<boolean>
  sanitizeExternalHref: (value: string) => string | null
  openExternalUrl: (value: string) => Promise<void>
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

  const headingMeta = Extension.create({
    name: 'headingMeta',
    addGlobalAttributes() {
      return [
        {
          types: ['heading'],
          attributes: {
            isVirtualTitle: {
              default: false
            }
          }
        }
      ]
    }
  })

  function closestAnchorFromEventTarget(target: EventTarget | null): HTMLAnchorElement | null {
    const element = target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null
    return element?.closest('a') as HTMLAnchorElement | null
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

  function adjustHeadingLevelFromTab(view: ProseMirrorEditorView, event: KeyboardEvent): boolean {
    if (event.key !== 'Tab') return false

    const { selection } = view.state
    if (!selection.empty) return false

    const { $from } = selection
    const parent = $from.parent
    if (parent.type.name !== 'heading') return false
    if (Boolean(parent.attrs?.isVirtualTitle)) return false
    if ($from.parentOffset !== 0) return false

    const currentLevel = Number(parent.attrs?.level ?? 1)
    const nextLevel = Math.max(1, Math.min(6, currentLevel + (event.shiftKey ? -1 : 1)))

    event.preventDefault()
    event.stopPropagation()

    if (nextLevel === currentLevel) return true

    const headingPos = $from.before($from.depth)
    view.dispatch(
      view.state.tr.setNodeMarkup(headingPos, undefined, {
        ...parent.attrs,
        level: nextLevel
      })
    )
    return true
  }

  function createEditorOptions(path: string) {
    return {
      autofocus: false,
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
          openOnClick: false
        }),
        headingMeta,
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
        MermaidNode.configure({ confirmReplace: options.requestMermaidReplaceConfirm }),
        QuoteNode,
        HtmlNode,
        CodeBlockNode,
        WikilinkNode.configure({
          getCandidates: (query: string) => options.getWikilinkCandidates(query),
          onNavigate: (target: string) => options.openLinkTargetWithAutosave(target),
          onCreate: async (_target: string) => {},
          resolve: (target: string) => options.resolveWikilinkTarget(target)
        }),
        VirtualTitleGuard
      ],
      editorProps: {
        attributes: {
          class: 'ProseMirror tomosona-prosemirror'
        },
        handleKeyDown: (view: ProseMirrorEditorView, event: KeyboardEvent) => {
          if (adjustHeadingLevelFromTab(view, event)) return true
          if (
            event.key === '/' &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
          ) {
            options.markSlashActivatedByUser()
          }
          return false
        },
        handleClick: (view: ProseMirrorEditorView, pos: number, event: MouseEvent) => {
          const anchor = closestAnchorFromEventTarget(event.target)
          const modifierPressed = event.metaKey || event.ctrlKey
          if (!anchor) {
            if (!modifierPressed) return false
            const isoDateTarget = readIsoDateTokenAtPos(view, pos)
            if (!isoDateTarget) return false
            event.preventDefault()
            event.stopPropagation()
            void options.openLinkTargetWithAutosave(isoDateTarget)
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
              let domPos = 0
              try {
                domPos = view.posAtDOM(anchor, 0)
              } catch {
                domPos = 0
              }
              const candidates = [domPos, domPos - 1, domPos + 1]
              for (const candidate of candidates) {
                if (candidate < 0 || candidate > view.state.doc.content.size) continue
                const targetEditor = options.getSessionEditor(path) ?? options.getCurrentEditor()
                if (!targetEditor) continue
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
          const safe = options.sanitizeExternalHref(href)
          if (!safe) return false
          if (modifierPressed) {
            event.preventDefault()
            event.stopPropagation()
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
          event.preventDefault()
          event.stopPropagation()
          void options.openExternalUrl(safe)
          return true
        }
      },
      onUpdate: () => {
        if (options.currentPath.value !== path) return
        options.syncSlashMenuFromSelection({ preserveIndex: true })
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
        options.syncSlashMenuFromSelection({ preserveIndex: true })
        options.updateFormattingToolbar()
        options.updateTableToolbar()
        options.syncWikilinkUiFromPluginState()
      },
      onTransaction: (payload: { transaction: Transaction }) => {
        const { transaction } = payload
        if (transaction.docChanged) {
          options.onEditorDocChanged(path)
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

  return {
    createEditorOptions,
    createSessionEditor
  }
}
