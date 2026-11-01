import { computed, ref } from 'vue'

export type PaneId = string

export type SurfaceType = 'document' | 'home'

export type PaneTab =
  { id: string; type: 'document'; path: string; pinned: boolean } | { id: string; type: 'file-inspector'; path: string; pinned: boolean } | { id: string; type: 'home'; pinned: boolean }

export type PaneState = {
  id: PaneId
  openTabs: PaneTab[]
  activeTabId: string
  activePath?: string
  /**
   * Tab ids ordered most-recently-consulted first.
   *
   * Why: closing the active tab must return to the last consulted tab, and
   * `Ctrl+Tab` cycles that order. Both are pure reads of this list, so the
   * order has to live in the state rather than be derived from timestamps.
   */
  recentTabIds: string[]
}

/** A tab removed from a pane, kept so the user can reopen it. */
export type ClosedTabEntry = {
  paneId: PaneId
  tab: PaneTab
  index: number
}

export type SplitNode =
  | { kind: 'pane'; paneId: PaneId }
  | {
    kind: 'split'
    axis: 'row' | 'column'
    a: SplitNode
    b: SplitNode
    ratio: 0.5
  }

export type MultiPaneLayout = {
  root: SplitNode
  panesById: Record<PaneId, PaneState>
  activePaneId: PaneId
}

export type MoveDirection = 'next' | 'previous'

const MAX_PANES = 4

/** Upper bound on the session-only reopen stack. */
const MAX_CLOSED_TABS = 20

function documentTabId(path: string): string {
  return `doc:${path}`
}

function fileInspectorTabId(path: string): string {
  return `file-inspector:${path}`
}

function surfaceTabId(type: Exclude<SurfaceType, 'document'>): string {
  return `surface:${type}`
}

function isSpecialSurface(type: SurfaceType): type is Exclude<SurfaceType, 'document'> {
  return type !== 'document'
}

export function createInitialLayout(): MultiPaneLayout {
  const initialPaneId = 'pane-1'
  return {
    root: { kind: 'pane', paneId: initialPaneId },
    panesById: {
      [initialPaneId]: {
        id: initialPaneId,
        openTabs: [],
        activeTabId: '',
        activePath: '',
        recentTabIds: []
      }
    },
    activePaneId: initialPaneId
  }
}

function cloneNode(node: SplitNode): SplitNode {
  if (node.kind === 'pane') {
    return { kind: 'pane', paneId: node.paneId }
  }
  return {
    kind: 'split',
    axis: node.axis,
    ratio: 0.5,
    a: cloneNode(node.a),
    b: cloneNode(node.b)
  }
}

function collectPaneIds(node: SplitNode, ids: Set<string>): boolean {
  if (!node || typeof node !== 'object') return false
  if (node.kind === 'pane') {
    if (typeof node.paneId !== 'string' || !node.paneId.trim()) return false
    ids.add(node.paneId)
    return true
  }
  if (node.kind !== 'split') return false
  if ((node.axis !== 'row' && node.axis !== 'column') || node.ratio !== 0.5) return false
  return collectPaneIds(node.a, ids) && collectPaneIds(node.b, ids)
}

function listPaneIdsInOrder(node: SplitNode): PaneId[] {
  if (node.kind === 'pane') return [node.paneId]
  return [...listPaneIdsInOrder(node.a), ...listPaneIdsInOrder(node.b)]
}

function buildPathToPane(node: SplitNode, paneId: string, path: Array<'a' | 'b'> = []): Array<'a' | 'b'> | null {
  if (node.kind === 'pane') {
    return node.paneId === paneId ? path : null
  }
  const inA = buildPathToPane(node.a, paneId, [...path, 'a'])
  if (inA) return inA
  return buildPathToPane(node.b, paneId, [...path, 'b'])
}

function replaceNodeAtPath(root: SplitNode, path: Array<'a' | 'b'>, replacement: SplitNode): SplitNode {
  if (!path.length) return replacement
  if (root.kind !== 'split') return root
  const [head, ...tail] = path
  if (head === 'a') {
    return {
      ...root,
      a: replaceNodeAtPath(root.a, tail, replacement)
    }
  }
  return {
    ...root,
    b: replaceNodeAtPath(root.b, tail, replacement)
  }
}

function removePaneFromTree(root: SplitNode, paneId: PaneId): SplitNode {
  if (root.kind === 'pane') return root

  if (root.a.kind === 'pane' && root.a.paneId === paneId) {
    return cloneNode(root.b)
  }
  if (root.b.kind === 'pane' && root.b.paneId === paneId) {
    return cloneNode(root.a)
  }

  return {
    ...root,
    a: removePaneFromTree(root.a, paneId),
    b: removePaneFromTree(root.b, paneId)
  }
}

function makeNextPaneId(existing: Set<string>): string {
  let i = 1
  while (existing.has(`pane-${i}`)) {
    i += 1
  }
  return `pane-${i}`
}

