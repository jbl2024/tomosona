import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  PulseStreamEvent,
  PulseTransformationRequest,
  PulseTransformationResponse
} from './apiTypes'

/**
 * Frontend IPC wrappers for Pulse transport and stream subscriptions.
 */

/** Starts a Pulse transformation request for the provided source payload. */
export async function runPulseTransformation(
  payload: PulseTransformationRequest
): Promise<PulseTransformationResponse> {
  return await invoke('run_pulse_transformation', { payload })
}

/** Requests cancellation for an in-flight Pulse stream. */
export async function cancelPulseStream(payload: {
  request_id: string
  output_id?: string
}): Promise<void> {
  await invoke('cancel_pulse_stream', { payload })
}

/** Subscribes to Pulse lifecycle stream events. */
export async function listenPulseStream(
  eventName: 'pulse://start' | 'pulse://delta' | 'pulse://complete' | 'pulse://error',
  handler: (payload: PulseStreamEvent) => void
): Promise<UnlistenFn> {
  return await listen<PulseStreamEvent>(eventName, (event) => {
    handler(event.payload)
  })
}
