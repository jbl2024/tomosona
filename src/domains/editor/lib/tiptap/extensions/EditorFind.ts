import { Extension, type Editor } from '@tiptap/vue-3'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export type EditorFindMatch = {
  from: number
  to: number
}

export type EditorFindPluginState = {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  matches: EditorFindMatch[]
  activeIndex: number
  decorations: DecorationSet
}

type EditorFindMeta =
  | {
    type: 'set-search'
    query?: string
    caseSensitive?: boolean
    wholeWord?: boolean
    activeIndex?: number
  }
  | {
    type: 'set-active-index'
    activeIndex: number
  }
  | {
    type: 'clear'
  }

const EMPTY_DECORATIONS = DecorationSet.empty

function isWordChar(value: string | undefined): boolean {
  return Boolean(value) && /[\p{L}\p{N}_]/u.test(value ?? '')
}

function normalizeQuery(query: string, caseSensitive: boolean): string {
  return caseSensitive ? query : query.toLocaleLowerCase()
}

function findMatchesInText(
  text: string,
  positionMap: number[],
  query: string,
  options: { caseSensitive: boolean; wholeWord: boolean }
): EditorFindMatch[] {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []
  if (!text || positionMap.length !== text.length) return []

  const haystack = normalizeQuery(text, options.caseSensitive)
  const needle = normalizeQuery(trimmedQuery, options.caseSensitive)
  const matches: EditorFindMatch[] = []
  let cursor = 0

  while (cursor <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, cursor)
    if (index === -1) break

    const before = index > 0 ? text[index - 1] : undefined
    const after = index + trimmedQuery.length < text.length ? text[index + trimmedQuery.length] : undefined
    const respectsWholeWord =
      !options.wholeWord ||
      (!isWordChar(before) && !isWordChar(after))

    if (respectsWholeWord) {
      const from = positionMap[index]
      const endIndex = index + trimmedQuery.length - 1
      const to = positionMap[endIndex] + 1
      matches.push({ from, to })
    }

    cursor = index + Math.max(1, needle.length)
  }

  return matches
}

function collectTextblockMatches(
  doc: ProseMirrorNode,
  query: string,
  options: { caseSensitive: boolean; wholeWord: boolean }
): EditorFindMatch[] {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []

  const matches: EditorFindMatch[] = []

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true

    const blockText = node.textContent
    if (!blockText) return true

    const positionMap: number[] = []
    node.descendants((child, childPos) => {
      if (!child.isText) return true
      const text = child.text ?? ''
      const start = pos + childPos + 1
      for (let index = 0; index < text.length; index += 1) {
        positionMap.push(start + index)
      }
      return true
    })

    matches.push(...findMatchesInText(blockText, positionMap, trimmedQuery, options))
    return true
  })

  return matches
}

function clampActiveIndex(activeIndex: number, matchCount: number): number {
  if (matchCount <= 0) return -1
  if (activeIndex < 0) return 0
  if (activeIndex >= matchCount) return 0
  return activeIndex
}

function buildDecorations(matches: EditorFindMatch[], activeIndex: number) {
  return matches.map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class: index === activeIndex
        ? 'tomosona-editor-find-match tomosona-editor-find-match--active'
        : 'tomosona-editor-find-match',
      'data-editor-find-match': index === activeIndex ? 'active' : 'true'
    })
  )
}

function buildState(
  doc: ProseMirrorNode,
  current: Pick<EditorFindPluginState, 'query' | 'caseSensitive' | 'wholeWord' | 'activeIndex'>
): EditorFindPluginState {
  const query = current.query.trim()
  const matches = collectTextblockMatches(doc, query, {
    caseSensitive: current.caseSensitive,
    wholeWord: current.wholeWord
  })
  const activeIndex = query ? clampActiveIndex(current.activeIndex, matches.length) : -1

  return {
    query,
    caseSensitive: current.caseSensitive,
    wholeWord: current.wholeWord,
    matches,
    activeIndex,
    decorations: DecorationSet.create(doc, buildDecorations(matches, activeIndex))
  }
}

