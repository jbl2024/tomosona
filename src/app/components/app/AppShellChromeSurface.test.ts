import { createApp, defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import AppShellChromeSurface, { type AppShellChromeSurfaceExposed } from './AppShellChromeSurface.vue'

function mountHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const events: string[] = []
  const chrome = ref<AppShellChromeSurfaceExposed | null>(null)

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(AppShellChromeSurface, {
          ref: chrome,
          canGoBack: true,
          canGoForward: true,
          backShortcutLabel: 'Alt+Left',
          forwardShortcutLabel: 'Alt+Right',
          homeShortcutLabel: 'Cmd+H',
          commandPaletteShortcutLabel: 'Cmd+P',
          hasWorkspace: true,
          sidebarVisible: true,
          rightPaneVisible: true,
          historyMenuOpen: 'back',
          historyMenuStyle: {},
          backItems: [{ index: 1, key: 'back-1', label: 'notes/a.md' }],
          forwardItems: [],
          paneCount: 2,
          overflowMenuOpen: false,
          indexingState: 'indexed',
          zoomPercentLabel: '100%',
          activeThemeLabel: 'System',
          showDebugTools: true,
          onHistoryButtonClick: (side: string) => events.push(`history:${side}`),
          onHistoryButtonContextMenu: (side: string) => events.push(`context:${side}`),
          onHistoryButtonPointerDown: (side: string) => events.push(`pointer:${side}`),
          onHistoryLongPressCancel: () => events.push('cancel-long-press'),
          onHistoryTargetClick: (index: number) => events.push(`target:${index}`),
          onOpenToday: () => events.push('today'),
          onOpenCosmos: () => events.push('cosmos'),
          onOpenSecondBrain: () => events.push('second-brain'),
          onSplitRight: () => events.push('split-right'),
          onSplitDown: () => events.push('split-down'),
          onFocusPane: (index: number) => events.push(`focus:${index}`),
          onFocusNext: () => events.push('focus-next'),
          onMoveTabNext: () => events.push('move-tab-next'),
          onClosePane: () => events.push('close-pane'),
          onJoinPanes: () => events.push('join-panes'),
          onResetLayout: () => events.push('reset-layout'),
          onToggleSidebar: () => events.push('toggle-sidebar'),
          onToggleRightPane: () => events.push('toggle-right'),
          onToggleOverflow: () => events.push('toggle-overflow'),
          onOpenCommandPalette: () => events.push('open-command-palette'),
          onOpenShortcuts: () => events.push('open-shortcuts'),
          onOpenAbout: () => events.push('open-about'),
          onOpenSettings: () => events.push('open-settings'),
          onOpenDesignSystemDebug: () => events.push('open-debug'),
          onRebuildIndex: () => events.push('rebuild-index'),
          onCloseWorkspace: () => events.push('close-workspace'),
          onZoomIn: () => events.push('zoom-in'),
          onZoomOut: () => events.push('zoom-out'),
          onResetZoom: () => events.push('reset-zoom'),
          onOpenThemePicker: () => events.push('open-theme-picker')
        })
    }
  }))

  app.mount(root)
  return { app, root, events, chrome }
}

describe('AppShellChromeSurface', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('forwards topbar and status interactions and exposes history anchors', () => {
    const mounted = mountHarness()

    expect(mounted.chrome.value?.getHistoryButtonEl('back')).toBeInstanceOf(HTMLElement)

    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Hide sidebar"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Back (Alt+Left)"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('.history-menu-item')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Search or type a command (Cmd+P)"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="View options"]')?.click()

    expect(mounted.events).toEqual([
      'toggle-sidebar',
      'history:back',
      'target:1',
      'open-command-palette',
      'toggle-overflow'
    ])

    mounted.app.unmount()
  })
})
