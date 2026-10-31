import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppNotePersistence, type AppNotePersistenceOptions } from './useAppNotePersistence'

function createOptions(virtualDocs: Record<string, { content: string; titleLine: string }>) {
  const options: AppNotePersistenceOptions = {
    workingFolderPath: ref('/vault'),
    virtualDocs: ref(virtualDocs),
    allWorkspaceFiles: ref([]),
    ensureParentFolders: vi.fn(async () => {}),
    refreshActiveFileMetadata: vi.fn(async () => {}),
    upsertWorkspaceFilePath: vi.fn(),
    loadAllFiles: vi.fn(async () => {}),
    enqueueMarkdownReindex: vi.fn(),
    pathExists: vi.fn(async () => false),
    renameEntry: vi.fn(async (path: string, nextName: string) => `${path}/${nextName}`)
  }
  return options
}

describe('useAppNotePersistence', () => {
  it('skips autosave for a new note containing only its seeded title heading', async () => {
    const options = createOptions({
      '/vault/New Idea.md': { content: '# New Idea', titleLine: '# New Idea' }
    })
    const api = useAppNotePersistence(options)

    const result = await api.saveNoteBuffer('/vault/New Idea.md', '# New Idea', {
      explicit: false,
      expectedBaseVersion: null
    })

    expect(result.ok).toBe(true)
    expect(options.ensureParentFolders).not.toHaveBeenCalled()
    expect(options.upsertWorkspaceFilePath).not.toHaveBeenCalled()
    expect(options.enqueueMarkdownReindex).not.toHaveBeenCalled()
  })

  it('reads the seeded heading from a virtual document snapshot', async () => {
    const options = createOptions({
      '/vault/New Idea.md': { content: '# New Idea', titleLine: '# New Idea' }
    })
    const api = useAppNotePersistence(options)

    const snapshot = await api.readNoteSnapshot('/vault/New Idea.md')

    expect(snapshot.content).toBe('# New Idea')
    expect(snapshot.version).toBeNull()
  })
})
