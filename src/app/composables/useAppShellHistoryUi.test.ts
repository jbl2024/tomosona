import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppShellHistoryUi } from './useAppShellHistoryUi'

function createHistoryUi() {
  const anchor = document.createElement('button')
  document.body.appendChild(anchor)
  Object.defineProperty(anchor, 'getBoundingClientRect', {
    value: () => ({
      left: 120,
      right: 160,
      top: 24,
      bottom: 48,
      width: 40,
      height: 24,
      x: 120,
      y: 24,
      toJSON: () => ({})
    })
  })

  const closeOverflowMenu = vi.fn()
  const scope = effectScope()
  const api = scope.run(() => useAppShellHistoryUi({
    topbarPort: {
      getHistoryButtonEl: () => anchor,
      containsOverflowTarget: (target) => target === anchor,
      containsHistoryMenuTarget: (side, target) => side === 'back' && target === anchor
    },
    closeOverflowMenu,
    canOpenMenu: () => true,
    getTargetCount: (side) => side === 'back' ? 4 : 2
  }))
  if (!api) throw new Error('Expected history UI controller')
  return { api, scope, closeOverflowMenu, anchor }
}

describe('useAppShellHistoryUi', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('opens and positions a history menu from the context menu', () => {
    const { api, scope, closeOverflowMenu } = createHistoryUi()
    const event = new MouseEvent('contextmenu', { bubbles: true })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() })

    api.onHistoryButtonContextMenu('back', event)

    expect(closeOverflowMenu).toHaveBeenCalled()
    expect(api.historyMenuOpen.value).toBe('back')
    expect(api.historyMenuStyle.value.position).toBe('fixed')
    scope.stop()
  })

  it('starts long-press opening on pointer down', async () => {
    vi.useFakeTimers()
    const { api, scope } = createHistoryUi()

    api.onHistoryButtonPointerDown('forward', { button: 0 } as PointerEvent)
    await vi.advanceTimersByTimeAsync(420)

    expect(api.historyMenuOpen.value).toBe('forward')
    scope.stop()
  })

  it('consumes the click that follows a long press', async () => {
    vi.useFakeTimers()
    const { api, scope } = createHistoryUi()

    api.onHistoryButtonPointerDown('back', { button: 0 } as PointerEvent)
    await vi.advanceTimersByTimeAsync(420)

    expect(api.shouldConsumeHistoryButtonClick('back')).toBe(true)
    expect(api.historyMenuOpen.value).toBe('back')
    scope.stop()
  })

  it('closes on outside pointer down', () => {
    const { api, scope } = createHistoryUi()
    api.openHistoryMenu('forward')

    const outside = document.createElement('div')
    document.body.appendChild(outside)
    const event = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(event, 'target', { value: outside })
    api.onGlobalPointerDown(event, true)

    expect(api.historyMenuOpen.value).toBeNull()
    scope.stop()
  })

  it('repositions the menu on window resize', () => {
    const { api, scope } = createHistoryUi()
    api.openHistoryMenu('back')
    const previousTop = api.historyMenuStyle.value.top

    api.onWindowResize()

    expect(api.historyMenuStyle.value.top).toBe(previousTop)
    scope.stop()
  })
})
