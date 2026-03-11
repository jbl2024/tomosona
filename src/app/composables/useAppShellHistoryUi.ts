import { onScopeDispose, ref } from 'vue'

export type HistoryMenuSide = 'back' | 'forward'

/** Minimal topbar contract required by the shell history UI controller. */
export type AppShellHistoryUiTopbarPort = {
  getHistoryButtonEl: (side: HistoryMenuSide) => HTMLElement | null
  containsOverflowTarget: (target: Node) => boolean
  containsHistoryMenuTarget: (side: HistoryMenuSide, target: Node) => boolean
}

/** Declares the dependencies required by the shell history UI controller. */
export type UseAppShellHistoryUiOptions = {
  topbarPort: AppShellHistoryUiTopbarPort
  closeOverflowMenu: () => void
  canOpenMenu: (side: HistoryMenuSide) => boolean
  getTargetCount: (side: HistoryMenuSide) => number
}

/**
 * Owns the shell-level back/forward history menu UI: long press, context menu,
 * outside-click dismissal, resize repositioning, and menu state.
 */
export function useAppShellHistoryUi(options: UseAppShellHistoryUiOptions) {
  const historyMenuOpen = ref<HistoryMenuSide | null>(null)
  const historyMenuStyle = ref<Record<string, string>>({})
  let historyMenuTimer: ReturnType<typeof setTimeout> | null = null
  let historyLongPressTarget: HistoryMenuSide | null = null

  function historyMenuItemCount(side: HistoryMenuSide): number {
    return Math.max(1, Math.min(14, options.getTargetCount(side)))
  }

  function closeHistoryMenu() {
    historyMenuOpen.value = null
    historyMenuStyle.value = {}
  }

  function updateHistoryMenuPosition(side: HistoryMenuSide) {
    const anchor = options.topbarPort.getHistoryButtonEl(side)
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    const viewportPadding = 8
    const menuWidth = 320
    const menuHeight = historyMenuItemCount(side) * 32 + 12

    const left = Math.max(
      viewportPadding,
      Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding)
    )
    const prefersDown = rect.bottom + 6 + menuHeight <= window.innerHeight - viewportPadding
    const top = prefersDown
      ? rect.bottom + 6
      : Math.max(viewportPadding, rect.top - menuHeight - 6)

    historyMenuStyle.value = {
      position: 'fixed',
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      maxHeight: `${Math.max(120, window.innerHeight - viewportPadding * 2)}px`
    }
  }

  function openHistoryMenu(side: HistoryMenuSide) {
    options.closeOverflowMenu()
    historyMenuOpen.value = side
    updateHistoryMenuPosition(side)
  }

  function onHistoryButtonPointerDown(side: HistoryMenuSide, event: PointerEvent) {
    if (event.button !== 0 || !options.canOpenMenu(side)) return
    historyLongPressTarget = null
    cancelHistoryLongPress()
    historyMenuTimer = setTimeout(() => {
      historyLongPressTarget = side
      openHistoryMenu(side)
    }, 420)
  }

  function cancelHistoryLongPress() {
    if (!historyMenuTimer) return
    clearTimeout(historyMenuTimer)
    historyMenuTimer = null
  }

  function onHistoryButtonContextMenu(side: HistoryMenuSide, event: MouseEvent) {
    event.preventDefault()
    openHistoryMenu(side)
  }

  function shouldConsumeHistoryButtonClick(side: HistoryMenuSide): boolean {
    if (historyLongPressTarget === side) {
      historyLongPressTarget = null
      return true
    }
    historyLongPressTarget = null
    closeHistoryMenu()
    return false
  }

  function onWindowResize() {
    if (!historyMenuOpen.value) return
    updateHistoryMenuPosition(historyMenuOpen.value)
  }

  function onGlobalPointerDown(event: MouseEvent, overflowMenuOpen: boolean) {
    const target = event.target as Node | null
    if (!target) return

    if (overflowMenuOpen && !options.topbarPort.containsOverflowTarget(target)) {
      options.closeOverflowMenu()
    }

    if (historyMenuOpen.value === 'back' && !options.topbarPort.containsHistoryMenuTarget('back', target)) {
      closeHistoryMenu()
    }

    if (historyMenuOpen.value === 'forward' && !options.topbarPort.containsHistoryMenuTarget('forward', target)) {
      closeHistoryMenu()
    }
  }

  function dispose() {
    cancelHistoryLongPress()
  }

  onScopeDispose(dispose)

  return {
    historyMenuOpen,
    historyMenuStyle,
    closeHistoryMenu,
    openHistoryMenu,
    onHistoryButtonPointerDown,
    cancelHistoryLongPress,
    onHistoryButtonContextMenu,
    shouldConsumeHistoryButtonClick,
    onWindowResize,
    onGlobalPointerDown,
    dispose
  }
}
