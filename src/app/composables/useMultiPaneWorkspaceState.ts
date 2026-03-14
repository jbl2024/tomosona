import { computed, ref } from 'vue'

export type PaneId = string

export type SurfaceType = 'document' | 'home' | 'cosmos' | 'second-brain-chat'

export type PaneTab =
  | { id: string; type: 'document'; path: string; pinned: boolean }
  | { id: string; type: 'home'; pinned: boolean }
  | { id: string; type: 'cosmos'; pinned: boolean }
  | { id: string; type: 'second-brain-chat'; pinned: boolean }

export type PaneState = {
  id: PaneId
  openTabs: PaneTab[]
  activeTabId: string
  activePath?: string
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

function documentTabId(path: string): string {
  return `doc:${path}`
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
        activePath: ''
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
  return active && active.type === 'document' ? active.path : ''
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
  const seenSpecialSurfaces = new Set<string>()
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
      // Backward compatibility: hydrate legacy "second-brain-sessions" tabs as chat tabs.
      const nextType = tab.type === 'second-brain-sessions' ? 'second-brain-chat' : tab.type
      if (nextType === 'home' || nextType === 'cosmos' || nextType === 'second-brain-chat') {
        if (seenSpecialSurfaces.has(nextType)) continue
        seenSpecialSurfaces.add(nextType)
        openTabs.push({ id: surfaceTabId(nextType), type: nextType, pinned: Boolean(tab.pinned) })
      }
    }

    const activeTabIdRaw = typeof paneObj.activeTabId === 'string' ? paneObj.activeTabId : ''
    const activeTabId = openTabs.some((tab) => tab.id === activeTabIdRaw) ? activeTabIdRaw : (openTabs[0]?.id ?? '')

    panesById[paneId] = {
      id: paneId,
      openTabs,
      activeTabId,
      activePath: documentPathForTabId(openTabs, activeTabId)
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
          activePath: pane.activePath ?? ''
        }
      ])
    ),
    activePaneId: layout.activePaneId
  }
}

