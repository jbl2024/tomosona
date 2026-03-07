/**
 * Cosmos graph shaping helpers.
 *
 * This module converts the raw wikilink graph payload into a deterministic,
 * UI-oriented structure for rendering and interaction decisions.
 */
import type { WikilinkGraph, WikilinkGraphEdge, WikilinkGraphNode } from '../../../shared/api/apiTypes'

export type CosmosGraphNode = WikilinkGraphNode & {
  cluster: number
  importance: number
  opacityHint: number
  showLabelByDefault: boolean
  displayLabel: string
  folderKey: string
  fullLabel: string
}

export type CosmosGraph = {
  nodes: CosmosGraphNode[]
  edges: WikilinkGraphEdge[]
  generated_at_ms: number
}

export type HubSelectionOptions = {
  percentile?: number
  minDegree?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Computes user-facing label metadata from the indexed path/label fields.
 *
 * Examples:
 * - label `graph/synapse` => displayLabel `synapse`, folderKey `graph`
 * - path `journal/2026-03-01.md` => displayLabel `2026-03-01`, folderKey `journal`
 * - root file `inbox.md` => folderKey `root`
 */
function deriveNodeLabelParts(node: Pick<WikilinkGraphNode, 'path' | 'label'>): {
  displayLabel: string
  folderKey: string
  fullLabel: string
} {
  const normalizedPath = node.path.replace(/\\/g, '/')
  const normalizedLabel = (node.label || '').replace(/\\/g, '/')
  const fullLabel = normalizedLabel || normalizedPath.replace(/\.(md|markdown)$/i, '')

  const labelSegments = fullLabel.split('/').filter((segment) => segment.length > 0)
  const pathSegments = normalizedPath.split('/').filter((segment) => segment.length > 0)

  const fallbackStem = (pathSegments[pathSegments.length - 1] ?? fullLabel ?? node.path)
    .replace(/\.(md|markdown)$/i, '')
  const displayLabel = labelSegments[labelSegments.length - 1] ?? fallbackStem

  const firstLabelSegment = labelSegments[0]
  const firstPathSegment = pathSegments[0]
  const folderKey = firstLabelSegment && firstLabelSegment !== displayLabel
    ? firstLabelSegment
    : firstPathSegment && pathSegments.length > 1
      ? firstPathSegment
      : 'root'

  return {
    displayLabel,
    folderKey,
    fullLabel
  }
}

/**
 * Assigns stable cluster ids using connected components over an undirected view of edges.
 * Complexity is O(N + E).
 */
export function assignConnectedComponentClusters(graph: WikilinkGraph): Map<string, number> {
  const nodesSorted = [...graph.nodes].sort((a, b) => a.path.localeCompare(b.path))
  const adjacency = new Map<string, Set<string>>()

  for (const node of nodesSorted) {
    adjacency.set(node.id, new Set<string>())
  }

  for (const edge of graph.edges) {
    adjacency.get(edge.source)?.add(edge.target)
    adjacency.get(edge.target)?.add(edge.source)
  }

  const visited = new Set<string>()
  const components: string[][] = []

  for (const node of nodesSorted) {
    if (visited.has(node.id)) continue
    const queue = [node.id]
    const component: string[] = []
    visited.add(node.id)

    while (queue.length) {
      const current = queue.shift()!
      component.push(current)
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue
        visited.add(neighbor)
        queue.push(neighbor)
      }
    }

    component.sort((a, b) => a.localeCompare(b))
    components.push(component)
  }

  components.sort((a, b) => a[0].localeCompare(b[0]))

  const out = new Map<string, number>()
  components.forEach((component, clusterId) => {
    for (const nodeId of component) {
      out.set(nodeId, clusterId)
    }
  })
  return out
}

/**
 * Selects hub nodes used for always-on labels.
 *
 * The default strategy marks roughly the top 10% by degree while enforcing a minimum degree threshold.
 */
export function selectHubNodes(
  graph: WikilinkGraph,
  options: HubSelectionOptions = {}
): Set<string> {
  if (!graph.nodes.length) return new Set<string>()

  const percentile = clamp(options.percentile ?? 0.9, 0, 1)
  const minDegree = Math.max(0, options.minDegree ?? 2)
  const sortedDegrees = graph.nodes.map((node) => node.degree).sort((a, b) => a - b)
  const cutoffIndex = Math.floor((sortedDegrees.length - 1) * percentile)
  const percentileCutoff = sortedDegrees[cutoffIndex] ?? 0
  const threshold = Math.max(minDegree, percentileCutoff)

  const hubs = new Set<string>()
  for (const node of graph.nodes) {
    if (node.degree >= threshold) {
      hubs.add(node.id)
    }
  }
  return hubs
}

/**
 * Builds a deterministic Cosmos graph model with cluster ids and display hints.
 */
export function buildCosmosGraph(raw: WikilinkGraph): CosmosGraph {
  const nodeIds = new Set(raw.nodes.map((node) => node.id))
  const edges = raw.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  const normalized: WikilinkGraph = {
    nodes: [...raw.nodes].sort((a, b) => a.path.localeCompare(b.path)),
    edges,
    generated_at_ms: raw.generated_at_ms
  }

  const clusters = assignConnectedComponentClusters(normalized)
  const hubs = selectHubNodes(normalized)

  const nodes: CosmosGraphNode[] = normalized.nodes.map((node) => {
    const cluster = clusters.get(node.id) ?? 0
    const importance = node.degree + (node.tags.length > 0 ? 0.25 : 0)
    const opacityHint = clamp(0.28 + Math.log10(node.degree + 1) * 0.55, 0.28, 1)
    const labelParts = deriveNodeLabelParts(node)

    return {
      ...node,
      cluster,
      importance,
      opacityHint,
      showLabelByDefault: hubs.has(node.id),
      displayLabel: labelParts.displayLabel,
      folderKey: labelParts.folderKey,
      fullLabel: labelParts.fullLabel
    }
  })

  return {
    nodes,
    edges: normalized.edges,
    generated_at_ms: raw.generated_at_ms
  }
}
