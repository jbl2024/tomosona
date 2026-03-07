/**
 * Cosmos controller state/computation layer.
 *
 * This module isolates graph-fetching, selection/focus behavior, semantic edge
 * filtering, and preview loading from `App.vue`.
 */
import { computed, ref, watch, type Ref } from 'vue'
import type { WikilinkGraph } from '../lib/apiTypes'
import { type CosmosGraph, type CosmosGraphNode, buildCosmosGraph as defaultBuildCosmosGraph } from '../lib/graphIndex'

type GraphSummary = {
  nodes: number
  edges: number
}

type CosmosDeps = {
  workingFolderPath: Readonly<Ref<string>>
  activeTabPath: Readonly<Ref<string>>
  getWikilinkGraph: () => Promise<WikilinkGraph>
  reindexMarkdownFile: (path: string) => Promise<void>
  readTextFile: (path: string) => Promise<string>
  ftsSearch: (query: string) => Promise<Array<{ path: string; snippet: string; score: number }>>
  buildCosmosGraph?: (raw: WikilinkGraph) => CosmosGraph
}

type OpenSelectedResult = {
  path: string
} | null

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

function normalizeGraphLoadError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message.trim()
  }
  if (typeof err === 'string' && err.trim()) {
    return err.trim()
  }
  try {
    const serialized = JSON.stringify(err)
    if (serialized && serialized !== '{}' && serialized !== 'null') {
      return serialized
    }
  } catch {
    // Ignore JSON conversion failure.
  }
  return 'Could not load graph.'
}

/** Produces a compact preview used in the Cosmos context card. */
function buildPreview(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 48)
    .join('\n')
    .slice(0, 6400)
}

