import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import SettingsModal from './SettingsModal.vue'

const terminalPreferences = {
  fontFamily: 'SF Mono', fontSize: 13, lineHeight: 1.2, letterSpacing: 0,
  cursorStyle: 'block' as const, cursorBlink: true, scrollback: 5000
}

const editorPreferences = {
  cursorStyle: 'block' as const, cursorBlink: true
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
        editorPreferences,
        onClose: () => { visible.value = false },
        onUpdateTerminalPreferences: (value: unknown) => updates.push(value),
        onUpdateEditorPreferences: (value: unknown) => updates.push(value)
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

    expect(Array.from(buttons).map((button) => button.textContent)).toEqual(['Appearance', 'Editor', 'Terminal'])
    buttons[2].click()
    await nextTick()

    expect(mounted.root.querySelector('#terminal-font-size')).not.toBeNull()
    expect(mounted.root.querySelector('.settings-content')).not.toBeNull()
    mounted.app.unmount()
  })

  it('exposes editor cursor controls that emit preference updates', async () => {
    const mounted = mountHarness()
    const buttons = mounted.root.querySelectorAll<HTMLButtonElement>('.settings-nav button')

    buttons[1].click()
    await nextTick()

    const styleSelect = mounted.root.querySelector<HTMLSelectElement>('#editor-cursor-style')
    expect(styleSelect).not.toBeNull()
    styleSelect!.value = 'underline'
    styleSelect!.dispatchEvent(new Event('change'))
    await nextTick()

    const blinkToggle = mounted.root.querySelector<HTMLInputElement>('#editor-cursor-blink')
    expect(blinkToggle).not.toBeNull()
    blinkToggle!.checked = false
    blinkToggle!.dispatchEvent(new Event('change'))
    await nextTick()

    expect(mounted.updates).toContainEqual({ cursorStyle: 'underline' })
    expect(mounted.updates).toContainEqual({ cursorBlink: false })
    mounted.app.unmount()
  })
})
