import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import WorkspaceOverflowMenu from './WorkspaceOverflowMenu.vue'

function mountHarness(showDebugTools = false) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const open = ref(true)
  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(WorkspaceOverflowMenu, {
          open: open.value,
          hasWorkspace: true,
          indexingState: 'indexed',
          zoomPercentLabel: '100%',
          activeThemeLabel: 'System (Tomosona Light)',
          showDebugTools,
          onToggle: () => events.push('toggle'),
          onOpenCommandPalette: () => events.push('palette'),
          onOpenShortcuts: () => events.push('shortcuts'),
          onOpenAbout: () => events.push('about'),
          onOpenSettings: () => events.push('settings'),
          onOpenDesignSystemDebug: () => events.push('design-system'),
          onRebuildIndex: () => events.push('rebuild'),
          onCloseWorkspace: () => events.push('close-workspace'),
          onZoomIn: () => events.push('zoom-in'),
          onZoomOut: () => events.push('zoom-out'),
          onResetZoom: () => events.push('zoom-reset'),
          onOpenThemePicker: () => events.push('theme-picker')
        })
    }
  }))

  app.mount(root)
  return { app, root, events }
}

describe('WorkspaceOverflowMenu', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('emits menu actions and theme changes', async () => {
    const mounted = mountHarness()
    const buttons = mounted.root.querySelectorAll<HTMLButtonElement>('.overflow-item')

    Array.from(buttons).find((button) => button.textContent?.includes('Command palette'))?.click()
    Array.from(buttons).find((button) => button.textContent?.includes('About'))?.click()
    Array.from(buttons).find((button) => button.textContent?.includes('Zoom in'))?.click()
    Array.from(buttons).find((button) => button.textContent?.includes('Theme picker'))?.click()
    await nextTick()

    expect(mounted.events).toEqual(['palette', 'about', 'zoom-in', 'theme-picker'])
    expect(Array.from(buttons).find((button) => button.textContent?.includes('Command palette'))?.querySelector('svg')).toBeNull()
    expect(Array.from(buttons).find((button) => button.textContent?.includes('Close workspace'))?.getAttribute('data-tone')).toBe('danger')
    expect(Array.from(buttons).find((button) => button.textContent?.includes('Command palette'))?.querySelector('.ui-menu-item-icon-spacer')).toBeTruthy()

    mounted.app.unmount()
  })

  it('shows the design-system debug entry only when enabled', async () => {
    const hidden = mountHarness(false)
    expect(hidden.root.textContent).not.toContain('Design system debug')
    hidden.app.unmount()

    const shown = mountHarness(true)
    const debugButton = Array.from(shown.root.querySelectorAll<HTMLButtonElement>('.overflow-item'))
      .find((button) => button.textContent?.includes('Design system debug'))

    debugButton?.click()
    await nextTick()

    expect(debugButton).toBeTruthy()
    expect(shown.events).toContain('design-system')
    shown.app.unmount()
  })
})
