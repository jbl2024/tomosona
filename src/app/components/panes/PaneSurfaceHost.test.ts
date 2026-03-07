import { createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaneTab } from '../../../composables/useMultiPaneWorkspaceState'
import PaneSurfaceHost from './PaneSurfaceHost.vue'

const lifecycle = vi.hoisted(() => ({
  secondBrainMounted: 0,
  secondBrainUnmounted: 0
}))

vi.mock('../../../domains/editor/components/EditorView.vue', () => ({
  default: defineComponent({
    name: 'EditorViewStub',
    props: ['path'],
    setup(props) {
      return () => h('div', { class: 'editor-view-stub' }, String(props.path ?? ''))
    }
  })
}))

vi.mock('../../../domains/cosmos/components/CosmosPaneSurface.vue', () => ({
  default: defineComponent({
    name: 'CosmosPaneSurfaceStub',
    setup() {
      return () => h('div', { class: 'cosmos-pane-stub' }, 'cosmos')
    }
  })
}))

vi.mock('../../../domains/second-brain/components/SecondBrainPaneSurface.vue', () => ({
  default: defineComponent({
    name: 'SecondBrainPaneSurfaceStub',
    setup() {
      onMounted(() => {
        lifecycle.secondBrainMounted += 1
      })
      onBeforeUnmount(() => {
        lifecycle.secondBrainUnmounted += 1
      })
      return () => h('div', { class: 'second-brain-pane-stub' }, 'second-brain')
    }
  })
}))

describe('PaneSurfaceHost', () => {
  beforeEach(() => {
    lifecycle.secondBrainMounted = 0
    lifecycle.secondBrainUnmounted = 0
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('keeps second brain mounted when switching to another tab in the same pane', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const activeTab = ref<PaneTab | null>({
      id: 'sb',
      type: 'second-brain-chat',
      pinned: false
    })
    const openTabs = ref<PaneTab[]>([
      { id: 'sb', type: 'second-brain-chat', pinned: false },
      { id: 'doc-1', type: 'document', path: '/vault/a.md', pinned: false }
    ])

    const app = createApp(defineComponent({
      setup() {
        return () => h(PaneSurfaceHost, {
          paneId: 'pane-1',
          activeTab: activeTab.value,
          openTabs: openTabs.value,
          openDocumentPaths: ['/vault/a.md'],
          activeDocumentPath: '/vault/a.md',
          getStatus: () => ({ dirty: false, saving: false, saveError: '' }),
          openFile: async () => '',
          saveFile: async () => ({ persisted: true }),
          renameFileFromTitle: async (path: string) => ({ path, title: 'a' }),
          loadLinkTargets: async () => [],
          loadLinkHeadings: async () => [],
          loadPropertyTypeSchema: async () => ({}),
          savePropertyTypeSchema: async () => {},
          openLinkTarget: async () => true,
          cosmos: {
            graph: { nodes: [], links: [] },
            loading: false,
            error: '',
            selectedNodeId: '',
            focusMode: false,
            focusDepth: 1,
            summary: { nodes: 0, edges: 0 },
            query: '',
            matches: [],
            showSemanticEdges: false,
            selectedNode: null,
            selectedLinkCount: 0,
            preview: '',
            previewLoading: false,
            previewError: '',
            outgoingNodes: [],
            incomingNodes: []
          },
          secondBrain: {
            workspacePath: '/vault',
            allWorkspaceFiles: ['/vault/a.md'],
            requestedSessionId: '',
            requestedSessionNonce: 0,
            requestedPrompt: '',
            requestedPromptNonce: 0,
            activeNotePath: '/vault/a.md'
          },
          launchpad: {
            showExperience: true,
            mode: 'workspace-launchpad',
            workspaceLabel: 'vault',
            recentWorkspaces: [],
            recentNotes: [],
            showWizardAction: false
          }
        })
      }
    }))

    app.mount(root)
    await nextTick()

    expect(lifecycle.secondBrainMounted).toBe(1)
    expect(lifecycle.secondBrainUnmounted).toBe(0)
    expect(root.querySelector('.second-brain-pane-stub')).toBeTruthy()

    activeTab.value = { id: 'doc-1', type: 'document', path: '/vault/a.md', pinned: false }
    await nextTick()

    const secondBrainSurface = root.querySelector<HTMLElement>('.second-brain-pane-stub')
    expect(secondBrainSurface).toBeTruthy()
    expect(secondBrainSurface?.getAttribute('style')).toContain('display: none')
    expect(lifecycle.secondBrainMounted).toBe(1)
    expect(lifecycle.secondBrainUnmounted).toBe(0)

    activeTab.value = { id: 'sb', type: 'second-brain-chat', pinned: false }
    await nextTick()

    expect(lifecycle.secondBrainMounted).toBe(1)
    expect(lifecycle.secondBrainUnmounted).toBe(0)
    expect(root.querySelector<HTMLElement>('.second-brain-pane-stub')?.getAttribute('style') ?? '').not.toContain('display: none')

    app.unmount()
  })

  it('renders the no-workspace launchpad when the active pane is empty', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () => h(PaneSurfaceHost, {
          paneId: 'pane-1',
          activeTab: null,
          openTabs: [],
          openDocumentPaths: [],
          activeDocumentPath: '',
          getStatus: () => ({ dirty: false, saving: false, saveError: '' }),
          openFile: async () => '',
          saveFile: async () => ({ persisted: true }),
          renameFileFromTitle: async (path: string) => ({ path, title: 'a' }),
          loadLinkTargets: async () => [],
          loadLinkHeadings: async () => [],
          loadPropertyTypeSchema: async () => ({}),
          savePropertyTypeSchema: async () => {},
          openLinkTarget: async () => true,
          cosmos: {
            graph: { nodes: [], links: [] },
            loading: false,
            error: '',
            selectedNodeId: '',
            focusMode: false,
            focusDepth: 1,
            summary: { nodes: 0, edges: 0 },
            query: '',
            matches: [],
            showSemanticEdges: false,
            selectedNode: null,
            selectedLinkCount: 0,
            preview: '',
            previewLoading: false,
            previewError: '',
            outgoingNodes: [],
            incomingNodes: []
          },
          secondBrain: {
            workspacePath: '',
            allWorkspaceFiles: [],
            requestedSessionId: '',
            requestedSessionNonce: 0,
            requestedPrompt: '',
            requestedPromptNonce: 0,
            activeNotePath: ''
          },
          launchpad: {
            showExperience: true,
            mode: 'no-workspace',
            workspaceLabel: '',
            recentWorkspaces: [{
              path: '/vault',
              label: 'vault',
              subtitle: '/vault',
              recencyLabel: 'opened yesterday'
            }],
            recentNotes: [],
            showWizardAction: true
          }
        })
      }
    }))

    app.mount(root)
    await nextTick()

    expect(root.textContent).toContain('Workspace entry')
    expect(root.textContent).toContain('Recent workspaces')
    expect(root.textContent).toContain('vault')

    app.unmount()
  })
})
