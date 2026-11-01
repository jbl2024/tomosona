import { createApp, defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import WorkspaceStatusBar from './WorkspaceStatusBar.vue'

function mountHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(WorkspaceStatusBar, {
          activeFileLabel: 'test.md',
          activeStateLabel: 'saved',
          indexStateLabel: 'indexed',
          indexStateClass: 'status-item-indexed',
          spellcheckEnabled: true,
          signalSummary: {
            path: 'notes/test.md',
            spellcheckEnabled: true,
            findActive: true,
            spellcheckCount: 2,
            findCount: 3,
            linkCount: 1
          },
          onOpenIndexStatus: () => events.push('open-index-status'),
          onNavigateSignal: (payload: { kind: string; direction: number }) => events.push(`${payload.kind}:${payload.direction}`),
          onToggleSpellcheck: () => events.push('spellcheck:toggle')
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

  it('renders signal counters and advances on click', () => {
    const mounted = mountHarness()
    const spellingButton = mounted.root.querySelector<HTMLButtonElement>('.status-signal--spellcheck')
    const findButton = mounted.root.querySelector<HTMLButtonElement>('.status-signal--find')
    const linkButton = mounted.root.querySelector<HTMLButtonElement>('.status-signal--link')

    expect(spellingButton?.textContent).toContain('2 fautes')
    expect(findButton?.textContent).toContain('3 résultats')
    expect(linkButton?.textContent).toContain('1 link')

    spellingButton?.click()
    expect(mounted.events).toEqual(['spellcheck:1'])

    mounted.app.unmount()
  })

  it('disables spellcheck from the adjacent close button', () => {
    const mounted = mountHarness()
    mounted.root.querySelector<HTMLButtonElement>('.status-signal-dismiss')?.click()

    expect(mounted.events).toEqual(['spellcheck:toggle'])
    mounted.app.unmount()
  })

  it('moves backward on shift-click', () => {
    const mounted = mountHarness()
    mounted.root.querySelector<HTMLButtonElement>('.status-signal--link')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))

    expect(mounted.events).toEqual(['link:-1'])

    mounted.app.unmount()
  })

  it('shows the document name without repeating its path', () => {
    const mounted = mountHarness()
    const labels = Array.from(mounted.root.querySelectorAll('.status-item'))
      .map((item) => item.textContent?.trim() ?? '')

    expect(labels).toContain('test.md')
    expect(labels.some((label) => label.includes('/'))).toBe(false)

    mounted.app.unmount()
  })

  it('reports a failed save as operational information', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(defineComponent({
      setup() {
        return () => h(WorkspaceStatusBar, {
          activeFileLabel: 'test.md',
          activeStateLabel: 'editing',
          indexStateLabel: 'indexed',
          indexStateClass: 'status-item-indexed',
          spellcheckEnabled: true,
          saveError: 'disk is read-only',
          signalSummary: { path: 'notes/test.md', spellcheckEnabled: true, findActive: false, spellcheckCount: 0, findCount: 0, linkCount: 0 }
        })
      }
    }))

    app.mount(root)
    const error = root.querySelector<HTMLElement>('.status-item-error')
    expect(error?.textContent?.trim()).toBe('save failed')
    expect(error?.getAttribute('role')).toBe('alert')
    expect(error?.getAttribute('title')).toBe('disk is read-only')
    app.unmount()
  })

  it('shows an actionable disabled spellcheck state', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const toggles: string[] = []
    const app = createApp(defineComponent({
      setup() {
        return () => h(WorkspaceStatusBar, {
          activeFileLabel: 'test.md',
          activeStateLabel: 'saved',
          indexStateLabel: 'indexed',
          indexStateClass: 'status-item-indexed',
          spellcheckEnabled: false,
          signalSummary: { path: 'notes/test.md', spellcheckEnabled: false, findActive: false, spellcheckCount: 0, findCount: 0, linkCount: 0 },
          onToggleSpellcheck: () => toggles.push('toggle')
        })
      }
    }))

    app.mount(root)
    const button = root.querySelector<HTMLButtonElement>('.status-signal--spellcheck')
    expect(button?.textContent).toContain('spellcheck off')
    button?.click()
    expect(toggles).toEqual(['toggle'])
    app.unmount()
  })
})
