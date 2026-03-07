import { describe, expect, it } from 'vitest'
import { planWorkspaceFsActions, normalizeFsPath, parentPath } from './workspaceFsPlanner'
import type { WorkspaceFsChange } from '../../../shared/api/apiTypes'

function setOf(values: string[]): Set<string> {
  return new Set(values)
}

describe('workspaceFsPlanner', () => {
  it('normalizes path separators', () => {
    expect(normalizeFsPath('a\\b\\c.md')).toBe('a/b/c.md')
  })

  it('computes parent path', () => {
    expect(parentPath('/tmp/work/a.md')).toBe('/tmp/work')
    expect(parentPath('a.md')).toBe('')
  })

  it('plans create refresh for loaded parent', () => {
    const changes: WorkspaceFsChange[] = [
      { kind: 'created', path: '/ws/notes/new.md', parent: '/ws/notes' }
    ]

    const plan = planWorkspaceFsActions('/ws', setOf(['/ws/notes']), changes)
    expect(Array.from(plan.dirsToRefresh).sort()).toEqual(['/ws', '/ws/notes'])
    expect(Array.from(plan.pathsToPrune)).toEqual([])
  })

  it('derives create parent from path when parent is absent', () => {
    const changes: WorkspaceFsChange[] = [{ kind: 'created', path: '/ws/notes/new.md' }]
    const plan = planWorkspaceFsActions('/ws', setOf(['/ws/notes']), changes)
    expect(plan.dirsToRefresh.has('/ws/notes')).toBe(true)
  })

  it('ignores create parent that is not loaded and not root', () => {
    const changes: WorkspaceFsChange[] = [{ kind: 'created', path: '/ws/other/new.md' }]
    const plan = planWorkspaceFsActions('/ws', setOf(['/ws/notes']), changes)
    expect(Array.from(plan.dirsToRefresh).sort()).toEqual(['/ws'])
  })

  it('plans remove prune and parent refresh', () => {
    const changes: WorkspaceFsChange[] = [
      { kind: 'removed', path: '/ws/notes/deleted.md', parent: '/ws/notes' }
    ]
    const plan = planWorkspaceFsActions('/ws', setOf(['/ws/notes']), changes)
    expect(Array.from(plan.pathsToPrune)).toEqual(['/ws/notes/deleted.md'])
    expect(Array.from(plan.dirsToRefresh).sort()).toEqual(['/ws', '/ws/notes'])
  })

  it('derives remove parent from path when parent is absent', () => {
    const changes: WorkspaceFsChange[] = [{ kind: 'removed', path: '/ws/notes/deleted.md' }]
    const plan = planWorkspaceFsActions('/ws', setOf(['/ws/notes']), changes)
    expect(plan.dirsToRefresh.has('/ws/notes')).toBe(true)
    expect(plan.pathsToPrune.has('/ws/notes/deleted.md')).toBe(true)
  })

  it('plans modified refresh for loaded file and parent', () => {
    const changes: WorkspaceFsChange[] = [
      { kind: 'modified', path: '/ws/notes/file.md', parent: '/ws/notes' }
    ]
    const plan = planWorkspaceFsActions('/ws', setOf(['/ws/notes', '/ws/notes/file.md']), changes)
    expect(plan.dirsToRefresh.has('/ws/notes/file.md')).toBe(true)
    expect(plan.dirsToRefresh.has('/ws/notes')).toBe(true)
    expect(plan.dirsToRefresh.has('/ws')).toBe(true)
  })

  it('plans modified refresh for root only when target is not loaded', () => {
    const changes: WorkspaceFsChange[] = [{ kind: 'modified', path: '/ws/notes/file.md' }]
    const plan = planWorkspaceFsActions('/ws', setOf(['/ws/notes']), changes)
    expect(Array.from(plan.dirsToRefresh).sort()).toEqual(['/ws', '/ws/notes'])
  })

  it('plans renamed prune and parent refreshes', () => {
    const changes: WorkspaceFsChange[] = [
      {
        kind: 'renamed',
        old_path: '/ws/a/old.md',
        new_path: '/ws/b/new.md',
        old_parent: '/ws/a',
        new_parent: '/ws/b'
      }
    ]
    const plan = planWorkspaceFsActions('/ws', setOf(['/ws/a', '/ws/b']), changes)
    expect(plan.pathsToPrune.has('/ws/a/old.md')).toBe(true)
    expect(plan.dirsToRefresh.has('/ws/a')).toBe(true)
    expect(plan.dirsToRefresh.has('/ws/b')).toBe(true)
    expect(plan.dirsToRefresh.has('/ws')).toBe(true)
  })

  it('deduplicates repeated refresh and prune entries', () => {
    const changes: WorkspaceFsChange[] = [
      { kind: 'removed', path: '/ws/a/file.md', parent: '/ws/a' },
      { kind: 'removed', path: '/ws/a/file.md', parent: '/ws/a' },
      { kind: 'created', path: '/ws/a/file2.md', parent: '/ws/a' }
    ]
    const plan = planWorkspaceFsActions('/ws', setOf(['/ws/a']), changes)
    expect(Array.from(plan.pathsToPrune)).toEqual(['/ws/a/file.md'])
    expect(Array.from(plan.dirsToRefresh).sort()).toEqual(['/ws', '/ws/a'])
  })

  it('handles windows-style slashes in payload', () => {
    const changes: WorkspaceFsChange[] = [
      {
        kind: 'renamed',
        old_path: 'C:\\ws\\a\\old.md',
        new_path: 'C:\\ws\\a\\new.md',
        old_parent: 'C:\\ws\\a',
        new_parent: 'C:\\ws\\a'
      }
    ]
    const plan = planWorkspaceFsActions('C:\\ws', setOf(['C:/ws/a']), changes)
    expect(plan.pathsToPrune.has('C:/ws/a/old.md')).toBe(true)
    expect(plan.dirsToRefresh.has('C:/ws/a')).toBe(true)
    expect(plan.dirsToRefresh.has('C:/ws')).toBe(true)
  })

  it('returns no root refresh for empty batch', () => {
    const plan = planWorkspaceFsActions('/ws', setOf(['/ws/a']), [])
    expect(plan.dirsToRefresh.size).toBe(0)
    expect(plan.pathsToPrune.size).toBe(0)
  })
})
