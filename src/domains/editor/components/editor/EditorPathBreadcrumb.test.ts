import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EditorPathBreadcrumb from './EditorPathBreadcrumb.vue'

type SegmentAction = { kind: 'folder' | 'document'; path: string; action: 'reveal' | 'copy-link' }

/** Captures the observer callback so a test can drive the overflow measurement. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  readonly callback: () => void

  constructor(callback: () => void) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }

  observe() {}
  unobserve() {}
  disconnect() {}

  trigger() {
    this.callback()
  }
}

function mountBreadcrumb(initialPath: string, workspacePath = '/vault') {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const path = ref(initialPath)
  const actions: SegmentAction[] = []

  const app = createApp(defineComponent({
    setup() {
      return () => h(EditorPathBreadcrumb, {
        path: path.value,
        workspacePath,
        onSegmentAction: (payload: SegmentAction) => actions.push(payload)
      })
    }
  }))
  app.mount(root)

  const breadcrumb = () => root.querySelector<HTMLElement>('.editor-path')
  const segments = () => Array.from(root.querySelectorAll<HTMLButtonElement>('.editor-path-segment'))
  const menuItems = () => Array.from(root.querySelectorAll<HTMLButtonElement>('.editor-path-menu-item'))

  return { app, root, path, actions, breadcrumb, segments, menuItems }
}

/** jsdom reports zero layout, so overflow has to be simulated explicitly. */
function setScrollMetrics(element: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(element, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(element, 'clientWidth', { value: clientWidth, configurable: true })
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeResizeObserver.instances = []
  document.body.innerHTML = ''
})

describe('EditorPathBreadcrumb', () => {
  it('splits a nested path into focusable folder and document segments', async () => {
    const mounted = mountBreadcrumb('/vault/Projets/AsciiArts.md')
    await nextTick()

    expect(mounted.segments().map((segment) => segment.textContent?.trim())).toEqual(['Projets', 'AsciiArts'])
    expect(mounted.segments().map((segment) => segment.dataset.segmentKind)).toEqual(['folder', 'document'])
    for (const segment of mounted.segments()) {
      expect(segment.tagName).toBe('BUTTON')
      expect(segment.getAttribute('type')).toBe('button')
    }

    mounted.app.unmount()
  })

  it('exposes the complete path on hover and keeps it in sync with the document', async () => {
    const mounted = mountBreadcrumb('/vault/deep/folder/Note.md')
    await nextTick()

    expect(mounted.breadcrumb()?.getAttribute('title')).toBe('deep/folder/Note.md')
    expect(mounted.breadcrumb()?.getAttribute('aria-label')).toBe('File location: deep/folder/Note.md')

    mounted.path.value = '/vault/deep/folder/Renamed.md'
    await nextTick()

    expect(mounted.breadcrumb()?.getAttribute('title')).toBe('deep/folder/Renamed.md')
    expect(mounted.segments().map((segment) => segment.textContent?.trim())).toEqual(['deep', 'folder', 'Renamed'])

    mounted.app.unmount()
  })

  it('reveals a folder segment without touching the active document', async () => {
    const mounted = mountBreadcrumb('/vault/Projets/AsciiArts.md')
    await nextTick()

    mounted.segments()[0].click()

    expect(mounted.actions).toEqual([{ kind: 'folder', path: '/vault/Projets', action: 'reveal' }])
    expect(mounted.path.value).toBe('/vault/Projets/AsciiArts.md')

    mounted.app.unmount()
  })

  it('offers the document actions from the document segment', async () => {
    const mounted = mountBreadcrumb('/vault/Projets/AsciiArts.md')
    await nextTick()

    mounted.segments()[1].click()
    await nextTick()

    expect(mounted.menuItems().map((item) => item.textContent?.trim())).toEqual([
      'Reveal in explorer',
      'Copy note link'
    ])

    mounted.menuItems()[1].click()
    expect(mounted.actions).toEqual([{ kind: 'document', path: '/vault/Projets/AsciiArts.md', action: 'copy-link' }])

    mounted.app.unmount()
  })

  it('opens the segment actions on right-click for both segment kinds', async () => {
    const mounted = mountBreadcrumb('/vault/Projets/AsciiArts.md')
    await nextTick()

    mounted.segments()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await nextTick()
    expect(mounted.menuItems().map((item) => item.textContent?.trim())).toEqual(['Reveal in explorer'])
    mounted.menuItems()[0].click()
    expect(mounted.actions).toEqual([{ kind: 'folder', path: '/vault/Projets', action: 'reveal' }])

    mounted.segments()[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await nextTick()
    expect(mounted.menuItems().map((item) => item.textContent?.trim())).toEqual([
      'Reveal in explorer',
      'Copy note link'
    ])

    mounted.app.unmount()
  })

  it('condenses intermediate segments into an ellipsis that reveals them', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const mounted = mountBreadcrumb('/vault/Connaissances/Methodes/Organisation/Notes atomiques.md')
    await nextTick()
    expect(mounted.segments().map((segment) => segment.textContent?.trim())).toEqual([
      'Connaissances',
      'Methodes',
      'Organisation',
      'Notes atomiques'
    ])

    setScrollMetrics(mounted.breadcrumb()!, 400, 120)
    FakeResizeObserver.instances[0]?.trigger()
    await nextTick()

    const labels = mounted.segments().map((segment) => segment.textContent?.trim())
    expect(labels).toEqual(['Connaissances', '…', 'Notes atomiques'])

    mounted.segments()[1].click()
    await nextTick()
    expect(mounted.menuItems().map((item) => item.textContent?.trim())).toEqual(['Methodes', 'Organisation'])

    mounted.menuItems()[1].click()
    expect(mounted.actions).toEqual([
      { kind: 'folder', path: '/vault/Connaissances/Methodes/Organisation', action: 'reveal' }
    ])

    mounted.app.unmount()
  })

  it('never renders an editable field for a segment', async () => {
    const mounted = mountBreadcrumb('/vault/Projets/AsciiArts.md')
    await nextTick()

    mounted.segments()[0].click()
    mounted.segments()[1].click()
    await nextTick()

    expect(mounted.root.querySelector('input')).toBeNull()
    expect(mounted.root.querySelector('textarea')).toBeNull()
    expect(mounted.root.querySelector('[contenteditable="true"]')).toBeNull()

    mounted.app.unmount()
  })
})
