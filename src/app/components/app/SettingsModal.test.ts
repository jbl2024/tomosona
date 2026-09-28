import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import SettingsModal from './SettingsModal.vue'

const terminalPreferences = {
  fontFamily: 'SF Mono', fontSize: 13, lineHeight: 1.2, letterSpacing: 0,
  cursorStyle: 'block' as const, cursorBlink: true, scrollback: 5000
}

function mountHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const visible = ref(true)
  const updates: unknown[] = []
  const app = createApp(defineComponent({
    setup() {
      return () => h(SettingsModal, {
        visible: visible.value,
        themePreference: 'system',
        availableThemes: [{ id: 'tomosona-light', label: 'Tomosona Light', colorScheme: 'light', group: 'official' }],
        terminalPreferences,
        onClose: () => { visible.value = false },
        onUpdateTerminalPreferences: (value: unknown) => updates.push(value)
      })
    }
  }))
  app.mount(root)
  return { app, root, updates }
}

describe('SettingsModal', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('uses vertical sections and exposes terminal controls', async () => {
    const mounted = mountHarness()
    const buttons = mounted.root.querySelectorAll<HTMLButtonElement>('.settings-nav button')

    expect(Array.from(buttons).map((button) => button.textContent)).toEqual(['Appearance', 'Terminal'])
    buttons[1].click()
    await nextTick()

    expect(mounted.root.querySelector('#terminal-font-size')).not.toBeNull()
    expect(mounted.root.querySelector('.settings-content')).not.toBeNull()
    mounted.app.unmount()
  })
})
