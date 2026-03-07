import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useSecondBrainAtMentions } from './useSecondBrainAtMentions'

describe('useSecondBrainAtMentions', () => {
  function build() {
    return useSecondBrainAtMentions({
      workspacePath: ref('/vault'),
      allWorkspaceFiles: ref([
        '/vault/alpha.md',
        '/vault/Beta.markdown',
        '/vault/docs/nested.md',
        '/vault/readme.txt'
      ])
    })
  }

  it('detects mention trigger with and without query', () => {
    const api = build()
    api.updateTrigger('Bonjour @', 9)
    expect(api.trigger.value?.query).toBe('')

    api.updateTrigger('Bonjour @do', 11)
    expect(api.trigger.value?.query).toBe('do')
  })

  it('filters markdown suggestions case-insensitively', () => {
    const api = build()
    api.updateTrigger('@be', 3)

    expect(api.suggestions.value.map((item) => item.relativePath)).toEqual(['Beta.markdown'])
  })

  it('moves active index with wrap-around', () => {
    const api = build()
    api.updateTrigger('@', 1)

    api.moveActive(-1)
    expect(api.activeIndex.value).toBe(api.suggestions.value.length - 1)

    api.moveActive(1)
    expect(api.activeIndex.value).toBe(0)
  })

  it('inserts selected mention and returns next caret', () => {
    const api = build()
    const text = 'Ask @do now'
    api.updateTrigger(text, 7)

    const suggestion = api.suggestions.value.find((item) => item.relativePath === 'docs/nested.md')
    expect(suggestion).toBeTruthy()
    if (!suggestion) return

    const result = api.applySuggestion(text, suggestion)
    expect(result.text).toBe('Ask @docs/nested.md  now')
    expect(result.caret).toBe('Ask @docs/nested.md '.length)
  })

  it('extracts resolved mentions and unresolved tokens', () => {
    const api = build()
    const result = api.resolveMentionedPaths('Use @alpha.md with @docs/nested.md and @missing.md then @alpha.md')

    expect(result.resolvedPaths).toEqual(['/vault/alpha.md', '/vault/docs/nested.md'])
    expect(result.unresolved).toEqual(['missing.md'])
  })

  it('deduplicates resolved mentions with mixed case and slash styles', () => {
    const api = build()
    const result = api.resolveMentionedPaths('Use @ALPHA.MD and @docs\\nested.md and @alpha.md')

    expect(result.resolvedPaths).toEqual(['/vault/alpha.md', '/vault/docs/nested.md'])
    expect(result.unresolved).toEqual([])
  })
})
