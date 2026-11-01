import { beforeEach, describe, expect, it, vi } from 'vitest'
import { preflightMoveEntries, revalidateMoveEntry } from './workspaceApi'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

describe('workspace move preflight IPC', () => {
  beforeEach(() => { invoke.mockReset() })

  it('returns checked entries and forwards the proposed paths', async () => {
    const result = [{ sourcePath: '/vault/a.md', destinationPath: '/vault/notes/a.md', sourceVersion: { size: 4, modifiedMs: 123, isDir: false }, issue: null }]
    invoke.mockResolvedValue(result)
    await expect(preflightMoveEntries(['/vault/a.md'], '/vault/notes')).resolves.toEqual(result)
    expect(invoke).toHaveBeenCalledWith('preflight_move_entries', {
      sourcePaths: ['/vault/a.md'], targetDirPath: '/vault/notes'
    })
  })

  it('sends the saved source metadata for revalidation', async () => {
    const version = { size: 4, modifiedMs: 123, isDir: false }
    const result = { sourcePath: '/vault/a.md', destinationPath: '/vault/notes/a.md', sourceVersion: version, issue: 'stale_source' }
    invoke.mockResolvedValue(result)
    await expect(revalidateMoveEntry('/vault/a.md', '/vault/notes', version)).resolves.toEqual(result)
    expect(invoke).toHaveBeenCalledWith('revalidate_move_entry', { sourcePath: '/vault/a.md', targetDirPath: '/vault/notes', expectedVersion: version })
  })

  it('propagates an invalid destination failure', async () => {
    invoke.mockRejectedValue(new Error('Invalid path.'))
    await expect(preflightMoveEntries(['/vault/a.md'], '/outside')).rejects.toThrow('Invalid path.')
  })
})
