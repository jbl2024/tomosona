import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import MultiPaneToolbarMenu from './MultiPaneToolbarMenu.vue'

function mountHarness(props?: { canSplit?: boolean; paneCount?: number }) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(MultiPaneToolbarMenu, {
          canSplit: props?.canSplit ?? true,
          paneCount: props?.paneCount ?? 2,
          onSplitRight: () => events.push('split-right'),
          onSplitDown: () => events.push('split-down'),
          onFocusPane: (payload: { index: number }) => events.push(`focus:${payload.index}`),
          onFocusNext: () => events.push('focus-next'),
          onMoveTabNext: () => events.push('move-next'),
          onClosePane: () => events.push('close-pane'),
          onJoinPanes: () => events.push('join-panes'),
          onResetLayout: () => events.push('reset-layout')
        })
    }
  }))

  app.mount(root)
  return { app, root, events }
}

describe('MultiPaneToolbarMenu', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens the dropdown and emits pane actions', async () => {
    const mounted = mountHarness()

    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Multi-pane layout"]')?.click()
    await nextTick()

    const focusNext = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.multi-pane-item'))
      .find((button) => button.textContent?.includes('Focus Next Pane'))
    focusNext?.click()

    expect(mounted.events).toEqual(['focus-next'])

    mounted.app.unmount()
  })

  it('disables split and pane-navigation actions when unavailable', async () => {
    const mounted = mountHarness({ canSplit: false, paneCount: 1 })

    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Multi-pane layout"]')?.click()
    await nextTick()

    const labels = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('.multi-pane-item'))
      .map((button) => ({ label: button.textContent?.trim(), disabled: button.disabled }))

    expect(labels).toContainEqual({ label: 'Split Right', disabled: true })
    expect(labels).toContainEqual({ label: 'Split Down', disabled: true })
    expect(labels).toContainEqual({ label: 'Focus Next Pane', disabled: true })
    expect(labels).toContainEqual({ label: 'Move Tab to Next Pane', disabled: true })

    mounted.app.unmount()
  })

  it('closes the dropdown on outside click', async () => {
    const mounted = mountHarness()

    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Multi-pane layout"]')?.click()
    await nextTick()
    expect(mounted.root.querySelector('.multi-pane-dropdown')).toBeTruthy()

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()

    expect(mounted.root.querySelector('.multi-pane-dropdown')).toBeNull()
    mounted.app.unmount()
  })
})
