import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import PropertyTokenInput from './PropertyTokenInput.vue'

describe('PropertyTokenInput', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows all autocomplete suggestions on focus and filters as the user types', async () => {
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
    await nextTick()

    let menu = document.body.querySelector('.property-token-input-menu')
    expect(menu).toBeTruthy()
    let options = Array.from(menu?.querySelectorAll('.ui-filterable-dropdown-option') ?? []).map(
      (option) => option.textContent?.trim()
    )
    expect(options).toEqual(['review', 'published'])

    input!.value = 're'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    menu = document.body.querySelector('.property-token-input-menu')
    expect(menu).toBeTruthy()
    options = Array.from(menu?.querySelectorAll('.ui-filterable-dropdown-option') ?? []).map(
      (option) => option.textContent?.trim()
    )
    expect(options).toEqual(['review'])

    app.unmount()
  })
})
