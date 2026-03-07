import { createApp, defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EditorView from './EditorView.vue'

async function flushEditorUi() {
  await nextTick()
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0))
  await nextTick()
}

type HarnessControls = {
  path: Ref<string>
  openPaths: Ref<string[]>
}

function mountHarness(options: {
  controls: HarnessControls
  openFile: (path: string) => Promise<string>
}) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const editorRef = ref<unknown>(null)

  const Harness = defineComponent({
    setup() {
      return () =>
        h(EditorView, {
          ref: editorRef,
          path: options.controls.path.value,
          openPaths: options.controls.openPaths.value,
          openFile: options.openFile,
          saveFile: async () => ({ persisted: true }),
          renameFileFromTitle: async (path: string, title: string) => ({ path, title }),
          loadLinkTargets: async () => [],
          loadLinkHeadings: async () => [],
          loadPropertyTypeSchema: async () => ({}),
          savePropertyTypeSchema: async () => {},
          openLinkTarget: async () => false,
          onStatus: () => {},
          onOutline: () => {},
          onProperties: () => {},
          onPathRenamed: () => {}
        })
    }
  })

  const app = createApp(Harness)
  app.mount(root)

  return {
    app,
    root,
    editorRef
  }
}

function editorText(root: HTMLElement): string {
  const activePane = root.querySelector('.editor-session-pane[data-active="true"]')
  return (activePane?.querySelector('.ProseMirror')?.textContent ?? '')
}

function allEditorTexts(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('.ProseMirror')).map((el) => el.textContent ?? '')
}

function mountedSessionPaths(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('.editor-session-pane'))
    .map((el) => el.getAttribute('data-session-path') ?? '')
    .filter(Boolean)
}


