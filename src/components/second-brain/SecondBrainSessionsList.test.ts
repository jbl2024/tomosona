import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import SecondBrainSessionsList from './SecondBrainSessionsList.vue'

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

describe('SecondBrainSessionsList', () => {
  it('filters and selects sessions', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const selected = ref('')

    const Harness = defineComponent({
      setup() {
        return () =>
          h(SecondBrainSessionsList, {
            sessions: [
              {
                session_id: 's1',
                title: 'Alpha Session',
                created_at_ms: 1,
                updated_at_ms: 1,
                context_count: 1,
                target_note_path: '',
                context_paths: []
              },
              {
                session_id: 's2',
                title: 'Beta Session',
                created_at_ms: 1,
                updated_at_ms: 1,
                context_count: 1,
                target_note_path: '',
                context_paths: []
              }
            ],
            activeSessionId: selected.value,
            loading: false,
            onSelect: (id: string) => {
              selected.value = id
            }
          })
      }
    })

    const app = createApp(Harness)
    app.mount(root)
    await flushUi()

    const input = root.querySelector<HTMLInputElement>('.sb-input')
    expect(input).toBeTruthy()
    if (input) {
      input.value = 'beta'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushUi()

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.sb-session-item'))
    expect(buttons).toHaveLength(1)
    buttons[0].click()
    await flushUi()
    expect(selected.value).toBe('s2')

    app.unmount()
  })
})
