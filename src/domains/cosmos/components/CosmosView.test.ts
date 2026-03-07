import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CosmosView from './CosmosView.vue'
import type { CosmosGraph } from '../lib/graphIndex'

type RenderNode = {
  id: string
  path: string
  label: string
  displayLabel?: string
  folderKey?: string
  x?: number
  y?: number
}

type MockState = {
  onNodeClick: ((node: RenderNode) => void) | null
  onNodeHover: ((node: RenderNode | null) => void) | null
  linkDashCalls: Array<(edge: unknown) => number[] | null>
  centerAtCalls: Array<{ x?: number; y?: number; ms?: number }>
  zoomCalls: Array<{ value: number; ms?: number }>
  zoomToFitCalls: Array<{ ms?: number; px?: number; hasFilter: boolean }>
  zoomValue: number
  data: { nodes: RenderNode[]; links: Array<{ source: string; target: string; type: 'wikilink' | 'semantic'; score?: number | null }> }
}

const mockState: MockState = {
  onNodeClick: null,
  onNodeHover: null,
  linkDashCalls: [],
  centerAtCalls: [],
  zoomCalls: [],
  zoomToFitCalls: [],
  zoomValue: 1,
  data: { nodes: [], links: [] }
}

const mockGraph = {
  graphData(data?: MockState['data']) {
    if (data) {
      mockState.data = data
      return mockGraph
    }
    return mockState.data
  },
  backgroundColor: () => mockGraph,
  nodeLabel: () => mockGraph,
  nodeRelSize: () => mockGraph,
  nodeVal: () => mockGraph,
  nodeColor: () => mockGraph,
  nodeCanvasObject: () => mockGraph,
  nodeCanvasObjectMode: () => mockGraph,
  nodePointerAreaPaint: () => mockGraph,
  linkVisibility: () => mockGraph,
  linkColor: () => mockGraph,
  linkWidth: () => mockGraph,
  linkLineDash(value: (edge: unknown) => number[] | null) {
    mockState.linkDashCalls.push(value)
    return mockGraph
  },
  linkDirectionalParticles: () => mockGraph,
  linkDirectionalParticleSpeed: () => mockGraph,
  linkDirectionalParticleWidth: () => mockGraph,
  linkDirectionalParticleColor: () => mockGraph,
  enableNodeDrag: () => mockGraph,
  enableZoomInteraction: () => mockGraph,
  enablePanInteraction: () => mockGraph,
  cooldownTicks: () => mockGraph,
  cooldownTime: () => mockGraph,
  d3VelocityDecay: () => mockGraph,
  d3Force: () => ({
    strength: () => mockGraph,
    distance: () => mockGraph
  }),
  d3ReheatSimulation: () => mockGraph,
  onNodeHover(handler: (node: RenderNode | null) => void) {
    mockState.onNodeHover = handler
    return mockGraph
  },
  onNodeClick(handler: (node: RenderNode) => void) {
    mockState.onNodeClick = handler
    return mockGraph
  },
  onNodeDrag: () => mockGraph,
  onNodeDragEnd: () => mockGraph,
  onEngineStop: () => mockGraph,
  width: () => mockGraph,
  height: () => mockGraph,
  centerAt(x?: number, y?: number, ms?: number) {
    mockState.centerAtCalls.push({ x, y, ms })
    return mockGraph
  },
  zoom(value?: number, ms?: number) {
    if (typeof value === 'number') {
      mockState.zoomValue = value
      mockState.zoomCalls.push({ value, ms })
      return mockGraph
    }
    return mockState.zoomValue
  },
  zoomToFit(ms?: number, px?: number, filter?: (node: RenderNode) => boolean) {
    mockState.zoomToFitCalls.push({ ms, px, hasFilter: typeof filter === 'function' })
    return mockGraph
  },
  refresh: () => mockGraph,
  _destructor: () => {}
}

vi.mock('force-graph', () => ({
  default: function ForceGraphMock() {
    return mockGraph
  }
}))

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