export function useCosmosController(deps: CosmosDeps) {
  const graph = ref<CosmosGraph>({ nodes: [], edges: [], generated_at_ms: 0 })
  const loading = ref(false)
  const error = ref('')
  const query = ref('')
  const selectedNodeId = ref('')
  const focusMode = ref(false)
  const focusDepth = ref(1)
  const showSemanticEdges = ref(true)
  const preview = ref('')
  const previewLoading = ref(false)
  const previewError = ref('')
  const semanticPathOrder = ref<string[]>([])
  let semanticSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null

  let previewRequestToken = 0
  let queryRequestToken = 0
  let graphRequestToken = 0

  const summary = computed<GraphSummary>(() => ({
    nodes: graph.value.nodes.length,
    edges: graph.value.edges.length
  }))

  const nodeById = computed(() => new Map(graph.value.nodes.map((node) => [node.id, node])))

  const visibleEdges = computed(() => {
    if (showSemanticEdges.value) return graph.value.edges
    return graph.value.edges.filter((edge) => edge.type !== 'semantic')
  })

  const selectedNode = computed(() => nodeById.value.get(selectedNodeId.value) ?? null)

  const selectedLinkCount = computed(() => {
    const selected = selectedNodeId.value
    if (!selected) return 0
    return visibleEdges.value.filter((edge) => edge.source === selected || edge.target === selected).length
  })

  const outgoingNodes = computed(() => {
    const selected = selectedNodeId.value
    if (!selected) return []
    const outgoingIds = visibleEdges.value.filter((edge) => edge.source === selected).map((edge) => edge.target)
    return Array.from(new Set(outgoingIds))
      .map((id) => nodeById.value.get(id))
      .filter((node): node is CosmosGraphNode => Boolean(node))
      .sort((a, b) => a.label.localeCompare(b.label))
  })

  const incomingNodes = computed(() => {
    const selected = selectedNodeId.value
    if (!selected) return []
    const incomingIds = visibleEdges.value.filter((edge) => edge.target === selected).map((edge) => edge.source)
    return Array.from(new Set(incomingIds))
      .map((id) => nodeById.value.get(id))
      .filter((node): node is CosmosGraphNode => Boolean(node))
      .sort((a, b) => a.label.localeCompare(b.label))
  })

  const queryMatches = computed(() => {
    const value = query.value.trim().toLowerCase()
    if (!value) return []

    if (semanticPathOrder.value.length) {
      const byPath = new Map(graph.value.nodes.map((node) => [node.path.toLowerCase(), node]))
      const ordered: CosmosGraphNode[] = []
      const seenNodeIds = new Set<string>()
      for (const path of semanticPathOrder.value) {
        const node = byPath.get(path)
        if (node && !seenNodeIds.has(node.id)) {
          seenNodeIds.add(node.id)
          ordered.push(node)
        }
      }
      if (ordered.length) {
        return ordered.slice(0, 12)
      }
    }

    return graph.value.nodes
      .filter((node) => node.label.toLowerCase().includes(value) || node.path.toLowerCase().includes(value))
      .slice(0, 12)
  })

  const visibleGraph = computed<CosmosGraph>(() => {
    const edgesForView = visibleEdges.value
    return {
      generated_at_ms: graph.value.generated_at_ms,
      nodes: graph.value.nodes,
      edges: edgesForView
    }
  })

  async function refreshSemanticMatches() {
    const trimmed = query.value.trim()
    if (!trimmed || !deps.workingFolderPath.value) {
      semanticPathOrder.value = []
      return
    }

    const requestToken = ++queryRequestToken
    try {
      const hits = await deps.ftsSearch(trimmed)
      if (requestToken !== queryRequestToken) return
      semanticPathOrder.value = hits.map((hit) => hit.path.toLowerCase())
    } catch {
      if (requestToken !== queryRequestToken) return
      semanticPathOrder.value = []
    }
  }

  function scheduleRefreshSemanticMatches() {
    if (semanticSearchDebounceTimer) {
      clearTimeout(semanticSearchDebounceTimer)
      semanticSearchDebounceTimer = null
    }
    semanticSearchDebounceTimer = setTimeout(() => {
      semanticSearchDebounceTimer = null
      void refreshSemanticMatches()
    }, 260)
  }

  async function loadSelectedPreview() {
    const node = selectedNode.value
    const requestToken = ++previewRequestToken
    if (!node?.path) {
      preview.value = ''
      previewError.value = ''
      previewLoading.value = false
      return
    }

    previewLoading.value = true
    previewError.value = ''
    try {
      const markdown = await deps.readTextFile(node.path)
      if (requestToken !== previewRequestToken) return
      preview.value = buildPreview(markdown)
    } catch (err) {
      if (requestToken !== previewRequestToken) return
      preview.value = ''
      previewError.value = err instanceof Error ? err.message : 'Could not load preview.'
    } finally {
      if (requestToken === previewRequestToken) {
        previewLoading.value = false
      }
    }
  }

  async function refreshGraph() {
    const requestToken = ++graphRequestToken
    if (!deps.workingFolderPath.value) {
      if (requestToken !== graphRequestToken) return
      graph.value = { nodes: [], edges: [], generated_at_ms: 0 }
      error.value = ''
      semanticPathOrder.value = []
      return
    }

    loading.value = true
    error.value = ''
    try {
      const active = deps.activeTabPath.value
      if (active && isMarkdownPath(active)) {
        try {
          await deps.reindexMarkdownFile(active)
        } catch (err) {
          console.warn('[cosmos] active note reindex failed; continuing with existing graph index', err)
        }
      }
      let raw: WikilinkGraph | null = null
      let lastError: unknown = null
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          raw = await deps.getWikilinkGraph()
          if (attempt > 0) {
            console.info('[cosmos] graph refresh recovered after retry')
          }
          break
        } catch (err) {
          lastError = err
          console.warn('[cosmos] graph refresh attempt failed', { attempt: attempt + 1, error: err })
          if (attempt < 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, 250))
          }
        }
      }
      if (!raw) {
        throw lastError ?? new Error('Could not load graph.')
      }
      const shape = deps.buildCosmosGraph ?? defaultBuildCosmosGraph
      if (requestToken !== graphRequestToken) return
      graph.value = shape(raw)
      error.value = ''

      if (!graph.value.nodes.some((node) => node.id === selectedNodeId.value)) {
        selectedNodeId.value = ''
        focusDepth.value = 1
      }
      await refreshSemanticMatches()
    } catch (err) {
      if (requestToken !== graphRequestToken) return
      graph.value = { nodes: [], edges: [], generated_at_ms: 0 }
      error.value = normalizeGraphLoadError(err)
      console.error('[cosmos] graph refresh failed', err)
    } finally {
      if (requestToken !== graphRequestToken) return
      loading.value = false
    }
  }

  function selectNode(nodeId: string) {
    const searchSnapshot = query.value
    selectedNodeId.value = nodeId
    if (query.value !== searchSnapshot) {
      query.value = searchSnapshot
    }
  }

  function focusMatch(nodeId: string): string {
    const searchSnapshot = query.value
    selectedNodeId.value = nodeId
    if (query.value !== searchSnapshot) {
      query.value = searchSnapshot
    }
    return nodeId
  }

  function searchEnter(): string | null {
    const first = queryMatches.value[0]
    if (!first) return null
    focusMatch(first.id)
    return first.id
  }

  function expandNeighborhood() {
    if (!selectedNodeId.value) return
    focusMode.value = true
    focusDepth.value = Math.min(8, focusDepth.value + 1)
  }

  function jumpToRelated(nodeId: string): string {
    return focusMatch(nodeId)
  }

  function openSelected(): OpenSelectedResult {
    const node = selectedNode.value
    if (!node) return null
    return { path: node.path }
  }

  function resetSelection() {
    selectedNodeId.value = ''
    focusMode.value = false
    focusDepth.value = 1
    preview.value = ''
    previewLoading.value = false
    previewError.value = ''
  }

  function clearState() {
    if (semanticSearchDebounceTimer) {
      clearTimeout(semanticSearchDebounceTimer)
      semanticSearchDebounceTimer = null
    }
    graph.value = { nodes: [], edges: [], generated_at_ms: 0 }
    error.value = ''
    loading.value = false
    query.value = ''
    semanticPathOrder.value = []
    resetSelection()
  }

  watch(
    () => selectedNodeId.value,
    () => {
      void loadSelectedPreview()
    }
  )

  watch(
    () => query.value,
    () => {
      scheduleRefreshSemanticMatches()
    }
  )

  return {
    graph,
    visibleGraph,
    loading,
    error,
    query,
    selectedNodeId,
    focusMode,
    focusDepth,
    showSemanticEdges,
    preview,
    previewLoading,
    previewError,
    summary,
    queryMatches,
    selectedNode,
    selectedLinkCount,
    outgoingNodes,
    incomingNodes,
    refreshGraph,
    selectNode,
    focusMatch,
    searchEnter,
    expandNeighborhood,
    jumpToRelated,
    openSelected,
    resetSelection,
    clearState
  }
}
