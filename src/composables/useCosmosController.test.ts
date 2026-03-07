import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useCosmosController } from './useCosmosController'
import type { WikilinkGraph } from '../lib/apiTypes'

const rawGraph: WikilinkGraph = {
  nodes: [
    { id: 'a', path: '/vault/a.md', label: 'a', degree: 2, tags: [], cluster: null },
    { id: 'b', path: '/vault/b.md', label: 'b', degree: 1, tags: [], cluster: null },
    { id: 'c', path: '/vault/c.md', label: 'c', degree: 0, tags: [], cluster: null }
  ],
  edges: [
    { source: 'a', target: 'b', type: 'wikilink' }
  ],
  generated_at_ms: 1
}

async function flush() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useCosmosController', () => {
  it('keeps query untouched when selecting/focusing nodes', async () => {
    const scope = effectScope()
    await scope.run(async () => {
      const ctrl = useCosmosController({
        workingFolderPath: ref('/vault'),
        activeTabPath: ref('/vault/a.md'),
        getWikilinkGraph: vi.fn(async () => rawGraph),
        reindexMarkdownFile: vi.fn(async () => {}),
        readTextFile: vi.fn(async () => '# A'),
        ftsSearch: vi.fn(async () => [])
      })

      await ctrl.refreshGraph()
      ctrl.query.value = 'abc'
      ctrl.selectNode('a')
      expect(ctrl.query.value).toBe('abc')

      ctrl.focusMatch('b')
      expect(ctrl.query.value).toBe('abc')
      expect(ctrl.selectedNodeId.value).toBe('b')
    })
    scope.stop()
  })

  it('searchEnter selects first match and returns node id', async () => {
    const scope = effectScope()
    await scope.run(async () => {
      const ctrl = useCosmosController({
        workingFolderPath: ref('/vault'),
        activeTabPath: ref('/vault/a.md'),
        getWikilinkGraph: vi.fn(async () => rawGraph),
        reindexMarkdownFile: vi.fn(async () => {}),
        readTextFile: vi.fn(async () => '# A'),
        ftsSearch: vi.fn(async () => [])
      })

      await ctrl.refreshGraph()
      ctrl.query.value = 'b'
      const nodeId = ctrl.searchEnter()

      expect(nodeId).toBe('b')
      expect(ctrl.selectedNodeId.value).toBe('b')
    })
    scope.stop()
  })

  it('expandNeighborhood enables focus mode and increments depth', async () => {
    const scope = effectScope()
    await scope.run(async () => {
      const ctrl = useCosmosController({
        workingFolderPath: ref('/vault'),
        activeTabPath: ref('/vault/a.md'),
        getWikilinkGraph: vi.fn(async () => rawGraph),
        reindexMarkdownFile: vi.fn(async () => {}),
        readTextFile: vi.fn(async () => '# A'),
        ftsSearch: vi.fn(async () => [])
      })

      await ctrl.refreshGraph()
      ctrl.selectNode('a')
      expect(ctrl.focusMode.value).toBe(false)
      expect(ctrl.focusDepth.value).toBe(1)

      ctrl.expandNeighborhood()
      expect(ctrl.focusMode.value).toBe(true)
      expect(ctrl.focusDepth.value).toBe(2)
    })
    scope.stop()
  })

  it('resets stale selection when refreshed graph no longer contains selected node', async () => {
    const getGraph = vi
      .fn<() => Promise<WikilinkGraph>>()
      .mockResolvedValueOnce(rawGraph)
      .mockResolvedValueOnce({ ...rawGraph, nodes: rawGraph.nodes.filter((n) => n.id !== 'a') })

    const scope = effectScope()
    await scope.run(async () => {
      const ctrl = useCosmosController({
        workingFolderPath: ref('/vault'),
        activeTabPath: ref('/vault/a.md'),
        getWikilinkGraph: getGraph,
        reindexMarkdownFile: vi.fn(async () => {}),
        readTextFile: vi.fn(async () => '# A'),
        ftsSearch: vi.fn(async () => [])
      })

      await ctrl.refreshGraph()
      ctrl.selectNode('a')
      expect(ctrl.selectedNodeId.value).toBe('a')

      await ctrl.refreshGraph()
      expect(ctrl.selectedNodeId.value).toBe('')
      expect(ctrl.focusDepth.value).toBe(1)
    })
    scope.stop()
  })

  it('loads preview and surfaces read failures', async () => {
    const readTextFile = vi
      .fn<(path: string) => Promise<string>>()
      .mockResolvedValueOnce('# A\n\ncontent')
      .mockRejectedValueOnce(new Error('boom'))

    const scope = effectScope()
    await scope.run(async () => {
      const ctrl = useCosmosController({
        workingFolderPath: ref('/vault'),
        activeTabPath: ref('/vault/a.md'),
        getWikilinkGraph: vi.fn(async () => rawGraph),
        reindexMarkdownFile: vi.fn(async () => {}),
        readTextFile,
        ftsSearch: vi.fn(async () => [])
      })

      await ctrl.refreshGraph()
      ctrl.selectNode('a')
      await flush()
      expect(ctrl.preview.value).toContain('content')
      expect(ctrl.previewError.value).toBe('')

      ctrl.selectNode('b')
      await flush()
      expect(ctrl.preview.value).toBe('')
      expect(ctrl.previewError.value).toBe('boom')
    })
    scope.stop()
  })

  it('filters semantic edges when toggle is off', async () => {
    const scope = effectScope()
    await scope.run(async () => {
      const ctrl = useCosmosController({
        workingFolderPath: ref('/vault'),
        activeTabPath: ref('/vault/a.md'),
        getWikilinkGraph: vi.fn(async () => ({
          ...rawGraph,
          edges: [
            { source: 'a', target: 'b', type: 'wikilink' as const },
            { source: 'a', target: 'c', type: 'semantic' as const, score: 0.82 }
          ]
        })),
        reindexMarkdownFile: vi.fn(async () => {}),
        readTextFile: vi.fn(async () => '# A'),
        ftsSearch: vi.fn(async () => [])
      })

      await ctrl.refreshGraph()
      expect(ctrl.visibleGraph.value.edges).toHaveLength(2)
      ctrl.showSemanticEdges.value = false
      expect(ctrl.visibleGraph.value.edges).toHaveLength(1)
      expect(ctrl.visibleGraph.value.edges[0]?.type).toBe('wikilink')
    })
    scope.stop()
  })

  it('prefers semantic search order when available', async () => {
    const scope = effectScope()
    await scope.run(async () => {
      const ctrl = useCosmosController({
        workingFolderPath: ref('/vault'),
        activeTabPath: ref('/vault/a.md'),
        getWikilinkGraph: vi.fn(async () => rawGraph),
        reindexMarkdownFile: vi.fn(async () => {}),
        readTextFile: vi.fn(async () => '# A'),
        ftsSearch: vi.fn(async () => [
          { path: '/vault/b.md', snippet: 'B', score: 2 },
          { path: '/vault/a.md', snippet: 'A', score: 1 }
        ])
      })

      await ctrl.refreshGraph()
      ctrl.query.value = 'x'
      await new Promise<void>((resolve) => setTimeout(resolve, 320))
      await flush()
      expect(ctrl.queryMatches.value.map((item) => item.id)).toEqual(['b', 'a'])
    })
    scope.stop()
  })

  it('deduplicates semantic search order results by node', async () => {
    const scope = effectScope()
    await scope.run(async () => {
      const ctrl = useCosmosController({
        workingFolderPath: ref('/vault'),
        activeTabPath: ref('/vault/a.md'),
        getWikilinkGraph: vi.fn(async () => rawGraph),
        reindexMarkdownFile: vi.fn(async () => {}),
        readTextFile: vi.fn(async () => '# A'),
        ftsSearch: vi.fn(async () => [
          { path: '/vault/a.md', snippet: 'A-1', score: 3 },
          { path: '/vault/a.md', snippet: 'A-2', score: 2 },
          { path: '/vault/b.md', snippet: 'B', score: 1 }
        ])
      })

      await ctrl.refreshGraph()
      ctrl.query.value = 'ia'
      await new Promise<void>((resolve) => setTimeout(resolve, 320))
      await flush()
      expect(ctrl.queryMatches.value.map((item) => item.id)).toEqual(['a', 'b'])
    })
    scope.stop()
  })

  it('ignores stale refresh errors when a newer refresh succeeds', async () => {
    const first = deferred<WikilinkGraph>()
    const second = deferred<WikilinkGraph>()
    let calls = 0
    const getWikilinkGraph = vi.fn(async () => {
      calls += 1
      return calls === 1 ? first.promise : second.promise
    })

    const scope = effectScope()
    await scope.run(async () => {
      const ctrl = useCosmosController({
        workingFolderPath: ref('/vault'),
        activeTabPath: ref('/vault/a.md'),
        getWikilinkGraph,
        reindexMarkdownFile: vi.fn(async () => {}),
        readTextFile: vi.fn(async () => '# A'),
        ftsSearch: vi.fn(async () => [])
      })

      const early = ctrl.refreshGraph()
      const latest = ctrl.refreshGraph()

      second.resolve(rawGraph)
      await latest
      first.reject(new Error('Database operation failed.'))
      await early.catch(() => {})

      expect(ctrl.error.value).toBe('')
      expect(ctrl.graph.value.nodes.length).toBe(rawGraph.nodes.length)
    })
    scope.stop()
  })

  it('continues graph loading when active-note reindex fails', async () => {
    const scope = effectScope()
    await scope.run(async () => {
      const ctrl = useCosmosController({
        workingFolderPath: ref('/vault'),
        activeTabPath: ref('/vault/a.md'),
        getWikilinkGraph: vi.fn(async () => rawGraph),
        reindexMarkdownFile: vi.fn(async () => {
          throw new Error('database busy')
        }),
        readTextFile: vi.fn(async () => '# A'),
        ftsSearch: vi.fn(async () => [])
      })

      await ctrl.refreshGraph()
      expect(ctrl.error.value).toBe('')
      expect(ctrl.graph.value.nodes.length).toBe(rawGraph.nodes.length)
    })
    scope.stop()
  })
})
