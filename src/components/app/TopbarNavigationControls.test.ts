import { createApp, defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import TopbarNavigationControls from './TopbarNavigationControls.vue'

function mountHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(TopbarNavigationControls, {
          canGoBack: true,
          canGoForward: true,
          backShortcutLabel: 'Cmd+[',
          forwardShortcutLabel: 'Cmd+]',
          homeShortcutLabel: 'Cmd+Shift+H',
          hasWorkspace: true,
          rightPaneVisible: false,
          historyMenuOpen: 'back',
          historyMenuStyle: {},
          backItems: [{ index: 1, key: 'back-1', label: 'notes/a.md' }],
          forwardItems: [],
          paneCount: 1,
          overflowMenuOpen: false,
          indexingState: 'indexed',
          zoomPercentLabel: '100%',
          themePreference: 'system',
          onHistoryButtonClick: (side: 'back' | 'forward') => events.push(`history:${side}`),
          onHistoryTargetClick: (index: number) => events.push(`target:${index}`),
          onOpenToday: () => events.push('today'),
          onOpenCosmos: () => events.push('cosmos'),
          onOpenSecondBrain: () => events.push('second-brain'),
          onToggleRightPane: () => events.push('toggle-right'),
          onToggleOverflow: () => events.push('toggle-overflow'),
          onHistoryButtonContextMenu: () => {},
          onHistoryButtonPointerDown: () => {},
          onHistoryLongPressCancel: () => {},
          onSplitRight: () => {},
          onSplitDown: () => {},
          onFocusPane: () => {},
          onFocusNext: () => {},
          onMoveTabNext: () => {},
          onClosePane: () => {},
          onJoinPanes: () => {},
          onResetLayout: () => {},
          onOpenCommandPalette: () => {},
          onOpenShortcuts: () => {},
          onOpenSettings: () => {},
          onRebuildIndex: () => {},
          onCloseWorkspace: () => {},
          onZoomIn: () => {},
          onZoomOut: () => {},
          onResetZoom: () => {},
          onSetTheme: () => {}
        })
    }
  }))

  app.mount(root)
  return { app, root, events }
}

describe('TopbarNavigationControls', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('emits history and primary toolbar actions', () => {
    const mounted = mountHarness()

    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Back (Cmd+[)"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('.history-menu-item')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Home: today note (Cmd+Shift+H)"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Cosmos view"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Second Brain"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="View options"]')?.click()

    expect(mounted.events).toEqual([
      'history:back',
      'target:1',
      'today',
      'cosmos',
      'second-brain',
      'toggle-overflow'
    ])

    mounted.app.unmount()
  })
})
