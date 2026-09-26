import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type TerminalOutput = { session_id: string; data: string }
export type TerminalClosed = { session_id: string }

/** Starts a native shell at a workspace-scoped file or directory. */
export async function startTerminalSession(cwd?: string): Promise<string> {
  return await invoke('start_terminal_session', { cwd })
}

/** Sends raw keyboard input to a native terminal session. */
export async function writeTerminalSession(sessionId: string, data: string): Promise<void> {
  await invoke('write_terminal_session', { sessionId, data })
}

/** Synchronizes the native pseudo-terminal dimensions with its renderer. */
export async function resizeTerminalSession(sessionId: string, cols: number, rows: number): Promise<void> {
  await invoke('resize_terminal_session', { sessionId, cols, rows })
}

/** Stops a native terminal session and its child shell. */
export async function closeTerminalSession(sessionId: string): Promise<void> {
  await invoke('close_terminal_session', { sessionId })
}

/** Subscribes to raw output emitted by native terminal sessions. */
export async function listenTerminalOutput(handler: (output: TerminalOutput) => void): Promise<UnlistenFn> {
  return await listen<TerminalOutput>('terminal://output', (event) => handler(event.payload))
}

/** Subscribes to shell exits, including an interactive shell closed with Ctrl+D. */
export async function listenTerminalClosed(handler: (closed: TerminalClosed) => void): Promise<UnlistenFn> {
  return await listen<TerminalClosed>('terminal://closed', (event) => handler(event.payload))
}
