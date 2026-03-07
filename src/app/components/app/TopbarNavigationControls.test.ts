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
          commandPaletteShortcutLabel: 'Cmd+Shift+P',
          hasWorkspace: true,
          sidebarVisible: true,
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
          onOpenToday: () => events.push('home'),
          onOpenCosmos: () => events.push('cosmos'),
          onOpenSecondBrain: () => events.push('second-brain'),
          onToggleSidebar: () => events.push('toggle-sidebar'),
          onToggleRightPane: () => events.push('toggle-right'),
          onOpenCommandPalette: () => events.push('command-palette'),
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

    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Hide sidebar"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Back (Cmd+[)"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('.history-menu-item')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Home (Cmd+Shift+H)"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Search or type a command (Cmd+Shift+P)"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Cosmos view"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Second Brain"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="View options"]')?.click()

    expect(mounted.events).toEqual([
      'toggle-sidebar',
      'history:back',
      'target:1',
      'home',
      'command-palette',
      'cosmos',
      'second-brain',
      'toggle-overflow'
    ])

    mounted.app.unmount()
  })
})
