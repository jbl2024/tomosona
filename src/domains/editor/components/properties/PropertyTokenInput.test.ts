import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import PropertyTokenInput from './PropertyTokenInput.vue'

describe('PropertyTokenInput', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders autocomplete suggestions through a datalist', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () => h(PropertyTokenInput, {
          modelValue: ['draft'],
          suggestions: ['draft', 'review', 'published', 'review']
        })
      }
    }))

    app.mount(root)
    await nextTick()

    const input = root.querySelector('.token-editor') as HTMLInputElement | null
    input?.focus()
    input!.value = 're'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    const menu = document.body.querySelector('.property-token-input-menu')
    expect(menu).toBeTruthy()
    const options = Array.from(menu?.querySelectorAll('.ui-filterable-dropdown-option') ?? []).map(
      (option) => option.textContent?.trim()
    )
    expect(options).toEqual(['review'])

    app.unmount()
  })
})
