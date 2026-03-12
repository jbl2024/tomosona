import { invoke } from '@tauri-apps/api/core'

/** Writes plain text to the native system clipboard through Tauri. */
export async function writeClipboardText(text: string): Promise<void> {
  await invoke('write_clipboard_text', { text })
}
