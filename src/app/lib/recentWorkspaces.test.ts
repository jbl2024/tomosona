import { beforeEach, describe, expect, it } from 'vitest'
import { readRecentWorkspaces, removeRecentWorkspace, upsertRecentWorkspace } from './recentWorkspaces'

describe('recentWorkspaces', () => {
  const storageKey = 'tomosona:test:recent-workspaces'

  beforeEach(() => {
    window.localStorage.clear()
  })

  it('upserts and deduplicates by path', () => {
    upsertRecentWorkspace(storageKey, {
      path: '/vault',
      label: 'vault',
      lastOpenedAtMs: 10
    })
    upsertRecentWorkspace(storageKey, {
      path: '/vault',
      label: 'vault renamed',
      lastOpenedAtMs: 20
    })

    expect(readRecentWorkspaces(storageKey)).toEqual([
      { path: '/vault', label: 'vault renamed', lastOpenedAtMs: 20 }
    ])
  })

  it('caps the list at five entries', () => {
    for (let index = 0; index < 7; index += 1) {
      upsertRecentWorkspace(storageKey, {
        path: `/vault-${index}`,
        label: `vault-${index}`,
        lastOpenedAtMs: index
      })
    }

    expect(readRecentWorkspaces(storageKey)).toHaveLength(5)
    expect(readRecentWorkspaces(storageKey)[0]?.path).toBe('/vault-6')
  })

  it('removes a persisted workspace entry', () => {
    upsertRecentWorkspace(storageKey, {
      path: '/vault',
      label: 'vault',
      lastOpenedAtMs: 1
    })
    removeRecentWorkspace(storageKey, '/vault')

    expect(readRecentWorkspaces(storageKey)).toEqual([])
  })
})
