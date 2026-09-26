import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import EditorPropertiesPanel from './EditorPropertiesPanel.vue'
import type { PropertyType } from '../../lib/propertyTypes'

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

describe('EditorPropertiesPanel', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders collapsed row without overlay classes', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorPropertiesPanel, {
          expanded: false,
          hasProperties: true,
          mode: 'structured',
          canUseStructuredProperties: true,
          structuredPropertyFields: [],
          structuredPropertyKeys: [],
          activeRawYaml: '',
          activeParseErrors: [],
          corePropertyOptions: [],
          propertyKeySuggestions: [],
          propertySuggestionsForField: () => [],
          effectiveTypeForField: (): PropertyType => 'text',
          isPropertyTypeLocked: () => false,
          generationPending: false,
          generationTargetIndex: null
        })
      }
    }))

    app.mount(root)
    await flushUi()

    expect(root.querySelector('.properties-panel')).toBeTruthy()
    expect(root.querySelector('.properties-panel')?.classList.contains('properties-panel--populated')).toBe(true)
    expect(root.querySelector('.properties-content-wrap')).toBeFalsy()
    expect(root.innerHTML).not.toContain('absolute')

    app.unmount()
  })

  it('marks empty state separately so it can stay almost invisible until hover', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorPropertiesPanel, {
          expanded: false,
          hasProperties: false,
          mode: 'structured',
          canUseStructuredProperties: true,
          structuredPropertyFields: [],
          structuredPropertyKeys: [],
          activeRawYaml: '',
          activeParseErrors: [],
          corePropertyOptions: [],
          propertyKeySuggestions: [],
          propertySuggestionsForField: () => [],
          effectiveTypeForField: (): PropertyType => 'text',
          isPropertyTypeLocked: () => false,
          generationPending: false,
          generationTargetIndex: null
        })
      }
    }))

    app.mount(root)
    await flushUi()

    const panel = root.querySelector('.properties-panel')
    expect(panel?.classList.contains('properties-panel--empty')).toBe(true)
    expect(panel?.classList.contains('properties-panel--expanded')).toBe(false)

    app.unmount()
  })

  it('uses compact mode buttons when expanded', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorPropertiesPanel, {
          expanded: true,
          hasProperties: true,
          mode: 'structured',
          canUseStructuredProperties: true,
          structuredPropertyFields: [],
          structuredPropertyKeys: [],
          activeRawYaml: '',
          activeParseErrors: [],
          corePropertyOptions: [],
          propertyKeySuggestions: [],
          propertySuggestionsForField: () => [],
          effectiveTypeForField: (): PropertyType => 'text',
          isPropertyTypeLocked: () => false,
          generationPending: false,
          generationTargetIndex: null
        })
      }
    }))

    app.mount(root)
    await flushUi()

    const buttons = root.querySelectorAll('.properties-mode-btn')
    expect(buttons.length).toBe(2)
    expect((buttons[0] as HTMLButtonElement).style.height).toBe('1.45rem')
    expect((buttons[1] as HTMLButtonElement).style.height).toBe('1.45rem')
    expect((buttons[0] as HTMLButtonElement).style.fontSize).toBe('10px')

    app.unmount()
  })

  it('renders structured property fields when expanded', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorPropertiesPanel, {
          expanded: true,
          hasProperties: true,
          mode: 'structured',
          canUseStructuredProperties: true,
          structuredPropertyFields: [{ key: 'status', value: '', type: 'text', order: 0, styleHint: 'plain' }],
          structuredPropertyKeys: ['status'],
          activeRawYaml: '',
          activeParseErrors: [],
          corePropertyOptions: [],
          propertyKeySuggestions: [],
          propertySuggestionsForField: () => [],
          effectiveTypeForField: (): PropertyType => 'text',
          isPropertyTypeLocked: () => false,
          generationPending: false,
          generationTargetIndex: null
        })
      }
    }))

    app.mount(root)
    await flushUi()

    expect(root.querySelector('.property-row')).toBeTruthy()
    expect(root.querySelector('.properties-remove-btn')).toBeTruthy()

    app.unmount()
  })
})
