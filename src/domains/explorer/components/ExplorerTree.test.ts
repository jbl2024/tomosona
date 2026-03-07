import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExplorerTree from './ExplorerTree.vue'
import type { TreeNode } from '../../../shared/api/apiTypes'

const unlistenWorkspaceFsChanged = vi.fn()
const listChildren = vi.fn()

vi.mock('../../../shared/api/workspaceApi', () => ({
  copyEntry: vi.fn(),
  duplicateEntry: vi.fn(),
  listChildren: (...args: unknown[]) => listChildren(...args),
  listenWorkspaceFsChanged: vi.fn(async () => unlistenWorkspaceFsChanged),
  moveEntry: vi.fn(),
  openPathExternal: vi.fn(),
  pathExists: vi.fn(async () => true),
  renameEntry: vi.fn(),
  revealInFileManager: vi.fn(),
  trashEntry: vi.fn()
}))

function fileNode(path: string): TreeNode {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: false,
    is_markdown: true,
    has_children: false
  }
}

async function mountHarness(initialActivePath = '/vault/a.md') {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const activePath = ref(initialActivePath)
  const explorerRef = ref<InstanceType<typeof ExplorerTree> | null>(null)

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(ExplorerTree, {
          ref: explorerRef,
          folderPath: '/vault',
          activePath: activePath.value,
          onOpen: () => {},
          onSelect: () => {},
          onError: () => {},
          onPathRenamed: () => {},
          onRequestCreate: () => {},
          onToggleContext: () => {}
        })
    }
  }))

  app.mount(root)
  await nextTick()
  await nextTick()

  return { app, root, activePath, explorerRef }
}

describe('ExplorerTree', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    listChildren.mockReset()
    unlistenWorkspaceFsChanged.mockReset()
    document.body.innerHTML = ''
    window.localStorage.clear()
  })

  it('does not auto-scroll when the active row is already visible', async () => {
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [fileNode('/vault/a.md'), fileNode('/vault/b.md')]
      }
      return []
    })

    const mounted = await mountHarness('/vault/a.md')
    const tree = mounted.root.querySelector('[tabindex="0"]') as HTMLElement
    const scrollToSpy = vi.fn()

    Object.defineProperty(tree, 'scrollTop', { value: 40, writable: true, configurable: true })
    Object.defineProperty(tree, 'scrollTo', { value: scrollToSpy, configurable: true })
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === tree) {
        return { top: 100, bottom: 300 } as DOMRect
      }
      if (this instanceof HTMLElement && this.dataset.explorerPath === '/vault/b.md') {
        return { top: 140, bottom: 180 } as DOMRect
      }
      return { top: 0, bottom: 0 } as DOMRect
    })

    await mounted.explorerRef.value?.revealPathInView('/vault/b.md')

    expect(scrollToSpy).not.toHaveBeenCalled()
    rectSpy.mockRestore()

    mounted.app.unmount()
  })

  it('scrolls just enough when the active row is below the visible viewport', async () => {
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [fileNode('/vault/a.md'), fileNode('/vault/b.md')]
      }
      return []
    })

    const mounted = await mountHarness('/vault/a.md')
    const tree = mounted.root.querySelector('[tabindex="0"]') as HTMLElement
    const scrollToSpy = vi.fn()

    Object.defineProperty(tree, 'scrollTop', { value: 40, writable: true, configurable: true })
    Object.defineProperty(tree, 'scrollTo', { value: scrollToSpy, configurable: true })
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === tree) {
        return { top: 100, bottom: 300 } as DOMRect
      }
      if (this instanceof HTMLElement && this.dataset.explorerPath === '/vault/b.md') {
        return { top: 260, bottom: 340 } as DOMRect
      }
      return { top: 0, bottom: 0 } as DOMRect
    })

    await mounted.explorerRef.value?.revealPathInView('/vault/b.md')

    expect(scrollToSpy).toHaveBeenCalledWith({
      top: 80,
      behavior: 'auto'
    })
    rectSpy.mockRestore()

    mounted.app.unmount()
  })
})
