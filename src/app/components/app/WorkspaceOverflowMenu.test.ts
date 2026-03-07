import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import WorkspaceOverflowMenu from './WorkspaceOverflowMenu.vue'

function mountHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const open = ref(true)
  const theme = ref<'light' | 'dark' | 'system'>('system')
  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(WorkspaceOverflowMenu, {
          open: open.value,
          hasWorkspace: true,
          indexingState: 'indexed',
          zoomPercentLabel: '100%',
          themePreference: theme.value,
          onToggle: () => events.push('toggle'),
          onOpenCommandPalette: () => events.push('palette'),
          onOpenShortcuts: () => events.push('shortcuts'),
          onOpenSettings: () => events.push('settings'),
          onRebuildIndex: () => events.push('rebuild'),
          onCloseWorkspace: () => events.push('close-workspace'),
          onZoomIn: () => events.push('zoom-in'),
          onZoomOut: () => events.push('zoom-out'),
          onResetZoom: () => events.push('zoom-reset'),
          onSetTheme: (value: 'light' | 'dark' | 'system') => {
            theme.value = value
            events.push(`theme:${value}`)
          }
        })
    }
  }))

  app.mount(root)
  return { app, root, events, theme }
}

describe('WorkspaceOverflowMenu', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('emits menu actions and theme changes', async () => {
    const mounted = mountHarness()
    const buttons = mounted.root.querySelectorAll<HTMLButtonElement>('.overflow-item')

    buttons[0]?.click()
    buttons[5]?.click()
    buttons[8]?.click()
    await nextTick()

    expect(mounted.events).toEqual(['palette', 'zoom-in', 'theme:light'])
    expect(mounted.theme.value).toBe('light')

    mounted.app.unmount()
  })
})
