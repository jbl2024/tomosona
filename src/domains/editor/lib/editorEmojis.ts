/**
 * Portable Unicode emoji catalog used by the editor's `@` macro picker.
 * The app stores the characters themselves, so inserted content is not tied to
 * an operating-system emoji picker or a particular font.
 */
export type EditorEmojiGroup = {
  label: string
  emojis: string[]
}

export const EDITOR_EMOJI_GROUPS: EditorEmojiGroup[] = [
  { label: 'Smileys', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🙂', '🙃', '😉', '😊', '😍', '😘', '😎', '🤓', '🥳', '🤔', '🤗', '🤩', '😴', '😭', '😡', '🤯', '😱'] },
  { label: 'Gestures', emojis: ['👋', '🤚', '✋', '🖐️', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '👍', '👎', '👏', '🙌', '🫶', '💪', '🙏', '✍️'] },
  { label: 'People', emojis: ['👤', '👥', '🧑', '👩', '👨', '🧒', '👶', '👴', '👵', '🧑‍💻', '👩‍💻', '👨‍💻', '🧑‍🎨', '👩‍🔬', '👨‍🚀', '👮', '🕵️', '💂', '🥷', '👷', '🤴', '👸', '🧙', '🧚'] },
  { label: 'Nature', emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🦄', '🐝', '🦋', '🌱', '🌲', '🌻', '🍀'] },
  { label: 'Food', emojis: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🥑', '🥕', '🌽', '🥐', '🍞', '🧀', '🍕', '🍔', '🍣', '🍜', '🍪', '🍰', '☕', '🍷'] },
  { label: 'Activities', emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏆', '🥇', '🎯', '🎮', '🎲', '🧩', '🎨', '🎭', '🎤', '🎧', '🎹', '🎸', '🎬', '🚴', '🏃', '🧘', '✈️', '🏖️'] },
  { label: 'Objects', emojis: ['💡', '🔦', '📌', '📍', '📎', '🖇️', '📁', '📂', '🗂️', '📝', '📖', '🔖', '📚', '💻', '⌨️', '🖥️', '📱', '☎️', '📷', '⏰', '⌛', '🔑', '🔒', '🛠️'] },
  { label: 'Status', emojis: ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪', '🟩', '🟨', '🟦', '🟪', '🟥', '⬛', '⬜', '🆗', '🆕', '🆙', '🆒', '🈳', '🈺', '🅿️', '🔘'] },
  { label: 'Symbols', emojis: ['✅', '☑️', '✔️', '❌', '❗', '❓', '⚠️', '🚫', '♻️', '💯', '💤', '💬', '💭', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '⭐', '✨', '🔥', '🎉'] }
]

const EMOJI_SEARCH_TERMS: Record<string, string[]> = {
  '✅': ['check', 'checked', 'tick', 'done', 'valid', 'success', 'ok', 'oui'],
  '☑️': ['check', 'checked', 'tick', 'box', 'done', 'valid'],
  '✔️': ['check', 'tick', 'done', 'valid'],
  '❌': ['cross', 'cancel', 'close', 'no', 'wrong', 'non'],
  '👍': ['thumb', 'thumbs up', 'like', 'approve', 'yes', 'oui'],
  '👎': ['thumb', 'thumbs down', 'dislike', 'reject', 'no', 'non'],
  '⚠️': ['warning', 'alert', 'caution', 'attention'],
  '❗': ['warning', 'important', 'exclamation', 'alert'],
  '❓': ['question', 'help', 'unknown'],
  '💡': ['idea', 'lightbulb', 'tip'],
  '📌': ['pin', 'pinned', 'pushpin'],
  '📍': ['location', 'place', 'marker'],
  '📎': ['attachment', 'paperclip', 'file'],
  '🔒': ['lock', 'private', 'secure'],
  '🔑': ['key', 'password', 'access'],
  '❤️': ['heart', 'love', 'like'],
  '💬': ['comment', 'chat', 'message', 'speech'],
  '💭': ['thought', 'thinking', 'idea'],
  '🎉': ['party', 'celebrate', 'celebration'],
  '🔥': ['fire', 'hot', 'trend'],
  '⭐': ['star', 'favorite', 'favourite'],
  '✨': ['sparkles', 'magic', 'shine'],
  '🚫': ['forbidden', 'prohibited', 'ban', 'no'],
  '💯': ['hundred', 'perfect', 'score'],
  '📝': ['note', 'write', 'edit', 'memo'],
  '📚': ['books', 'reading', 'library'],
  '💻': ['computer', 'laptop', 'code'],
  '📱': ['phone', 'mobile'],
  '☕': ['coffee', 'tea', 'drink'],
  '✈️': ['plane', 'travel', 'flight'],
  '🔴': ['status', 'red', 'circle', 'urgent', 'error'],
  '🟠': ['status', 'orange', 'circle', 'warning'],
  '🟡': ['status', 'yellow', 'circle', 'pending'],
  '🟢': ['status', 'green', 'circle', 'active', 'success'],
  '🔵': ['status', 'blue', 'circle', 'info'],
  '🟣': ['status', 'purple', 'circle'],
  '🟤': ['status', 'brown', 'circle'],
  '⚫': ['status', 'black', 'circle'],
  '⚪': ['status', 'white', 'circle'],
  '🟩': ['status', 'green', 'square'],
  '🟨': ['status', 'yellow', 'square'],
  '🟦': ['status', 'blue', 'square'],
  '🟪': ['status', 'purple', 'square'],
  '🟥': ['status', 'red', 'square']
}

/** Returns whether an emoji matches its portable, app-provided search terms. */
export function editorEmojiMatchesQuery(emoji: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  return [emoji, ...(EMOJI_SEARCH_TERMS[emoji] ?? [])]
    .some((term) => term.toLocaleLowerCase().includes(needle))
}
