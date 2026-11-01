import { describe, expect, it } from 'vitest'
import type { TreeNode } from '../../../shared/api/apiTypes'
import { filterExplorerRows } from './explorerFilter'
import type { ExplorerVisibleRow } from '../composables/useExplorerTreeState'
import { buildJournalTimeline } from '../../../app/lib/journalTimeline'
import { planJournalOrganization } from '../../../app/lib/journalOrganization'

/**
 * Responsiveness guard for the explorer's pure derivation paths.
 *
 * The target workspaces are nested 500- and 1,000-note trees. These budgets are
 * deliberately loose (they run on shared CI machines) but still catch an
 * accidental quadratic scan or a per-keystroke full-tree rebuild.
 */
const FILTER_BUDGET_MS = 60
const TIMELINE_BUDGET_MS = 60

type Fixture = {
  rootPath: string
  childrenByDir: Record<string, TreeNode[]>
  visibleRows: ExplorerVisibleRow[]
  journalPaths: string[]
}

function dirNode(path: string): TreeNode {
  return { name: path.split('/').pop() ?? path, path, is_dir: true, is_markdown: false, has_children: true }
}

function fileNode(path: string): TreeNode {
  return { name: path.split('/').pop() ?? path, path, is_dir: false, is_markdown: true, has_children: false }
}

/** Builds a nested workspace with `folders` folders of `perFolder` notes each. */
function buildFixture(folders: number, perFolder: number): Fixture {
  const rootPath = '/vault'
  const childrenByDir: Record<string, TreeNode[]> = { [rootPath]: [] }
  const visibleRows: ExplorerVisibleRow[] = []
  const journalPaths: string[] = []

  for (let folderIndex = 0; folderIndex < folders; folderIndex += 1) {
    const folderPath = `${rootPath}/area-${folderIndex}`
    childrenByDir[rootPath].push(dirNode(folderPath))
    childrenByDir[folderPath] = []
    visibleRows.push({ path: folderPath, depth: 0 })

    for (let noteIndex = 0; noteIndex < perFolder; noteIndex += 1) {
      const notePath = `${folderPath}/note-${folderIndex}-${noteIndex}.md`
      childrenByDir[folderPath].push(fileNode(notePath))
      visibleRows.push({ path: notePath, depth: 1 })
    }
  }

  // A dated journal subtree large enough to exercise grouping and planning.
  const journalRoot = `${rootPath}/journal`
  childrenByDir[rootPath].push(dirNode(journalRoot))
  childrenByDir[journalRoot] = []
  visibleRows.push({ path: journalRoot, depth: 0 })
  for (let index = 0; index < folders * perFolder; index += 1) {
    const year = 2020 + Math.floor(index / 365)
    const month = String((index % 12) + 1).padStart(2, '0')
    const day = String((index % 28) + 1).padStart(2, '0')
    const monthDir = `${journalRoot}/${year}/${month}`
    if (!childrenByDir[monthDir]) {
      childrenByDir[monthDir] = []
      const yearDir = `${journalRoot}/${year}`
      if (!childrenByDir[yearDir]) {
        childrenByDir[yearDir] = []
        childrenByDir[journalRoot].push(dirNode(yearDir))
      }
      childrenByDir[yearDir].push(dirNode(monthDir))
    }
    const notePath = `${monthDir}/${year}-${month}-${day}-${index}.md`
    childrenByDir[monthDir].push(fileNode(notePath))
    journalPaths.push(notePath)
  }

  return { rootPath, childrenByDir, visibleRows, journalPaths }
}

function measure(task: () => void): number {
  const started = performance.now()
  task()
  return performance.now() - started
}

describe('explorer responsiveness', () => {
  for (const [folders, perFolder] of [[10, 50], [20, 50]] as const) {
    const noteCount = folders * perFolder
    const label = `${noteCount}-note workspace`

    it(`filters a nested ${label} within budget`, () => {
      const fixture = buildFixture(folders, perFolder)
      const elapsed = measure(() => {
        filterExplorerRows('note-1', fixture.visibleRows, {
          rootPath: fixture.rootPath,
          childrenByDir: fixture.childrenByDir
        })
      })

      console.info(`[perf] filter ${label}: ${elapsed.toFixed(2)}ms`)
      expect(elapsed).toBeLessThan(FILTER_BUDGET_MS)
    })

    it(`derives the journal timeline for ${noteCount} dated notes within budget`, () => {
      const fixture = buildFixture(folders, perFolder)
      const elapsed = measure(() => {
        buildJournalTimeline(fixture.journalPaths, {
          journalFolder: `${fixture.rootPath}/journal`,
          today: '2026-03-13'
        })
      })

      console.info(`[perf] journal timeline ${noteCount} dated notes: ${elapsed.toFixed(2)}ms`)
      expect(elapsed).toBeLessThan(TIMELINE_BUDGET_MS)
    })

    it(`plans journal organization for ${noteCount} dated notes within budget`, () => {
      const fixture = buildFixture(folders, perFolder)
      const timeline = buildJournalTimeline(fixture.journalPaths, {
        journalFolder: `${fixture.rootPath}/journal`,
        today: '2026-03-13'
      })
      const entries = timeline.groups.flatMap((group) => group.entries)

      const elapsed = measure(() => {
        planJournalOrganization(entries, { root: fixture.rootPath, journalFolder: 'journal' })
      })

      console.info(`[perf] journal organization ${noteCount} dated notes: ${elapsed.toFixed(2)}ms`)
      expect(elapsed).toBeLessThan(TIMELINE_BUDGET_MS)
    })
  }
})