function documentPathForTabId(openTabs: PaneTab[], tabId: string): string {
  const active = openTabs.find((tab) => tab.id === tabId)
  return active && (active.type === 'document' || active.type === 'file-inspector') ? active.path : ''
}

function hasTabPath(tab: PaneTab): tab is Extract<PaneTab, { path: string }> {
  return 'path' in tab
}

/** Drops ids that no longer belong to an open tab. */
function pruneRecentTabIds(recentTabIds: string[], openTabs: PaneTab[]): string[] {
  return recentTabIds.filter((id) => openTabs.some((tab) => tab.id === id))
}

/** Moves a tab id to the front of the most-recently-consulted order. */
function touchRecentTab(recentTabIds: string[], tabId: string, openTabs: PaneTab[]): string[] {
  if (!tabId) return pruneRecentTabIds(recentTabIds, openTabs)
  return pruneRecentTabIds([tabId, ...recentTabIds.filter((id) => id !== tabId)], openTabs)
}

/** Builds the next pane state, keeping the MRU order consistent with the tabs. */
function withTabs(pane: PaneState, nextTabs: PaneTab[], activeTabId: string): PaneState {
  return {
    ...pane,
    openTabs: nextTabs,
    activeTabId,
    activePath: documentPathForTabId(nextTabs, activeTabId),
    recentTabIds: touchRecentTab(pane.recentTabIds, activeTabId, nextTabs)
  }
}

function clearTabRangeAfterMutation(
  pane: PaneState,
  nextTabs: PaneTab[],
  activeTabId: string
): PaneState {
  return withTabs(pane, nextTabs, activeTabId)
}

function closeTabsRelativeToTab(
  layoutState: MultiPaneLayout,
  paneId: PaneId,
  tabId: string,
  direction: 'left' | 'right'
): { nextLayout: MultiPaneLayout; removedDocumentPaths: string[]; removedEntries: ClosedTabEntry[] } {
  const pane = layoutState.panesById[paneId]
  if (!pane) return { nextLayout: layoutState, removedDocumentPaths: [], removedEntries: [] }

  const tabIndex = pane.openTabs.findIndex((tab) => tab.id === tabId)
  if (tabIndex < 0) return { nextLayout: layoutState, removedDocumentPaths: [], removedEntries: [] }

  const nextTabs = pane.openTabs.filter((_, index) => direction === 'left' ? index >= tabIndex : index <= tabIndex)
  const removedEntries = pane.openTabs
    .map((tab, index) => ({ paneId, tab, index }))
    .filter(({ index }) => direction === 'left' ? index < tabIndex : index > tabIndex)
  const removedDocumentPaths = removedEntries.flatMap(({ tab }) =>
    tab.type === 'document' || tab.type === 'file-inspector' ? [tab.path] : []
  )
  const activeTabId = tabId

  return {
    nextLayout: {
      ...layoutState,
      activePaneId: paneId,
      panesById: {
        ...layoutState.panesById,
        [paneId]: clearTabRangeAfterMutation(pane, nextTabs, activeTabId)
      }
    },
    removedDocumentPaths,
    removedEntries
  }
}

export function hydrateLayout(payload: unknown): MultiPaneLayout | null {
  if (!payload || typeof payload !== 'object') return null

  const maybe = payload as Partial<MultiPaneLayout>
  if (!maybe.root || !maybe.panesById || typeof maybe.panesById !== 'object') return null
  if (typeof maybe.activePaneId !== 'string' || !maybe.activePaneId) return null

  const paneIds = new Set<string>()
  if (!collectPaneIds(maybe.root as SplitNode, paneIds)) return null
  if (!paneIds.size || paneIds.size > MAX_PANES) return null

  const seenDocumentPaths = new Set<string>()
  const seenInspectorPaths = new Set<string>()
  const panesById: Record<PaneId, PaneState> = {}

  for (const paneId of paneIds) {
    const rawPane = (maybe.panesById as Record<string, unknown>)[paneId]
    if (!rawPane || typeof rawPane !== 'object') return null
    const paneObj = rawPane as Partial<PaneState>
    const rawTabs = Array.isArray(paneObj.openTabs) ? paneObj.openTabs : []

    const openTabs: PaneTab[] = []
    for (const raw of rawTabs) {
      if (!raw || typeof raw !== 'object') continue
      const tab = raw as { type?: string; path?: string; pinned?: boolean }
      if (tab.type === 'document') {
        const path = typeof tab.path === 'string' ? tab.path.trim() : ''
        if (!path || seenDocumentPaths.has(path)) continue
        seenDocumentPaths.add(path)
        openTabs.push({ id: documentTabId(path), type: 'document', path, pinned: Boolean(tab.pinned) })
        continue
      }
      if (tab.type === 'file-inspector') {
        const path = typeof tab.path === 'string' ? tab.path.trim() : ''
        if (!path || seenInspectorPaths.has(path)) continue
        seenInspectorPaths.add(path)
        openTabs.push({ id: fileInspectorTabId(path), type: 'file-inspector', path, pinned: Boolean(tab.pinned) })
        continue
      }
      // `home` tabs are no longer rendered: an empty pane shows its home
      // surface directly, so a persisted home tab is dropped on hydration.
    }

    const activeTabIdRaw = typeof paneObj.activeTabId === 'string' ? paneObj.activeTabId : ''
    const activeTabId = openTabs.some((tab) => tab.id === activeTabIdRaw) ? activeTabIdRaw : (openTabs[0]?.id ?? '')
    const rawRecent = Array.isArray(paneObj.recentTabIds) ? paneObj.recentTabIds : []
    const recentTabIds = touchRecentTab(
      rawRecent.filter((id): id is string => typeof id === 'string'),
      activeTabId,
      openTabs
    )

    panesById[paneId] = {
      id: paneId,
      openTabs,
      activeTabId,
      activePath: documentPathForTabId(openTabs, activeTabId),
      recentTabIds
    }
  }

  const activePaneId = paneIds.has(maybe.activePaneId) ? maybe.activePaneId : Array.from(paneIds)[0]
  return {
    root: cloneNode(maybe.root as SplitNode),
    panesById,
    activePaneId
  }
}

