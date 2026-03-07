import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useFrontmatterProperties } from './useFrontmatterProperties'

function setup(path = 'notes/a.md') {
  const currentPath = ref(path)
  const emitProperties = vi.fn()
  const onDirty = vi.fn()
  const savePropertyTypeSchema = vi.fn(async () => {})
  const loadPropertyTypeSchema = vi.fn(async () => ({ published: 'checkbox', tags: 'tags', bad: 'nope' }))

  const api = useFrontmatterProperties({
    currentPath,
    loadPropertyTypeSchema,
    savePropertyTypeSchema,
    onDirty,
    emitProperties
  })

  return {
    currentPath,
    emitProperties,
    onDirty,
    savePropertyTypeSchema,
    loadPropertyTypeSchema,
    api
  }
}

describe('useFrontmatterProperties', () => {
  it('loads and sanitizes schema once', async () => {
    const { api, loadPropertyTypeSchema } = setup()

    await api.ensurePropertySchemaLoaded()
    await api.ensurePropertySchemaLoaded()

    expect(loadPropertyTypeSchema).toHaveBeenCalledTimes(1)
    expect(api.propertySchema.value).toEqual({ published: 'checkbox', tags: 'tags' })
  })

  it('switches to raw mode when parse errors exist', () => {
    const { api } = setup()

    api.parseAndStoreFrontmatter('notes/a.md', '---\ntags:\n  - one\n  bad-indent\n---\nBody')
    expect(api.propertyEditorMode.value).toBe('raw')
    expect(api.activeParseErrors.value.length).toBeGreaterThan(0)
  })

  it('detects duplicate keys and invalid date format in structured editing', () => {
    const { api } = setup()
    api.parseAndStoreFrontmatter('notes/a.md', 'Body')

    api.addPropertyField('date')
    api.onPropertyValueInput(0, '2026/02/25')
    api.addPropertyField('date')

    const messages = api.activeParseErrors.value.map((item) => item.message)
    expect(messages.some((message) => message.includes('Invalid date value'))).toBe(true)
    expect(messages.some((message) => message.includes('Duplicate property key'))).toBe(true)
  })

  it('coerces values when field type changes', async () => {
    const { api } = setup()
    api.parseAndStoreFrontmatter('notes/a.md', '---\ncount: "7"\n---\nBody')

    await api.onPropertyTypeChange(0, 'number')
    expect(api.activeFields.value[0]?.value).toBe(7)
    expect(typeof api.activeFields.value[0]?.value).toBe('number')
  })

  it('marks document dirty when property value changes', () => {
    const { api, onDirty } = setup()
    api.parseAndStoreFrontmatter('notes/a.md', '---\ntitle: test\n---\nBody')

    api.onPropertyValueInput(0, 'updated')
    expect(onDirty).toHaveBeenCalledWith('notes/a.md')
  })
})
