import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import CosmosSidebarPanel from './CosmosSidebarPanel.vue'
import type { CosmosGraphNode } from '../lib/graphIndex'

const nodeA: CosmosGraphNode = {
  id: 'a',
  path: 'graph/a.md',
  label: 'graph/a',
  displayLabel: 'a',
  folderKey: 'graph',
  fullLabel: 'graph/a',
  degree: 2,
  tags: [],
  cluster: 0,
  importance: 2,
  opacityHint: 1,
  showLabelByDefault: true
}

const nodeB: CosmosGraphNode = {
  id: 'b',
  path: 'graph/b.md',
  label: 'graph/b',
  displayLabel: 'b',
  folderKey: 'graph',
  fullLabel: 'graph/b',
  degree: 1,
  tags: [],
  cluster: 0,
  importance: 1,
  opacityHint: 0.8,
  showLabelByDefault: false
}

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

describe('CosmosSidebarPanel', () => {
  it('renders search results and keeps them visible while query is non-empty', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const Harness = defineComponent({
      setup() {
        const query = ref('graph')
        return () =>
          h(CosmosSidebarPanel, {
            summary: { nodes: 2, edges: 1 },
            query: query.value,
            matches: [nodeA, nodeB],
            focusMode: false,
            focusDepth: 1,
            showSemanticEdges: true,
            selectedNode: nodeA,
            selectedLinkCount: 1,
            preview: '# A\nline',
            previewLoading: false,
            previewError: '',
            outgoingNodes: [nodeB],
            incomingNodes: [],
            loading: false,
            'onUpdate:query': (value: string) => {
              query.value = value
            }
          })
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()

    expect(root.querySelectorAll('.cosmos-match-item').length).toBe(2)

    const input = root.querySelector<HTMLInputElement>('.cosmos-search-input')
    expect(input).toBeTruthy()
    if (input) {
      input.value = 'zzz'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushUi()
    expect(root.querySelector('.cosmos-match-list')).toBeTruthy()

    app.unmount()
  })

  it('emits actions for open/reset/select related', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const events = {
      openSelected: 0,
      locateSelected: 0,
      resetView: 0,
      selectMatch: '' as string,
      jumpRelated: '' as string,
      focusMode: false,
      addToContext: '' as string
    }

    const Harness = defineComponent({
      setup() {
        return () =>
          h(CosmosSidebarPanel, {
            summary: { nodes: 2, edges: 1 },
            query: 'graph',
            matches: [nodeA],
            focusMode: false,
            focusDepth: 1,
            showSemanticEdges: true,
            selectedNode: nodeA,
            selectedLinkCount: 1,
            preview: '# A\nline',
            previewLoading: false,
            previewError: '',
            outgoingNodes: [nodeB],
            incomingNodes: [nodeB],
            loading: false,
            onOpenSelected: () => {
              events.openSelected += 1
            },
            onLocateSelected: () => {
              events.locateSelected += 1
            },
            onResetView: () => {
              events.resetView += 1
            },
            onSelectMatch: (nodeId: string) => {
              events.selectMatch = nodeId
            },
            onJumpRelated: (nodeId: string) => {
              events.jumpRelated = nodeId
            },
            onToggleFocusMode: (value: boolean) => {
              events.focusMode = value
            },
            onAddToContext: (path: string) => {
              events.addToContext = path
            }
          })
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()

    root.querySelector<HTMLButtonElement>('.cosmos-node-title-link')?.click()
    root.querySelector<HTMLButtonElement>('.cosmos-locate-btn')?.click()
    const resetBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('.cosmos-reset-btn'))
      .find((button) => (button.textContent ?? '').includes('Reset view'))
    resetBtn?.click()
    root.querySelector<HTMLButtonElement>('.cosmos-match-item')?.click()
    root.querySelectorAll<HTMLButtonElement>('.cosmos-links-item')[0]?.click()
    root.querySelector<HTMLInputElement>('.cosmos-toggle input')?.click()
    root.querySelector<HTMLButtonElement>('.cosmos-context-btn')?.click()
    await flushUi()

    expect(events.openSelected).toBe(1)
    expect(events.locateSelected).toBe(1)
    expect(events.resetView).toBe(1)
    expect(events.selectMatch).toBe('a')
    expect(events.jumpRelated).toBe('b')
    expect(events.focusMode).toBe(true)
    expect(events.addToContext).toBe('graph/a.md')

    app.unmount()
  })

  it('renders selected title using displayLabel', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const Harness = defineComponent({
      setup() {
        return () =>
          h(CosmosSidebarPanel, {
            summary: { nodes: 2, edges: 1 },
            query: '',
            matches: [],
            focusMode: false,
            focusDepth: 1,
            showSemanticEdges: true,
            selectedNode: nodeA,
            selectedLinkCount: 1,
            preview: '',
            previewLoading: false,
            previewError: '',
            outgoingNodes: [],
            incomingNodes: [],
            loading: false
          })
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()

    expect(root.querySelector('.cosmos-node-title-link')?.textContent).toContain('a')

    app.unmount()
  })

  it('renders preview in a dedicated scrollable card area', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const Harness = defineComponent({
      setup() {
        return () =>
          h(CosmosSidebarPanel, {
            summary: { nodes: 2, edges: 1 },
            query: '',
            matches: [],
            focusMode: false,
            focusDepth: 1,
            showSemanticEdges: true,
            selectedNode: nodeA,
            selectedLinkCount: 1,
            preview: Array.from({ length: 80 }, (_, idx) => `line ${idx}`).join('\n'),
            previewLoading: false,
            previewError: '',
            outgoingNodes: [],
            incomingNodes: [],
            loading: false
          })
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()

    const preview = root.querySelector<HTMLElement>('.cosmos-node-preview')
    const content = root.querySelector<HTMLElement>('.cosmos-panel-content')
    expect(preview).toBeTruthy()
    expect(content).toBeTruthy()
    expect(preview?.tagName.toLowerCase()).toBe('pre')
    expect(preview?.textContent).toContain('line 79')

    app.unmount()
  })

  it('applies search mode prefixes from chips', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const query = ref('concept map')

    const Harness = defineComponent({
      setup() {
        return () =>
          h(CosmosSidebarPanel, {
            summary: { nodes: 2, edges: 1 },
            query: query.value,
            matches: [],
            focusMode: false,
            focusDepth: 1,
            showSemanticEdges: true,
            selectedNode: null,
            selectedLinkCount: 0,
            preview: '',
            previewLoading: false,
            previewError: '',
            outgoingNodes: [],
            incomingNodes: [],
            loading: false,
            'onUpdate:query': (value: string) => {
              query.value = value
            }
          })
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()

    const semanticChip = Array.from(root.querySelectorAll<HTMLButtonElement>('.cosmos-search-mode-chip'))
      .find((button) => button.textContent?.includes('Semantic'))
    semanticChip?.click()
    await flushUi()
    expect(query.value).toBe('semantic: concept map')

    const lexicalChip = Array.from(root.querySelectorAll<HTMLButtonElement>('.cosmos-search-mode-chip'))
      .find((button) => button.textContent?.includes('Lexical'))
    lexicalChip?.click()
    await flushUi()
    expect(query.value).toBe('lexical: concept map')

    const hybridChip = Array.from(root.querySelectorAll<HTMLButtonElement>('.cosmos-search-mode-chip'))
      .find((button) => button.textContent?.includes('Hybrid'))
    hybridChip?.click()
    await flushUi()
    expect(query.value).toBe('concept map')

    app.unmount()
  })

  it('opens Pulse in Second Brain with a preset prompt', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const onPulseOpenSecondBrain = vi.fn()

    const Harness = defineComponent({
      setup() {
        return () =>
          h(CosmosSidebarPanel, {
            summary: { nodes: 2, edges: 1 },
            query: '',
            matches: [],
            focusMode: false,
            focusDepth: 1,
            showSemanticEdges: true,
            selectedNode: nodeA,
            selectedLinkCount: 1,
            preview: '# A\nline',
            previewLoading: false,
            previewError: '',
            outgoingNodes: [nodeB],
            incomingNodes: [],
            loading: false,
            onPulseOpenSecondBrain
          })
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()

    root.querySelector<HTMLButtonElement>('.cosmos-pulse-trigger')?.click()
    await flushUi()

    const outlineOption = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ui-filterable-dropdown-option'))
      .find((button) => button.textContent?.includes('Outline'))
    outlineOption?.click()
    await flushUi()

    const textarea = root.querySelector<HTMLTextAreaElement>('.cosmos-pulse-textarea')
    expect(textarea).toBeTruthy()
    if (textarea) {
      textarea.value = 'Keep it short.'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushUi()

    root.querySelector<HTMLButtonElement>('.cosmos-pulse-send')?.click()

    expect(onPulseOpenSecondBrain).toHaveBeenCalledTimes(1)
    expect(onPulseOpenSecondBrain).toHaveBeenCalledWith({
      contextPaths: ['graph/a.md', 'graph/b.md'],
      prompt: expect.stringContaining('Turn the selected graph context into a clear outline')
    })
    expect(onPulseOpenSecondBrain).toHaveBeenCalledWith({
      contextPaths: ['graph/a.md', 'graph/b.md'],
      prompt: expect.stringContaining('Additional guidance: Keep it short.')
    })

    app.unmount()
  })
})
