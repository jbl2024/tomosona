import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import {
  enterWikilinkEditFromNode,
  findSelectedWikilinkNode,
  insertWikilinkDraft,
  type WikilinkEditingRange
} from '../extensions/wikilinkCommands'
import { buildWikilinkToken } from '../../wikilinks'

export type WikilinkCandidate = {
  target: string
  label?: string
  exists: boolean
  isCreate?: boolean
}

export type WikilinkStateMode = 'idle' | 'node_selected' | 'editing'

export type WikilinkPluginState = {
  mode: WikilinkStateMode
  editingRange: WikilinkEditingRange | null
  nodePos: number | null
  nodeTarget: string
  nodeLabel: string | null
  nodeExists: boolean
  query: string
  inLabel: boolean
  pipeSeen: boolean
  open: boolean
  selectedIndex: number
  candidates: WikilinkCandidate[]
  requestId: number
}

export type WikilinkStateOptions = {
  getCandidates: (query: string) => Promise<WikilinkCandidate[]>
  onNavigate: (target: string) => void | Promise<void>
  onCreate: (target: string) => void | Promise<void>
  resolve: (target: string) => Promise<boolean>
}

type WikilinkStateAction =
  | { type: 'setIdle' }
  | { type: 'setNodeSelected'; pos: number; target: string; label: string | null; exists: boolean }
  | { type: 'startEditing'; range: WikilinkEditingRange }
  | { type: 'updateEditing'; range: WikilinkEditingRange; query: string; inLabel: boolean; pipeSeen: boolean }
  | { type: 'setEditingOpen'; open: boolean }
  | { type: 'setCandidates'; requestId: number; candidates: WikilinkCandidate[] }
  | { type: 'setSelectedIndex'; index: number }

const INITIAL_STATE: WikilinkPluginState = {
  mode: 'idle',
  editingRange: null,
  nodePos: null,
  nodeTarget: '',
  nodeLabel: null,
  nodeExists: true,
  query: '',
  inLabel: false,
  pipeSeen: false,
  open: false,
  selectedIndex: 0,
  candidates: [],
  requestId: 0
}

export const WIKILINK_STATE_KEY = new PluginKey<WikilinkPluginState>('tomosona-wikilink-state')

export function getWikilinkPluginState(state: EditorState): WikilinkPluginState {
  return WIKILINK_STATE_KEY.getState(state) ?? INITIAL_STATE
}

function isPrintableKey(event: KeyboardEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1
}

function isEditModifier(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey
}

function inCodeContext(state: EditorState): boolean {
  const { $from } = state.selection
  if ($from.parent.type.name === 'codeBlock') return true
  return $from.marks().some((mark) => mark.type.name === 'code')
}

function mapRange(range: WikilinkEditingRange, tr: Transaction): WikilinkEditingRange {
  return {
    from: tr.mapping.map(range.from, 1),
    to: tr.mapping.map(range.to, -1)
  }
}

function findClosedWikilinkRangeAtCursor(state: EditorState): WikilinkEditingRange | null {
  const selection = state.selection
  if (!('empty' in selection) || !selection.empty) return null
  const { $from } = selection
  const parent = $from.parent
  if (!parent.isTextblock) return null

  const text = parent.textContent
  const offset = $from.parentOffset
  const start = text.lastIndexOf('[[', offset)
  if (start < 0) return null
  const end = text.indexOf(']]', start + 2)
  if (end < 0) return null
  if (offset < start + 2 || offset > end + 2) return null

  const inner = text.slice(start + 2, end)
  if (inner.includes('[') || inner.includes(']')) return null
  if (inner.indexOf('|') !== inner.lastIndexOf('|')) return null

  return {
    from: $from.start() + start,
    to: $from.start() + end + 2
  }
}

function extractEditingState(state: EditorState, range: WikilinkEditingRange) {
  const normalizedFrom = Math.max(1, Math.min(range.from, state.doc.content.size))
  const normalizedTo = Math.max(normalizedFrom, Math.min(range.to, state.doc.content.size))
  const text = state.doc.textBetween(normalizedFrom, normalizedTo, '\n', '\n')

  if (!text.startsWith('[[') || text.includes('\n')) return null
  const closeIndex = text.indexOf(']]', 2)
  const active = closeIndex >= 0 ? text.slice(0, closeIndex + 2) : text
  if (active.indexOf('[[', 2) >= 0) return null

  const inner = closeIndex >= 0 ? active.slice(2, -2) : active.slice(2)
  if (inner.includes('[') || inner.includes(']')) return null

  const pipeIndex = inner.indexOf('|')
  const secondPipe = pipeIndex >= 0 ? inner.indexOf('|', pipeIndex + 1) : -1
  if (secondPipe >= 0) return null

  const query = (pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner).trim()
  const cursor = state.selection.from
  const inLabel = pipeIndex >= 0 && cursor > normalizedFrom + 2 + pipeIndex

  return {
    range: { from: normalizedFrom, to: normalizedTo },
    query,
    inLabel,
    pipeSeen: pipeIndex >= 0
  }
}

