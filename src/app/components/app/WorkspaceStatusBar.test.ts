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
          activeFileLabel: 'notes/test.md',
          activeStateLabel: 'saved',
          indexStateLabel: 'indexed',
          indexStateClass: 'status-item-indexed',
          signalSummary: {
            path: 'notes/test.md',
            spellcheckEnabled: true,
            findActive: true,
            spellcheckCount: 2,
            findCount: 3,
            linkCount: 1
          },
          onOpenIndexStatus: () => events.push('open-index-status'),
          onNavigateSignal: (payload: { kind: string; direction: number }) => events.push(`${payload.kind}:${payload.direction}`)
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

  it('moves backward on shift-click', () => {
    const mounted = mountHarness()
    mounted.root.querySelector<HTMLButtonElement>('.status-signal--link')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))

    expect(mounted.events).toEqual(['link:-1'])

    mounted.app.unmount()
  })
})
