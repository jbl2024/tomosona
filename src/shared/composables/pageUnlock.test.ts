import { describe, expect, it, vi } from 'vitest'
import { readWithPageUnlock } from './pageUnlock'

describe('protected page reads', () => {
  it('opens an ordinary page without prompting', async () => {
    const unlock = vi.fn()
    await expect(readWithPageUnlock(async () => 'plain', unlock)).resolves.toBe('plain')
    expect(unlock).not.toHaveBeenCalled()
  })
  it('prompts for the locked page and retries after unlock', async () => {
    const read = vi.fn().mockRejectedValueOnce({ code: 'PageLocked', path: '/a.md' }).mockResolvedValueOnce('secret')
    const unlock = vi.fn().mockResolvedValue(undefined)
    await expect(readWithPageUnlock(read, unlock)).resolves.toBe('secret')
    expect(unlock).toHaveBeenCalledWith('/a.md')
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('does not retry a cancelled unlock or unrelated error', async () => {
    const read = vi.fn().mockRejectedValue({ code: 'PageLocked', path: '/a.md' })
    await expect(readWithPageUnlock(read, async () => { throw new Error('cancelled') })).rejects.toThrow('cancelled')
    expect(read).toHaveBeenCalledTimes(1)
    const unlock = vi.fn()
    await expect(readWithPageUnlock(async () => { throw new Error('failure') }, unlock)).rejects.toThrow('failure')
    expect(unlock).not.toHaveBeenCalled()
  })
})
