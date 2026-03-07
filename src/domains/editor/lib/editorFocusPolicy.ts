/**
 * Focus policy helpers for editor/tab navigation flows.
 *
 * Purpose:
 * - Centralize when the app should restore editor focus after navigation events.
 *
 * Boundary:
 * - Pure DOM inspection only; does not mutate focus state.
 */

/**
 * Returns true when a tab switch should restore editor focus.
 *
 * Invariant:
 * - Only restore focus if the currently focused element is already inside an editor holder.
 * - Prevents accidental caret placement (often at doc end) when switching tabs from non-editor UI.
 */
export function shouldRefocusEditorAfterTabSwitch(activeElement: Element | null): boolean {
  if (!(activeElement instanceof HTMLElement)) return false
  const shouldRefocus = Boolean(activeElement.closest('.editor-holder'))
  return shouldRefocus
}
