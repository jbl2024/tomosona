import { createApp, defineComponent, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useEditorPathWatchers } from './useEditorPathWatchers'

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

describe('useEditorPathWatchers', () => {
  it('increments request ids and loads current path on switch', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const path = ref('a.md')
    const openPaths = ref(['a.md'])
    const nextRequestId = vi.fn(() => 1)
    const loadCurrentFile = vi.fn(async () => {})

    const Harness = defineComponent({
      setup() {
        useEditorPathWatchers({
          path,
          openPaths,
          holder: ref(document.createElement('div')),
          currentPath: ref('a.md'),
          nextRequestId,
          ensureSession: vi.fn(() => ({ scrollTop: 0 } as any)),
          setActiveSession: vi.fn(),
          loadCurrentFile,
          captureCaret: vi.fn(),
          getSession: vi.fn(() => ({ scrollTop: 0 } as any)),
          getActivePath: vi.fn(() => 'a.md'),
          setActivePath: vi.fn(),
          clearActiveEditor: vi.fn(),
          listPaths: vi.fn(() => ['a.md']),
          closePath: vi.fn(),
          resetPropertySchemaState: vi.fn(),
          emitEmptyProperties: vi.fn(),
          closeSlashMenu: vi.fn(),
          closeWikilinkMenu: vi.fn(),
          closeBlockMenu: vi.fn(),
          hideTableToolbarAnchor: vi.fn(),
          emitEmptyOutline: vi.fn(),
          onMountInit: vi.fn(async () => {}),
          onUnmountCleanup: vi.fn(async () => {})
        })
        return () => null
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()

    path.value = 'b.md'
    await flushUi()

    expect(nextRequestId).toHaveBeenCalled()
    expect(loadCurrentFile).toHaveBeenCalledWith('b.md', { requestId: 1 })

    app.unmount()
    document.body.innerHTML = ''
  })

  it('resets transient UI and emits empty payloads when path clears', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const path = ref('a.md')
    const openPaths = ref(['a.md'])
    const setActivePath = vi.fn()
    const emitEmptyProperties = vi.fn()
    const emitEmptyOutline = vi.fn()
    const closeWikilinkMenu = vi.fn()

    const Harness = defineComponent({
      setup() {
        useEditorPathWatchers({
          path,
          openPaths,
          holder: ref(document.createElement('div')),
          currentPath: ref('a.md'),
          nextRequestId: vi.fn(() => 1),
          ensureSession: vi.fn(() => ({ scrollTop: 0 } as any)),
          setActiveSession: vi.fn(),
          loadCurrentFile: vi.fn(async () => {}),
          captureCaret: vi.fn(),
          getSession: vi.fn(() => ({ scrollTop: 0 } as any)),
          getActivePath: vi.fn(() => 'a.md'),
          setActivePath,
          clearActiveEditor: vi.fn(),
          listPaths: vi.fn(() => ['a.md']),
          closePath: vi.fn(),
          resetPropertySchemaState: vi.fn(),
          emitEmptyProperties,
          closeSlashMenu: vi.fn(),
          closeWikilinkMenu,
          closeBlockMenu: vi.fn(),
          hideTableToolbarAnchor: vi.fn(),
          emitEmptyOutline,
          onMountInit: vi.fn(async () => {}),
          onUnmountCleanup: vi.fn(async () => {})
        })
        return () => null
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()

    path.value = ''
    await flushUi()

    expect(setActivePath).toHaveBeenCalledWith('')
    expect(emitEmptyProperties).toHaveBeenCalled()
    expect(emitEmptyOutline).toHaveBeenCalled()
    expect(closeWikilinkMenu).toHaveBeenCalled()

    app.unmount()
    document.body.innerHTML = ''
  })

  it('closes sessions removed from openPaths except active path', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const path = ref('a.md')
    const openPaths = ref(['a.md', 'b.md'])
    const closePath = vi.fn()

    const Harness = defineComponent({
      setup() {
        useEditorPathWatchers({
          path,
          openPaths,
          holder: ref(document.createElement('div')),
          currentPath: ref('a.md'),
          nextRequestId: vi.fn(() => 1),
          ensureSession: vi.fn(() => ({ scrollTop: 0 } as any)),
          setActiveSession: vi.fn(),
          loadCurrentFile: vi.fn(async () => {}),
          captureCaret: vi.fn(),
          getSession: vi.fn(() => ({ scrollTop: 0 } as any)),
          getActivePath: vi.fn(() => 'a.md'),
          setActivePath: vi.fn(),
          clearActiveEditor: vi.fn(),
          listPaths: vi.fn(() => ['a.md', 'b.md', 'c.md']),
          closePath,
          resetPropertySchemaState: vi.fn(),
          emitEmptyProperties: vi.fn(),
          closeSlashMenu: vi.fn(),
          closeWikilinkMenu: vi.fn(),
          closeBlockMenu: vi.fn(),
          hideTableToolbarAnchor: vi.fn(),
          emitEmptyOutline: vi.fn(),
          onMountInit: vi.fn(async () => {}),
          onUnmountCleanup: vi.fn(async () => {})
        })
        return () => null
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()

    openPaths.value = ['a.md']
    await flushUi()

    expect(closePath).toHaveBeenCalledWith('b.md')
    expect(closePath).toHaveBeenCalledWith('c.md')
    expect(closePath).not.toHaveBeenCalledWith('a.md')

    app.unmount()
    document.body.innerHTML = ''
  })

  it('captures caret only when holder owns focus', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const path = ref('a.md')
    const openPaths = ref(['a.md', 'b.md'])
    const holderEl = document.createElement('div')
    const focusable = document.createElement('button')
    holderEl.appendChild(focusable)
    document.body.appendChild(holderEl)
    const captureCaret = vi.fn()

    const Harness = defineComponent({
      setup() {
        useEditorPathWatchers({
          path,
          openPaths,
          holder: ref(holderEl),
          currentPath: ref('a.md'),
          nextRequestId: vi.fn(() => 1),
          ensureSession: vi.fn(() => ({ scrollTop: 0 } as any)),
          setActiveSession: vi.fn(),
          loadCurrentFile: vi.fn(async () => {}),
          captureCaret,
          getSession: vi.fn(() => ({ scrollTop: 0 } as any)),
          getActivePath: vi.fn(() => 'a.md'),
          setActivePath: vi.fn(),
          clearActiveEditor: vi.fn(),
          listPaths: vi.fn(() => ['a.md', 'b.md']),
          closePath: vi.fn(),
          resetPropertySchemaState: vi.fn(),
          emitEmptyProperties: vi.fn(),
          closeSlashMenu: vi.fn(),
          closeWikilinkMenu: vi.fn(),
          closeBlockMenu: vi.fn(),
          hideTableToolbarAnchor: vi.fn(),
          emitEmptyOutline: vi.fn(),
          onMountInit: vi.fn(async () => {}),
          onUnmountCleanup: vi.fn(async () => {})
        })
        return () => null
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()

    path.value = 'b.md'
    await flushUi()
    expect(captureCaret).not.toHaveBeenCalled()

    focusable.focus()
    path.value = 'a.md'
    await flushUi()
    expect(captureCaret).toHaveBeenCalledWith('b.md')

    app.unmount()
    holderEl.remove()
    document.body.innerHTML = ''
  })
})