export function serializeLayout(layout: MultiPaneLayout): MultiPaneLayout {
  return {
    root: cloneNode(layout.root),
    panesById: Object.fromEntries(
      Object.entries(layout.panesById).map(([paneId, pane]) => [
        paneId,
        {
          id: pane.id,
          openTabs: pane.openTabs.map((tab) => ({ ...tab })),
          activeTabId: pane.activeTabId,
          activePath: pane.activePath ?? '',
          recentTabIds: [...pane.recentTabIds]
        }
      ])
    ),
    activePaneId: layout.activePaneId
  }
}

export function useMultiPaneWorkspaceState(initial: MultiPaneLayout = createInitialLayout()) {
  const layout = ref<MultiPaneLayout>(serializeLayout(initial))
  /**
   * Session-only reopen stack, oldest first.
   *
   * Why not persisted: restoring it across restarts would let a user resurrect a
   * tab from a previous session with no way to tell where it came from.
   */
  const closedTabs = ref<ClosedTabEntry[]>([])

  const paneOrder = computed(() => listPaneIdsInOrder(layout.value.root))

  function pushClosedTab(entry: ClosedTabEntry) {
    const next = [...closedTabs.value, entry]
    closedTabs.value = next.length > MAX_CLOSED_TABS ? next.slice(next.length - MAX_CLOSED_TABS) : next
  }

  /**
   * Reopens the most recently closed tab in the pane it came from.
   *
   * Falls back to the active pane when that pane no longer exists, and returns
   * false when the stack is empty so callers can disable the command.
   */
  function reopenLastClosedTab(): boolean {
    while (closedTabs.value.length) {
      const entry = closedTabs.value[closedTabs.value.length - 1]
      closedTabs.value = closedTabs.value.slice(0, -1)

      const paneId = layout.value.panesById[entry.paneId] ? entry.paneId : layout.value.activePaneId
      const pane = layout.value.panesById[paneId]
      if (!pane) continue

      const existing = pane.openTabs.find((tab) => tab.id === entry.tab.id)
      if (existing) {
        setActiveTabInPane(paneId, existing.id)
        return true
      }

      const nextTabs = [...pane.openTabs]
      nextTabs.splice(Math.max(0, Math.min(entry.index, nextTabs.length)), 0, { ...entry.tab })
      layout.value = {
        ...layout.value,
        panesById: {
          ...layout.value.panesById,
          [paneId]: withTabs(pane, nextTabs, entry.tab.id)
        },
        activePaneId: paneId
      }
      return true
    }
    return false
  }

  function paneCount(): number {
    return Object.keys(layout.value.panesById).length
  }

  function getActiveTab(paneId: PaneId = layout.value.activePaneId): PaneTab | null {
    const pane = layout.value.panesById[paneId]
    if (!pane) return null
    return pane.openTabs.find((tab) => tab.id === pane.activeTabId) ?? null
  }

  function getActiveDocumentPath(paneId: PaneId = layout.value.activePaneId): string {
    const tab = getActiveTab(paneId)
    if (!tab || (tab.type !== 'document' && tab.type !== 'file-inspector')) return ''
    return tab.path
  }

  function getOpenDocumentPaths(): string[] {
    return Object.values(layout.value.panesById).flatMap((pane) =>
      pane.openTabs
        .filter((tab): tab is Extract<PaneTab, { type: 'document' }> => tab.type === 'document')
        .map((tab) => tab.path)
    )
  }

  function setActivePane(paneId: PaneId) {
    if (!layout.value.panesById[paneId]) return
    layout.value = {
      ...layout.value,
      activePaneId: paneId
    }
  }

  function setActiveTabInPane(paneId: PaneId, tabId: string) {
    const pane = layout.value.panesById[paneId]
    if (!pane || !tabId) return
    if (!pane.openTabs.some((tab) => tab.id === tabId)) return
    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [paneId]: withTabs(pane, pane.openTabs, tabId)
      },
      activePaneId: paneId
    }
  }

  function findPaneContainingPath(path: string, type?: PaneTab['type']): PaneId | null {
    const target = path.trim()
    if (!target) return null
    for (const pane of Object.values(layout.value.panesById)) {
      if (pane.openTabs.some((tab) => hasTabPath(tab) && tab.path === target && (!type || tab.type === type))) {
        return pane.id
      }
    }
    return null
  }

  function findPaneContainingDocument(path: string): PaneId | null {
    return findPaneContainingPath(path, 'document')
  }

  function findPaneContainingInspector(path: string): PaneId | null {
    return findPaneContainingPath(path, 'file-inspector')
  }

  function findPaneContainingSurface(type: Exclude<SurfaceType, 'document'>): PaneId | null {
    for (const pane of Object.values(layout.value.panesById)) {
      if (pane.openTabs.some((tab) => tab.type === type)) {
        return pane.id
      }
    }
    return null
  }

  function openDocumentInPane(path: string, paneId: PaneId = layout.value.activePaneId) {
    const target = path.trim()
    if (!target) return

    const existingPaneId = findPaneContainingDocument(target)
    if (existingPaneId) {
      const existingPane = layout.value.panesById[existingPaneId]
      const tab = existingPane.openTabs.find((item) => hasTabPath(item) && item.type === 'document' && item.path === target)
      if (!tab) return
      setActiveTabInPane(existingPaneId, tab.id)
      return
    }

    const pane = layout.value.panesById[paneId]
    if (!pane) return
    const tab: PaneTab = {
      id: documentTabId(target),
      type: 'document',
      path: target,
      pinned: false
    }

    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [paneId]: withTabs(pane, [...pane.openTabs, tab], tab.id)
      },
      activePaneId: paneId
    }
  }

  function openInspectorInPane(path: string, paneId: PaneId = layout.value.activePaneId) {
    const target = path.trim()
    if (!target) return

    const existingPaneId = findPaneContainingInspector(target)
    if (existingPaneId) {
      const existingPane = layout.value.panesById[existingPaneId]
      const tab = existingPane.openTabs.find((item) => hasTabPath(item) && item.type === 'file-inspector' && item.path === target)
      if (!tab) return
      setActiveTabInPane(existingPaneId, tab.id)
      return
    }

    const pane = layout.value.panesById[paneId]
    if (!pane) return
    const tab: PaneTab = {
      id: fileInspectorTabId(target),
      type: 'file-inspector',
      path: target,
      pinned: false
    }

    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [paneId]: withTabs(pane, [...pane.openTabs, tab], tab.id)
      },
      activePaneId: paneId
    }
  }

  /**
   * Relocates an existing tab into another pane.
   *
   * This is deliberately not `openDocumentInPane`: that one redirects to the
   * pane already holding the path, which would close the source tab without
   * opening anything in the target. Here the tab object itself moves, so its
   * id, document and pinned state survive. When the target already shows the
   * same tab id, the move collapses into an activation, keeping one tab per
   * pane.
   */
  function moveTabToPane(sourcePaneId: PaneId, tabId: string, targetPaneId: PaneId) {
    if (sourcePaneId === targetPaneId) return
    const sourcePane = layout.value.panesById[sourcePaneId]
    const targetPane = layout.value.panesById[targetPaneId]
    if (!sourcePane || !targetPane) return
    const sourceTab = sourcePane.openTabs.find((tab) => tab.id === tabId)
    if (!sourceTab) return

    const nextSourceTabs = sourcePane.openTabs.filter((tab) => tab.id !== tabId)
    const nextSourceActive = sourcePane.activeTabId === tabId
      ? (sourcePane.recentTabIds.find((id) => id !== tabId && nextSourceTabs.some((tab) => tab.id === id))
        ?? nextSourceTabs[0]?.id
        ?? '')
      : sourcePane.activeTabId
    const alreadyInTarget = targetPane.openTabs.some((tab) => tab.id === tabId)
    const nextTargetTabs = alreadyInTarget ? targetPane.openTabs : [...targetPane.openTabs, sourceTab]

    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [sourcePaneId]: withTabs(sourcePane, nextSourceTabs, nextSourceActive),
        [targetPaneId]: withTabs(targetPane, nextTargetTabs, tabId)
      },
      activePaneId: targetPaneId
    }
  }

  function revealDocumentInPane(path: string, paneId: PaneId = layout.value.activePaneId) {
    const targetPath = path.trim()
    if (!targetPath) return

    const targetPane = layout.value.panesById[paneId]
    if (!targetPane) return

    const existingInTarget = targetPane.openTabs.find((tab) => hasTabPath(tab) && tab.type === 'document' && tab.path === targetPath)
    if (existingInTarget) {
      setActiveTabInPane(paneId, existingInTarget.id)
      return
    }

    const existingPaneId = findPaneContainingDocument(targetPath)
    if (!existingPaneId || existingPaneId === paneId) {
      openDocumentInPane(targetPath, paneId)
      return
    }

    const sourceTab = layout.value.panesById[existingPaneId]?.openTabs
      .find((tab) => hasTabPath(tab) && tab.type === 'document' && tab.path === targetPath)
    if (!sourceTab) return
    moveTabToPane(existingPaneId, sourceTab.id, paneId)
  }

  function openSurfaceInPane(type: Exclude<SurfaceType, 'document'>, paneId: PaneId = layout.value.activePaneId) {
    const existingPaneId = findPaneContainingSurface(type)
    if (existingPaneId) {
      const existingPane = layout.value.panesById[existingPaneId]
      const tab = existingPane.openTabs.find((item) => item.type === type)
      if (!tab) return
      setActiveTabInPane(existingPaneId, tab.id)
      return
    }

    const pane = layout.value.panesById[paneId]
    if (!pane) return
    const tab: PaneTab = {
      id: surfaceTabId(type),
      type,
      pinned: false
    }

    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [paneId]: withTabs(pane, [...pane.openTabs, tab], tab.id)
      },
      activePaneId: paneId
    }
  }

  function closeTabInPane(paneId: PaneId, tabId: string) {
    const pane = layout.value.panesById[paneId]
    if (!pane) return
    const index = pane.openTabs.findIndex((tab) => tab.id === tabId)
    if (index < 0) return

    const nextTabs = pane.openTabs.filter((tab) => tab.id !== tabId)
    // Closing the active tab returns to the most recently consulted tab, which
    // is usually closer to the user's intent than the visual neighbour.
    const activeTabId = pane.activeTabId === tabId
      ? (pane.recentTabIds.find((id) => id !== tabId && nextTabs.some((tab) => tab.id === id)) ?? nextTabs[0]?.id ?? '')
      : pane.activeTabId

    pushClosedTab({ paneId, tab: pane.openTabs[index], index })

    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [paneId]: withTabs(pane, nextTabs, activeTabId)
      }
    }
  }

  function closeOtherTabsInPane(paneId: PaneId, tabId: string): string[] {
    const pane = layout.value.panesById[paneId]
    if (!pane) return []
    const active = pane.openTabs.find((tab) => tab.id === tabId)
    if (!active) return []

    // Pinned tabs survive "close others"; the requested tab always survives.
    const kept = pane.openTabs.filter((tab) => tab.id === tabId || tab.pinned)
    const removed = pane.openTabs.filter((tab) => tab.id !== tabId && !tab.pinned)
    removed.forEach((tab) => pushClosedTab({ paneId, tab, index: pane.openTabs.indexOf(tab) }))

    const removedDocumentPaths = removed
      .flatMap((tab) => (tab.type === 'document' || tab.type === 'file-inspector' ? [tab.path] : []))

    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [paneId]: withTabs(pane, kept, active.id)
      },
      activePaneId: paneId
    }

    return removedDocumentPaths
  }

  /** Closes every tab to the left of the requested tab and keeps the tab itself. */
  function closeTabsLeftInPane(paneId: PaneId, tabId: string): string[] {
    const next = closeTabsRelativeToTab(layout.value, paneId, tabId, 'left')
    layout.value = next.nextLayout
    next.removedEntries.forEach(pushClosedTab)
    return next.removedDocumentPaths
  }

  /** Closes every tab to the right of the requested tab and keeps the tab itself. */
  function closeTabsRightInPane(paneId: PaneId, tabId: string): string[] {
    const next = closeTabsRelativeToTab(layout.value, paneId, tabId, 'right')
    layout.value = next.nextLayout
    next.removedEntries.forEach(pushClosedTab)
    return next.removedDocumentPaths
  }

  function closeAllTabsInPane(paneId: PaneId) {
    const pane = layout.value.panesById[paneId]
    if (!pane) return
    pane.openTabs.forEach((tab, index) => pushClosedTab({ paneId, tab, index }))
    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [paneId]: withTabs(pane, [], '')
      },
      activePaneId: paneId
    }
  }

  /**
   * Pins or unpins a tab, keeping pinned tabs as a prefix of the strip.
   *
   * Pinning moves the tab to the front; unpinning drops it into the first
   * unpinned slot, right after the remaining pinned prefix. Pinning is layout
   * state only: it never touches the note itself or its favourite status.
   */
  function setTabPinnedInPane(paneId: PaneId, tabId: string, pinned: boolean) {
    const pane = layout.value.panesById[paneId]
    if (!pane) return
    const tab = pane.openTabs.find((item) => item.id === tabId)
    if (!tab || tab.pinned === pinned) return

    const others = pane.openTabs.filter((item) => item.id !== tabId)
    const updated = { ...tab, pinned }
    const nextTabs = pinned
      ? [updated, ...others]
      : [
          ...others.slice(0, others.filter((item) => item.pinned).length),
          updated,
          ...others.slice(others.filter((item) => item.pinned).length)
        ]

    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [paneId]: withTabs(pane, nextTabs, pane.activeTabId)
      }
    }
  }

  /**
   * Moves a tab to an insertion slot expressed against the current order.
   *
   * `targetSlot` is a gap index in the current array (`0..length`), which is
   * what a drop between two tabs naturally reports. The slot is clamped to the
   * tab's own region, so a dragged tab can never cross the pinned boundary:
   * pinned tabs stay in the prefix and unpinned tabs stay after it.
   */
  function reorderTabInPane(paneId: PaneId, tabId: string, targetSlot: number) {
    const pane = layout.value.panesById[paneId]
    if (!pane) return
    const from = pane.openTabs.findIndex((tab) => tab.id === tabId)
    if (from < 0) return
    const tab = pane.openTabs[from]
    const pinnedCount = pane.openTabs.filter((item) => item.pinned).length
    const min = tab.pinned ? 0 : pinnedCount
    const max = tab.pinned ? pinnedCount : pane.openTabs.length
    const slot = Math.min(Math.max(targetSlot, min), max)
    const to = slot > from ? slot - 1 : slot
    if (to === from) return

    const nextTabs = [...pane.openTabs]
    nextTabs.splice(from, 1)
    nextTabs.splice(to, 0, tab)

    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [paneId]: withTabs(pane, nextTabs, pane.activeTabId)
      }
    }
  }

  /** Closes every unpinned tab and keeps the pinned ones in place. */
  function closeAllUnpinnedTabsInPane(paneId: PaneId): string[] {
    const pane = layout.value.panesById[paneId]
    if (!pane) return []

    const kept = pane.openTabs.filter((tab) => tab.pinned)
    const removed = pane.openTabs.filter((tab) => !tab.pinned)
    if (!removed.length) return []
    removed.forEach((tab) => pushClosedTab({ paneId, tab, index: pane.openTabs.indexOf(tab) }))

    const activeTabId = kept.some((tab) => tab.id === pane.activeTabId)
      ? pane.activeTabId
      : (pane.recentTabIds.find((id) => kept.some((tab) => tab.id === id)) ?? kept[0]?.id ?? '')

    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [paneId]: withTabs(pane, kept, activeTabId)
      },
      activePaneId: paneId
    }

    return removed.flatMap((tab) => (tab.type === 'document' || tab.type === 'file-inspector' ? [tab.path] : []))
  }

  function splitPane(paneId: PaneId, axis: 'row' | 'column'): PaneId | null {
    const sourcePane = layout.value.panesById[paneId]
    if (!sourcePane) return null
    if (paneCount() >= MAX_PANES) return null

    const existingIds = new Set(Object.keys(layout.value.panesById))
    const newPaneId = makeNextPaneId(existingIds)
    const newPane: PaneState = {
      id: newPaneId,
      openTabs: [],
      activeTabId: '',
      activePath: '',
      recentTabIds: []
    }

    const pathToSource = buildPathToPane(layout.value.root, paneId)
    if (!pathToSource) return null

    const replacement: SplitNode = {
      kind: 'split',
      axis,
      ratio: 0.5,
      a: { kind: 'pane', paneId },
      b: { kind: 'pane', paneId: newPaneId }
    }

    layout.value = {
      ...layout.value,
      root: replaceNodeAtPath(layout.value.root, pathToSource, replacement),
      panesById: {
        ...layout.value.panesById,
        [newPaneId]: newPane
      },
      activePaneId: newPaneId
    }

    return newPaneId
  }

  function closePane(paneId: PaneId): boolean {
    if (!layout.value.panesById[paneId]) return false
    if (paneCount() <= 1) return false

    const orderBefore = paneOrder.value
    const indexBefore = orderBefore.indexOf(paneId)

    const nextPanes = { ...layout.value.panesById }
    delete nextPanes[paneId]

    const nextRoot = removePaneFromTree(layout.value.root, paneId)
    const orderAfter = listPaneIdsInOrder(nextRoot)
    const nextFocus = orderAfter[Math.max(0, Math.min(indexBefore, orderAfter.length - 1))] ?? orderAfter[0]

    layout.value = {
      root: nextRoot,
      panesById: nextPanes,
      activePaneId: nextFocus
    }

    return true
  }

  function focusPaneByIndex(index1to4: number): boolean {
    if (!Number.isInteger(index1to4) || index1to4 < 1 || index1to4 > 4) return false
    const paneId = paneOrder.value[index1to4 - 1]
    if (!paneId) return false
    setActivePane(paneId)
    return true
  }

  function focusAdjacentPane(direction: MoveDirection): boolean {
    const order = paneOrder.value
    if (order.length <= 1) return false
    const current = order.indexOf(layout.value.activePaneId)
    if (current < 0) return false
    const step = direction === 'next' ? 1 : -1
    const nextIndex = (current + step + order.length) % order.length
    setActivePane(order[nextIndex])
    return true
  }

  function moveActiveTabToAdjacentPane(direction: MoveDirection): boolean {
    const sourceId = layout.value.activePaneId
    let order = paneOrder.value
    let targetId = ''
    if (order.length <= 1) {
      if (direction !== 'next') return false
      const createdPaneId = splitPane(sourceId, 'row')
      if (!createdPaneId) return false
      targetId = createdPaneId
      order = paneOrder.value
      setActivePane(sourceId)
    }

    const source = layout.value.panesById[sourceId]
    if (!source || !source.activeTabId) return false

    const sourceTab = source.openTabs.find((tab) => tab.id === source.activeTabId)
    if (!sourceTab) return false

    if (!targetId) {
      const sourceIndex = order.indexOf(sourceId)
      if (sourceIndex < 0) return false
      const step = direction === 'next' ? 1 : -1
      targetId = order[(sourceIndex + step + order.length) % order.length]
    }

    const target = layout.value.panesById[targetId]
    if (!target) return false

    const duplicateInTarget = target.openTabs.find((tab) => {
      if (sourceTab.type === 'document' && tab.type === 'document') {
        return tab.path === sourceTab.path
      }
      if (sourceTab.type === 'file-inspector' && tab.type === 'file-inspector') {
        return tab.path === sourceTab.path
      }
      return sourceTab.type !== 'document' &&
        sourceTab.type !== 'file-inspector' &&
        isSpecialSurface(sourceTab.type) &&
        tab.type === sourceTab.type
    })

    const sourceTabs = source.openTabs.filter((tab) => tab.id !== sourceTab.id)
    const nextSourceActive = sourceTabs[0]?.id ?? ''

    if (duplicateInTarget) {
      layout.value = {
        ...layout.value,
        panesById: {
          ...layout.value.panesById,
          [sourceId]: withTabs(source, sourceTabs, nextSourceActive),
          [targetId]: withTabs(target, target.openTabs, duplicateInTarget.id)
        },
        activePaneId: targetId
      }
      return true
    }

    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [sourceId]: withTabs(source, sourceTabs, nextSourceActive),
        [targetId]: withTabs(target, [...target.openTabs, { ...sourceTab }], sourceTab.id)
      },
      activePaneId: targetId
    }

    return true
  }

  /**
   * Activates the next or previous tab in the active pane's MRU order.
   *
   * The MRU order is deliberately not reordered here: cycling has to be a stable
   * walk, otherwise `Ctrl+Tab` followed by `Ctrl+Shift+Tab` would not return to
   * the tab the user started from.
   */
  /**
   * Returns the tab the MRU cycle would activate, without changing anything.
   *
   * The walk is a pure step over `recentTabIds` and never reorders it, so
   * `Ctrl+Tab` followed by `Ctrl+Shift+Tab` lands back on the starting tab.
   */
  function recentTabTargetId(pane: PaneState, direction: MoveDirection): string {
    const order = pane.recentTabIds.filter((id) => pane.openTabs.some((tab) => tab.id === id))
    if (order.length < 2) return ''
    const current = order.indexOf(pane.activeTabId)
    const step = direction === 'next' ? 1 : -1
    const nextIndex = current < 0 ? 0 : (current + step + order.length) % order.length
    const nextId = order[nextIndex]
    return nextId && nextId !== pane.activeTabId ? nextId : ''
  }

  /** Returns the path the MRU cycle would activate in the active pane. */
  function getRecentTabTarget(direction: MoveDirection): string {
    const pane = layout.value.panesById[layout.value.activePaneId]
    if (!pane) return ''
    const nextId = recentTabTargetId(pane, direction)
    return nextId ? documentPathForTabId(pane.openTabs, nextId) : ''
  }

  function cycleRecentTab(direction: MoveDirection): boolean {
    const pane = layout.value.panesById[layout.value.activePaneId]
    if (!pane) return false
    const nextId = recentTabTargetId(pane, direction)
    if (!nextId) return false
    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [pane.id]: {
          ...pane,
          activeTabId: nextId,
          activePath: documentPathForTabId(pane.openTabs, nextId)
        }
      }
    }
    return true
  }

  function closeAllTabsAndResetLayout() {
    layout.value = createInitialLayout()
  }

  function replacePath(fromPath: string, toPath: string) {
    const from = fromPath.trim()
    const to = toPath.trim()
    if (!from || !to || from === to) return

    const targetPaneWithTo = findPaneContainingPath(to)
    const renamedTabId = documentTabId(to)

    const nextPanes: Record<PaneId, PaneState> = {}
    for (const [paneId, pane] of Object.entries(layout.value.panesById)) {
      const activeTab = pane.openTabs.find((tab) => tab.id === pane.activeTabId) ?? null
      const shouldRemapActiveTab =
        (activeTab?.type === 'document' || activeTab?.type === 'file-inspector') && activeTab.path === from
      const nextTabs: PaneTab[] = []
      for (const tab of pane.openTabs) {
        if (tab.type !== 'document' && tab.type !== 'file-inspector') {
          nextTabs.push(tab)
          continue
        }
        if (tab.path === from) {
          if (targetPaneWithTo && targetPaneWithTo !== paneId) {
            continue
          }
          nextTabs.push({
            ...tab,
            path: to,
            id: tab.type === 'document' ? documentTabId(to) : fileInspectorTabId(to)
          })
          continue
        }
        nextTabs.push(tab)
      }

      const resolvedActiveTabId = shouldRemapActiveTab
        ? (activeTab?.type === 'document' ? renamedTabId : fileInspectorTabId(to))
        : (nextTabs.some((tab) => tab.id === pane.activeTabId) ? pane.activeTabId : (nextTabs[0]?.id ?? ''))
      // Remap the MRU order through the same id rewrite so it keeps pointing at
      // the renamed tab instead of a stale id.
      const remappedRecent = pane.recentTabIds.map((id) => {
        if (id !== documentTabId(from) && id !== fileInspectorTabId(from)) return id
        return id === documentTabId(from) ? renamedTabId : fileInspectorTabId(to)
      })
      nextPanes[paneId] = withTabs({ ...pane, recentTabIds: remappedRecent }, nextTabs, resolvedActiveTabId)
    }

    layout.value = {
      ...layout.value,
      panesById: nextPanes
    }
  }

  function resetToSinglePane() {
    const activeTab = getActiveTab(layout.value.activePaneId)
    const single = createInitialLayout()

    if (activeTab) {
      single.panesById[single.activePaneId] = withTabs(
        single.panesById[single.activePaneId],
        [{ ...activeTab }],
        activeTab.id
      )
    }

    layout.value = single
  }

  function joinAllPanes() {
    const activeTab = getActiveTab(layout.value.activePaneId)
    const mergedTabs: PaneTab[] = []
    const seenDocs = new Set<string>()
    const seenSurfaces = new Set<string>()

    for (const paneId of paneOrder.value) {
      const pane = layout.value.panesById[paneId]
      if (!pane) continue
      for (const tab of pane.openTabs) {
        if (tab.type === 'document') {
          if (seenDocs.has(tab.path)) continue
          seenDocs.add(tab.path)
          mergedTabs.push({ ...tab, id: documentTabId(tab.path) })
          continue
        }
        if (tab.type === 'file-inspector') {
          if (seenDocs.has(`inspector:${tab.path}`)) continue
          seenDocs.add(`inspector:${tab.path}`)
          mergedTabs.push({ ...tab, id: fileInspectorTabId(tab.path) })
          continue
        }
        if (seenSurfaces.has(tab.type)) continue
        seenSurfaces.add(tab.type)
        mergedTabs.push({ ...tab, id: surfaceTabId(tab.type) })
      }
    }

    const single = createInitialLayout()
    const mergedActiveTabId = activeTab && mergedTabs.some((tab) => tab.id === activeTab.id)
      ? activeTab.id
      : (mergedTabs[0]?.id ?? '')

    single.panesById[single.activePaneId] = withTabs(
      single.panesById[single.activePaneId],
      mergedTabs,
      mergedActiveTabId
    )
    layout.value = single
  }

  // Compatibility wrappers for the existing app integration.
  function openPathInPane(path: string, paneId?: PaneId) {
    openDocumentInPane(path, paneId)
  }

  function setActivePathInPane(paneId: PaneId, path: string) {
    const target = path.trim()
    if (!target) return
    const pane = layout.value.panesById[paneId]
    if (!pane) return
    const tab = pane.openTabs.find((item) => hasTabPath(item) && item.path === target && (item.type === 'document' || item.type === 'file-inspector'))
    if (!tab) {
      const existingPaneId = findPaneContainingDocument(target)
      const existingInspectorPaneId = findPaneContainingInspector(target)
      const matchingPaneId = existingPaneId ?? existingInspectorPaneId
      if (matchingPaneId) {
        const existingPane = layout.value.panesById[matchingPaneId]
        const existingTab = existingPane.openTabs.find((item) => hasTabPath(item) && item.path === target && (item.type === 'document' || item.type === 'file-inspector'))
        if (existingTab) setActiveTabInPane(matchingPaneId, existingTab.id)
      }
      return
    }
    setActiveTabInPane(paneId, tab.id)
  }

  return {
    layout,
    paneOrder,
    closedTabs,
    reopenLastClosedTab,
    cycleRecentTab,
    openDocumentInPane,
    openInspectorInPane,
    revealDocumentInPane,
    openSurfaceInPane,
    setActivePane,
    setActiveTabInPane,
    findPaneContainingDocument,
    findPaneContainingInspector,
    findPaneContainingSurface,
    closeTabInPane,
    closeOtherTabsInPane,
    closeTabsLeftInPane,
    closeTabsRightInPane,
    closeAllTabsInPane,
    closeAllUnpinnedTabsInPane,
    setTabPinnedInPane,
    getRecentTabTarget,
    reorderTabInPane,
    moveTabToPane,
    closeAllTabsAndResetLayout,
    splitPane,
    closePane,
    moveActiveTabToAdjacentPane,
    focusAdjacentPane,
    focusPaneByIndex,
    replacePath,
    resetToSinglePane,
    joinAllPanes,
    getActiveTab,
    getActiveDocumentPath,
    getOpenDocumentPaths,
    // Compatibility
    openPathInPane,
    setActivePathInPane,
    findPaneContainingPath
  }
}
