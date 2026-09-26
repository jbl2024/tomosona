import { describe, expect, it } from 'vitest'
import { resolveTerminalBuiltinCommand } from './terminalCommands'

describe('resolveTerminalBuiltinCommand', () => {
  it('moves to the active file directory for @current', () => {
    expect(resolveTerminalBuiltinCommand('@current', '/vault/notes/today.md', '/vault')).toBe("cd '/vault/notes'")
  })

  it('moves to the workspace root for @home', () => {
    expect(resolveTerminalBuiltinCommand('@home', '/vault/notes/today.md', '/vault')).toBe("cd '/vault'")
  })

  it('leaves ordinary shell input untouched', () => {
    expect(resolveTerminalBuiltinCommand('ls', '/vault/notes/today.md', '/vault')).toBeNull()
  })
})
