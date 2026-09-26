import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MultiPaneLayout } from '../../composables/useMultiPaneWorkspaceState'
import type { WorkspaceFsChange } from '../../../shared/api/apiTypes'
import EditorPaneGrid from './EditorPaneGrid.vue'

const harnessState = vi.hoisted(() => ({
  tabsProps: [] as Array<{ paneId: string; activePane: boolean }>,
  surfaceProps: [] as Array<{
    paneId: string
    openDocumentPaths: string[]
    launchpadMode: string
    showExperience: boolean
    activeTabId: string | null
  }>,
    surfaceMethods: [] as Array<{
      paneId: string
      methods: {
        saveNow: ReturnType<typeof vi.fn>
        reloadCurrent: ReturnType<typeof vi.fn>
        applyWorkspaceFsChanges: ReturnType<typeof vi.fn>
        focusEditor: ReturnType<typeof vi.fn>
        revealSnippet: ReturnType<typeof vi.fn>
        revealOutlineHeading: ReturnType<typeof vi.fn>
        revealAnchor: ReturnType<typeof vi.fn>
        navigateSignal: ReturnType<typeof vi.fn>
        zoomIn: ReturnType<typeof vi.fn>
        zoomOut: ReturnType<typeof vi.fn>
        resetZoom: ReturnType<typeof vi.fn>
        getZoom: ReturnType<typeof vi.fn>
      }
    }>,
  emittedStatus: [] as Array<{ path: string; dirty: boolean; saving: boolean; saveError: string }>,
  emittedPaneFocus: [] as Array<{ paneId: string }>
}))

vi.mock('./EditorPaneTabs.vue', () => ({
  default: defineComponent({
    name: 'EditorPaneTabsStub',
    props: ['pane', 'isActivePane', 'getStatus'],
    emits: [
      'pane-focus',
      'tab-click',
      'tab-close',
      'tab-close-others',
      'tab-close-all',
      'request-move-tab'
    ],
    setup(props, { emit }) {
      harnessState.tabsProps.push({
        paneId: props.pane.id,
        activePane: Boolean(props.isActivePane)
      })

      return () =>
        h('div', { class: 'tabs-stub', 'data-pane-id': props.pane.id }, [
          h(
            'button',
            {
              class: 'tabs-stub-focus',
              onClick: () => emit('pane-focus', { paneId: props.pane.id })
            },
            'focus'
          ),
          h(
            'button',
            {
              class: 'tabs-stub-click',
              onClick: () => emit('tab-click', { paneId: props.pane.id, tabId: props.pane.openTabs[0]?.id ?? '' })
            },
            'click'
          )
        ])
    }
  })
}))

vi.mock('./PaneSurfaceHost.vue', () => ({
  default: defineComponent({
    name: 'PaneSurfaceHostStub',
    props: ['paneId', 'activeTab', 'openDocumentPaths', 'launchpad'],
    emits: ['status'],
    setup(props, { emit, expose }) {
      const methods = {
        saveNow: vi.fn(async () => {}),
        reloadCurrent: vi.fn(async () => {}),
        applyWorkspaceFsChanges: vi.fn(async () => {}),
        focusEditor: vi.fn(),
        revealSnippet: vi.fn(async () => {}),
        revealOutlineHeading: vi.fn(async () => {}),
        revealAnchor: vi.fn(async () => true),
        navigateSignal: vi.fn(),
        zoomIn: vi.fn(() => 2),
        zoomOut: vi.fn(() => 0.5),
        resetZoom: vi.fn(() => 1),
        getZoom: vi.fn(() => 1),
      }

      harnessState.surfaceProps.push({
        paneId: props.paneId,
        openDocumentPaths: [...props.openDocumentPaths],
        launchpadMode: props.launchpad.mode,
        showExperience: props.launchpad.showExperience,
        activeTabId: props.activeTab?.id ?? null
      })
      harnessState.surfaceMethods.push({ paneId: props.paneId, methods })
      expose(methods)

      return () =>
        h('div', { class: 'surface-stub', 'data-pane-id': props.paneId }, [
          h(
            'button',
            {
              class: 'surface-stub-status',
              onClick: () => emit('status', { path: `${props.paneId}.md`, dirty: true, saving: false, saveError: '' })
            },
            'status'
          )
        ])
    }
  })
}))

