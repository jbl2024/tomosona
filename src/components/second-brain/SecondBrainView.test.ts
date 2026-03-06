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

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
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
    apiCore.computeEchoesPack.mockResolvedValue({
      anchorPath: '/vault/seed.md',
      generatedAtMs: 1,
      items: [{
        path: '/vault/notes/a.md',
        title: 'Echo Note',
        reasonLabel: 'Semantically related',
        reasonLabels: ['Semantically related'],
        score: 0.8,
        signalSources: ['semantic']
      }]
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mountView() {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(SecondBrainView, {
      workspacePath: '/vault',
      allWorkspaceFiles: ['/vault/seed.md', '/vault/notes/a.md', '/vault/readme.txt'],
      requestedSessionId: '',
      requestedSessionNonce: 0,
      activeNotePath: '/vault/seed.md',
      onContextChanged: () => {},
      onOpenNote: () => {}
    })

    app.mount(root)
    return { root, app }
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
})
