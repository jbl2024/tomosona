import type { Extension } from '@codemirror/state'
import { drawSelection, EditorView } from '@codemirror/view'

/**
 * Cursor shape options for the source editor. Mirrors the app-level editor
 * cursor preference; `'bar'` keeps CodeMirror's default thin caret.
 */
export type SourceCursorStyle = 'block' | 'bar' | 'underline'

/** Solid tint: accent hue deepened by the theme text color so muted accents stay visible. */
const CURSOR_TINT = 'color-mix(in srgb, var(--accent) 80%, var(--text-main) 20%)'
/**
 * Full blink cycle in ms; matches the rich text editor. The cursor holds
 * solid for the first ~40% then eases out and back in, and CodeMirror
 * restarts the cycle on selection transactions (every keystroke), so it only
 * pulses after the user pauses.
 */
const CURSOR_BLINK_RATE_MS = 2400
const SMOOTH_BLINK_KEYFRAMES = { '0%': { opacity: 1 }, '40%': { opacity: 1 }, '70%': { opacity: 0.15 }, '100%': { opacity: 1 } }

/**
 * Resolves CodeMirror extensions that turn the default caret into a
 * terminal-style cursor for the source editor.
 *
 * Boundary:
 * - Owns cursor theming and blink-rate wiring only; pane lifecycle stays in
 *   SourceEditorPane.
 * - Returns an empty list for `'bar'`/unknown values so the default caret,
 *   selection rendering, and blink behavior are left untouched.
 * - `basicSetup` already includes `drawSelection()` without an explicit
 *   `cursorBlinkRate`; facet inputs only combine over provided values, so the
 *   rate set here wins (0 disables blinking) without drawing a second cursor —
 *   identical extension values are deduplicated.
 * - The theme overrides CodeMirror's `cm-blink`/`cm-blink2` keyframes (highest
 *   precedence wins by stylesheet order) so the block cursor eases softly
 *   instead of hard-cutting, matching the rich text editor.
 */
export function resolveSourceCursorExtensions(
  style: SourceCursorStyle | undefined,
  blink: boolean | undefined
): Extension[] {
  if (style !== 'block' && style !== 'underline') return []

  const shape: Record<string, string> = style === 'block'
    ? {
      borderLeft: 'none',
      marginLeft: '0px',
      width: '0.6em',
      background: CURSOR_TINT
    }
    : {
      borderLeft: 'none',
      marginLeft: '0px',
      width: '0.6em',
      background: 'transparent',
      borderBottom: `2px solid ${CURSOR_TINT}`
    }

  return [
    EditorView.theme({
      '.cm-cursor': shape,
      '&.cm-focused > .cm-scroller > .cm-cursorLayer': {
        animationTimingFunction: 'ease-in-out'
      },
      '@keyframes cm-blink': SMOOTH_BLINK_KEYFRAMES,
      '@keyframes cm-blink2': SMOOTH_BLINK_KEYFRAMES
    }),
    drawSelection({ cursorBlinkRate: blink === false ? 0 : CURSOR_BLINK_RATE_MS })
  ]
}
