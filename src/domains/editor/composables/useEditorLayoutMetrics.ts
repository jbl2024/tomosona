import { ref, type Ref } from 'vue'

/**
 * Module: useEditorLayoutMetrics
 *
 * Owns editor holder/content-shell geometry helpers used by gutter hitboxes and
 * large-document metrics.
 */

/**
 * Dependencies required by {@link useEditorLayoutMetrics}.
 */
export type UseEditorLayoutMetricsOptions = {
  holder: Ref<HTMLDivElement | null>
  contentShell: Ref<HTMLDivElement | null>
  onScrollSync?: () => void
  minGutterWidth?: number
  gutterPaddingPx?: number
}

/**
 * Creates layout helpers for editor-shell geometry and markdown line counting.
 *
 * Responsibilities:
 * - Compute gutter hitbox width from holder/content-shell geometry.
 * - Normalize newline variants when counting document lines.
 * - Coordinate holder scroll updates with table-toolbar refresh hooks.
 *
 * Failure behavior:
 * - `updateGutterHitboxStyle` is a no-op when layout refs are not mounted.
 */
export function useEditorLayoutMetrics(options: UseEditorLayoutMetricsOptions) {
  const minGutterWidth = options.minGutterWidth ?? 48
  const gutterPaddingPx = options.gutterPaddingPx ?? 8

  const gutterHitboxStyle = ref<Record<string, string>>({
    position: 'absolute',
    top: '0',
    left: '0px',
    bottom: '0',
    width: '0px',
  })

  /**
   * Counts visual markdown lines with normalized CRLF/CR separators.
   *
   * Regex example:
   * - `"a\r\nb\rc"` is normalized to `"a\nb\nc"` and reports `3`.
   */
  function countLines(input: string): number {
    if (!input) return 0
    return input.replace(/\r\n?/g, '\n').split('\n').length
  }

  function updateGutterHitboxStyle() {
    if (!options.holder.value || !options.contentShell.value) return
    const holderRect = options.holder.value.getBoundingClientRect()
    const shellRect = options.contentShell.value.getBoundingClientRect()
    const shellStyle = window.getComputedStyle(options.contentShell.value)
    const shellPaddingLeft = Number.parseFloat(shellStyle.paddingLeft || '0') || 0
    const textStart = shellRect.left + shellPaddingLeft
    const width = Math.max(minGutterWidth, textStart - holderRect.left + gutterPaddingPx)
    gutterHitboxStyle.value = {
      position: 'absolute',
      top: '0',
      left: '0px',
      bottom: '0',
      width: `${width}px`,
    }
  }

  function onHolderScroll() {
    updateGutterHitboxStyle()
    options.onScrollSync?.()
  }

  return {
    gutterHitboxStyle,
    countLines,
    updateGutterHitboxStyle,
    onHolderScroll
  }
}
