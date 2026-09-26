# Testing Guide

This repository uses Vitest for frontend tests and Rust tests for backend logic. Keep tests small, intentional, and easy to maintain.

## What To Test Where

Use the least expensive test that provides confidence.

### Unit tests

Use unit tests for pure or nearly pure logic, deterministic transformations, and focused state transitions. Keep these tests near the code they protect.

Examples in this repository:

- `src/app/lib/appShellPaths.test.ts`
- `src/shared/lib/markdownFrontmatter.test.ts`
- `src/domains/editor/lib/editorAtMacros.test.ts`

### Component tests

Use component tests for Vue rendering, props and emits, DOM interaction, lifecycle behavior, and narrow child-component boundaries.

Examples in this repository:

- `src/app/components/app/QuickOpenModal.test.ts`
- `src/app/components/panes/PaneSurfaceHost.test.ts`
- `src/domains/editor/components/EditorRightPane.test.ts`

### Integration tests

Use integration tests when a workflow crosses the app shell, composables, shared APIs, or persistence. Examples include restoring recent-note state or opening a workspace and navigating between panes.

## Mocking Rules

Mock the boundary that is not under test, never the behavior the test is meant to verify.

Mock when appropriate:

- Tauri IPC wrappers
- filesystem or backend adapters
- browser APIs unavailable in JSDOM
- large child components that would make a test too broad

Avoid mocking a small pure function or the state transition under test.

### Good `vi.mock` usage

Keep mock spies in a hoisted container when a mock factory needs them:

```ts
import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  readRecentNotes: vi.fn()
}))

vi.mock('../shared/api/workspaceApi', () => api)

it('returns the notes supplied by the workspace adapter', async () => {
  api.readRecentNotes.mockResolvedValue(['/vault/today.md'])

  await expect(api.readRecentNotes()).resolves.toEqual(['/vault/today.md'])
})
```

For child components, keep the stub focused on the parent contract:

```ts
import { defineComponent, h, vi } from 'vue'

vi.mock('./ChildPane.vue', () => ({
  default: defineComponent({
    props: ['value'],
    emits: ['select'],
    setup(props, { emit }) {
      return () => h('button', {
        type: 'button',
        onClick: () => emit('select', String(props.value))
      }, 'child-stub')
    }
  })
}))
```

## Common Patterns

### Pure function test

Keep pure-function tests direct and focused on observable results.

```ts
import { describe, expect, it } from 'vitest'
import { toRelativePath } from './appShellPaths'

describe('toRelativePath', () => {
  it('returns a workspace-relative path', () => {
    expect(toRelativePath('/vault', '/vault/notes/today.md')).toBe('notes/today.md')
  })
})
```

### Composable test with injected ports

Prefer explicit dependency injection for stateful workflows. It keeps the test focused and avoids broad app setup.

```ts
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const saveNote = vi.fn(async () => {})
const state = ref('draft')

it('saves the active note', async () => {
  await saveNote(state.value)
  expect(saveNote).toHaveBeenCalledWith('draft')
})
```

### App-level integration test

Use this when several shell pieces must cooperate:

1. Mock only large child surfaces.
2. Mount `App.vue`.
3. Drive the UI through clicks or keyboard events.
4. Assert the resulting cross-boundary effect.

## Handling Async UI

Async Vue tests often need explicit flushing after watcher updates or resolved promises:

```ts
async function flushUi() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
```

Use fake timers for debounced behavior, and restore real timers in cleanup.

## State Reset And Cleanup

Clean up browser and mock state after every test that changes it:

- `window.localStorage.clear()`
- `window.sessionStorage.clear()`
- `document.body.innerHTML = ''`
- `app.unmount()`
- `vi.clearAllMocks()`
- `vi.useRealTimers()`

## Naming And File Layout

Use `*.test.ts` for focused tests, `*.integration.test.ts` for broader workflows, and `*.contract.test.ts` for compatibility checks. Keep each test close to the code it protects.

## Anti-Patterns

Avoid giant tests, broad snapshots, duplicate production logic in tests, and real filesystem or network calls when an injected adapter is sufficient.

## When A Test Feels Too Hard

When a test is awkward, the code often owns too many concerns or the boundary is wrong. Prefer splitting ownership, injecting dependencies, or moving the test to the layer that owns the behavior.
