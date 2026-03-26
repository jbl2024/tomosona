import { createApp, defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import WorkspaceStatusBar from './WorkspaceStatusBar.vue'

function mountHarness(spellcheckEnabled = false) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(WorkspaceStatusBar, {
          activeFileLabel: 'notes/test.md',
          activeStateLabel: 'saved',
          indexStateLabel: 'indexed',
          indexStateClass: 'status-item-indexed',
          workspaceLabel: '/workspace',
          spellcheckEnabled,
          onOpenIndexStatus: () => events.push('open-index-status'),
          onToggleSpellcheck: () => events.push('toggle-spellcheck')
        })
    }
  }))

  app.mount(root)
  return { app, root, events }
}

describe('WorkspaceStatusBar', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the global spellcheck toggle and emits clicks', () => {
    const mounted = mountHarness(false)
    const spellcheckButton = mounted.root.querySelector<HTMLButtonElement>('[aria-label="Toggle spellcheck"]')

    expect(spellcheckButton).toBeTruthy()
    expect(spellcheckButton?.textContent).toContain('spellcheck: off')
    expect(spellcheckButton?.querySelector('svg')).toBeTruthy()

    spellcheckButton?.click()

    expect(mounted.events).toEqual(['toggle-spellcheck'])

    mounted.app.unmount()
  })

  it('shows the enabled state with a pulsing accent', () => {
    const mounted = mountHarness(true)
    const spellcheckButton = mounted.root.querySelector<HTMLButtonElement>('[aria-label="Toggle spellcheck"]')

    expect(spellcheckButton?.textContent).toContain('spellcheck: on')
    expect(spellcheckButton?.classList.contains('status-item-spellcheck--on')).toBe(true)
    expect(spellcheckButton?.querySelector('.status-spellcheck-icon--on')).toBeTruthy()

    mounted.app.unmount()
  })
})