function createEmptyState(doc: ProseMirrorNode): EditorFindPluginState {
  return {
    query: '',
    caseSensitive: false,
    wholeWord: false,
    matches: [],
    activeIndex: -1,
    decorations: DecorationSet.create(doc, [])
  }
}

export const EDITOR_FIND_PLUGIN_KEY = new PluginKey<EditorFindPluginState>('tomosona-editor-find')

export const EditorFindExtension = Extension.create({
  name: 'editorFind',
  addProseMirrorPlugins() {
    return [
      new Plugin<EditorFindPluginState>({
        key: EDITOR_FIND_PLUGIN_KEY,
        state: {
          init: (_, state) => createEmptyState(state.doc),
          apply(tr, pluginState, _oldState, newState) {
            const meta = tr.getMeta(EDITOR_FIND_PLUGIN_KEY) as EditorFindMeta | undefined

            if (meta?.type === 'clear') {
              return createEmptyState(newState.doc)
            }

            if (meta?.type === 'set-active-index') {
              const activeIndex = clampActiveIndex(meta.activeIndex, pluginState.matches.length)
              return {
                ...pluginState,
                activeIndex,
                decorations: DecorationSet.create(newState.doc, buildDecorations(pluginState.matches, activeIndex))
              }
            }

            if (meta?.type === 'set-search') {
              return buildState(newState.doc, {
                query: meta.query ?? pluginState.query,
                caseSensitive: meta.caseSensitive ?? pluginState.caseSensitive,
                wholeWord: meta.wholeWord ?? pluginState.wholeWord,
                activeIndex: meta.activeIndex ?? pluginState.activeIndex
              })
            }

            if (tr.docChanged && pluginState.query) {
              return buildState(newState.doc, pluginState)
            }

            if (tr.docChanged) {
              return {
                ...pluginState,
                decorations: DecorationSet.create(newState.doc, [])
              }
            }

            return pluginState
          }
        },
        props: {
          decorations(state) {
            return EDITOR_FIND_PLUGIN_KEY.getState(state)?.decorations ?? null
          }
        }
      })
    ]
  }
})

export function getEditorFindState(editor: Editor | null): EditorFindPluginState {
  const state = editor ? EDITOR_FIND_PLUGIN_KEY.getState(editor.state) : null
  if (state) return state

  return {
    query: '',
    caseSensitive: false,
    wholeWord: false,
    matches: [],
    activeIndex: -1,
    decorations: EMPTY_DECORATIONS
  }
}

export function setEditorFindSearch(
  editor: Editor | null,
  payload: {
    query?: string
    caseSensitive?: boolean
    wholeWord?: boolean
    activeIndex?: number
  }
) {
  if (!editor) return
  editor.view.dispatch(editor.state.tr.setMeta(EDITOR_FIND_PLUGIN_KEY, { type: 'set-search', ...payload }))
}

export function clearEditorFind(editor: Editor | null) {
  if (!editor) return
  editor.view.dispatch(editor.state.tr.setMeta(EDITOR_FIND_PLUGIN_KEY, { type: 'clear' }))
}

export function stepEditorFindMatch(editor: Editor | null, direction: 1 | -1): EditorFindPluginState {
  const state = getEditorFindState(editor)
  if (!editor || !state.matches.length) return state

  const nextIndex = state.activeIndex < 0
    ? 0
    : (state.activeIndex + direction + state.matches.length) % state.matches.length

  editor.view.dispatch(
    editor.state.tr.setMeta(EDITOR_FIND_PLUGIN_KEY, {
      type: 'set-active-index',
      activeIndex: nextIndex
    })
  )

  return getEditorFindState(editor)
}

/** Activates one known find match without changing the current query. */
export function setEditorFindActiveMatch(editor: Editor | null, activeIndex: number): EditorFindPluginState {
  const state = getEditorFindState(editor)
  if (!editor || !state.matches.length) return state
  editor.view.dispatch(
    editor.state.tr.setMeta(EDITOR_FIND_PLUGIN_KEY, {
      type: 'set-active-index',
      activeIndex
    })
  )
  return getEditorFindState(editor)
}
