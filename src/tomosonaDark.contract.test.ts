import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const themeSource = readFileSync(resolve(process.cwd(), 'src/assets/themes/base.css'), 'utf-8')

describe('Tomosona Dark theme', () => {
  it('uses the Atom One Dark surface hierarchy and palette', () => {
    expect(themeSource).toContain("html[data-theme='tomosona-dark']")
    expect(themeSource).toContain('--color-surface-0: #282c34;')
    expect(themeSource).toContain('--color-surface-2: #21252b;')
    expect(themeSource).toContain('--color-accent-1: #61afef;')
  })
})
