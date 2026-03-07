import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { PulseStreamEvent, PulseTransformationRequest } from '../lib/api'
import { requestPulseTransformation, stopPulseStream, subscribePulseStream } from '../lib/pulseApi'

/**
 * Owns Pulse streaming state for a single surface instance.
 */
export function usePulseTransformation() {
  const requestId = ref('')
  const outputId = ref('')
  const previewMarkdown = ref('')
  const provenancePaths = ref<string[]>([])
  const previewTitle = ref('')
  const running = ref(false)
  const error = ref('')

  const unsubs: Array<() => void> = []

  function matchesEvent(payload: PulseStreamEvent): boolean {
    return Boolean(requestId.value) && payload.request_id === requestId.value
  }

  function nextRequestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `pulse-${crypto.randomUUID()}`
    }
    return `pulse-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }

  async function run(payload: PulseTransformationRequest) {
    const nextId = payload.request_id?.trim() || nextRequestId()
    requestId.value = nextId
    outputId.value = ''
    previewMarkdown.value = ''
    provenancePaths.value = []
    previewTitle.value = ''
    error.value = ''
    running.value = true

    const result = await requestPulseTransformation({
      ...payload,
      request_id: nextId
    })
    outputId.value = result.output_id
    return result
  }

  async function cancel() {
    if (!requestId.value) return
    try {
      await stopPulseStream({
        requestId: requestId.value,
        outputId: outputId.value || undefined
      })
    } finally {
      running.value = false
    }
  }

  function reset() {
    requestId.value = ''
    outputId.value = ''
    previewMarkdown.value = ''
    provenancePaths.value = []
    previewTitle.value = ''
    running.value = false
    error.value = ''
  }

  onMounted(async () => {
    if (typeof window === 'undefined' || !(window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      return
    }
    unsubs.push(await subscribePulseStream('pulse://start', (payload) => {
      if (!matchesEvent(payload)) return
      running.value = true
      error.value = ''
      previewMarkdown.value = ''
      provenancePaths.value = payload.provenance_paths ?? []
      previewTitle.value = payload.title ?? ''
    }))

    unsubs.push(await subscribePulseStream('pulse://delta', (payload) => {
      if (!matchesEvent(payload)) return
      previewMarkdown.value = `${previewMarkdown.value}${payload.chunk}`
    }))

    unsubs.push(await subscribePulseStream('pulse://complete', (payload) => {
      if (!matchesEvent(payload)) return
      previewMarkdown.value = payload.chunk
      provenancePaths.value = payload.provenance_paths ?? provenancePaths.value
      previewTitle.value = payload.title ?? previewTitle.value
      running.value = false
    }))

    unsubs.push(await subscribePulseStream('pulse://error', (payload) => {
      if (!matchesEvent(payload)) return
      error.value = payload.error || 'Pulse generation failed.'
      running.value = false
    }))
  })

  onBeforeUnmount(() => {
    for (const unsub of unsubs) unsub()
  })

  return {
    requestId,
    outputId,
    previewMarkdown,
    provenancePaths,
    previewTitle,
    running,
    error,
    run,
    cancel,
    reset
  }
}
