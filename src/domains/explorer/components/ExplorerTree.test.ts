import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExplorerTree from './ExplorerTree.vue'
import type { TreeNode } from '../../../shared/api/apiTypes'
import { openPathExternal } from '../../../shared/api/workspaceApi'

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
  isTextFile: vi.fn(async (path: string) => /\.(txt|text|md|markdown|ts|tsx|js|jsx|vue|css|scss|sass|less|cpp|c|h|hpp|rs|py|go|java|kt|sh|bash|zsh|fish|desktop)$/i.test(path) || !/\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|tar|gz|bz2|xz|7z|rar|docx?|xlsx?|pptx?|odt|ods|odp|epub|mp3|wav|flac|aac|ogg|m4a|mp4|mkv|mov|avi|webm|exe|dll|so|dylib|bin|iso|woff2?|ttf|otf|eot)$/i.test(path)),
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

function binaryNode(path: string): TreeNode {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: false,
    is_markdown: false,
    has_children: false
  }
}

async function mountHarness(initialActivePath = '/vault/a.md') {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const activePath = ref(initialActivePath)
  const explorerRef = ref<InstanceType<typeof ExplorerTree> | null>(null)
  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(ExplorerTree, {
          ref: explorerRef,
          folderPath: '/vault',
          activePath: activePath.value,
          onOpen: (path: string) => events.push(`open:${path}`),
          onSelect: () => {},
          onError: () => {},
          onPathRenamed: () => {},
          onRequestCreate: () => {},
          onToggleContext: () => {},
          onConvertToWord: (path: string) => events.push(path)
        })
    }
  }))

  app.mount(root)
  await nextTick()
  await nextTick()

  return { app, root, activePath, explorerRef, events }
}