describe('EditorView per-document sessions', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('switches between files and preserves per-file loaded session state', async () => {
    const controls: HarnessControls = {
      path: ref('a.md'),
      openPaths: ref(['a.md', 'b.md'])
    }

    const openFile = vi.fn(async (path: string) => {
      if (path === 'a.md') return '# A\n\nAlpha body'
      if (path === 'b.md') return '# B\n\nBeta body'
      return ''
    })

    const mounted = mountHarness({ controls, openFile })
    await flushEditorUi()

    expect(editorText(mounted.root)).toContain('Alpha body')

    controls.path.value = 'b.md'
    await flushEditorUi()
    expect(openFile).toHaveBeenCalledWith('b.md')
    expect(mountedSessionPaths(mounted.root)).toEqual(expect.arrayContaining(['a.md', 'b.md']))
    expect(allEditorTexts(mounted.root).length).toBeGreaterThanOrEqual(2)
    expect(editorText(mounted.root)).toContain('Beta body')

    controls.path.value = 'a.md'
    await flushEditorUi()
    expect(editorText(mounted.root)).toContain('Alpha body')

    expect(openFile).toHaveBeenCalledWith('a.md')
    expect(openFile).toHaveBeenCalledWith('b.md')
    expect(openFile.mock.calls.filter(([path]) => path === 'a.md')).toHaveLength(1)

    mounted.app.unmount()
  })

  it('keeps latest active file visible when load responses resolve out of order', async () => {
    const controls: HarnessControls = {
      path: ref('a.md'),
      openPaths: ref(['a.md', 'b.md'])
    }

    const pendingByPath = new Map<string, Array<(content: string) => void>>()
    const openFile = vi.fn((path: string) => new Promise<string>((resolve) => {
      const list = pendingByPath.get(path) ?? []
      list.push(resolve)
      pendingByPath.set(path, list)
    }))

    const mounted = mountHarness({ controls, openFile })
    await flushEditorUi()

    controls.path.value = 'b.md'
    await flushEditorUi()

    pendingByPath.get('b.md')?.shift()?.('# B\n\nBeta body')
    await flushEditorUi()
    expect(editorText(mounted.root)).toContain('Beta body')

    pendingByPath.get('a.md')?.shift()?.('# A\n\nAlpha body')
    await flushEditorUi()
    expect(editorText(mounted.root)).toContain('Beta body')

    mounted.app.unmount()
  })

  it('disposes closed-tab session and reloads when reopened', async () => {
    const controls: HarnessControls = {
      path: ref('a.md'),
      openPaths: ref(['a.md', 'b.md'])
    }

    const openFile = vi.fn(async (path: string) => {
      if (path === 'a.md') return '# A\n\nAlpha body'
      return '# B\n\nBeta body'
    })

    const mounted = mountHarness({ controls, openFile })
    await flushEditorUi()

    controls.path.value = 'b.md'
    await flushEditorUi()

    controls.openPaths.value = ['b.md']
    await flushEditorUi()
    expect(mountedSessionPaths(mounted.root)).not.toContain('a.md')

    controls.path.value = 'a.md'
    controls.openPaths.value = ['a.md', 'b.md']
    await flushEditorUi()

    expect(openFile.mock.calls.filter(([path]) => path === 'a.md')).toHaveLength(2)
    expect(editorText(mounted.root)).toContain('Alpha body')

    mounted.app.unmount()
  })

  it('ignores in-flight load when editor path is cleared', async () => {
    const controls: HarnessControls = {
      path: ref('a.md'),
      openPaths: ref(['a.md'])
    }

    const pendingResolvers: Array<(value: string) => void> = []
    const openFile = vi.fn((path: string) => new Promise<string>((resolve) => {
      if (path === 'a.md') {
        pendingResolvers.push((value: string) => resolve(value))
      }
    }))

    const mounted = mountHarness({ controls, openFile })
    await flushEditorUi()

    controls.path.value = ''
    controls.openPaths.value = []
    await flushEditorUi()

    pendingResolvers.shift()?.('# A\n\nAlpha body')
    await flushEditorUi()

    expect(editorText(mounted.root)).toBe('')
    expect(mounted.root.textContent ?? '').toContain('Open a file to start editing')

    mounted.app.unmount()
  })

  it('uses only latest request during rapid A->B->A switch', async () => {
    const controls: HarnessControls = {
      path: ref('a.md'),
      openPaths: ref(['a.md', 'b.md'])
    }

    const pendingByPath = new Map<string, Array<(content: string) => void>>()
    const openFile = vi.fn((path: string) => new Promise<string>((resolve) => {
      const list = pendingByPath.get(path) ?? []
      list.push(resolve)
      pendingByPath.set(path, list)
    }))

    const mounted = mountHarness({ controls, openFile })
    await flushEditorUi()

    controls.path.value = 'b.md'
    await flushEditorUi()
    controls.path.value = 'a.md'
    await flushEditorUi()

    pendingByPath.get('a.md')?.shift()?.('# A\n\nOld alpha')
    await flushEditorUi()
    expect(editorText(mounted.root)).not.toContain('Old alpha')

    pendingByPath.get('b.md')?.shift()?.('# B\n\nBeta body')
    await flushEditorUi()
    expect(editorText(mounted.root)).not.toContain('Beta body')

    pendingByPath.get('a.md')?.shift()?.('# A\n\nNewest alpha')
    await flushEditorUi()
    expect(editorText(mounted.root)).toContain('Newest alpha')

    mounted.app.unmount()
  })

  it('keeps active session alive when openPaths temporarily omits it', async () => {
    const controls: HarnessControls = {
      path: ref('a.md'),
      openPaths: ref(['a.md', 'b.md'])
    }

    const openFile = vi.fn(async (path: string) => {
      if (path === 'a.md') return '# A\n\nAlpha body'
      return '# B\n\nBeta body'
    })

    const mounted = mountHarness({ controls, openFile })
    await flushEditorUi()

    controls.path.value = 'b.md'
    await flushEditorUi()

    controls.openPaths.value = []
    await flushEditorUi()

    expect(editorText(mounted.root)).toContain('Beta body')
    expect(openFile.mock.calls.filter(([path]) => path === 'b.md')).toHaveLength(1)

    mounted.app.unmount()
  })

})
