import { describe, expect, it } from 'vitest'
import type { MovePreflightEntry } from '../../../shared/api/apiTypes'
import { preflightIssueMessage, summarizePreflight } from './mutationPreflight'

function entry(sourcePath: string, issue: MovePreflightEntry['issue']): MovePreflightEntry {
  return {
    sourcePath,
    destinationPath: issue === null ? '/vault/dest/name' : null,
    sourceVersion: null,
    issue
  }
}

describe('mutation preflight summary', () => {
  it('splits ready, collision and blocked entries', () => {
    const summary = summarizePreflight([
      entry('/vault/a.md', null),
      entry('/vault/b.md', 'collision'),
      entry('/vault/c.md', 'stale_source'),
      entry('/vault/d.md', 'symlink')
    ])
    expect(summary.ready.map((item) => item.sourcePath)).toEqual(['/vault/a.md'])
    expect(summary.collisions.map((item) => item.sourcePath)).toEqual(['/vault/b.md'])
    expect(summary.hasBlockingIssues).toBe(true)
    expect(summary.blocked).toEqual([
      { sourcePath: '/vault/c.md', issue: 'stale_source', message: 'The file changed since it was checked. Refresh and try again.' },
      { sourcePath: '/vault/d.md', issue: 'symlink', message: 'Symbolic links are not supported.' }
    ])
  })

  it('does not block on collisions alone', () => {
    const summary = summarizePreflight([entry('/vault/a.md', 'collision')])
    expect(summary.hasBlockingIssues).toBe(false)
    expect(summary.ready).toEqual([])
  })

  it('maps every issue to a clear message', () => {
    const issues = ['invalid_source', 'invalid_name', 'unavailable', 'stale_source', 'workspace_root', 'symlink', 'read_only', 'descendant', 'same_location', 'collision'] as const
    for (const issue of issues) {
      expect(preflightIssueMessage(issue).length).toBeGreaterThan(10)
    }
  })
})
