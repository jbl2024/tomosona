import { effectScope, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppShellLaunchpad } from './useAppShellLaunchpad'

function createLaunchpad(overrides: Partial<Parameters<typeof useAppShellLaunchpad>[0]> = {}) {
  const recentWorkspaceEntries: Array<{ path: string; label: string; lastOpenedAtMs: number }> = [
    { path: '/vault', label: 'vault', lastOpenedAtMs: 100 }
  ]
  const recentNotesByKey = new Map<string, Array<{ path: string; title: string; lastViewedAtMs: number }>>()
  const metadataByPath = new Map<string, number>([
    ['/vault/a.md', 200],
    ['/vault/b.md', 150]
  ])

  const scope = effectScope()
  const api = scope.run(() => useAppShellLaunchpad({
    storageKey: 'recent-workspaces',
    workingFolderPath: ref('/vault'),
    hasWorkspace: ref(true),
    allWorkspaceFiles: ref(['/vault/a.md', '/vault/b.md']),
    loadingAllFiles: ref(false),
    readFileMetadata: vi.fn(async (path: string) => ({ updated_at_ms: metadataByPath.get(path) ?? null })),
    readRecentWorkspaces: vi.fn(() => recentWorkspaceEntries),
    upsertRecentWorkspace: vi.fn((_key, item) => {
      recentWorkspaceEntries.unshift(item)
      return [...recentWorkspaceEntries]
    }),
    removeRecentWorkspace: vi.fn((_key, path) => recentWorkspaceEntries.filter((entry) => entry.path !== path)),
    readRecentNotes: vi.fn((storageKey: string) => recentNotesByKey.get(storageKey) ?? []),
    writeRecentNotes: vi.fn((storageKey: string, entries) => {
      recentNotesByKey.set(storageKey, entries)
    }),
    upsertRecentNote: vi.fn((storageKey: string, entry) => {
      recentNotesByKey.set(storageKey, [entry])
    }),
    removeRecentNote: vi.fn((storageKey: string, path: string) => {
      recentNotesByKey.set(storageKey, (recentNotesByKey.get(storageKey) ?? []).filter((entry) => entry.path !== path))
    }),
    renameRecentNote: vi.fn((storageKey: string, fromPath: string, toPath: string, title: string) => {
      recentNotesByKey.set(storageKey, (recentNotesByKey.get(storageKey) ?? []).map((entry) =>
        entry.path === fromPath ? { ...entry, path: toPath, title } : entry
      ))
    }),
    normalizePathKey: (path) => path.toLowerCase(),
    toRelativePath: (path) => path.replace('/vault/', ''),
    noteTitleFromPath: (path) => path.split('/').pop()?.replace('.md', '') ?? path,
    basenameLabel: (path) => path.split('/').pop() ?? path,
    formatRelativeTime: (ts, prefix = '') => `${prefix} ${ts}`.trim(),
    ...overrides
  }))
  if (!api) throw new Error('Expected launchpad controller')
  return { api, scope, recentNotesByKey }
}

describe('useAppShellLaunchpad', () => {
  it('derives recent workspace rows immediately', () => {
    const { api, scope } = createLaunchpad()

    expect(api.launchpadRecentWorkspaces.value).toEqual([
      { path: '/vault', label: 'vault', subtitle: '/vault', recencyLabel: 'opened 100' }
    ])
    scope.stop()
  })

  it('records and renames recent notes in the active workspace bucket', async () => {
    const { api, scope } = createLaunchpad()

    api.recordRecentNote('/vault/a.md')
    await Promise.resolve()
    expect(api.recentViewedNotes.value[0]?.path).toBe('/vault/a.md')

    api.renameLaunchpadRecentNote('/vault/a.md', '/vault/b.md')
    await Promise.resolve()
    expect(api.recentViewedNotes.value[0]?.path).toBe('/vault/b.md')
    scope.stop()
  })

  it('cleans removed recent notes once the workspace file list is known', async () => {
    const allWorkspaceFiles = ref(['/vault/a.md'])
    const { api, scope, recentNotesByKey } = createLaunchpad({ allWorkspaceFiles })
    recentNotesByKey.set('tomosona:recent-notes:%2Fvault', [
      { path: '/vault/a.md', title: 'a', lastViewedAtMs: 100 },
      { path: '/vault/missing.md', title: 'missing', lastViewedAtMs: 90 }
    ])

    await api.refreshLaunchpadRecentNotes()

    expect(api.recentViewedNotes.value).toEqual([
      { path: '/vault/a.md', title: 'a', relativePath: 'a.md', recencyLabel: 'opened 100' }
    ])
    scope.stop()
  })

  it('builds updated-note rows sorted by most recent metadata', async () => {
    const { api, scope } = createLaunchpad()

    await api.refreshLaunchpadRecentNotes()

    expect(api.recentUpdatedNotes.value.map((item) => item.path)).toEqual(['/vault/a.md', '/vault/b.md'])
    scope.stop()
  })

  it('invalidates cached updated-note rows when requested', async () => {
    const readFileMetadata = vi.fn(async (_path: string) => ({ updated_at_ms: 100 }))
    const { api, scope } = createLaunchpad({ readFileMetadata })

    const baselineCalls = readFileMetadata.mock.calls.length
    await api.refreshLaunchpadRecentNotes()
    await api.refreshLaunchpadRecentNotes()
    api.invalidateRecentNotes()
    await api.refreshLaunchpadRecentNotes()

    expect(readFileMetadata.mock.calls.length).toBeGreaterThan(baselineCalls + 1)
    scope.stop()
  })
})