function getWikilinkAnchorFromDOM(event: MouseEvent): HTMLAnchorElement | null {
  const rawTarget = event.target
  const element = rawTarget instanceof Element
    ? rawTarget
    : rawTarget instanceof Node
      ? rawTarget.parentElement
      : null
  return element?.closest('a[data-wikilink="true"], a[data-wikilink-target]') as HTMLAnchorElement | null
}

function getWikilinkTargetFromAnchor(anchor: HTMLAnchorElement | null): string {
  if (!anchor) return ''
  return (anchor.getAttribute('data-target') ?? anchor.getAttribute('data-wikilink-target') ?? '').trim()
}

function reduceState(previous: WikilinkPluginState, action: WikilinkStateAction): WikilinkPluginState {
  switch (action.type) {
    case 'setIdle':
      return { ...INITIAL_STATE }

    case 'setNodeSelected':
      return {
        ...previous,
        mode: 'node_selected',
        editingRange: null,
        open: false,
        candidates: [],
        selectedIndex: 0,
        nodePos: action.pos,
        nodeTarget: action.target,
        nodeLabel: action.label,
        nodeExists: action.exists,
        query: ''
      }

    case 'startEditing':
      return {
        ...previous,
        mode: 'editing',
        editingRange: action.range,
        open: true,
        selectedIndex: 0,
        candidates: [],
        requestId: previous.requestId + 1,
        nodePos: null,
        nodeTarget: '',
        nodeLabel: null
      }

    case 'updateEditing':
      return {
        ...previous,
        mode: 'editing',
        editingRange: action.range,
        query: action.query,
        inLabel: action.inLabel,
        pipeSeen: action.pipeSeen,
        open: true
      }

    case 'setEditingOpen':
      if (previous.mode !== 'editing') return previous
      return {
        ...previous,
        open: action.open
      }

    case 'setCandidates': {
      if (action.requestId !== previous.requestId) return previous
      const nextIndex = action.candidates.length
        ? Math.min(previous.selectedIndex, action.candidates.length - 1)
        : 0
      return {
        ...previous,
        candidates: action.candidates,
        selectedIndex: nextIndex,
        open: true
      }
    }

    case 'setSelectedIndex':
      return {
        ...previous,
        selectedIndex: action.index
      }

    default:
      return previous
  }
}

function dispatchAction(view: EditorView, action: WikilinkStateAction) {
  const tr = view.state.tr.setMeta(WIKILINK_STATE_KEY, action)
  view.dispatch(tr)
}

function resolveWikilinkEditRange(editor: Editor, pos: number): WikilinkEditingRange | null {
  const candidates = [pos, pos - 1, pos + 1]
  for (const candidate of candidates) {
    if (candidate < 0 || candidate > editor.state.doc.content.size) continue
    const range = enterWikilinkEditFromNode(editor, candidate)
    if (range) return range
  }
  return null
}

