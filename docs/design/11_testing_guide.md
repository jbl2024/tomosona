# Testing Guide

This repository uses `Vitest` for frontend tests and Rust tests for backend logic.
The goal of this guide is to keep tests small, intentional, and easy to maintain.

The short version:

- Test pure logic as close to the source as possible.
- Mock boundaries, not the behavior you are trying to verify.
- Use component or App-level tests only when the behavior crosses real boundaries.
- Prefer one focused test per behavior, not one giant test that proves everything.

## What To Test Where

Use the cheapest test that gives you confidence.

### Unit tests

Use a unit test when the logic is:

- Pure or almost pure
- Deterministic
- Easy to isolate
- Worth protecting from regression on its own

Typical examples:

- Path normalization helpers
- Markdown parsing helpers
- Session store functions
- Composable state transitions that accept injected ports

Examples in this repo:

- [`src/domains/second-brain/lib/secondBrainContextPaths.test.ts`](../../src/domains/second-brain/lib/secondBrainContextPaths.test.ts)
- [`src/app/composables/useAppSecondBrainBridge.test.ts`](../../src/app/composables/useAppSecondBrainBridge.test.ts)
- [`src/shared/lib/markdownFrontmatter.test.ts`](../../src/shared/lib/markdownFrontmatter.test.ts)

### Component tests

Use a component test when the behavior depends on:

- Vue rendering
- Props and emits
- DOM interaction
- Lifecycle hooks
- Child component boundaries you want to keep narrow

Typical examples:

- A list component that filters items and emits `select`
- A pane surface that forwards props to children
- A dialog that handles keyboard and click interactions

Examples in this repo:

- [`src/domains/second-brain/components/SecondBrainView.test.ts`](../../src/domains/second-brain/components/SecondBrainView.test.ts)
- [`src/app/components/panes/PaneSurfaceHost.test.ts`](../../src/app/components/panes/PaneSurfaceHost.test.ts)
- [`src/domains/editor/components/EditorRightPane.test.ts`](../../src/domains/editor/components/EditorRightPane.test.ts)

### Integration tests

Use an integration test when the behavior crosses multiple boundaries:

- App shell to composables
- Component to shared API wrappers
- UI action to persistence and reopening
- Multiple composables that coordinate a user-visible workflow

Typical examples:

- “Add active note to Second Brain, then reopen the pane and keep the session”
- “Open a Cosmos note, then move focus and keep the graph selection”
- “Open a workspace, then restore recent note state”

Examples in this repo:

- [`src/App.constituted-context.test.ts`](../../src/App.constituted-context.test.ts)
- [`src/App.second-brain-context.test.ts`](../../src/App.second-brain-context.test.ts)
- [`src/App.multi-pane.test.ts`](../../src/App.multi-pane.test.ts)

## Mocking Rules

Mock the boundary that is not under test.

Do not mock:

- The function or composable whose behavior you want to verify
- The state transitions you are trying to protect
- The result that is the point of the test

Do mock:

- IPC wrappers
- File system calls
- Network-facing or backend-facing adapters
- Child components that would otherwise make the test too broad

### Good `vi.mock` usage

Use `vi.mock` for:

- Shared API wrappers
- Tauri-facing adapters
- Large child components
- Browser APIs that are not available or not stable in JSDOM

Example: mock a shared API module while keeping the composable under test real.

```ts
import { describe, expect, it, vi } from 'vitest'
import { useEchoesPack } from './useEchoesPack'

const api = vi.hoisted(() => ({
  computeEchoesPack: vi.fn()
}))

vi.mock('../../../shared/api/indexApi', () => api)

it('returns the mocked echo pack result', async () => {
  api.computeEchoesPack.mockResolvedValue({
    anchorPath: '/vault/a.md',
    generatedAtMs: 1,
    items: []
  })

  // Exercise the real composable, not the API.
  const result = await useEchoesPack(/* injected refs */)
  expect(result.items.value).toEqual([])
})
```

Example: mock child Vue components in a parent/component test.

