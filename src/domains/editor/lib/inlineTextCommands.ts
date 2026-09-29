import type { InjectionKey } from 'vue'

/** Text field embedded in an atomic editor block (quote or callout). */
export type InlineTextCommandInput = {
  element: HTMLTextAreaElement
  value: string
  selectionStart: number
  selectionEnd: number
  getPos: () => number
  setValue: (value: string) => void
}

/** Bridges atomic block text fields to the editor's command overlays. */
export type InlineTextCommandHandler = {
  onInput: (input: InlineTextCommandInput) => void
  onKeydown: (event: KeyboardEvent, input: InlineTextCommandInput) => void
  onBlur: () => void
}

export const INLINE_TEXT_COMMAND_HANDLER: InjectionKey<InlineTextCommandHandler> = Symbol('inline-text-command-handler')
