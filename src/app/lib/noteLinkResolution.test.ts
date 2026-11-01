import { describe, expect, it } from 'vitest'
import { resolveExistingWikilinkPath } from '../../domains/editor/lib/wikilinkResolution'
import { resolveNoteLinkPath } from './noteLinkResolution'

describe('note link resolution shared with navigation', () => {
  const root = '/vault'
  const files = ['/vault/notes/one.md', '/vault/other/two.md', '/vault/docs/index.md']
  const resolve = (target: string, source = '/vault/notes/current.md') => resolveNoteLinkPath(target, root, source, files, resolveExistingWikilinkPath)

  it('resolves root, current-folder and parent-relative targets using navigation rules', () => {
    expect(resolve('notes/one.md')?.existing).toBe('/vault/notes/one.md')
    expect(resolve('one')?.existing).toBe('/vault/notes/one.md')
    expect(resolve('../other/two.md')?.existing).toBe('/vault/other/two.md')
    expect(resolve('docs', '/vault/current.md')?.existing).toBe('/vault/docs/index.md')
  })

  it('returns the same note when the workspace list uses relative paths', () => {
    const relativeFiles = ['notes/one.md', 'other/two.md', 'docs/index.md']
    const result = resolveNoteLinkPath('../other/two.md', root, '/vault/notes/current.md', relativeFiles, resolveExistingWikilinkPath)
    expect(result?.existing).toBe('other/two.md')
  })

  it('leaves ambiguous targets unresolved and does not invent paths for traversal beyond the root', () => {
    const ambiguous = ['/vault/a/same.md', '/vault/b/same.md']
    expect(resolveNoteLinkPath('same', root, '/vault/current.md', ambiguous, resolveExistingWikilinkPath)?.existing).toBeNull()
    expect(resolve('../../../../escape', '/vault/a.md')).toBeNull()
    expect(resolveNoteLinkPath('', root, '/vault/a.md', files, resolveExistingWikilinkPath)).toBeNull()
  })
})
