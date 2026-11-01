import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePageProtectionActions } from './usePageProtectionActions'

const api = vi.hoisted(() => ({ protectPage: vi.fn(), unprotectPage: vi.fn(), changePagePassword: vi.fn(), lockPage: vi.fn() }))
vi.mock('../../shared/api/pageProtectionApi', () => api)

function harness(passwords: string[] = ['secret'], canProtect: (path: string) => boolean = () => true) {
  let dirty = false
  const reload = vi.fn(async () => {})
  const refresh = vi.fn(async () => {})
  const save = vi.fn(async () => { dirty = false })
  const reportError = vi.fn()
  const prompt = vi.fn(async (_title: string, action: (password: string) => Promise<void>) => { await action(passwords.shift() ?? '') })
  const controller = usePageProtectionActions({
    currentPath: () => '/vault/page.md', canProtect,
    isUnsaved: () => dirty, save, reload, refresh, prompt, reportError
  })
  return { ...controller, reload, refresh, save, prompt, reportError, setDirty: (value: boolean) => { dirty = value } }
}

describe('page protection actions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('saves dirty content before protection and refreshes the view', async () => {
    const h = harness()
    h.setDirty(true)
    await h.run('protect')
    expect(h.save).toHaveBeenCalledOnce()
    expect(h.prompt).toHaveBeenCalledWith('Choose a password (it cannot be recovered)', expect.any(Function), { confirm: true })
    expect(api.protectPage).toHaveBeenCalledWith('/vault/page.md', 'secret')
    expect(h.reload).toHaveBeenCalledOnce()
    expect(h.refresh).toHaveBeenCalledWith('/vault/page.md')
  })

  it('removes and changes protection with the supplied passwords', async () => {
    const remove = harness()
    await remove.run('unprotect')
    expect(api.unprotectPage).toHaveBeenCalledWith('/vault/page.md', 'secret')
    expect(remove.prompt).toHaveBeenCalledWith('Remove protection', expect.any(Function))
    expect(remove.refresh).toHaveBeenCalledOnce()
    const change = harness(['new', 'old'])
    await change.run('change')
    expect(api.changePagePassword).toHaveBeenCalledWith('/vault/page.md', 'old', 'new')
    expect(change.prompt).toHaveBeenNthCalledWith(1, 'Choose a new password', expect.any(Function), { confirm: true })
    expect(change.prompt).toHaveBeenNthCalledWith(2, 'Enter current password', expect.any(Function))
    expect(change.refresh).toHaveBeenCalledOnce()
  })

  it('locks future access without reloading or clearing an open view', async () => {
    const h = harness()
    await h.run('lock')
    expect(api.lockPage).toHaveBeenCalledWith('/vault/page.md')
    expect(h.reload).not.toHaveBeenCalled()
    expect(h.refresh).toHaveBeenCalledOnce()
  })

  it('saves dirty edits before locking and refuses to lock if saving fails', async () => {
    const success = harness()
    success.setDirty(true)
    await success.run('lock')
    expect(success.save).toHaveBeenCalledOnce()
    expect(api.lockPage).toHaveBeenCalledOnce()
    api.lockPage.mockClear()
    const failure = harness()
    failure.setDirty(true)
    failure.save.mockRejectedValueOnce(new Error('Save failed.'))
    await failure.run('lock')
    expect(api.lockPage).not.toHaveBeenCalled()
    expect(failure.reportError).toHaveBeenCalledWith('Save failed.')
  })

  it('locks a background tab without touching the active editor', async () => {
    const h = harness()
    const changed = vi.fn()
    window.addEventListener('page-protection-changed', changed)
    await h.lockPath('/vault/other.md')
    window.removeEventListener('page-protection-changed', changed)
    expect(api.lockPage).toHaveBeenCalledWith('/vault/other.md')
    expect(h.save).not.toHaveBeenCalled()
    expect(h.reload).not.toHaveBeenCalled()
    expect(h.refresh).toHaveBeenCalledWith('/vault/other.md')
    expect(changed).toHaveBeenCalledOnce()
  })

  it('ignores a background lock for a path that cannot be protected', async () => {
    const empty = harness()
    await empty.lockPath('')
    expect(api.lockPage).not.toHaveBeenCalled()
    expect(empty.refresh).not.toHaveBeenCalled()
    const notMarkdown = harness(['secret'], () => false)
    await notMarkdown.lockPath('/vault/image.png')
    expect(api.lockPage).not.toHaveBeenCalled()
    expect(notMarkdown.refresh).not.toHaveBeenCalled()
  })

  it('reports a failed background lock', async () => {
    const h = harness()
    api.lockPage.mockRejectedValueOnce(new Error('Lock failed.'))
    await h.lockPath('/vault/other.md')
    expect(h.reportError).toHaveBeenCalledWith('Lock failed.')
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it('does not protect a page when saving fails', async () => {
    const h = harness()
    h.setDirty(true)
    h.save.mockRejectedValueOnce(new Error('Save failed.'))
    await h.run('protect')
    expect(api.protectPage).not.toHaveBeenCalled()
    expect(h.reportError).toHaveBeenCalledWith('Save failed.')
  })
})
