import { ref, type Ref } from 'vue'
import { TextSelection } from '@tiptap/pm/state'
import { type Editor } from '@tiptap/vue-3'
import { TIPTAP_NODE_TYPES } from '../lib/tiptap/types'
import { WIKILINK_STATE_KEY, getWikilinkPluginState } from '../lib/tiptap/plugins/wikilinkState'
import { parseWikilinkToken, type WikilinkEditingRange } from '../lib/tiptap/extensions/wikilinkCommands'
import { buildWikilinkToken } from '../lib/wikilinks'

/**
 * Module: useEditorWikilinkOverlayState
 *
 * Keeps wikilink plugin state and overlay UI state synchronized for EditorView.
 */

/**
 * UI-facing wikilink candidate row.
 */
export type WikilinkOverlayItem = {
  id: string
  label: string
  target: string
  isCreate: boolean
}

/**
 * Runtime dependencies required by {@link useEditorWikilinkOverlayState}.
 */
export type UseEditorWikilinkOverlayStateOptions = {
  getEditor: () => Editor | null
  holder: Ref<HTMLElement | null>
  blockMenuOpen: Ref<boolean>
  isDragMenuOpen: () => boolean
  closeBlockMenu: () => void
}

/**
 * useEditorWikilinkOverlayState
 *
 * Purpose:
 * - Own wikilink overlay refs and plugin-state synchronization.
 *
 * Responsibilities:
 * - Mirror plugin editing/open/index state into overlay refs.
 * - Apply selected candidate token and keep plugin selected index in sync.
 * - Finalize token -> node conversion when editing range is exited.
 */
