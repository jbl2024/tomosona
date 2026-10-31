/** Coordinates password prompts and retries without exposing keys to the UI. */
import { onScopeDispose, ref, shallowRef } from 'vue'

type Prompt = {
  id: number
  title: string
  confirm: boolean
  action: (password: string) => Promise<void>
  resolve: () => void
  reject: (reason: Error) => void
}

/** Owns a queue of password requests and keeps the dialog open on failure. */
export function usePagePasswordPrompt() {
  const active = shallowRef<Prompt | null>(null)
  const error = ref('')
  const pending = ref(false)
  const queue: Prompt[] = []
  let nextId = 0

  function next() {
    active.value = queue.shift() ?? null
    error.value = ''
  }

  function request(title: string, action: (password: string) => Promise<void>, options: { confirm?: boolean } = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      queue.push({ id: ++nextId, title, confirm: Boolean(options.confirm), action, resolve, reject })
      if (!active.value) next()
    })
  }

  async function submit(password: string) {
    const prompt = active.value
    if (!prompt || pending.value) return
    pending.value = true
    try {
      await prompt.action(password)
      if (active.value !== prompt) return
      prompt.resolve()
      next()
    } catch (cause) {
      if (active.value === prompt) error.value = typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : 'Incorrect password or damaged file.'
    } finally {
      pending.value = false
    }
  }

  function cancel() {
    if (!active.value) return
    active.value.reject(new Error('Password entry cancelled.'))
    next()
  }

  onScopeDispose(() => {
    active.value?.reject(new Error('Password entry cancelled.'))
    for (const prompt of queue) prompt.reject(new Error('Password entry cancelled.'))
  })
  return { active, error, pending, request, submit, cancel }
}