```ts
import { createApp, defineComponent, h } from 'vue'
import { vi } from 'vitest'

vi.mock('./ChildPane.vue', () => ({
  default: defineComponent({
    props: ['value'],
    emits: ['select'],
    setup(props, { emit }) {
      return () =>
        h('button', {
          type: 'button',
          onClick: () => emit('select', String(props.value))
        }, 'child-stub')
    }
  })
}))
```

Example: keep a top-level `vi.hoisted` container for spies that are referenced by the mock factory.

```ts
const api = vi.hoisted(() => ({
  loadDeliberationSession: vi.fn(),
  createDeliberationSession: vi.fn()
}))

vi.mock('./secondBrainApi', () => ({
  loadDeliberationSession: api.loadDeliberationSession,
  createDeliberationSession: api.createDeliberationSession
}))
```

### When not to mock

Avoid mocking when:

- The code under test is already a small pure function
- The test becomes less meaningful than the implementation
- You are mocking the exact thing you want confidence in

Bad example:

- Mocking `normalizeContextPathsForUpdate` while testing `useAppSecondBrainBridge`

Good example:

- Mocking `loadDeliberationSession` and `replaceSessionContext` while testing the bridge logic that orchestrates them

## Common Patterns

### 1. Pure function test

Keep these direct and boring.

```ts
import { describe, expect, it } from 'vitest'
import { workspaceScopedSecondBrainSessionKey } from './secondBrainContextPaths'

describe('workspaceScopedSecondBrainSessionKey', () => {
  it('encodes the workspace path into a stable storage key', () => {
    expect(workspaceScopedSecondBrainSessionKey('/vault/my ws')).toBe(
      'tomosona:second-brain:last-session-id:%2Fvault%2Fmy%20ws'
    )
  })
})
```

### 2. Composable test with injected ports

Prefer dependency injection for stateful logic. That keeps the test focused and avoids broad app setup.

```ts
import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppSecondBrainBridge } from './useAppSecondBrainBridge'

const bridge = useAppSecondBrainBridge({
  secondBrainWorkspacePort: {
    workingFolderPath: ref('/vault'),
    activeFilePath: ref('/vault/a.md')
  },
  secondBrainContextPort: {
    storageKeyForWorkspace: (workspacePath) => `sb:${workspacePath}`,
    toAbsoluteWorkspacePath: (_workspacePath, path) => path,
    normalizeContextPathsForUpdate: (_workspacePath, paths) => paths
  },
  secondBrainSessionPort: {
    createDeliberationSession: vi.fn(async () => ({ sessionId: 'session-new' })),
    loadDeliberationSession: vi.fn(async () => ({ session_id: 'session-new', context_items: [] })),
    replaceSessionContext: vi.fn(async () => {})
  },
  secondBrainUiEffectsPort: {
    errorMessage: ref(''),
    notifySuccess: vi.fn()
  }
})

it('persists the session id when one is selected', async () => {
  bridge.setSecondBrainSessionId('session-1')
  await nextTick()

  expect(bridge.secondBrainRequestedSessionId.value).toBe('session-1')
})
```

### 3. Component test with DOM interaction

Use a component test when the logic is mostly in the Vue template and events.

```ts
import { createApp, defineComponent, h, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import MyList from './MyList.vue'

it('emits the selected item', async () => {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const app = createApp(defineComponent({
    setup() {
      return () => h(MyList, {
        items: ['a', 'b'],
        onSelect: vi.fn()
      })
    }
  }))

  app.mount(root)
  await nextTick()

  root.querySelector<HTMLButtonElement>('button')?.click()
  await nextTick()

  app.unmount()
})
```

### 4. App-level integration test

Use this only when the workflow needs several shells pieces to cooperate.

This repo already uses that style for:

- constituted context flows
- workspace lifecycle flows
- multi-pane behavior

Pattern:

1. Mock the large child surfaces
2. Mount `App.vue`
3. Drive the UI through real clicks or keyboard events
4. Assert the cross-boundary effect

```ts
import { createApp, defineComponent, h, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import App from './app/App.vue'

vi.mock('./domains/second-brain/components/SecondBrainView.vue', () => ({
  default: defineComponent(() => () => h('div', { 'data-second-brain': 'stub' }))
}))

it('opens Second Brain with the current request state', async () => {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const app = createApp(App)
  app.mount(root)

  root.querySelector<HTMLButtonElement>('[data-open-context-second-brain="true"]')?.click()
  await nextTick()

  expect(root.querySelector('[data-second-brain="stub"]')).toBeTruthy()
  app.unmount()
})
```

