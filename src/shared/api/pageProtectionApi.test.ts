import { beforeEach, describe, expect, it, vi } from 'vitest'
import { changePagePassword, isPageLockedError, lockPage, pageProtectionStatus, protectPage, unlockPage, unprotectPage } from './pageProtectionApi'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

describe('page protection IPC', () => {
  beforeEach(() => invoke.mockReset())

  it('passes each operation and its parameters to the backend', async () => {
    invoke.mockResolvedValue(undefined)
    await protectPage('/note.md', 'first')
    await unlockPage('/note.md', 'first')
    await lockPage('/note.md')
    await unprotectPage('/note.md', 'first')
    await changePagePassword('/note.md', 'first', 'second')
    await pageProtectionStatus(['/note.md'])
    expect(invoke.mock.calls).toEqual([
      ['protect_page', { path: '/note.md', password: 'first' }],
      ['unlock_page', { path: '/note.md', password: 'first' }],
      ['lock_page', { path: '/note.md' }],
      ['unprotect_page', { path: '/note.md', password: 'first' }],
      ['change_page_password', { path: '/note.md', currentPassword: 'first', nextPassword: 'second' }],
      ['page_protection_status', { paths: ['/note.md'] }]
    ])
  })

  it('recognizes only a structured locked-page response', () => {
    expect(isPageLockedError({ code: 'PageLocked', path: '/note.md' })).toBe(true)
    expect(isPageLockedError({ code: 'PageLocked' })).toBe(false)
    expect(isPageLockedError('PageLocked')).toBe(false)
  })
})