describe('ExplorerTree', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    class MockIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    Object.defineProperty(window, 'IntersectionObserver', {
      value: MockIntersectionObserver,
      writable: true,
      configurable: true
    })
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      value: MockIntersectionObserver,
      writable: true,
      configurable: true
    })
  })

  afterEach(() => {
    vi.useRealTimers()
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
      behavior: 'smooth'
    })
    rectSpy.mockRestore()

    mounted.app.unmount()
  })

  it('keeps file-targeted actions enabled on row context menu', async () => {
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [fileNode('/vault/a.md')]
      }
      return []
    })

    const mounted = await mountHarness('/vault/a.md')
    const row = mounted.root.querySelector('[data-explorer-path="/vault/a.md"]') as HTMLElement
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 80 }))
    await nextTick()

    const openExternalButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Open externally'
    ) as HTMLButtonElement | undefined

    expect(openExternalButton).toBeDefined()
    expect(openExternalButton?.disabled).toBe(false)

    openExternalButton?.click()
    await nextTick()

    expect(openPathExternal).toHaveBeenCalledWith('/vault/a.md')

    mounted.app.unmount()
  })

  it('emits convert to Word from the explorer context menu', async () => {
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [fileNode('/vault/a.md')]
      }
      return []
    })

    const mounted = await mountHarness('/vault/a.md')
    const row = mounted.root.querySelector('[data-explorer-path="/vault/a.md"]') as HTMLElement
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 80 }))
    await nextTick()

    const convertButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Convert to Word'
    ) as HTMLButtonElement | undefined

    expect(convertButton).toBeDefined()
    convertButton?.click()
    await nextTick()

    expect(mounted.events).toEqual(['/vault/a.md'])

    mounted.app.unmount()
  })

  it('opens non-markdown files in-app on single click', async () => {
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [binaryNode('/vault/photo.png')]
      }
      return []
    })

    const mounted = await mountHarness('/vault/photo.png')
    const row = mounted.root.querySelector('[data-explorer-path="/vault/photo.png"]') as HTMLElement
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await nextTick()

    expect(mounted.events).toEqual(['open:/vault/photo.png'])

    mounted.app.unmount()
  })

  it('opens non-markdown files natively on double click', async () => {
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [binaryNode('/vault/photo.png')]
      }
      return []
    })

    const mounted = await mountHarness('/vault/photo.png')
    const row = mounted.root.querySelector('[data-explorer-path="/vault/photo.png"]') as HTMLElement
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await nextTick()

    expect(openPathExternal).toHaveBeenCalledWith('/vault/photo.png')
    expect(mounted.events).toEqual([])

    mounted.app.unmount()
  })

  it('opens editable text files in-app on double click', async () => {
    vi.mocked(openPathExternal).mockClear()
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [
          {
            name: 'test.txt',
            path: '/vault/test.txt',
            is_dir: false,
            is_markdown: false,
            has_children: false
          }
        ]
      }
      return []
    })

    const mounted = await mountHarness('/vault/test.txt')
    const row = mounted.root.querySelector('[data-explorer-path="/vault/test.txt"]') as HTMLElement
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await nextTick()

    expect(openPathExternal).not.toHaveBeenCalled()
    expect(mounted.events).toEqual(['open:/vault/test.txt'])

    mounted.app.unmount()
  })

  it('opens generic source files in-app on double click', async () => {
    vi.mocked(openPathExternal).mockClear()
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [
          {
            name: 'main.ts',
            path: '/vault/main.ts',
            is_dir: false,
            is_markdown: false,
            has_children: false
          }
        ]
      }
      return []
    })

    const mounted = await mountHarness('/vault/main.ts')
    const row = mounted.root.querySelector('[data-explorer-path="/vault/main.ts"]') as HTMLElement
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await nextTick()

    expect(openPathExternal).not.toHaveBeenCalled()
    expect(mounted.events).toEqual(['open:/vault/main.ts'])

    mounted.app.unmount()
  })

  it('debounces fuzzy filtering and keeps ancestor rows for matches', async () => {
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [
          {
            name: 'features',
            path: '/vault/features',
            is_dir: true,
            is_markdown: false,
            has_children: true
          },
          fileNode('/vault/inbox.md')
        ]
      }
      if (dirPath === '/vault/features') {
        return [fileNode('/vault/features/related.md')]
      }
      return []
    })

    const mounted = await mountHarness('/vault/inbox.md')
    const toggleButton = mounted.root.querySelector('button[aria-label="Toggle filter"]') as HTMLButtonElement
    toggleButton.click()
    await nextTick()
    const input = mounted.root.querySelector('input[placeholder="Filter files and folders..."]') as HTMLInputElement

    input.value = 'rel'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    expect(mounted.root.querySelector('[data-explorer-path="/vault/features/related.md"]')).toBeNull()

    await vi.advanceTimersByTimeAsync(180)
    await nextTick()
    await nextTick()

    expect(mounted.root.querySelector('[data-explorer-path="/vault/features"]')).toBeTruthy()
    expect(mounted.root.querySelector('[data-explorer-path="/vault/features/related.md"]')).toBeTruthy()
    expect(mounted.root.querySelector('[data-explorer-path="/vault/inbox.md"]')).toBeNull()

    mounted.app.unmount()
  })

  it('toggles the filter field from the toolbar and keeps it open while text exists', async () => {
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [fileNode('/vault/a.md')]
      }
      return []
    })

    const mounted = await mountHarness('/vault/a.md')
    const toggleButton = mounted.root.querySelector('button[aria-label="Toggle filter"]') as HTMLButtonElement

    expect(mounted.root.querySelector('input[placeholder="Filter files and folders..."]')).toBeNull()

    toggleButton.click()
    await nextTick()

    const input = mounted.root.querySelector('input[placeholder="Filter files and folders..."]') as HTMLInputElement
    expect(input).toBeTruthy()

    input.value = 'a'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    toggleButton.click()
    await nextTick()

    expect(mounted.root.querySelector('input[placeholder="Filter files and folders..."]')).toBeTruthy()

    mounted.app.unmount()
  })

  it('clears the filter from the inline clear button', async () => {
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [fileNode('/vault/a.md')]
      }
      return []
    })

    const mounted = await mountHarness('/vault/a.md')
    const toggleButton = mounted.root.querySelector('button[aria-label="Toggle filter"]') as HTMLButtonElement

    toggleButton.click()
    await nextTick()

    const input = mounted.root.querySelector('input[placeholder="Filter files and folders..."]') as HTMLInputElement
    input.value = 'abc'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    const clearButton = mounted.root.querySelector('button[aria-label="Clear filter"]') as HTMLButtonElement
    expect(clearButton).toBeTruthy()

    clearButton.click()
    await nextTick()

    expect(input.value).toBe('')
    expect(mounted.root.querySelector('button[aria-label="Clear filter"]')).toBeNull()

    mounted.app.unmount()
  })
})