function applySelectedCandidateToken(
  view: EditorView,
  state: WikilinkPluginState,
  placement: 'after' | 'inside'
): boolean {
  const range = state.editingRange
  if (!range) return false
  const selected = state.candidates[state.selectedIndex]
  const target = String(selected?.target ?? state.query).trim()
  if (!target) return true

  const currentToken = view.state.doc.textBetween(range.from, range.to, '', '')
  const explicitAlias = extractAliasFromDraftToken(currentToken)
  const token = buildWikilinkToken(target, explicitAlias)
  const tr = view.state.tr.insertText(token, range.from, range.to)
  const nextPos = placement === 'inside'
    ? range.from + token.length - 2
    : range.from + token.length

  tr.setSelection(TextSelection.create(tr.doc, Math.min(nextPos, tr.doc.content.size)))
  view.dispatch(tr)

  if (placement === 'inside') {
    dispatchAction(view, {
      type: 'startEditing',
      range: { from: range.from, to: range.from + token.length }
    })
  }

  return true
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

export function createWikilinkStatePlugin(editor: Editor, options: WikilinkStateOptions) {
  return new Plugin<WikilinkPluginState>({
    key: WIKILINK_STATE_KEY,

    state: {
      init: () => ({ ...INITIAL_STATE }),
      apply(tr, pluginState, _oldState, newState) {
        const meta = tr.getMeta(WIKILINK_STATE_KEY) as WikilinkStateAction | undefined
        let next = pluginState

        if (meta) {
          next = reduceState(next, meta)
        }

        if (next.mode === 'editing' && next.editingRange) {
          const mappedRange = tr.docChanged ? mapRange(next.editingRange, tr) : next.editingRange
          const editing = extractEditingState(newState, mappedRange)
          if (!editing) {
            return { ...INITIAL_STATE }
          }
          return {
            ...next,
            editingRange: editing.range,
            query: editing.query,
            inLabel: editing.inLabel,
            pipeSeen: editing.pipeSeen,
            open: next.open
          }
        }

        const selected = findSelectedWikilinkNode(newState)
        if (selected) {
          const target = String(selected.node.attrs.target ?? '').trim()
          const label = String(selected.node.attrs.label ?? '').trim() || null
          const exists = Boolean(selected.node.attrs.exists)
          return reduceState(next, { type: 'setNodeSelected', pos: selected.pos, target, label, exists })
        }

        if (next.mode === 'node_selected') {
          return { ...INITIAL_STATE }
        }

        return next
      }
    },

    props: {
      handleClick(view, _pos, event) {
        const anchor = getWikilinkAnchorFromDOM(event)
        const target = getWikilinkTargetFromAnchor(anchor)

        if (!target) return false

        event.preventDefault()
        event.stopPropagation()

        if (isEditModifier(event)) {
          let editPos = 0
          try {
            editPos = anchor ? view.posAtDOM(anchor, 0) : 0
          } catch {
            editPos = 0
          }
          const range = resolveWikilinkEditRange(editor, editPos)
          if (!range) return true
          dispatchAction(view, { type: 'startEditing', range })
          return true
        }

        void options.onNavigate(target)
        return true
      },

      handleTextInput(view, from, to, text) {
        if (inCodeContext(view.state)) return false

        if (text === '[') {
          if (from < 2) return false
          const prev = view.state.doc.textBetween(from - 1, from, '', '')
          if (prev !== '[') return false

          const range = insertWikilinkDraft(editor, from - 1, to)
          if (!range) return false
          dispatchAction(view, { type: 'startEditing', range })
          return true
        }

        const pluginState = getWikilinkPluginState(view.state)
        if (pluginState.mode !== 'idle') return false

        const range = findClosedWikilinkRangeAtCursor(view.state)
        if (!range) return false

        const tr = view.state.tr.insertText(text, from, to)
        tr.setMeta(WIKILINK_STATE_KEY, {
          type: 'startEditing',
          range: {
            from: range.from,
            to: range.to + text.length - (to - from)
          }
        })
        view.dispatch(tr)
        return true
      },

      handleKeyDown(view, event) {
        const state = getWikilinkPluginState(view.state)

        if (state.mode === 'editing') {
          const range = state.editingRange
          if (!range) return false

          if (event.key === 'ArrowDown') {
            if (!state.open) return false
            event.preventDefault()
            if (!state.candidates.length) return true
            dispatchAction(view, {
              type: 'setSelectedIndex',
              index: (state.selectedIndex + 1) % state.candidates.length
            })
            return true
          }

          if (event.key === 'ArrowUp') {
            if (!state.open) return false
            event.preventDefault()
            if (!state.candidates.length) return true
            dispatchAction(view, {
              type: 'setSelectedIndex',
              index: (state.selectedIndex - 1 + state.candidates.length) % state.candidates.length
            })
            return true
          }

          if (event.key === 'Escape') {
            event.preventDefault()
            dispatchAction(view, { type: 'setEditingOpen', open: false })
            return true
          }

          if (event.key === '|' && state.pipeSeen) {
            event.preventDefault()
            return true
          }

          if (event.key === 'Tab') {
            if (!state.open) return false
            event.preventDefault()
            return applySelectedCandidateToken(view, state, 'inside')
          }

          if (event.key === 'Enter') {
            if (!state.open) return false
            event.preventDefault()
            return applySelectedCandidateToken(view, state, 'after')
          }

          return false
        }

        if (state.mode === 'node_selected') {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (state.nodeTarget) {
              void options.onNavigate(state.nodeTarget)
            }
            return true
          }

          const shouldEdit =
            event.key === 'F2' ||
            event.key === 'Backspace' ||
            event.key === 'ArrowLeft' ||
            event.key === 'ArrowRight' ||
            isPrintableKey(event)
          if (!shouldEdit) return false

          const pos = state.nodePos
          if (typeof pos !== 'number') return false
          event.preventDefault()
          const range = resolveWikilinkEditRange(editor, pos)
          if (!range) return true
          dispatchAction(view, { type: 'startEditing', range })

          if (isPrintableKey(event)) {
            const tr = view.state.tr.insertText(event.key)
            view.dispatch(tr)
          }

          return true
        }

        return false
      }
    },

    view(view) {
      let lastQuery = ''
      let lastRequestId = 0
      let disposed = false
      let pendingTimer: ReturnType<typeof setTimeout> | null = null

      function clearTimer() {
        if (!pendingTimer) return
        clearTimeout(pendingTimer)
        pendingTimer = null
      }

      async function fetchCandidates(query: string, requestId: number) {
        try {
          const candidates = await options.getCandidates(query)
          if (disposed) return
          dispatchAction(view, { type: 'setCandidates', requestId, candidates })
        } catch {
          if (disposed) return
          dispatchAction(view, { type: 'setCandidates', requestId, candidates: [] })
        }
      }

      return {
        update(nextView) {
          const state = getWikilinkPluginState(nextView.state)
          if (state.mode !== 'editing' || !state.open) {
            clearTimer()
            lastQuery = ''
            lastRequestId = 0
            return
          }

          if (state.query === lastQuery && state.requestId === lastRequestId) return

          lastQuery = state.query
          lastRequestId = state.requestId
          clearTimer()
          pendingTimer = setTimeout(() => {
            void fetchCandidates(state.query, state.requestId)
          }, 100)
        },

        destroy() {
          disposed = true
          clearTimer()
        }
      }
    }
  })
}
