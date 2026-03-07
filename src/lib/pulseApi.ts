import {
  cancelPulseStream,
  listenPulseStream,
  runPulseTransformation,
  type PulseStreamEvent,
  type PulseTransformationRequest,
  type PulseTransformationResponse
} from './api'

/** Runs a one-shot Pulse transformation over explicit source material. */
export async function requestPulseTransformation(
  payload: PulseTransformationRequest
): Promise<PulseTransformationResponse> {
  return await runPulseTransformation(payload)
}

/** Requests cancellation for an in-flight Pulse stream. */
export async function stopPulseStream(payload: {
  requestId: string
  outputId?: string | null
}): Promise<void> {
  await cancelPulseStream({
    request_id: payload.requestId,
    output_id: payload.outputId ?? undefined
  })
}

/** Subscribes to Pulse stream events emitted by the Tauri backend. */
export async function subscribePulseStream(
  eventName: 'pulse://start' | 'pulse://delta' | 'pulse://complete' | 'pulse://error',
  handler: (payload: PulseStreamEvent) => void
): Promise<() => void> {
  return await listenPulseStream(eventName, handler)
}
