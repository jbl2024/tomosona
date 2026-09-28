import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  nextSession: 1,
  closedHandler: null as null | ((closed: { session_id: string }) => void),
  startTerminalSession: vi.fn(async () => `terminal-test-${mocks.nextSession++}`)
}))

vi.mock('../../../shared/api/terminalApi', () => ({
  closeTerminalSession: vi.fn(async () => {}),
  listenTerminalClosed: vi.fn(async (handler) => {
    mocks.closedHandler = handler
    return () => { mocks.closedHandler = null }
  }),
  listenTerminalOutput: vi.fn(async () => () => {}),
  resizeTerminalSession: vi.fn(async () => {}),
  startTerminalSession: mocks.startTerminalSession,
  writeTerminalSession: vi.fn(async () => {})
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { fit() {} }
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options = {}
    loadAddon() {}
    open() {}
    writeln() {}
    onData() {}
    focus() {}
    dispose() {}
    write() {}
  }
}))

import IntegratedTerminalPanel from './IntegratedTerminalPanel.vue'

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: ResizeObserverMock })

function mountHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const visible = ref(true)
  const app = createApp(defineComponent({
    setup() {
      return () => h(IntegratedTerminalPanel, {
        visible: visible.value,
        workspacePath: '/vault',
        currentFilePath: '/vault/notes/today.md',
        colorScheme: 'dark',
        preferences: { fontFamily: 'SF Mono', fontSize: 13, lineHeight: 1.2, letterSpacing: 0, cursorStyle: 'block', cursorBlink: true, scrollback: 5000 },
        onClose: () => { visible.value = false }
      })
    }
  }))
  app.mount(root)
  return { app, root }
}

describe('IntegratedTerminalPanel', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
    mocks.nextSession = 1
    mocks.closedHandler = null
  })

  it('creates a visible native terminal tab from the add button', async () => {
    const mounted = mountHarness()
    await nextTick()
    await nextTick()

    const addButton = mounted.root.querySelector<HTMLButtonElement>('[aria-label="Nouveau terminal"]')
    expect(addButton).not.toBeNull()
    addButton?.click()
    await nextTick()
    await nextTick()

    expect(mounted.root.querySelectorAll('.terminal-tab')).toHaveLength(2)
    expect(mocks.startTerminalSession).toHaveBeenCalledTimes(2)
    mounted.app.unmount()
  })

  it('removes the tab when its shell exits', async () => {
    const mounted = mountHarness()
    await vi.waitFor(() => expect(mocks.startTerminalSession).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(mocks.closedHandler).not.toBeNull())

    mocks.closedHandler?.({ session_id: 'terminal-test-1' })
    await vi.waitFor(() => expect(mounted.root.querySelectorAll('.terminal-tab')).toHaveLength(0))

    expect(mounted.root.querySelector<HTMLElement>('.integrated-terminal')?.style.display).toBe('none')
    mounted.app.unmount()
  })
})