## Handling Async UI

Async Vue tests often need explicit flushing.

Use a local helper instead of scattering arbitrary waits everywhere.

```ts
async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
```

Use it when:

- A watcher updates state
- A mock `Promise` resolves and the DOM should re-render
- An action emits events that trigger another async effect

If you need timers:

```ts
import { vi } from 'vitest'

vi.useFakeTimers()
// trigger debounce
vi.advanceTimersByTime(260)
```

## State Reset And Cleanup

Tests should clean up after themselves.

Common cleanup tasks:

- `window.localStorage.clear()`
- `window.sessionStorage.clear()`
- `document.body.innerHTML = ''`
- `app.unmount()`
- `vi.clearAllMocks()`
- `vi.useRealTimers()`

If a test mutates browser globals, restore them inside `beforeEach` or `afterEach`.

## Naming And File Layout

Prefer the naming that describes the behavior:

- `*.test.ts` for focused unit or component tests
- `*.integration.test.ts` for broader workflow tests when the distinction helps
- `*.contract.test.ts` for shape or compatibility checks

Keep tests near the code they protect.

Examples:

- `src/domains/second-brain/lib/secondBrainContextPaths.test.ts`
- `src/app/composables/useAppSecondBrainBridge.test.ts`
- `src/App.constituted-context.test.ts`

## Good Test Shape

A good test usually reads like this:

1. Arrange
2. Act
3. Assert

Keep the assertion focused on the behavior that matters most.

Example:

```ts
it('adds the active note to the requested session context', async () => {
  const { bridge, replaceSessionContext, notifySuccess } = createBridge()
  bridge.setSecondBrainSessionId('session-1')

  const ok = await bridge.addActiveNoteToSecondBrain()

  expect(ok).toBe(true)
  expect(replaceSessionContext).toHaveBeenCalledWith('session-1', ['/vault/notes/a.md'])
  expect(notifySuccess).toHaveBeenCalledWith('Active note added to Second Brain context.')
})
```

## Anti-Patterns

Avoid these when possible:

- Giant tests that cover many unrelated behaviors
- Snapshotting large DOM trees just because it is easy
- Mocking the entire world and then asserting implementation details
- Copying the production logic into the test
- Using real network or file system calls when an injected port is enough

## Second Brain Specific Advice

Second Brain has a few useful patterns worth reusing:

- Persist the requested session id at the shell boundary.
- Let the pane read session requests from explicit props.
- Test the orchestration in the shell, not just the inner pane.
- Keep session-store logic and UI loading logic covered separately.

This is the reason the repo now has layered tests for:

- session persistence in the bridge
- palette and command wiring in the shell
- App-level constituted context flows
- view-level session loading and message rendering

## When A Test Feels Too Hard

If a test becomes awkward, usually one of three things is happening:

- The code under test owns too many concerns.
- The boundary is wrong.
- The test is trying to cover too much at once.

Preferred fix order:

1. Split the production code along real ownership boundaries.
2. Inject the dependencies you need.
3. Move the test one layer down if the behavior is mostly pure.
4. Move the test one layer up if the real behavior is a user workflow.

## Reference Files

Useful examples in this repository:

- [`src/app/composables/useAppSecondBrainBridge.test.ts`](../../src/app/composables/useAppSecondBrainBridge.test.ts)
- [`src/app/composables/useAppShellCommands.test.ts`](../../src/app/composables/useAppShellCommands.test.ts)
- [`src/App.constituted-context.test.ts`](../../src/App.constituted-context.test.ts)
- [`src/domains/second-brain/components/SecondBrainView.test.ts`](../../src/domains/second-brain/components/SecondBrainView.test.ts)
- [`src/app/components/panes/PaneSurfaceHost.test.ts`](../../src/app/components/panes/PaneSurfaceHost.test.ts)
- [`src/domains/editor/components/EditorView.smoke.test.ts`](../../src/domains/editor/components/EditorView.smoke.test.ts)
