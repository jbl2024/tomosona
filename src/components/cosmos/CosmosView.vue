<script setup lang="ts">
/**
 * 2D Cosmos graph renderer for wikilink exploration.
 *
 * Responsibilities:
 * - render graph with `force-graph`,
 * - apply hover/focus highlighting,
 * - surface node selection via emits.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CosmosGraph, CosmosGraphNode } from '../../lib/graphIndex'

type RenderNode = CosmosGraphNode & {
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number
  fy?: number
}

type RenderEdge = {
  source: string | RenderNode
  target: string | RenderNode
  type: 'wikilink' | 'semantic'
  score?: number | null
}

type ForceGraphInstance = {
  graphData: {
    (): { nodes: RenderNode[]; links: RenderEdge[] }
    (data: { nodes: RenderNode[]; links: RenderEdge[] }): ForceGraphInstance
  }
  backgroundColor: (value?: string) => string | ForceGraphInstance
  nodeLabel: (value: (node: RenderNode) => string) => ForceGraphInstance
  nodeRelSize: (value: number) => ForceGraphInstance
  nodeVal: (value: number | string | ((node: RenderNode) => number)) => ForceGraphInstance
  nodeColor: (value: (node: RenderNode) => string) => ForceGraphInstance
  nodeCanvasObject: (value: (node: RenderNode, ctx: CanvasRenderingContext2D, globalScale: number) => void) => ForceGraphInstance
  nodeCanvasObjectMode: (value: string | ((node: RenderNode) => string)) => ForceGraphInstance
  nodePointerAreaPaint: (value: (node: RenderNode, color: string, ctx: CanvasRenderingContext2D) => void) => ForceGraphInstance
  linkColor: (value: (edge: RenderEdge) => string) => ForceGraphInstance
  linkVisibility: (value: boolean | ((edge: RenderEdge) => boolean)) => ForceGraphInstance
  linkWidth: (value: (edge: RenderEdge) => number) => ForceGraphInstance
  linkLineDash: (value: (edge: RenderEdge) => number[] | null) => ForceGraphInstance
  enableNodeDrag: (value: boolean) => ForceGraphInstance
  enableZoomInteraction: (value: boolean | ((event: MouseEvent) => boolean)) => ForceGraphInstance
  enablePanInteraction: (value: boolean | ((event: MouseEvent) => boolean)) => ForceGraphInstance
  cooldownTicks: (value: number) => ForceGraphInstance
  cooldownTime: (value: number) => ForceGraphInstance
  d3VelocityDecay: (value: number) => ForceGraphInstance
  d3Force: {
    (forceName: string): unknown
    (forceName: string, forceFn: unknown): ForceGraphInstance
  }
  d3ReheatSimulation: () => ForceGraphInstance
  onNodeHover: (handler: (node: RenderNode | null) => void) => ForceGraphInstance
  onNodeClick: (handler: (node: RenderNode, event?: MouseEvent) => void) => ForceGraphInstance
  onNodeDrag: (handler: (node: RenderNode) => void) => ForceGraphInstance
  onNodeDragEnd: (handler: (node: RenderNode) => void) => ForceGraphInstance
  onEngineStop: (handler: () => void) => ForceGraphInstance
  width: (value: number) => ForceGraphInstance
  height: (value: number) => ForceGraphInstance
  centerAt: (x?: number, y?: number, ms?: number) => ForceGraphInstance
  zoom: {
    (): number
    (value: number, ms?: number): ForceGraphInstance
  }
  zoomToFit: (ms?: number, px?: number, filter?: (node: RenderNode) => boolean) => ForceGraphInstance
  refresh?: () => ForceGraphInstance
  _destructor?: () => void
}

const FOLDER_COLORS = ['#5fb3cc', '#86b969', '#d6be70', '#d59670', '#6bb49a', '#6e9ccc', '#9dc36a', '#62bbcb', '#d39a62', '#a7c770']
const CLUSTER_FALLBACK_COLORS = ['#5fb3cc', '#86b969', '#d6be70', '#d59670', '#6f8fa8', '#6bb49a', '#6e9ccc']
const HOVER_THROTTLE_MS = 24
const DOUBLE_CLICK_MS = 260
const AUTO_SHOW_LABEL_THRESHOLD = 24
const CLICK_AFTER_DRAG_GUARD_MS = 320
const MIN_LABEL_SCALE = 0.95
const RESET_VIEW_PADDING_PX = 56
const RESET_MIN_ZOOM = 0.45
const RESET_OUTLIER_TRIM_RATIO = 0.08

const props = defineProps<{
  graph: CosmosGraph
  loading: boolean
  error?: string
  selectedNodeId?: string
  focusMode?: boolean
  focusDepth?: number
}>()

const emit = defineEmits<{
  'select-node': [nodeId: string]
  'toggle-focus-mode': [value: boolean]
}>()

const rootEl = ref<HTMLDivElement | null>(null)
const graphEl = ref<HTMLDivElement | null>(null)
const graphInstance = ref<ForceGraphInstance | null>(null)

let hoverThrottleTimer: ReturnType<typeof setTimeout> | null = null
let lastClickAt = 0
let lastClickNodeId = ''
let lastDragAt = 0
let lastDraggedNodeId = ''
let hoveredNodeId = ''
let selectedNodeId = ''
let hoveredNeighborIds = new Set<string>()
let highlightedEdgeKeys = new Set<string>()
let focusNeighborIds = new Set<string>()
let focusEdgeKeys = new Set<string>()
let cachedEdges: Array<{ source: string; target: string; type: 'wikilink' | 'semantic'; score?: number | null }> = []
let didInitialAutoFit = false
let deferredFocusTimer: ReturnType<typeof setTimeout> | null = null
let deferredFocusNodeId = ''
let deferredFocusAttempts = 0
let themeObserver: MutationObserver | null = null
let hostResizeObserver: ResizeObserver | null = null

const hasRenderableGraph = computed(() => props.graph.nodes.length > 0)
const resolvedFocusDepth = computed(() => Math.max(1, props.focusDepth ?? 1))

function hashString(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const source = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized
  const red = Number.parseInt(source.slice(0, 2), 16)
  const green = Number.parseInt(source.slice(2, 4), 16)
  const blue = Number.parseInt(source.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function isDarkTheme(): boolean {
  return themeName() === 'dark'
}

function themeName(): 'light' | 'dark' {
  const root = document.documentElement
  return root.dataset.theme === 'dark' || root.classList.contains('dark') ? 'dark' : 'light'
}

function readThemeVar(name: string, fallback: string): string {
  const host = rootEl.value ?? document.documentElement
  const value = getComputedStyle(host).getPropertyValue(name).trim()
  return value || fallback
}

function clusterFallbackColor(cluster: number): string {
  return CLUSTER_FALLBACK_COLORS[Math.abs(cluster) % CLUSTER_FALLBACK_COLORS.length]
}

function nodeBaseColor(node: RenderNode): string {
  if (node.folderKey) {
    const slot = hashString(node.folderKey) % FOLDER_COLORS.length
    return FOLDER_COLORS[slot]
  }
  return clusterFallbackColor(node.cluster)
}

function edgeKey(sourceId: string, targetId: string): string {
  return `${sourceId}=>${targetId}`
}

function edgeSourceId(edge: RenderEdge): string {
  return typeof edge.source === 'string' ? edge.source : edge.source.id
}

function edgeTargetId(edge: RenderEdge): string {
  return typeof edge.target === 'string' ? edge.target : edge.target.id
}

function isFocusEnabled(): boolean {
  return Boolean(props.focusMode && selectedNodeId)
}

function isNodeInFocusNeighborhood(nodeId: string): boolean {
  if (!isFocusEnabled()) return false
  if (nodeId === selectedNodeId) return true
  return focusNeighborIds.has(nodeId)
}

function isEdgeInFocusNeighborhood(edge: RenderEdge): boolean {
  if (!isFocusEnabled()) return false
  return focusEdgeKeys.has(edgeKey(edgeSourceId(edge), edgeTargetId(edge)))
}

function isNodeHovered(nodeId: string): boolean {
  return hoveredNodeId === nodeId
}

function isNodeHoverNeighbor(nodeId: string): boolean {
  return hoveredNeighborIds.has(nodeId)
}

function shouldShowLabel(node: RenderNode): boolean {
  if (isFocusEnabled()) return isNodeInFocusNeighborhood(node.id)
  if (props.graph.nodes.length <= AUTO_SHOW_LABEL_THRESHOLD) return true
  if (node.showLabelByDefault) return true
  if (!hoveredNodeId) return false
  return node.id === hoveredNodeId || hoveredNeighborIds.has(node.id)
}

function nodeRadius(node: RenderNode): number {
  return Math.max(3, 2 + Math.log2(node.degree + 1) * 2.1)
}

function nodeOpacity(node: RenderNode): number {
  if (isFocusEnabled()) {
    if (node.id === selectedNodeId) return 1
    if (focusNeighborIds.has(node.id)) return 0.88
    return 0.1
  }

  if (hoveredNodeId) {
    if (node.id === hoveredNodeId) return 1
    if (hoveredNeighborIds.has(node.id)) return 0.9
    return 0.2
  }

  return Math.max(0.46, node.opacityHint)
}

function nodeStrokeColor(node: RenderNode): string {
  if (node.id === selectedNodeId) return readThemeVar('--cosmos-node-selected', '#b58900')
  if (isNodeHovered(node.id)) return readThemeVar('--cosmos-node-hover', '#334155')
  if (isNodeInFocusNeighborhood(node.id)) return readThemeVar('--cosmos-node-focus', '#7a8ea3')
  return readThemeVar('--cosmos-node-default-stroke', 'rgba(255, 255, 255, 0.7)')
}

function linkOpacity(edge: RenderEdge): number {
  const inFocus = isEdgeInFocusNeighborhood(edge)
  const hovered = highlightedEdgeKeys.has(edgeKey(edgeSourceId(edge), edgeTargetId(edge)))

  if (isFocusEnabled()) {
    if (inFocus) {
      if (edge.type === 'semantic') {
        const score = Number.isFinite(edge.score) ? Number(edge.score) : 0.85
        return Math.max(0.28, Math.min(0.7, score * 0.72))
      }
      return 0.72
    }
    return 0.1
  }

  if (edge.type === 'semantic') {
    const score = Number.isFinite(edge.score) ? Number(edge.score) : 0.85
    const semanticBase = Math.max(0.2, Math.min(0.6, score * 0.65))
    if (hovered) return Math.min(0.75, semanticBase + 0.15)
    if (hoveredNodeId) return Math.max(0.12, semanticBase - 0.12)
    return semanticBase
  }

  if (hovered) return 0.74
  if (hoveredNodeId) return 0.16
  return 0.22
}

function linkColor(edge: RenderEdge): string {
  const alpha = linkOpacity(edge)
  if (edge.type === 'semantic') {
    return isDarkTheme()
      ? `rgba(104, 182, 152, ${alpha})`
      : `rgba(73, 140, 118, ${alpha})`
  }

  return isDarkTheme()
    ? `rgba(171, 178, 191, ${alpha})`
    : `rgba(120, 130, 150, ${alpha})`
}

function linkWidth(edge: RenderEdge): number {
  const inFocus = isEdgeInFocusNeighborhood(edge)
  if (edge.type === 'semantic') {
    const score = Number.isFinite(edge.score) ? Number(edge.score) : 0.85
    const base = 0.8 + Math.max(0, score - 0.75) * 2
    return inFocus ? Math.min(1.9, base + 0.35) : Math.min(1.6, base)
  }
  return inFocus ? 1.7 : 1.1
}

function linkDash(edge: RenderEdge): number[] | null {
  if (edge.type !== 'semantic') return null
  return isDarkTheme() ? [5, 4] : [4, 4]
}

function labelColor(node: RenderNode): string {
  if (node.id === selectedNodeId) {
    return readThemeVar('--cosmos-label-selected', '#7a5700')
  }
  if (isNodeHovered(node.id) || isNodeHoverNeighbor(node.id) || isNodeInFocusNeighborhood(node.id)) {
    return readThemeVar('--cosmos-label-hover', '#1f2937')
  }
  return readThemeVar('--cosmos-label-text', '#4b5563')
}

function drawNode(node: RenderNode, ctx: CanvasRenderingContext2D, globalScale: number) {
  const radius = nodeRadius(node)
  const opacity = nodeOpacity(node)
  const baseColor = nodeBaseColor(node)
  const fillColor = hexToRgba(baseColor, opacity)

  ctx.beginPath()
  ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI)
  ctx.fillStyle = fillColor
  ctx.fill()

  const strokeWidth = node.id === selectedNodeId ? 1.8 : 1.2
  ctx.lineWidth = strokeWidth
  ctx.strokeStyle = nodeStrokeColor(node)
  ctx.stroke()

  const labelImportant = node.id === selectedNodeId || isNodeHovered(node.id) || isNodeHoverNeighbor(node.id) || isNodeInFocusNeighborhood(node.id)
  if (!labelImportant && globalScale < MIN_LABEL_SCALE) return
  if (!shouldShowLabel(node)) return

  const fontSize = Math.max(10, 12 / globalScale)
  const offset = radius + Math.max(5, 8 / globalScale)
  const textX = (node.x ?? 0) + offset
  const textY = (node.y ?? 0) + fontSize * 0.34

  ctx.font = `${fontSize}px ${readThemeVar('--font-ui', "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif")}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = Math.max(2.5, 3.3 / globalScale)
  ctx.strokeStyle = readThemeVar('--cosmos-label-outline', 'rgba(255, 255, 255, 0.92)')
  ctx.strokeText(node.displayLabel, textX, textY)
  ctx.fillStyle = labelColor(node)
  ctx.fillText(node.displayLabel, textX, textY)
}

function paintNodePointerArea(node: RenderNode, color: string, ctx: CanvasRenderingContext2D) {
  const radius = nodeRadius(node) + 1.5
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI)
  ctx.fill()
}

function rebuildHoverNeighborhood(node: RenderNode | null) {
  hoveredNodeId = node?.id ?? ''
  const nextNeighbors = new Set<string>()
  const nextEdges = new Set<string>()

  if (node) {
    for (const edge of cachedEdges) {
      const sourceId = edge.source
      const targetId = edge.target
      if (sourceId === node.id) {
        nextNeighbors.add(targetId)
        nextEdges.add(edgeKey(sourceId, targetId))
      }
      if (targetId === node.id) {
        nextNeighbors.add(sourceId)
        nextEdges.add(edgeKey(sourceId, targetId))
      }
    }
  }

  hoveredNeighborIds = nextNeighbors
  highlightedEdgeKeys = nextEdges
}

function rebuildFocusNeighborhood() {
  const selected = selectedNodeId
  if (!selected || !props.focusMode) {
    focusNeighborIds = new Set<string>()
    focusEdgeKeys = new Set<string>()
    return
  }

  const depth = resolvedFocusDepth.value
  const adjacency = new Map<string, Set<string>>()
  for (const node of props.graph.nodes) {
    adjacency.set(node.id, new Set<string>())
  }
  for (const edge of cachedEdges) {
    adjacency.get(edge.source)?.add(edge.target)
    adjacency.get(edge.target)?.add(edge.source)
  }

  const seen = new Set<string>([selected])
  const neighbors = new Set<string>()
  let frontier = new Set<string>([selected])

  for (let hop = 0; hop < depth; hop += 1) {
    const next = new Set<string>()
    for (const nodeId of frontier) {
      for (const neighbor of adjacency.get(nodeId) ?? []) {
        if (seen.has(neighbor)) continue
        seen.add(neighbor)
        neighbors.add(neighbor)
        next.add(neighbor)
      }
    }
    if (!next.size) break
    frontier = next
  }

  const edgeKeys = new Set<string>()
  for (const edge of cachedEdges) {
    if (seen.has(edge.source) && seen.has(edge.target)) {
      edgeKeys.add(edgeKey(edge.source, edge.target))
    }
  }

  focusNeighborIds = neighbors
  focusEdgeKeys = edgeKeys
}

function refreshGraphStyles() {
  graphInstance.value?.refresh?.()
}

function focusNode(node: RenderNode) {
  const graph = graphInstance.value
  if (!graph) return

  const x = node.x ?? 0
  const y = node.y ?? 0
  const targetZoom = Math.max(1.45, Math.min(2.25, 1.55 + Math.log2(node.degree + 1) * 0.15))

  graph.centerAt(x, y, 700)
  graph.zoom(targetZoom, 700)
}

function clearDeferredFocus() {
  deferredFocusNodeId = ''
  deferredFocusAttempts = 0
  if (deferredFocusTimer) {
    clearTimeout(deferredFocusTimer)
    deferredFocusTimer = null
  }
}

function hasReadyCoordinates(node: RenderNode): boolean {
  return Number.isFinite(node.x) && Number.isFinite(node.y)
}

function runDeferredFocus() {
  const graph = graphInstance.value
  if (!graph || !deferredFocusNodeId) {
    clearDeferredFocus()
    return
  }

  const renderData = graph.graphData()
  const node = (renderData.nodes ?? []).find((candidate) => candidate.id === deferredFocusNodeId)
  if (!node) {
    clearDeferredFocus()
    return
  }

  if (hasReadyCoordinates(node)) {
    focusNode(node)
    emit('select-node', node.id)
    clearDeferredFocus()
    return
  }

  deferredFocusAttempts += 1
  if (deferredFocusAttempts > 12) {
    clearDeferredFocus()
    return
  }

  deferredFocusTimer = setTimeout(() => {
    deferredFocusTimer = null
    runDeferredFocus()
  }, 80)
}

function onNodeClick(node: RenderNode) {
  if (lastDraggedNodeId === node.id && Date.now() - lastDragAt < CLICK_AFTER_DRAG_GUARD_MS) {
    return
  }

  emit('select-node', node.id)

  const now = Date.now()
  if (lastClickNodeId === node.id && now - lastClickAt <= DOUBLE_CLICK_MS) {
    focusNode(node)
    emit('toggle-focus-mode', true)
    lastClickAt = 0
    lastClickNodeId = ''
    return
  }

  lastClickAt = now
  lastClickNodeId = node.id
}

function lockNodePositions() {
  const graph = graphInstance.value
  if (!graph) return
  const renderData = graph.graphData()
  for (const node of renderData.nodes ?? []) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue
    node.fx = node.x
    node.fy = node.y
  }
}

function applyThemeBackground() {
  const graph = graphInstance.value
  if (!graph) return
  const nextBackground = readThemeVar('--cosmos-canvas-bg', '#ffffff')
  graph.backgroundColor(nextBackground)
  refreshGraphStyles()
}

async function initializeGraph() {
  const host = graphEl.value
  if (!host) return

  const module = await import('force-graph')
  const ForceGraph2D = module.default as unknown as
    | ((el?: HTMLElement) => ForceGraphInstance | ((el: HTMLElement) => ForceGraphInstance))
    | (new (el: HTMLElement) => ForceGraphInstance)

  let graph: ForceGraphInstance
  try {
    graph = new (ForceGraph2D as new (el: HTMLElement) => ForceGraphInstance)(host)
  } catch {
    const factory = ForceGraph2D as (el?: HTMLElement) => ForceGraphInstance | ((el: HTMLElement) => ForceGraphInstance)
    const maybeInstance = factory(host)
    graph = typeof maybeInstance === 'function' ? maybeInstance(host) : maybeInstance
  }

  graph
    .enableNodeDrag(true)
    .enableZoomInteraction(true)
    .enablePanInteraction(true)
    .nodeLabel(() => '')
    .nodeRelSize(3)
    .nodeVal((node) => Math.max(1, node.degree + 0.2))
    .nodeColor((node) => hexToRgba(nodeBaseColor(node), nodeOpacity(node)))
    .nodeCanvasObjectMode(() => 'replace')
    .nodeCanvasObject(drawNode)
    .nodePointerAreaPaint(paintNodePointerArea)
    .linkVisibility(() => true)
    .linkColor(linkColor)
    .linkLineDash(linkDash)
    .linkWidth(linkWidth)
    .cooldownTicks(200)
    .cooldownTime(7500)
    .d3VelocityDecay(0.24)
    .onNodeHover((node) => {
      if (hoverThrottleTimer) return
      hoverThrottleTimer = setTimeout(() => {
        hoverThrottleTimer = null
        rebuildHoverNeighborhood(node)
        refreshGraphStyles()
      }, HOVER_THROTTLE_MS)
    })
    .onNodeDrag((node) => {
      lastDragAt = Date.now()
      lastDraggedNodeId = node.id
    })
    .onNodeDragEnd((node) => {
      lastDragAt = Date.now()
      lastDraggedNodeId = node.id
    })
    .onNodeClick(onNodeClick)
    .onEngineStop(() => {
      lockNodePositions()
      refreshGraphStyles()
    })

  graphInstance.value = graph
  const chargeForce = graph.d3Force('charge') as { strength?: (value: number) => unknown } | undefined
  chargeForce?.strength?.(-330)
  const linkForce = graph.d3Force('link') as {
    distance?: (value: number | ((edge: RenderEdge) => number)) => unknown
    strength?: (value: number | ((edge: RenderEdge) => number)) => unknown
  } | undefined
  linkForce?.distance?.((edge: RenderEdge) => (edge.type === 'semantic' ? 120 : 88))
  linkForce?.strength?.((edge: RenderEdge) => (edge.type === 'semantic' ? 0.16 : 0.42))
  graph.d3ReheatSimulation()

  applyThemeBackground()
  applyGraphData()
  resizeGraphToHost()
}

function applyGraphData() {
  const graph = graphInstance.value
  if (!graph) return

  cachedEdges = props.graph.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    type: edge.type,
    score: edge.score ?? null
  }))

  graph.graphData({
    nodes: props.graph.nodes.map((node) => ({ ...node })),
    links: cachedEdges.map((edge) => ({ ...edge }))
  })

  rebuildHoverNeighborhood(null)
  rebuildFocusNeighborhood()
  refreshGraphStyles()

  if (!didInitialAutoFit && props.graph.nodes.length > 0) {
    didInitialAutoFit = true
    window.requestAnimationFrame(() => {
      resizeGraphToHost()
      graph.zoomToFit(420, 100)
      window.requestAnimationFrame(() => {
        resizeGraphToHost()
        graph.zoomToFit(420, 100)
      })
    })
  }

  if (deferredFocusNodeId) {
    runDeferredFocus()
  }
}

function resizeGraphToHost() {
  const graph = graphInstance.value
  const host = rootEl.value
  if (!graph || !host) return
  const rect = host.getBoundingClientRect()
  graph.width(Math.max(1, Math.floor(rect.width)))
  graph.height(Math.max(1, Math.floor(rect.height)))
}

function setupResizeObserver() {
  const host = rootEl.value
  if (!host || typeof ResizeObserver === 'undefined') return

  hostResizeObserver = new ResizeObserver(() => {
    resizeGraphToHost()
  })
  hostResizeObserver.observe(host)
}

function setupThemeObserver() {
  themeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && (mutation.attributeName === 'class' || mutation.attributeName === 'data-theme')) {
        applyThemeBackground()
        return
      }
    }
  })

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme']
  })
}

function teardownGraph() {
  if (hoverThrottleTimer) {
    clearTimeout(hoverThrottleTimer)
    hoverThrottleTimer = null
  }
  if (themeObserver) {
    themeObserver.disconnect()
    themeObserver = null
  }
  if (hostResizeObserver) {
    hostResizeObserver.disconnect()
    hostResizeObserver = null
  }

  hoveredNodeId = ''
  hoveredNeighborIds = new Set<string>()
  highlightedEdgeKeys = new Set<string>()
  focusNeighborIds = new Set<string>()
  focusEdgeKeys = new Set<string>()
  cachedEdges = []
  didInitialAutoFit = false
  clearDeferredFocus()

  graphInstance.value?._destructor?.()
  graphInstance.value = null
}

function resetCandidateNodeIds(nodes: RenderNode[]): Set<string> {
  const ready = nodes.filter((node) => hasReadyCoordinates(node))
  if (ready.length <= 10) return new Set(ready.map((node) => node.id))

  const centerX = ready.reduce((sum, node) => sum + (node.x ?? 0), 0) / ready.length
  const centerY = ready.reduce((sum, node) => sum + (node.y ?? 0), 0) / ready.length
  const scored = ready.map((node) => ({
    id: node.id,
    d2: Math.pow((node.x ?? 0) - centerX, 2) + Math.pow((node.y ?? 0) - centerY, 2)
  }))
  scored.sort((a, b) => a.d2 - b.d2)
  const trimCount = Math.max(1, Math.floor(scored.length * RESET_OUTLIER_TRIM_RATIO))
  const keepCount = Math.max(8, scored.length - trimCount)
  return new Set(scored.slice(0, keepCount).map((item) => item.id))
}

function resetView() {
  const graph = graphInstance.value
  if (!graph) return
  const renderData = graph.graphData()
  const candidateIds = resetCandidateNodeIds(renderData.nodes ?? [])
  const filter = candidateIds.size > 0
    ? (node: RenderNode) => candidateIds.has(node.id)
    : undefined

  graph.zoomToFit(520, RESET_VIEW_PADDING_PX, filter)
  const currentZoom = graph.zoom()
  if (typeof currentZoom === 'number' && currentZoom < RESET_MIN_ZOOM) {
    graph.zoom(RESET_MIN_ZOOM, 260)
  }
}

function focusNodeById(nodeId: string): boolean {
  const graph = graphInstance.value
  if (!graph || !nodeId) return false
  const renderData = graph.graphData()
  const node = (renderData.nodes ?? []).find((candidate) => candidate.id === nodeId)
  if (!node) return false

  if (hasReadyCoordinates(node)) {
    focusNode(node)
    emit('select-node', node.id)
    clearDeferredFocus()
    return true
  }

  deferredFocusNodeId = nodeId
  deferredFocusAttempts = 0
  runDeferredFocus()
  return true
}

watch(
  () => props.graph,
  () => {
    applyGraphData()
  },
  { deep: true }
)

watch(
  () => props.selectedNodeId,
  (value) => {
    selectedNodeId = value ?? ''
    rebuildFocusNeighborhood()
    refreshGraphStyles()
  },
  { immediate: true }
)

watch(
  () => props.focusMode,
  () => {
    rebuildFocusNeighborhood()
    refreshGraphStyles()
  }
)

watch(
  () => props.focusDepth,
  () => {
    rebuildFocusNeighborhood()
    refreshGraphStyles()
  }
)

onMounted(() => {
  void initializeGraph()
  setupThemeObserver()
  setupResizeObserver()
  window.addEventListener('resize', resizeGraphToHost)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeGraphToHost)
  teardownGraph()
})

defineExpose({
  resetView,
  focusNodeById
})
</script>
<template>
  <div ref="rootEl" class="cosmos-root">
    <div ref="graphEl" class="cosmos-canvas" :aria-busy="loading ? 'true' : 'false'"></div>

    <div v-if="loading" class="cosmos-state">Loading graph...</div>
    <div v-else-if="error" class="cosmos-state cosmos-state-error">{{ error }}</div>
    <div v-else-if="!hasRenderableGraph" class="cosmos-state">No wikilink graph yet.</div>
  </div>
</template>

<style scoped>
.cosmos-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 10px;
  background: var(--cosmos-view-bg);
}

.cosmos-canvas {
  position: absolute;
  inset: 0;
}

.cosmos-state {
  position: absolute;
  left: 16px;
  top: 14px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--cosmos-view-state-bg);
  color: var(--cosmos-view-state-text);
  border: 1px solid var(--cosmos-view-state-border);
  font-size: var(--font-size-md);
  letter-spacing: 0.02em;
}

.cosmos-state-error {
  background: var(--cosmos-view-state-error-bg);
  color: var(--cosmos-view-state-error-text);
  border-color: var(--cosmos-view-state-error-border);
}
</style>
