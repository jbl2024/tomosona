import { createApp, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SecondBrainView from './SecondBrainView.vue'

const api = vi.hoisted(() => ({
  cancelDeliberationStream: vi.fn(),
  createDeliberationSession: vi.fn(),
  fetchSecondBrainConfigStatus: vi.fn(),
  fetchSecondBrainSessions: vi.fn(),
  loadDeliberationSession: vi.fn(),
  removeDeliberationSession: vi.fn(),
  replaceSessionContext: vi.fn(),
  runDeliberation: vi.fn(),
  subscribeSecondBrainStream: vi.fn()
}))

vi.mock('../../lib/secondBrainApi', () => api)

const apiCore = vi.hoisted(() => ({
  computeEchoesPack: vi.fn()
}))

vi.mock('../../lib/indexApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/indexApi')>('../../lib/indexApi')
  return {
    ...actual,
    computeEchoesPack: apiCore.computeEchoesPack
  }
})

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

async function waitForEchoesTransition() {
  await new Promise((resolve) => setTimeout(resolve, 260))
  await flushUi()
}

describe('SecondBrainView', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    api.fetchSecondBrainConfigStatus.mockResolvedValue({ configured: true, error: null })
    api.fetchSecondBrainSessions.mockResolvedValue([
      {
        session_id: 's1',
        title: 'Session One',
        created_at_ms: 1,
        updated_at_ms: 2,
        context_count: 1,
        target_note_path: '',
        context_paths: ['seed.md']
      },
      {
        session_id: 's2',
        title: 'Session Two',
        created_at_ms: 1,
        updated_at_ms: 3,
        context_count: 1,
        target_note_path: '',
        context_paths: ['notes/a.md']
      }
    ])
    api.loadDeliberationSession.mockImplementation(async (sessionId: string) => ({
      session_id: sessionId,
      title: sessionId === 's2' ? 'Session Two' : 'Session One',
      provider: 'openai',
      model: 'gpt-4.1',
      created_at_ms: 1,
      updated_at_ms: sessionId === 's2' ? 3 : 2,
      target_note_path: '',
      context_items: [{ path: sessionId === 's2' ? 'notes/a.md' : 'seed.md', token_estimate: 12 }],
      messages: [],
      draft_content: ''
    }))
    api.subscribeSecondBrainStream.mockResolvedValue(() => {})
    api.cancelDeliberationStream.mockResolvedValue(undefined)
    api.runDeliberation.mockResolvedValue({ userMessageId: 'u1', assistantMessageId: 'a1' })
    api.replaceSessionContext.mockResolvedValue(42)
    api.createDeliberationSession.mockResolvedValue({ sessionId: 's-new', createdAtMs: 10 })
    api.removeDeliberationSession.mockResolvedValue(undefined)
    apiCore.computeEchoesPack.mockImplementation(async (anchorPath: string) => ({
      anchorPath,
      generatedAtMs: 1,
      items: [{
        path: anchorPath === '/vault/notes/a.md' ? '/vault/seed.md' : '/vault/notes/a.md',
        title: anchorPath === '/vault/notes/a.md' ? 'Seed Echo' : 'Echo Note',
        reasonLabel: 'Semantically related',
        reasonLabels: ['Semantically related'],
        score: 0.8,
        signalSources: ['semantic']
      }]
    }))
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mountView(options: {
    requestedSessionId?: string
    requestedSessionNonce?: number
    requestedPrompt?: string
    requestedPromptNonce?: number
  } = {}) {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const onOpenNote = vi.fn()

    const app = createApp(SecondBrainView, {
      workspacePath: '/vault',
      allWorkspaceFiles: ['/vault/seed.md', '/vault/notes/a.md', '/vault/readme.txt'],
      requestedSessionId: options.requestedSessionId ?? '',
      requestedSessionNonce: options.requestedSessionNonce ?? 0,
      requestedPrompt: options.requestedPrompt ?? '',
      requestedPromptNonce: options.requestedPromptNonce ?? 0,
      activeNotePath: '/vault/seed.md',
      onContextChanged: () => {},
      onOpenNote
    })

    app.mount(root)
    return { root, app, onOpenNote }
  }

  function deferredPromise<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('renders persisted context chips from loaded session', async () => {
    const mounted = mountView()
    for (let i = 0; i < 8 && mounted.root.querySelectorAll('.sb-chip').length === 0; i += 1) {
      await flushUi()
    }

    const chips = Array.from(mounted.root.querySelectorAll('.sb-chip'))
    expect(chips).toHaveLength(1)
    expect(mounted.root.textContent).toContain('seed.md')

    mounted.app.unmount()
  })

  it('hydrates the composer from an initial requested prompt on mount', async () => {
    const mounted = mountView({
      requestedPrompt: 'Turn this context into a concise outline.',
      requestedPromptNonce: 1
    })
    await flushUi()

    const textarea = mounted.root.querySelector<HTMLTextAreaElement>('.sb-textarea')
    expect(textarea).toBeTruthy()
    expect(textarea?.value).toBe('Turn this context into a concise outline.')

    mounted.app.unmount()
  })

  it('loads a grouped Pulse preset into the composer from the dropdown', async () => {
    const mounted = mountView()
    let trigger: HTMLButtonElement | null = null
    for (let i = 0; i < 8; i += 1) {
      await flushUi()
      trigger = mounted.root.querySelector<HTMLButtonElement>('.sb-pulse-trigger')
      if (trigger && !trigger.disabled) break
    }
    expect(trigger).toBeTruthy()
    trigger?.click()
    await flushUi()

    const tensionsOption = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ui-filterable-dropdown-option'))
      .find((button) => button.textContent?.includes('Identify tensions'))
    expect(tensionsOption).toBeTruthy()
    tensionsOption?.click()
    await flushUi()

    const textarea = mounted.root.querySelector<HTMLTextAreaElement>('.sb-textarea')
    expect(textarea?.value).toContain('Identify tensions, contradictions, or open questions in the current context.')

    mounted.app.unmount()
  })

  it('toggles the Echoes anchor from a context chip and keeps open explicit', async () => {
    const mounted = mountView()
    for (let i = 0; i < 8 && mounted.root.querySelectorAll('.sb-chip').length === 0; i += 1) {
      await flushUi()
    }

    const chipBody = mounted.root.querySelector<HTMLButtonElement>('.sb-chip-main')
    const chipOpen = mounted.root.querySelector<HTMLButtonElement>('.sb-chip-open')
    expect(chipBody).toBeTruthy()
    expect(chipOpen).toBeTruthy()
    if (!chipBody || !chipOpen) return

    expect(mounted.root.textContent).not.toContain('Suggested by Echoes')
    expect(mounted.root.textContent).not.toContain('Echo Note')

    chipBody.click()
    await flushUi()

    expect(chipBody.getAttribute('aria-pressed')).toBe('true')
    expect(mounted.root.textContent).toContain('Suggested by Echoes')
    expect(mounted.root.textContent).toContain('Echo Note')
    expect(mounted.onOpenNote).not.toHaveBeenCalled()

    chipBody.click()
    await waitForEchoesTransition()

    expect(chipBody.getAttribute('aria-pressed')).toBe('false')
    expect(mounted.root.textContent).not.toContain('Echo Note')
    expect(mounted.root.textContent).not.toContain('Suggested by Echoes')

    chipOpen.click()
    expect(mounted.onOpenNote).toHaveBeenCalledWith('/vault/seed.md')

    mounted.app.unmount()
  })

  it('turns selected @ mention into a persisted context chip', async () => {
    const mounted = mountView()
    await flushUi()

    const textarea = mounted.root.querySelector<HTMLTextAreaElement>('.sb-textarea')
    expect(textarea).toBeTruthy()
    if (!textarea) return

    textarea.value = '@not'
    textarea.selectionStart = textarea.value.length
    textarea.selectionEnd = textarea.value.length
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()

    const firstSuggestion = mounted.root.querySelector<HTMLButtonElement>('.sb-at-item')
    expect(firstSuggestion).toBeTruthy()
    if (!firstSuggestion) return

    firstSuggestion.click()
    await flushUi()

    expect(api.replaceSessionContext).toHaveBeenCalledWith('s1', ['/vault/seed.md', '/vault/notes/a.md'])
    expect(mounted.root.querySelectorAll('.sb-chip')).toHaveLength(2)
    expect(mounted.root.textContent).toContain('a.md')
    expect(textarea.value).toBe('')

    mounted.app.unmount()
  })

  it('adds resolved @ mentions to context before send', async () => {
    const mounted = mountView()
    await flushUi()

    const textarea = mounted.root.querySelector<HTMLTextAreaElement>('.sb-textarea')
    const sendBtn = mounted.root.querySelector<HTMLButtonElement>('.send-icon-btn')
    expect(textarea).toBeTruthy()
    expect(sendBtn).toBeTruthy()
    if (!textarea || !sendBtn) return

    textarea.value = 'Look at @notes/a.md please'
    textarea.selectionStart = textarea.value.length
    textarea.selectionEnd = textarea.value.length
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()

    sendBtn.click()
    await flushUi()

    expect(api.replaceSessionContext).toHaveBeenCalledWith('s1', ['/vault/seed.md', '/vault/notes/a.md'])
    expect(api.runDeliberation).toHaveBeenCalledWith({
      sessionId: 's1',
      mode: 'freestyle',
      message: 'Look at @notes/a.md please'
    })

    mounted.app.unmount()
  })

  it('sends message with Ctrl+Enter from composer', async () => {
    const mounted = mountView()
    await flushUi()

    const textarea = mounted.root.querySelector<HTMLTextAreaElement>('.sb-textarea')
    expect(textarea).toBeTruthy()
    if (!textarea) return

    textarea.value = 'Send via shortcut'
    textarea.selectionStart = textarea.value.length
    textarea.selectionEnd = textarea.value.length
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await flushUi()

    expect(api.runDeliberation).toHaveBeenCalledWith({
      sessionId: 's1',
      mode: 'freestyle',
      message: 'Send via shortcut'
    })

    mounted.app.unmount()
  })

  it('auto-scrolls discussion to bottom after send', async () => {
    const mounted = mountView()
    await flushUi()

    const thread = mounted.root.querySelector<HTMLElement>('.sb-thread')
    const textarea = mounted.root.querySelector<HTMLTextAreaElement>('.sb-textarea')
    const sendBtn = mounted.root.querySelector<HTMLButtonElement>('.send-icon-btn')
    expect(thread).toBeTruthy()
    expect(textarea).toBeTruthy()
    expect(sendBtn).toBeTruthy()
    if (!thread || !textarea || !sendBtn) return

    Object.defineProperty(thread, 'scrollHeight', { value: 420, configurable: true })
    thread.scrollTop = 0

    textarea.value = 'scroll after send'
    textarea.selectionStart = textarea.value.length
    textarea.selectionEnd = textarea.value.length
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()

    sendBtn.click()
    await flushUi()

    expect(thread.scrollTop).toBe(420)

    mounted.app.unmount()
  })

  it('scrolls to the bottom when opening a requested session with existing messages', async () => {
    api.loadDeliberationSession.mockImplementation(async (sessionId: string) => ({
      session_id: sessionId,
      title: 'Session Two',
      provider: 'openai',
      model: 'gpt-4.1',
      created_at_ms: 1,
      updated_at_ms: 3,
      target_note_path: '',
      context_items: [{ path: 'notes/a.md', token_estimate: 12 }],
      messages: [
        {
          id: 'u1',
          role: 'user',
          mode: 'freestyle',
          content_md: 'Question',
          citations_json: '[]',
          attachments_json: '[]',
          created_at_ms: 1
        },
        {
          id: 'a1',
          role: 'assistant',
          mode: 'freestyle',
          content_md: 'Answer',
          citations_json: '[]',
          attachments_json: '[]',
          created_at_ms: 2
        }
      ],
      draft_content: ''
    }))

    const mounted = mountView({ requestedSessionId: 's2', requestedSessionNonce: 1 })
    const thread = mounted.root.querySelector<HTMLElement>('.sb-thread')
    expect(thread).toBeTruthy()
    if (!thread) return

    Object.defineProperty(thread, 'scrollTop', { value: 0, writable: true, configurable: true })
    Object.defineProperty(thread, 'scrollHeight', { value: 540, configurable: true })
    thread.scrollTop = 0

    for (let i = 0; i < 8 && thread.scrollTop !== 540; i += 1) {
      await flushUi()
    }

    expect(thread.scrollTop).toBe(540)

    mounted.app.unmount()
  })

  it('stops streaming updates when stop button is clicked', async () => {
    const streamHandlers = new Map<string, (payload: {
      session_id: string
      message_id: string
      chunk: string
      done: boolean
      error: string | null
    }) => void>()
    api.subscribeSecondBrainStream.mockImplementation(async (eventName: string, handler: (payload: {
      session_id: string
      message_id: string
      chunk: string
      done: boolean
      error: string | null
    }) => void) => {
      streamHandlers.set(eventName, handler)
      return () => {}
    })

    const pendingRun = deferredPromise<{ userMessageId: string; assistantMessageId: string }>()
    api.runDeliberation.mockReturnValueOnce(pendingRun.promise)

    const mounted = mountView()
    await flushUi()

    const textarea = mounted.root.querySelector<HTMLTextAreaElement>('.sb-textarea')
    const sendBtn = mounted.root.querySelector<HTMLButtonElement>('.send-icon-btn')
    expect(textarea).toBeTruthy()
    expect(sendBtn).toBeTruthy()
    if (!textarea || !sendBtn) return

    textarea.value = 'streaming stop test'
    textarea.selectionStart = textarea.value.length
    textarea.selectionEnd = textarea.value.length
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()

    sendBtn.click()
    await flushUi()

    streamHandlers.get('second-brain://assistant-start')?.({
      session_id: 's1',
      message_id: 'a-stream',
      chunk: '',
      done: false,
      error: null
    })
    streamHandlers.get('second-brain://assistant-delta')?.({
      session_id: 's1',
      message_id: 'a-stream',
      chunk: 'alpha',
      done: false,
      error: null
    })
    await flushUi()

    expect(mounted.root.textContent).toContain('alpha')

    const stopBtn = mounted.root.querySelector<HTMLButtonElement>('.send-icon-btn-stop')
    expect(stopBtn).toBeTruthy()
    if (!stopBtn) return
    stopBtn.click()
    await flushUi()
    expect(api.cancelDeliberationStream).toHaveBeenCalledWith({
      sessionId: 's1',
      messageId: 'a-stream'
    })

    streamHandlers.get('second-brain://assistant-delta')?.({
      session_id: 's1',
      message_id: 'a-stream',
      chunk: 'beta',
      done: false,
      error: null
    })
    streamHandlers.get('second-brain://assistant-complete')?.({
      session_id: 's1',
      message_id: 'a-stream',
      chunk: 'alphabeta',
      done: true,
      error: null
    })
    await flushUi()

    expect(mounted.root.textContent).toContain('alpha')
    expect(mounted.root.textContent).not.toContain('alphabeta')

    pendingRun.resolve({ userMessageId: 'u1', assistantMessageId: 'a-stream' })
    await flushUi()

    mounted.app.unmount()
  })

  it('renders session action buttons', async () => {
    const mounted = mountView()
    await flushUi()

    expect(mounted.root.querySelector('.sb-session-create-btn')).toBeTruthy()
    expect(mounted.root.querySelector('.sb-session-gear-btn')).toBeTruthy()

    mounted.app.unmount()
  })

  it('does not create a new session while current session is empty', async () => {
    const mounted = mountView()
    await flushUi()

    const createBtn = mounted.root.querySelector<HTMLButtonElement>('.sb-session-create-btn')
    expect(createBtn).toBeTruthy()
    if (!createBtn) return

    for (let i = 0; i < 4 && createBtn.disabled; i += 1) {
      await flushUi()
    }
    expect(createBtn.disabled).toBe(false)

    createBtn.click()
    createBtn.click()
    await flushUi()

    expect(api.createDeliberationSession).not.toHaveBeenCalled()
    expect(mounted.root.textContent).toContain('Current session is empty')

    mounted.app.unmount()
  })

  it('rolls back mention context chip on immediate sync failure', async () => {
    api.replaceSessionContext.mockRejectedValueOnce(new Error('context update failed'))
    const mounted = mountView()
    await flushUi()

    const textarea = mounted.root.querySelector<HTMLTextAreaElement>('.sb-textarea')
    expect(textarea).toBeTruthy()
    if (!textarea) return

    textarea.value = '@not'
    textarea.selectionStart = textarea.value.length
    textarea.selectionEnd = textarea.value.length
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()

    const firstSuggestion = mounted.root.querySelector<HTMLButtonElement>('.sb-at-item')
    expect(firstSuggestion).toBeTruthy()
    if (!firstSuggestion) return
    firstSuggestion.click()
    await flushUi()

    expect(api.replaceSessionContext).toHaveBeenCalled()
    expect(mounted.root.querySelectorAll('.sb-chip')).toHaveLength(1)
    expect(mounted.root.textContent).toContain('seed.md')
    expect(mounted.root.textContent).toContain('Could not add notes/a.md to Second Brain context')

    mounted.app.unmount()
  })

  it('renders Echoes suggestions and adds them to context', async () => {
    const mounted = mountView()
    for (let index = 0; index < 8 && mounted.root.querySelectorAll('.sb-chip-main').length === 0; index += 1) {
      await flushUi()
    }

    mounted.root.querySelector<HTMLButtonElement>('.sb-chip-main')?.click()
    for (let index = 0; index < 8 && !mounted.root.textContent?.includes('Echo Note'); index += 1) {
      await flushUi()
    }

    expect(mounted.root.textContent).toContain('Suggested by Echoes')
    expect(mounted.root.textContent).toContain('Echo Note')

    const addButton = mounted.root.querySelector<HTMLButtonElement>('.sb-echoes-action')
    expect(addButton).toBeTruthy()
    if (!addButton) return

    addButton.click()
    await flushUi()

    expect(api.replaceSessionContext).toHaveBeenCalledWith('s1', ['/vault/seed.md', '/vault/notes/a.md'])
    expect(mounted.root.textContent).toContain('In context')

    mounted.app.unmount()
  })

  it('opens an Echoes suggestion only from the explicit action', async () => {
    const mounted = mountView()
    for (let index = 0; index < 8 && mounted.root.querySelectorAll('.sb-chip-main').length === 0; index += 1) {
      await flushUi()
    }

    mounted.root.querySelector<HTMLButtonElement>('.sb-chip-main')?.click()
    for (let index = 0; index < 8 && !mounted.root.textContent?.includes('Echo Note'); index += 1) {
      await flushUi()
    }

    const suggestionBody = mounted.root.querySelector<HTMLElement>('.sb-echoes-main')
    const openButton = mounted.root.querySelector<HTMLButtonElement>('.sb-echoes-open')
    expect(suggestionBody).toBeTruthy()
    expect(openButton).toBeTruthy()
    if (!suggestionBody || !openButton) return

    suggestionBody.click()
    expect(mounted.onOpenNote).not.toHaveBeenCalled()

    openButton.click()
    expect(mounted.onOpenNote).toHaveBeenCalledWith('/vault/notes/a.md')

    mounted.app.unmount()
  })

  it('recomputes Echoes suggestions when toggling another context chip', async () => {
    api.loadDeliberationSession.mockResolvedValueOnce({
      session_id: 's1',
      title: 'Session One',
      provider: 'openai',
      model: 'gpt-4.1',
      created_at_ms: 1,
      updated_at_ms: 2,
      target_note_path: '',
      context_items: [
        { path: 'seed.md', token_estimate: 12 },
        { path: 'notes/a.md', token_estimate: 10 }
      ],
      messages: [],
      draft_content: ''
    })

    const mounted = mountView()
    for (let i = 0; i < 8 && mounted.root.querySelectorAll('.sb-chip').length < 2; i += 1) {
      await flushUi()
    }

    const chipButtons = mounted.root.querySelectorAll<HTMLButtonElement>('.sb-chip-main')
    expect(chipButtons).toHaveLength(2)
    expect(mounted.root.textContent).not.toContain('Suggested by Echoes')

    chipButtons[1]?.click()
    await flushUi()

    expect(apiCore.computeEchoesPack).toHaveBeenCalledWith('/vault/notes/a.md', { limit: 5 })
    expect(mounted.root.textContent).toContain('Seed Echo')
    expect(chipButtons[1]?.getAttribute('aria-pressed')).toBe('true')

    chipButtons[1]?.click()
    await waitForEchoesTransition()

    expect(mounted.root.textContent).not.toContain('Seed Echo')
    expect(chipButtons[1]?.getAttribute('aria-pressed')).toBe('false')
    expect(mounted.root.textContent).not.toContain('Suggested by Echoes')

    mounted.app.unmount()
  })

  it('marks a suggestion as already in context and refreshes after removing that chip', async () => {
    api.loadDeliberationSession.mockResolvedValueOnce({
      session_id: 's1',
      title: 'Session One',
      provider: 'openai',
      model: 'gpt-4.1',
      created_at_ms: 1,
      updated_at_ms: 2,
      target_note_path: '',
      context_items: [
        { path: 'seed.md', token_estimate: 12 },
        { path: 'notes/b.md', token_estimate: 10 },
        { path: 'notes/c.md', token_estimate: 10 }
      ],
      messages: [],
      draft_content: ''
    })
    apiCore.computeEchoesPack.mockImplementation(async (anchorPath: string) => ({
      anchorPath,
      generatedAtMs: 1,
      items: anchorPath === '/vault/notes/b.md'
        ? [{
          path: '/vault/notes/c.md',
          title: 'Note C',
          reasonLabel: 'Backlink',
          reasonLabels: ['Backlink'],
          score: 0.8,
          signalSources: ['backlink']
        }]
        : [{
          path: '/vault/notes/a.md',
          title: 'Echo Note',
          reasonLabel: 'Semantically related',
          reasonLabels: ['Semantically related'],
          score: 0.8,
          signalSources: ['semantic']
        }]
    }))

    const mounted = mountView()
    for (let i = 0; i < 8 && mounted.root.querySelectorAll('.sb-chip').length < 3; i += 1) {
      await flushUi()
    }

    const chipButtons = mounted.root.querySelectorAll<HTMLButtonElement>('.sb-chip-main')
    expect(chipButtons).toHaveLength(3)

    chipButtons[1]?.click()
    for (let index = 0; index < 8 && !mounted.root.textContent?.includes('Note C'); index += 1) {
      await flushUi()
    }

    expect(mounted.root.textContent).toContain('Note C')
    expect(mounted.root.textContent).toContain('In context')
    expect(mounted.root.querySelector('.sb-echoes-action')).toBeNull()

    const removeButtons = mounted.root.querySelectorAll<HTMLButtonElement>('.sb-chip-remove')
    removeButtons[2]?.click()
    await flushUi()

    expect(mounted.root.textContent).toContain('Note C')
    expect(mounted.root.textContent).not.toContain('In context')
    expect(mounted.root.querySelector('.sb-echoes-action')).toBeTruthy()

    mounted.app.unmount()
  })

  it('deduplicates Echoes suggestions by normalized path and keeps context detection', async () => {
    api.loadDeliberationSession.mockResolvedValueOnce({
      session_id: 's1',
      title: 'Session One',
      provider: 'openai',
      model: 'gpt-4.1',
      created_at_ms: 1,
      updated_at_ms: 2,
      target_note_path: '',
      context_items: [
        { path: 'seed.md', token_estimate: 12 },
        { path: 'notes/pi.md', token_estimate: 10 }
      ],
      messages: [],
      draft_content: ''
    })
    apiCore.computeEchoesPack.mockImplementation(async (anchorPath: string) => ({
      anchorPath,
      generatedAtMs: 1,
      items: anchorPath === '/vault/seed.md'
        ? [
          {
            path: '/vault/notes/pi.md',
            title: 'Reunions PI',
            reasonLabel: 'Backlink',
            reasonLabels: ['Backlink'],
            score: 0.9,
            signalSources: ['backlink']
          },
          {
            path: 'notes/pi.md',
            title: 'Reunions PI',
            reasonLabel: 'Backlink',
            reasonLabels: ['Backlink'],
            score: 0.8,
            signalSources: ['backlink']
          }
        ]
        : []
    }))

    const mounted = mountView()
    for (let i = 0; i < 8 && mounted.root.querySelectorAll('.sb-chip').length < 2; i += 1) {
      await flushUi()
    }

    mounted.root.querySelector<HTMLButtonElement>('.sb-chip-main')?.click()
    for (let index = 0; index < 8 && !mounted.root.textContent?.includes('Reunions PI'); index += 1) {
      await flushUi()
    }

    expect(mounted.root.querySelectorAll('.sb-echoes-item')).toHaveLength(1)
    expect(mounted.root.textContent).toContain('In context')
    expect(mounted.root.querySelector('.sb-echoes-action')).toBeNull()

    mounted.app.unmount()
  })

  it('treats case-variant suggestion paths as the same in-context document', async () => {
    api.loadDeliberationSession.mockResolvedValueOnce({
      session_id: 's1',
      title: 'Session One',
      provider: 'openai',
      model: 'gpt-4.1',
      created_at_ms: 1,
      updated_at_ms: 2,
      target_note_path: '',
      context_items: [
        { path: 'seed.md', token_estimate: 12 },
        { path: 'Exécution/Réunions PI.md', token_estimate: 10 }
      ],
      messages: [],
      draft_content: ''
    })
    apiCore.computeEchoesPack.mockImplementation(async (anchorPath: string) => ({
      anchorPath,
      generatedAtMs: 1,
      items: anchorPath === '/vault/seed.md'
        ? [{
          path: '/vault/exe\u0301cution/re\u0301unions pi.md',
          title: 'Reunions PI',
          reasonLabel: 'Backlink',
          reasonLabels: ['Backlink'],
          score: 0.9,
          signalSources: ['backlink']
        }]
        : []
    }))

    const mounted = mountView()
    for (let i = 0; i < 8 && mounted.root.querySelectorAll('.sb-chip').length < 2; i += 1) {
      await flushUi()
    }

    mounted.root.querySelector<HTMLButtonElement>('.sb-chip-main')?.click()
    for (let index = 0; index < 8 && !mounted.root.textContent?.includes('Reunions PI'); index += 1) {
      await flushUi()
    }

    expect(mounted.root.textContent).toContain('In context')
    expect(mounted.root.querySelector('.sb-echoes-action')).toBeNull()

    mounted.app.unmount()
  })
})
