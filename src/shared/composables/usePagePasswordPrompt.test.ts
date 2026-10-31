import { effectScope } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { usePagePasswordPrompt } from './usePagePasswordPrompt'

describe('page password prompt', () => {
  it('keeps the dialog open on an incorrect password and resolves on success', async () => {
    const scope = effectScope()
    const prompt = scope.run(() => usePagePasswordPrompt())!
    const action = vi.fn(async (password: string) => {
      if (password !== 'correct') throw 'Incorrect password or damaged file.'
    })
    const result = prompt.request('Unlock page', action)
    await prompt.submit('wrong')
    expect(prompt.active.value?.title).toBe('Unlock page')
    expect(prompt.error.value).toBe('Incorrect password or damaged file.')
    await prompt.submit('correct')
    await expect(result).resolves.toBeUndefined()
    expect(prompt.active.value).toBeNull()
    scope.stop()
  })

  it('queues independent page requests and allows cancellation', async () => {
    const scope = effectScope()
    const prompt = scope.run(() => usePagePasswordPrompt())!
    const first = vi.fn(async () => {})
    const second = vi.fn(async () => {})
    const a = prompt.request('First page', first)
    const b = prompt.request('Second page', second)
    await prompt.submit('one')
    await a
    expect(prompt.active.value?.title).toBe('Second page')
    const rejection = expect(b).rejects.toThrow('cancelled')
    prompt.cancel()
    await rejection
    expect(second).not.toHaveBeenCalled()
    scope.stop()
  })

  it('does not let a cancelled in-flight request complete a later prompt', async () => {
    const scope = effectScope()
    const prompt = scope.run(() => usePagePasswordPrompt())!
    let finish!: () => void
    const first = prompt.request('First page', () => new Promise<void>((resolve) => { finish = resolve }))
    const firstRejected = expect(first).rejects.toThrow('cancelled')
    const submitting = prompt.submit('one')
    const second = prompt.request('Second page', async () => {})
    prompt.cancel()
    await firstRejected
    finish()
    await submitting
    expect(prompt.active.value?.title).toBe('Second page')
    await prompt.submit('two')
    await expect(second).resolves.toBeUndefined()
    scope.stop()
  })

  it('carries the confirmation flag per request', async () => {
    const scope = effectScope()
    const prompt = scope.run(() => usePagePasswordPrompt())!
    const choosing = prompt.request('Choose a password', async () => {}, { confirm: true })
    expect(prompt.active.value?.confirm).toBe(true)
    await prompt.submit('secret')
    await expect(choosing).resolves.toBeUndefined()
    const unlocking = prompt.request('Unlock page', async () => {})
    expect(prompt.active.value?.confirm).toBe(false)
    const rejection = expect(unlocking).rejects.toThrow('cancelled')
    prompt.cancel()
    await rejection
    scope.stop()
  })
})