export function useEditorWikilinkOverlayState(options: UseEditorWikilinkOverlayStateOptions) {
  const wikilinkOpen = ref(false)
  const wikilinkIndex = ref(0)
  const wikilinkLeft = ref(0)
  const wikilinkTop = ref(0)
  const wikilinkResults = ref<WikilinkOverlayItem[]>([])
  const wikilinkEditingRange = ref<WikilinkEditingRange | null>(null)

  /**
   * Closes overlay and clears transient wikilink UI state.
   */
  function closeWikilinkMenu() {
    wikilinkOpen.value = false
    wikilinkIndex.value = 0
    wikilinkResults.value = []
    wikilinkEditingRange.value = null
  }

  /**
   * Mirrors plugin state into overlay refs and commits pending token edits.
   */
  function syncWikilinkUiFromPluginState() {
    const editor = options.getEditor()
    if (!editor || !options.holder.value) {
      closeWikilinkMenu()
      return
    }

    const state = getWikilinkPluginState(editor.state)
    if (state.mode === 'editing' && state.editingRange) {
      const selection = editor.state.selection
      const stillInside = selection.from > state.editingRange.from && selection.to < state.editingRange.to
      if (!stillInside) {
        const token = editor.state.doc.textBetween(state.editingRange.from, state.editingRange.to, '', '')
        const parsed = parseWikilinkToken(token)
        if (parsed) {
          const nodeType = editor.state.schema.nodes[TIPTAP_NODE_TYPES.wikilink]
          if (nodeType) {
            const node = nodeType.create({
              target: parsed.target,
              label: parsed.label,
              exists: true
            })
            const exitOnLeft = selection.from <= state.editingRange.from
            const tr = editor.state.tr.replaceWith(state.editingRange.from, state.editingRange.to, node)
            const pos = exitOnLeft ? state.editingRange.from : state.editingRange.from + node.nodeSize
            tr.setSelection(TextSelection.create(tr.doc, Math.max(1, Math.min(pos, tr.doc.content.size))))
            editor.view.dispatch(tr)
          }
        }
        editor.view.dispatch(editor.state.tr.setMeta(WIKILINK_STATE_KEY, { type: 'setIdle' }))
        closeWikilinkMenu()
        return
      }
    }

    if (!state.open || state.mode !== 'editing' || !state.editingRange) {
      closeWikilinkMenu()
      return
    }

    wikilinkOpen.value = true
    if (options.blockMenuOpen.value || options.isDragMenuOpen()) {
      options.closeBlockMenu()
    }
    wikilinkIndex.value = state.selectedIndex
    wikilinkEditingRange.value = state.editingRange
    const currentToken = editor.state.doc.textBetween(state.editingRange.from, state.editingRange.to, '', '')
    const currentAlias = extractAliasFromDraftToken(currentToken)
    wikilinkResults.value = state.candidates.map((candidate) => ({
      id: `${candidate.isCreate ? 'create' : 'existing'}:${candidate.target}`,
      label: candidate.isCreate && currentAlias
        ? `Create "${candidate.target}" as "${currentAlias}"`
        : (candidate.label ?? candidate.target),
      target: candidate.target,
      isCreate: Boolean(candidate.isCreate)
    }))

    const anchorPos = Math.max(
      state.editingRange.from + 2,
      Math.min(editor.state.selection.from, state.editingRange.to - 1)
    )
    const rect = editor.view.coordsAtPos(anchorPos)
    let left = rect.left
    let top = rect.bottom + 8

    const estimatedWidth = 320
    const estimatedHeight = 280
    const maxX = Math.max(12, window.innerWidth - estimatedWidth - 12)
    const maxY = Math.max(12, window.innerHeight - estimatedHeight - 12)

    left = Math.max(12, Math.min(left, maxX))
    top = Math.max(12, Math.min(top, maxY))

    wikilinkLeft.value = left
    wikilinkTop.value = top
  }

  /**
   * Applies candidate token into the current editing range.
   */
  function applyWikilinkCandidateToken(target: string, placement: 'after' | 'inside') {
    const editor = options.getEditor()
    if (!editor || !wikilinkEditingRange.value) return
    const trimmedTarget = target.trim()
    if (!trimmedTarget) return
    const range = wikilinkEditingRange.value
    const currentToken = editor.state.doc.textBetween(range.from, range.to, '', '')
    const explicitAlias = extractAliasFromDraftToken(currentToken)
    const token = buildWikilinkToken(trimmedTarget, explicitAlias)
    const tr = editor.state.tr.insertText(token, range.from, range.to)
    const nextPos = placement === 'inside'
      ? range.from + token.length - 2
      : range.from + token.length
    tr.setSelection(TextSelection.create(tr.doc, Math.min(nextPos, tr.doc.content.size)))
    editor.view.dispatch(tr)
    if (placement === 'inside') {
      editor.view.dispatch(editor.state.tr.setMeta(WIKILINK_STATE_KEY, {
        type: 'startEditing',
        range: { from: range.from, to: range.from + token.length }
      }))
    } else {
      editor.view.dispatch(editor.state.tr.setMeta(WIKILINK_STATE_KEY, { type: 'setIdle' }))
    }
    syncWikilinkUiFromPluginState()
  }

  /**
   * Handles candidate selection from overlay list.
   */
  function onWikilinkMenuSelect(target: string) {
    applyWikilinkCandidateToken(target, 'after')
  }

  /**
   * Mirrors overlay selection index into plugin state.
   */
  function onWikilinkMenuIndexUpdate(index: number) {
    wikilinkIndex.value = index
    const editor = options.getEditor()
    if (!editor) return
    const tr = editor.state.tr.setMeta(WIKILINK_STATE_KEY, { type: 'setSelectedIndex', index })
    editor.view.dispatch(tr)
  }

  return {
    wikilinkOpen,
    wikilinkIndex,
    wikilinkLeft,
    wikilinkTop,
    wikilinkResults,
    wikilinkEditingRange,
    closeWikilinkMenu,
    syncWikilinkUiFromPluginState,
    applyWikilinkCandidateToken,
    onWikilinkMenuSelect,
    onWikilinkMenuIndexUpdate
  }
}

function extractAliasFromDraftToken(token: string): string | null {
  if (!token.startsWith('[[')) return null
  const closeIndex = token.indexOf(']]', 2)
  const inner = (closeIndex >= 0 ? token.slice(2, closeIndex) : token.slice(2)).trim()
  if (!inner || inner.includes('[') || inner.includes(']')) return null

  const pipeIndex = inner.indexOf('|')
  if (pipeIndex < 0) return null
  if (inner.indexOf('|', pipeIndex + 1) >= 0) return null

  const alias = inner.slice(pipeIndex + 1).trim()
  return alias || null
}