describe('EditorPaneGrid', () => {
  beforeEach(() => {
    harnessState.tabsProps.length = 0
    harnessState.surfaceProps.length = 0
    harnessState.surfaceMethods.length = 0
    harnessState.emittedStatus.length = 0
    harnessState.emittedPaneFocus.length = 0
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 106,
        bottom: 106,
        width: 106,
        height: 106,
        toJSON: () => ({})
      } as DOMRect
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('renders all panes, forwards child events, and drives resizer math', async () => {
    const layout = ref<MultiPaneLayout>({
      root: {
        kind: 'split',
        axis: 'column',
        ratio: 0.5,
        a: {
          kind: 'split',
          axis: 'row',
          ratio: 0.5,
          a: { kind: 'pane', paneId: 'pane-1' },
          b: { kind: 'pane', paneId: 'pane-2' }
        },
        b: {
          kind: 'split',
          axis: 'row',
          ratio: 0.5,
          a: { kind: 'pane', paneId: 'pane-3' },
          b: { kind: 'pane', paneId: 'pane-4' }
        }
      },
      panesById: {
        'pane-1': {
          id: 'pane-1',
          activeTabId: 'doc-1',
          openTabs: [
            { id: 'doc-1', type: 'document', path: 'notes/a.md', pinned: false },
            { id: 'home-1', type: 'home', pinned: false }
          ],
          activePath: 'notes/a.md'
        },
        'pane-2': {
          id: 'pane-2',
          activeTabId: 'second-brain-1',
          openTabs: [{ id: 'second-brain-1', type: 'second-brain-chat', pinned: false }],
          activePath: ''
        },
        'pane-3': {
          id: 'pane-3',
          activeTabId: 'home-1',
          openTabs: [{ id: 'home-1', type: 'home', pinned: false }],
          activePath: ''
        },
        'pane-4': {
          id: 'pane-4',
          activeTabId: 'home-2',
          openTabs: [{ id: 'home-2', type: 'home', pinned: false }],
          activePath: ''
        }
      },
      activePaneId: 'pane-1'
    })

    const gridRef = ref<any>(null)
    const emitted = {
      status: [] as Array<{ path: string; dirty: boolean; saving: boolean; saveError: string }>,
      paneFocus: [] as Array<{ paneId: string }>
    }

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorPaneGrid, {
            ref: gridRef,
            layout: layout.value,
            activeDocumentPath: 'notes/a.md',
            getStatus: (path: string) => ({
              dirty: path === 'notes/a.md',
              saving: false,
              saveError: ''
            }),
            renameFileFromTitle: async (path: string) => ({ path, title: 'title' }),
            loadLinkTargets: async () => [],
            loadLinkHeadings: async () => [],
            loadPropertyTypeSchema: async () => ({}),
            savePropertyTypeSchema: async () => {},
            openLinkTarget: async () => true,
            secondBrain: {
              workspacePath: '/vault',
              allWorkspaceFiles: ['notes/a.md'],
              requestedSessionId: '',
              requestedSessionNonce: 0,
              requestedPrompt: '',
              requestedPromptNonce: 0,
              activeNotePath: '',
              echoesRefreshToken: 0
            },
            launchpad: {
              workspaceLabel: 'vault',
              recentWorkspaces: [],
              recentViewedNotes: [],
              recentUpdatedNotes: [],
              showWizardAction: true
            },
            onStatus: (payload: { path: string; dirty: boolean; saving: boolean; saveError: string }) => {
              emitted.status.push(payload)
            },
            onPaneFocus: (payload: { paneId: string }) => {
              emitted.paneFocus.push(payload)
            }
          })
      }
    }))

    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await nextTick()

    const grid = root.querySelector<HTMLElement>('.pane-grid')
    expect(grid?.style.gridTemplateColumns).toBe('50% 6px 50%')
    expect(grid?.style.gridTemplateRows).toBe('50% 6px 50%')
    expect(root.querySelectorAll('.editor-pane')).toHaveLength(4)
    expect(harnessState.tabsProps).toEqual([
      { paneId: 'pane-1', activePane: true },
      { paneId: 'pane-2', activePane: false },
      { paneId: 'pane-3', activePane: false },
      { paneId: 'pane-4', activePane: false }
    ])
    expect(harnessState.surfaceProps).toEqual([
      {
        paneId: 'pane-1',
        openDocumentPaths: ['notes/a.md'],
        launchpadMode: 'workspace-launchpad',
        showExperience: true,
        activeTabId: 'doc-1'
      },
      {
        paneId: 'pane-2',
        openDocumentPaths: [],
        launchpadMode: 'workspace-launchpad',
        showExperience: false,
        activeTabId: 'second-brain-1'
      },
      {
        paneId: 'pane-3',
        openDocumentPaths: [],
        launchpadMode: 'workspace-launchpad',
        showExperience: false,
        activeTabId: 'home-1'
      },
      {
        paneId: 'pane-4',
        openDocumentPaths: [],
        launchpadMode: 'workspace-launchpad',
        showExperience: false,
        activeTabId: 'home-2'
      }
    ])

    await root.querySelector<HTMLElement>('.tabs-stub-focus')?.click()
    expect(emitted.paneFocus).toEqual([{ paneId: 'pane-1' }])

    await root.querySelector<HTMLElement>('.surface-stub-status')?.click()
    expect(emitted.status).toEqual([{ path: 'pane-1.md', dirty: true, saving: false, saveError: '' }])

    expect(gridRef.value).not.toBeNull()
    await gridRef.value?.saveNow()
    expect(harnessState.surfaceMethods[0]?.methods.saveNow).toHaveBeenCalledTimes(1)

    const changes: WorkspaceFsChange[] = [{ kind: 'modified', path: 'notes/a.md' }]
    await gridRef.value?.applyWorkspaceFsChanges(changes)
    for (const entry of harnessState.surfaceMethods) {
      expect(entry.methods.applyWorkspaceFsChanges).toHaveBeenCalledTimes(1)
    }

    await gridRef.value?.reloadCurrent()
    gridRef.value?.focusEditor()
    await gridRef.value?.revealSnippet('snippet')
    await gridRef.value?.revealOutlineHeading(2)
    expect(await gridRef.value?.revealAnchor({} as never)).toBe(true)
    gridRef.value?.navigateSignal('link', -1)
    expect(gridRef.value?.zoomIn()).toBe(2)
    expect(gridRef.value?.zoomOut()).toBe(0.5)
    expect(gridRef.value?.resetZoom()).toBe(1)
    expect(gridRef.value?.getZoom()).toBe(1)

    const activeSurfaceMethods = harnessState.surfaceMethods[0]?.methods
    expect(activeSurfaceMethods?.reloadCurrent).toHaveBeenCalledTimes(1)
    expect(activeSurfaceMethods?.focusEditor).toHaveBeenCalledTimes(1)
    expect(activeSurfaceMethods?.revealSnippet).toHaveBeenCalledWith('snippet')
    expect(activeSurfaceMethods?.revealOutlineHeading).toHaveBeenCalledWith(2)
    expect(activeSurfaceMethods?.revealAnchor).toHaveBeenCalledTimes(1)
    expect(activeSurfaceMethods?.navigateSignal).toHaveBeenCalledWith('link', -1)
    expect(activeSurfaceMethods?.zoomIn).toHaveBeenCalledTimes(1)
    expect(activeSurfaceMethods?.zoomOut).toHaveBeenCalledTimes(1)
    expect(activeSurfaceMethods?.resetZoom).toHaveBeenCalledTimes(1)
    expect(activeSurfaceMethods?.getZoom).toHaveBeenCalledTimes(1)

    layout.value.activePaneId = 'missing-pane'
    await nextTick()
    await gridRef.value?.saveNow()
    expect(harnessState.surfaceMethods[0]?.methods.saveNow).toHaveBeenCalledTimes(1)
    expect(gridRef.value?.getZoom()).toBe(1)

    const columnResizer = root.querySelector<HTMLElement>('.pane-resizer-col')
    expect(columnResizer).toBeTruthy()
    columnResizer?.dispatchEvent(
      Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), {
        clientX: 100,
        clientY: 100
      })
    )
    window.dispatchEvent(
      Object.assign(new Event('pointermove', { bubbles: true, cancelable: true }), {
        clientX: 120,
        clientY: 120
      })
    )
    await nextTick()
    expect(grid?.style.gridTemplateColumns).toBe('70% 6px 30%')

    const rowResizer = root.querySelector<HTMLElement>('.pane-resizer-row')
    expect(rowResizer).toBeTruthy()
    rowResizer?.dispatchEvent(
      Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), {
        clientX: 100,
        clientY: 100
      })
    )
    window.dispatchEvent(
      Object.assign(new Event('pointermove', { bubbles: true, cancelable: true }), {
        clientX: 120,
        clientY: 120
      })
    )
    await nextTick()
    expect(grid?.style.gridTemplateRows).toBe('70% 6px 30%')
    window.dispatchEvent(new Event('pointerup'))

    app.unmount()
  })

  it('drops a pending first-block focus when the active pane changes before readiness', async () => {
    const layout = ref<MultiPaneLayout>({
      root: {
        kind: 'split',
        axis: 'column',
        ratio: 0.5,
        a: { kind: 'pane', paneId: 'pane-1' },
        b: { kind: 'pane', paneId: 'pane-2' }
      },
      panesById: {
        'pane-1': {
          id: 'pane-1',
          activeTabId: 'doc-1',
          openTabs: [{ id: 'doc-1', type: 'document', path: 'notes/a.md', pinned: false }],
          activePath: 'notes/a.md'
        },
        'pane-2': {
          id: 'pane-2',
          activeTabId: 'doc-2',
          openTabs: [{ id: 'doc-2', type: 'document', path: 'notes/b.md', pinned: false }],
          activePath: 'notes/b.md'
        }
      },
      activePaneId: 'pane-1'
    })

    const gridRef = ref<any>(null)

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(EditorPaneGrid, {
            ref: gridRef,
            layout: layout.value,
            activeDocumentPath: 'notes/a.md',
            getStatus: () => ({ dirty: false, saving: false, saveError: '' }),
            renameFileFromTitle: async (path: string, title: string) => ({ path, title }),
            loadLinkTargets: async () => [],
            loadLinkHeadings: async () => [],
            loadPropertyTypeSchema: async () => ({}),
            savePropertyTypeSchema: async () => {},
            openLinkTarget: async () => true,
            secondBrain: {
              workspacePath: '/vault',
              allWorkspaceFiles: ['notes/a.md'],
              requestedSessionId: '',
              requestedSessionNonce: 0,
              requestedPrompt: '',
              requestedPromptNonce: 0,
              activeNotePath: '',
              echoesRefreshToken: 0
            },
            launchpad: {
              workspaceLabel: 'vault',
              recentWorkspaces: [],
              recentViewedNotes: [],
              recentUpdatedNotes: [],
              showWizardAction: true
            }
          })
      }
    }))

    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await nextTick()

    const firstSurfaceMethods = harnessState.surfaceMethods.find((entry) => entry.paneId === 'pane-1')?.methods
    const secondSurfaceMethods = harnessState.surfaceMethods.find((entry) => entry.paneId === 'pane-2')?.methods
    expect(firstSurfaceMethods).toBeTruthy()
    expect(secondSurfaceMethods).toBeTruthy()

    app.unmount()
  })
})
