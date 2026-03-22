import { createApp, h, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import PropertyAddDropdown from './PropertyAddDropdown.vue'

describe('PropertyAddDropdown', () => {
  it('opens in a floating portal and renders available properties plus custom key controls', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp({
      render() {
        return h(PropertyAddDropdown, {
          options: [
            { key: 'tags', description: 'Tag list' },
            { key: 'deadline', description: 'Due date' }
          ],
          existingKeys: ['tags']
        })
      }
    })

    app.mount(root)
    await nextTick()

    expect(root.textContent).toContain('Add property')

    const trigger = root.querySelector('button.property-add-trigger') as HTMLButtonElement | null
    trigger?.click()
    await nextTick()

    const menu = document.body.querySelector('.ui-filterable-dropdown-menu')
    expect(menu?.classList.contains('ui-filterable-dropdown-menu--portal')).toBe(true)
    expect(document.body.textContent).toContain('deadline')
    expect(document.body.textContent).toContain('Due date')
    expect((document.body.querySelector('.dropdown-custom-input') as HTMLInputElement | null)?.placeholder).toBe('custom key')

    app.unmount()
    document.body.innerHTML = ''
  })

  it('sorts visible properties alphabetically', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp({
      render() {
        return h(PropertyAddDropdown, {
          options: [
            { key: 'tags', description: 'Tag list' },
            { key: 'deadline', description: 'Due date' },
            { key: 'aliases', description: 'Alternative names' },
            { key: 'date', description: 'Primary date' }
          ],
          existingKeys: []
        })
      }
    })

    app.mount(root)
    await nextTick()

    const trigger = root.querySelector('button.property-add-trigger') as HTMLButtonElement | null
    trigger?.click()
    await nextTick()

    const items = Array.from(document.body.querySelectorAll('.dropdown-item > span')).map((el) => el.textContent?.trim())
    expect(items).toEqual(['aliases', 'date', 'deadline', 'tags'])

    app.unmount()
    document.body.innerHTML = ''
  })
})
