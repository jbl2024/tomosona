import { createApp, defineComponent, h, nextTick, reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EditorPaneGrid from './EditorPaneGrid.vue'
import type { MultiPaneLayout } from '../../composables/useMultiPaneWorkspaceState'

vi.mock('@vue-dnd-kit/core', () => ({
  DnDProvider: defineComponent({
    name: 'DnDProviderStub',
    setup(_, { slots }) {
      return () => slots.default?.()
    }
  }),
  makeDraggable: vi.fn(),
  makeDroppable: vi.fn()
}))

// The grid only wires panes together; the surfaces themselves are covered by
// their own tests, so they are stubbed to keep this test about pane activation.
vi.mock('./PaneSurfaceHost.vue', () => ({
  default: defineComponent({
    name: 'PaneSurfaceHostStub',
    props: { paneId: { type: String, required: true } },
    setup(props) {
      return () => h('div', { class: 'surface-stub', 'data-pane-id': props.paneId })
    }
  })
}))

vi.mock('./EditorPaneTabs.vue', () => ({
  default: defineComponent({
    name: 'EditorPaneTabsStub',
    props: {
      pane: { type: Object, required: true },
      isActivePane: { type: Boolean, default: false }
    },
    emits: ['pane-focus', 'tab-click'],
    setup(props, { emit }) {
      return () => h('div', {
        class: 'strip-stub',
        'data-pane-id': (props.pane as { id: string }).id,
        'data-active': props.isActivePane ? 'true' : 'false'
      }, [
        h('button', {
          class: 'strip-stub-tab',
          type: 'button',
          onClick: () => emit('tab-click', { paneId: (props.pane as { id: string }).id, tabId: 'doc-2' })
        }, 'tab')
      ])
    }
  })
}))

function twoPaneLayout(): MultiPaneLayout {
  return {
    root: {
      kind: 'split',
      axis: 'row',
      ratio: 0.5,
      a: { kind: 'pane', paneId: 'pane-1' },
      b: { kind: 'pane', paneId: 'pane-2' }
    },
    panesById: {
      'pane-1': {
        id: 'pane-1',
        openTabs: [{ id: 'doc-1', type: 'document', path: '/vault/a.md', pinned: false }],
        activeTabId: 'doc-1',
        activePath: '/vault/a.md',
        recentTabIds: ['doc-1']
      },
      'pane-2': {
        id: 'pane-2',
        openTabs: [{ id: 'doc-2', type: 'document', path: '/vault/b.md', pinned: false }],
        activeTabId: 'doc-2',
        activePath: '/vault/b.md',
        recentTabIds: ['doc-2']
      }
    },
    activePaneId: 'pane-1'
  }
}

function mountGrid() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const layout = reactive(twoPaneLayout())
  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () => h(EditorPaneGrid, {
        layout,
        activeDocumentPath: '/vault/a.md',
        workspacePath: '/vault',
        getStatus: () => ({ dirty: false, saving: false, saveError: '' }),
        renameFileFromTitle: async (path: string, title: string) => ({ path, title }),
        loadLinkTargets: async () => [],
        loadLinkHeadings: async () => [],
        loadPropertyTypeSchema: async () => ({}),
        savePropertyTypeSchema: async () => {},
        openLinkTarget: async () => false,
        launchpad: {
          workspaceLabel: 'vault',
          recentWorkspaces: [],
          recentViewedNotes: [],
          recentUpdatedNotes: [],
          showWizardAction: false
        },
        onPaneFocus: (payload: { paneId: string }) => events.push(`focus:${payload.paneId}`),
        onPaneTabClick: (payload: { paneId: string; tabId: string }) => events.push(`click:${payload.paneId}:${payload.tabId}`)
      })
    }
  }))

  app.mount(root)
  return { app, root, layout, events }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('EditorPaneGrid pane activation', () => {
  it('marks exactly one pane as active', async () => {
    const mounted = mountGrid()
    await nextTick()

    const sections = Array.from(mounted.root.querySelectorAll<HTMLElement>('.editor-pane'))
    expect(sections).toHaveLength(2)
    expect(sections.filter((section) => section.classList.contains('editor-pane-active'))).toHaveLength(1)

    const strips = Array.from(mounted.root.querySelectorAll<HTMLElement>('.strip-stub'))
    expect(strips.map((strip) => strip.dataset.active)).toEqual(['true', 'false'])

    mounted.app.unmount()
  })

  it('activates the inactive pane when its strip is clicked', async () => {
    const mounted = mountGrid()
    await nextTick()

    const inactiveSection = Array.from(mounted.root.querySelectorAll<HTMLElement>('.editor-pane'))[1]
    inactiveSection.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await nextTick()

    expect(mounted.events).toContain('focus:pane-2')

    mounted.layout.activePaneId = 'pane-2'
    await nextTick()

    const sections = Array.from(mounted.root.querySelectorAll<HTMLElement>('.editor-pane'))
    expect(sections[1].classList.contains('editor-pane-active')).toBe(true)
    expect(sections[0].classList.contains('editor-pane-active')).toBe(false)

    mounted.app.unmount()
  })

  it('activates the pane when a tab inside it is clicked', async () => {
    const mounted = mountGrid()
    await nextTick()

    const inactiveStrip = Array.from(mounted.root.querySelectorAll<HTMLElement>('.strip-stub'))[1]
    inactiveStrip.querySelector<HTMLButtonElement>('.strip-stub-tab')?.click()
    await nextTick()

    expect(mounted.events).toContain('click:pane-2:doc-2')

    mounted.app.unmount()
  })
})