describe('CosmosView', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    mockState.onNodeClick = null
    mockState.onNodeHover = null
    mockState.linkDashCalls = []
    mockState.centerAtCalls = []
    mockState.zoomCalls = []
    mockState.zoomToFitCalls = []
    mockState.zoomValue = 1
    mockState.data = { nodes: [], links: [] }
  })

  it('emits select-node on click and configures dashed semantic links', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const selected = ref('')
    const focusModeToggle = ref<boolean | null>(null)

    const graph: CosmosGraph = {
      nodes: [
        {
          id: 'a.md',
          path: '/vault/a.md',
          label: 'a',
          displayLabel: 'a',
          folderKey: 'vault',
          fullLabel: 'a',
          degree: 2,
          tags: [],
          cluster: 0,
          importance: 1,
          opacityHint: 1,
          showLabelByDefault: true
        }
      ],
      edges: [{ source: 'a.md', target: 'b.md', type: 'semantic', score: 0.9 }],
      generated_at_ms: 1
    }

    const Harness = defineComponent({
      setup() {
        return () =>
          h(CosmosView, {
            graph,
            loading: false,
            error: '',
            selectedNodeId: '',
            focusMode: false,
            focusDepth: 1,
            onSelectNode: (nodeId: string) => {
              selected.value = nodeId
            },
            onToggleFocusMode: (value: boolean) => {
              focusModeToggle.value = value
            }
          })
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()
    await new Promise<void>((resolve) => setTimeout(resolve, 20))

    expect(mockState.onNodeClick).toBeTypeOf('function')
    expect(mockState.linkDashCalls.length).toBeGreaterThan(0)

    const dashResolver = mockState.linkDashCalls[mockState.linkDashCalls.length - 1]
    expect(dashResolver({ source: 'a.md', target: 'b.md', type: 'semantic', score: 0.9 })).toEqual([4, 4])
    expect(dashResolver({ source: 'a.md', target: 'b.md', type: 'wikilink' })).toBeNull()

    mockState.onNodeClick?.({ id: 'a.md', path: '/vault/a.md', label: 'a', x: 1, y: 1 })
    mockState.onNodeClick?.({ id: 'a.md', path: '/vault/a.md', label: 'a', x: 1, y: 1 })
    await flushUi()

    expect(selected.value).toBe('a.md')
    expect(focusModeToggle.value).toBe(true)
    expect(mockState.data.nodes[0]?.displayLabel).toBe('a')

    app.unmount()
  })

  it('keeps focus-mode enable on double click when already enabled', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const focusModeToggle = ref<boolean | null>(null)

    const graph: CosmosGraph = {
      nodes: [
        {
          id: 'a.md',
          path: '/vault/a.md',
          label: 'a',
          displayLabel: 'a',
          folderKey: 'vault',
          fullLabel: 'a',
          degree: 2,
          tags: [],
          cluster: 0,
          importance: 1,
          opacityHint: 1,
          showLabelByDefault: true
        }
      ],
      edges: [],
      generated_at_ms: 1
    }

    const Harness = defineComponent({
      setup() {
        return () =>
          h(CosmosView, {
            graph,
            loading: false,
            error: '',
            selectedNodeId: '',
            focusMode: true,
            focusDepth: 1,
            onToggleFocusMode: (value: boolean) => {
              focusModeToggle.value = value
            }
          })
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()
    await new Promise<void>((resolve) => setTimeout(resolve, 20))

    mockState.onNodeClick?.({ id: 'a.md', path: '/vault/a.md', label: 'a', x: 1, y: 1 })
    mockState.onNodeClick?.({ id: 'a.md', path: '/vault/a.md', label: 'a', x: 1, y: 1 })
    await flushUi()

    expect(focusModeToggle.value).toBe(true)

    app.unmount()
  })

  it('clamps reset view zoom when zoomToFit returns too small', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const cosmosRef = ref<{ resetView: () => void } | null>(null)

    const graph: CosmosGraph = {
      nodes: [
        {
          id: 'a.md',
          path: '/vault/a.md',
          label: 'a',
          displayLabel: 'a',
          folderKey: 'vault',
          fullLabel: 'a',
          degree: 2,
          tags: [],
          cluster: 0,
          importance: 1,
          opacityHint: 1,
          showLabelByDefault: true
        }
      ],
      edges: [],
      generated_at_ms: 1
    }

    const Harness = defineComponent({
      setup() {
        return () =>
          h(CosmosView, {
            ref: cosmosRef,
            graph,
            loading: false,
            error: '',
            selectedNodeId: '',
            focusMode: false,
            focusDepth: 1
          })
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()
    await new Promise<void>((resolve) => setTimeout(resolve, 20))

    mockState.zoomValue = 0.15
    cosmosRef.value?.resetView()
    await flushUi()

    expect(mockState.zoomToFitCalls.length).toBeGreaterThan(0)
    expect(mockState.zoomCalls.some((call) => call.value === 0.45)).toBe(true)

    app.unmount()
  })
})
