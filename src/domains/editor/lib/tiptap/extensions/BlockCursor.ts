import { Extension, type Editor } from '@tiptap/vue-3'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

/**
 * Terminal-style fake cursor for the rich text editor.
 *
 * The native contenteditable caret cannot be resized, so this extension draws
 * a block/underline cursor as a widget decoration at the selection head while
 * the native caret stays hidden (see `.editor-cursor-fake` in
 * EditorViewContent.css). The widget only renders while the editor is focused,
 * the selection is collapsed, and no IME composition is in progress — during
 * composition the fake cursor steps aside so native editing stays intact.
 *
 * The widget's font size is pinned to the enclosing textblock's computed size,
 * so the cursor scales with the line type (p, h1, h2, ...) and stays constant
 * regardless of neighboring characters or inline marks.
 */

/** Fake-cursor shapes; `'bar'` is not drawn here (native caret is used instead). */
export type BlockCursorShape = 'block' | 'underline'

export type BlockCursorExtensionOptions = {
  /** Returns the cursor shape to draw, or null to keep the native caret. */
  getShape: () => BlockCursorShape | null
  /** Returns whether the fake cursor should blink. */
  getBlink: () => boolean
}

type BlockCursorPluginState = {
  focused: boolean
  composing: boolean
  decorations: DecorationSet
}

type BlockCursorMeta = {
  focused?: boolean
  composing?: boolean
}

const BLOCK_CURSOR_KEY = new PluginKey<BlockCursorPluginState>('tomosona-block-cursor')

/**
 * The decoration key encodes shape and blink variant so ProseMirror reuses the
 * widget DOM node while the variant is unchanged and swaps it when it changes.
 */
function cursorWidgetKey(shape: BlockCursorShape, blink: boolean): string {
  return `tomosona-block-cursor:${shape}:${blink ? 'blink' : 'static'}`
}

/** Blink cycle keyframes; the ALT twin lets the cycle restart without reflow. */
const BLINK_ANIMATION = 'tomosona-fake-cursor-blink'
const BLINK_ANIMATION_ALT = 'tomosona-fake-cursor-blink2'

/** Tracks the live widget DOM node so typing can restart the blink cycle. */
type CursorElementTracker = { element: HTMLSpanElement | null }

/**
 * Resolves the textblock (direct child of the editor root) that owns the
 * given position, so the cursor can be sized from the line type itself.
 */
function textblockElementFor(view: EditorView, head: number): HTMLElement | null {
  try {
    const at = view.domAtPos(head)
    let element: HTMLElement | null = at.node instanceof HTMLElement ? at.node : at.node.parentElement
    while (element && element.parentElement && element.parentElement !== view.dom) {
      element = element.parentElement
    }
    return element
  } catch {
    return null
  }
}

function createCursorElement(
  shape: BlockCursorShape,
  blink: boolean,
  view: EditorView,
  head: number,
  tracker: CursorElementTracker
): HTMLSpanElement {
  const element = document.createElement('span')
  element.className = [
    'tomosona-fake-cursor',
    `tomosona-fake-cursor--${shape}`,
    blink ? 'tomosona-fake-cursor--blink' : 'tomosona-fake-cursor--static'
  ].join(' ')
  element.setAttribute('aria-hidden', 'true')
  if (blink) element.style.animationName = BLINK_ANIMATION
  // Pin the em base to the textblock's computed font size so the cursor keeps
  // the line's size wherever the caret sits — inline marks such as code
  // (smaller font) must not shrink it, while h1/h2/p scale naturally.
  const block = textblockElementFor(view, head)
  const fontSize = block ? getComputedStyle(block).fontSize : ''
  if (fontSize) element.style.fontSize = fontSize
  tracker.element = element
  return element
}

function buildPluginState(
  state: EditorState,
  flags: { focused: boolean; composing: boolean },
  options: BlockCursorExtensionOptions,
  tracker: CursorElementTracker
): BlockCursorPluginState {
  const { selection } = state
  const shape = options.getShape()
  const blink = options.getBlink()
  const shouldRender = Boolean(shape) && flags.focused && !flags.composing && selection.empty
  const decorations = shouldRender && shape
    ? DecorationSet.create(state.doc, [
      Decoration.widget(selection.head, (view) => createCursorElement(shape, blink, view, selection.head, tracker), {
        side: -1,
        key: cursorWidgetKey(shape, blink)
      })
    ])
    : DecorationSet.empty
  return { focused: flags.focused, composing: flags.composing, decorations }
}

function dispatchCursorMeta(view: EditorView, meta: BlockCursorMeta) {
  view.dispatch(view.state.tr.setMeta(BLOCK_CURSOR_KEY, meta))
}

/** Reads the block cursor plugin state for an editor (mainly for tests/inspection). */
export function getBlockCursorState(editor: Editor): BlockCursorPluginState | undefined {
  return BLOCK_CURSOR_KEY.getState(editor.state)
}

/**
 * Forces the block cursor to re-read its shape/blink options. Call after the
 * cursor preferences change so already-mounted editors pick up the new variant.
 */
export function refreshBlockCursorDecorations(editor: Editor) {
  dispatchCursorMeta(editor.view, {})
}

export const BlockCursorExtension = Extension.create<BlockCursorExtensionOptions>({
  name: 'tomosonaBlockCursor',

  addOptions() {
    return {
      getShape: () => null,
      getBlink: () => true
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    const tracker: CursorElementTracker = { element: null }
    return [
      new Plugin<BlockCursorPluginState>({
        key: BLOCK_CURSOR_KEY,
        state: {
          init: (_config, state) => buildPluginState(state, { focused: false, composing: false }, options, tracker),
          apply: (transaction, value, _oldState, newState) => {
            const meta = transaction.getMeta(BLOCK_CURSOR_KEY) as BlockCursorMeta | undefined
            return buildPluginState(newState, {
              focused: meta && typeof meta.focused === 'boolean' ? meta.focused : value.focused,
              composing: meta && typeof meta.composing === 'boolean' ? meta.composing : value.composing
            }, options, tracker)
          }
        },
        view: () => ({
          update(view, prevState) {
            const element = tracker.element
            if (!element || !element.classList.contains('tomosona-fake-cursor--blink')) return
            const active = !view.state.doc.eq(prevState.doc) || !view.state.selection.eq(prevState.selection)
            if (!active) return
            // Restart the eased cycle on typing/caret moves by switching
            // between identical keyframe sets: the cursor stays solid while
            // writing and only pulses after the user pauses.
            element.style.animationName = element.style.animationName === BLINK_ANIMATION_ALT
              ? BLINK_ANIMATION
              : BLINK_ANIMATION_ALT
          }
        }),
        props: {
          decorations(state: EditorState) {
            return BLOCK_CURSOR_KEY.getState(state)?.decorations ?? DecorationSet.empty
          },
          handleDOMEvents: {
            focus: (view) => {
              dispatchCursorMeta(view, { focused: true })
              return false
            },
            blur: (view) => {
              dispatchCursorMeta(view, { focused: false })
              return false
            },
            compositionstart: (view) => {
              dispatchCursorMeta(view, { composing: true })
              return false
            },
            compositionend: (view) => {
              dispatchCursorMeta(view, { composing: false })
              return false
            }
          }
        }
      })
    ]
  }
})