export function useMultiPaneWorkspaceState(initial: MultiPaneLayout = createInitialLayout()) {
  const layout = ref<MultiPaneLayout>(serializeLayout(initial))

  const paneOrder = computed(() => listPaneIdsInOrder(layout.value.root))

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
    if (!tab || tab.type !== 'document') return ''
    return tab.path
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
        [paneId]: {
          ...pane,
          activeTabId: tabId,
          activePath: documentPathForTabId(pane.openTabs, tabId)
        }
      },
      activePaneId: paneId
    }
  }

  function findPaneContainingDocument(path: string): PaneId | null {
    const target = path.trim()
    if (!target) return null
    for (const pane of Object.values(layout.value.panesById)) {
      if (pane.openTabs.some((tab) => tab.type === 'document' && tab.path === target)) {
        return pane.id
      }
    }
    return null
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
      const tab = existingPane.openTabs.find((item) => item.type === 'document' && item.path === target)
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
        [paneId]: {
          ...pane,
          openTabs: [...pane.openTabs, tab],
          activeTabId: tab.id,
          activePath: target
        }
      },
      activePaneId: paneId
    }
  }

  function revealDocumentInPane(path: string, paneId: PaneId = layout.value.activePaneId) {
    const targetPath = path.trim()
    if (!targetPath) return

    const targetPane = layout.value.panesById[paneId]
    if (!targetPane) return

    const existingInTarget = targetPane.openTabs.find((tab) => tab.type === 'document' && tab.path === targetPath)
    if (existingInTarget) {
      setActiveTabInPane(paneId, existingInTarget.id)
      return
    }

    const existingPaneId = findPaneContainingDocument(targetPath)
    if (!existingPaneId || existingPaneId === paneId) {
      openDocumentInPane(targetPath, paneId)
      return
    }

    const sourcePane = layout.value.panesById[existingPaneId]
    if (!sourcePane) return

    const sourceTab = sourcePane.openTabs.find((tab) => tab.type === 'document' && tab.path === targetPath)
    if (!sourceTab) return

    const nextSourceTabs = sourcePane.openTabs.filter((tab) => tab.id !== sourceTab.id)
    const nextSourceActive = sourcePane.activeTabId === sourceTab.id
      ? (nextSourceTabs[0]?.id ?? '')
      : sourcePane.activeTabId
    const movedTab: PaneTab = {
      ...sourceTab,
      id: documentTabId(targetPath)
    }

    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [existingPaneId]: {
          ...sourcePane,
          openTabs: nextSourceTabs,
          activeTabId: nextSourceActive,
          activePath: documentPathForTabId(nextSourceTabs, nextSourceActive)
        },
        [paneId]: {
          ...targetPane,
          openTabs: [...targetPane.openTabs, movedTab],
          activeTabId: movedTab.id,
          activePath: targetPath
        }
      },
      activePaneId: paneId
    }
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
        [paneId]: {
          ...pane,
          openTabs: [...pane.openTabs, tab],
          activeTabId: tab.id,
          activePath: ''
        }
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
    const activeTabId = pane.activeTabId === tabId
      ? (nextTabs[index]?.id ?? nextTabs[index - 1]?.id ?? '')
      : pane.activeTabId

    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [paneId]: {
          ...pane,
          openTabs: nextTabs,
          activeTabId,
          activePath: documentPathForTabId(nextTabs, activeTabId)
        }
      }
    }
  }

  function closeOtherTabsInPane(paneId: PaneId, tabId: string) {
    const pane = layout.value.panesById[paneId]
    if (!pane) return
    const active = pane.openTabs.find((tab) => tab.id === tabId)
    if (!active) return

    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [paneId]: {
          ...pane,
          openTabs: [active],
          activeTabId: active.id,
          activePath: active.type === 'document' ? active.path : ''
        }
      },
      activePaneId: paneId
    }
  }

  function closeAllTabsInPane(paneId: PaneId) {
    const pane = layout.value.panesById[paneId]
    if (!pane) return
    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [paneId]: {
          ...pane,
          openTabs: [],
          activeTabId: '',
          activePath: ''
        }
      },
      activePaneId: paneId
    }
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
      activePath: ''
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
      return isSpecialSurface(sourceTab.type) && tab.type === sourceTab.type
    })

    const sourceTabs = source.openTabs.filter((tab) => tab.id !== sourceTab.id)
    const nextSourceActive = sourceTabs[0]?.id ?? ''

    if (duplicateInTarget) {
      layout.value = {
        ...layout.value,
        panesById: {
          ...layout.value.panesById,
          [sourceId]: {
            ...source,
            openTabs: sourceTabs,
            activeTabId: nextSourceActive,
            activePath: documentPathForTabId(sourceTabs, nextSourceActive)
          },
          [targetId]: {
            ...target,
            activeTabId: duplicateInTarget.id,
            activePath: duplicateInTarget.type === 'document' ? duplicateInTarget.path : ''
          }
        },
        activePaneId: targetId
      }
      return true
    }

    layout.value = {
      ...layout.value,
      panesById: {
        ...layout.value.panesById,
        [sourceId]: {
          ...source,
          openTabs: sourceTabs,
          activeTabId: nextSourceActive,
          activePath: documentPathForTabId(sourceTabs, nextSourceActive)
        },
        [targetId]: {
          ...target,
          openTabs: [...target.openTabs, { ...sourceTab }],
          activeTabId: sourceTab.id,
          activePath: sourceTab.type === 'document' ? sourceTab.path : ''
        }
      },
      activePaneId: targetId
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

    const targetPaneWithTo = findPaneContainingDocument(to)
    const renamedTabId = documentTabId(to)

    const nextPanes: Record<PaneId, PaneState> = {}
    for (const [paneId, pane] of Object.entries(layout.value.panesById)) {
      const activeTab = pane.openTabs.find((tab) => tab.id === pane.activeTabId) ?? null
      const shouldRemapActiveTab = activeTab?.type === 'document' && activeTab.path === from
      const nextTabs: PaneTab[] = []
      for (const tab of pane.openTabs) {
        if (tab.type !== 'document') {
          nextTabs.push(tab)
          continue
        }
        if (tab.path === from) {
          if (targetPaneWithTo && targetPaneWithTo !== paneId) {
            continue
          }
          nextTabs.push({ ...tab, path: to, id: documentTabId(to) })
          continue
        }
        nextTabs.push(tab)
      }

      const resolvedActiveTabId = shouldRemapActiveTab
        ? renamedTabId
        : (nextTabs.some((tab) => tab.id === pane.activeTabId) ? pane.activeTabId : (nextTabs[0]?.id ?? ''))
      nextPanes[paneId] = {
        ...pane,
        openTabs: nextTabs,
        activeTabId: resolvedActiveTabId,
        activePath: documentPathForTabId(nextTabs, resolvedActiveTabId)
      }
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
      single.panesById[single.activePaneId] = {
        ...single.panesById[single.activePaneId],
        openTabs: [{ ...activeTab }],
        activeTabId: activeTab.id,
        activePath: activeTab.type === 'document' ? activeTab.path : ''
      }
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
        if (seenSurfaces.has(tab.type)) continue
        seenSurfaces.add(tab.type)
        mergedTabs.push({ ...tab, id: surfaceTabId(tab.type) })
      }
    }

    const single = createInitialLayout()
    const mergedActiveTabId = activeTab && mergedTabs.some((tab) => tab.id === activeTab.id)
      ? activeTab.id
      : (mergedTabs[0]?.id ?? '')

    single.panesById[single.activePaneId] = {
      ...single.panesById[single.activePaneId],
      openTabs: mergedTabs,
      activeTabId: mergedActiveTabId,
      activePath: documentPathForTabId(mergedTabs, mergedActiveTabId)
    }
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
    const tab = pane.openTabs.find((item) => item.type === 'document' && item.path === target)
    if (!tab) {
      const existingPaneId = findPaneContainingDocument(target)
      if (existingPaneId) {
        const existingPane = layout.value.panesById[existingPaneId]
        const existingTab = existingPane.openTabs.find((item) => item.type === 'document' && item.path === target)
        if (existingTab) setActiveTabInPane(existingPaneId, existingTab.id)
      }
      return
    }
    setActiveTabInPane(paneId, tab.id)
  }

  function findPaneContainingPath(path: string) {
    return findPaneContainingDocument(path)
  }

  return {
    layout,
    paneOrder,
    openDocumentInPane,
    revealDocumentInPane,
    openSurfaceInPane,
    setActivePane,
    setActiveTabInPane,
    findPaneContainingDocument,
    findPaneContainingSurface,
    closeTabInPane,
    closeOtherTabsInPane,
    closeAllTabsInPane,
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
    // Compatibility
    openPathInPane,
    setActivePathInPane,
    findPaneContainingPath
  }
}
