import { computed, ref, type Ref } from 'vue'
import { composeMarkdownDocument, parseFrontmatter, serializeFrontmatter, type FrontmatterEnvelope, type FrontmatterField } from '../lib/frontmatter'
import { defaultPropertyTypeForKey, normalizePropertyKey, sanitizePropertyTypeSchema, type PropertyType, type PropertyTypeSchema } from '../lib/propertyTypes'

/**
 * useFrontmatterProperties
 *
 * Purpose:
 * - Manage frontmatter parsing/editing state and typed property interactions for the active note.
 *
 * Responsibilities:
 * - Parse/serialize frontmatter and keep raw-yaml + structured fields in sync.
 * - Apply property typing rules (locked keys, coercion, schema persistence).
 * - Expose UI-facing computed state for structured/raw property editors.
 *
 * Boundaries:
 * - Does not own editor block content or file IO; callers provide schema IO + dirty signaling.
 */
// Detects ISO date-only values, e.g. "2026-02-25".
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

type UseFrontmatterPropertiesOptions = {
  currentPath: Ref<string>
  loadPropertyTypeSchema: () => Promise<Record<string, string>>
  savePropertyTypeSchema: (schema: Record<string, string>) => Promise<void>
  onDirty: (path: string) => void
  emitProperties: (payload: { path: string; items: Array<{ key: string; value: string }>; parseErrorCount: number }) => void
}

/**
 * Builds a compact preview for emitted property values.
 */
function propertyValuePreview(value: FrontmatterField['value']): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  return String(value ?? '').replace(/\n/g, ' ')
}

/**
 * Returns only fields that can be safely serialized into YAML.
 */
function serializableFrontmatterFields(fields: FrontmatterField[]): FrontmatterField[] {
  return fields.filter((field) => field.key.trim().length > 0)
}

/**
 * Suggests a type for known semantic keys when schema has no explicit entry.
 */
function suggestedPropertyTypeForKey(key: string): PropertyType | null {
  const normalized = normalizePropertyKey(key)
  if (normalized === 'date' || normalized === 'deadline') return 'date'
  if (normalized === 'archive' || normalized === 'published') return 'checkbox'
  return null
}

/**
 * Returns the default locked type for reserved keys.
 */
function lockedPropertyTypeForKey(key: string): PropertyType | null {
  return defaultPropertyTypeForKey(key)
}

/**
 * Indicates whether a field key has a non-editable type.
 */
function isPropertyTypeLocked(key: string): boolean {
  return Boolean(lockedPropertyTypeForKey(key))
}

/**
 * Coerces text input into a value matching the selected property type.
 */
function coerceValueForType(type: PropertyType, input: string): string | number | boolean | string[] {
  if (type === 'checkbox') return input === 'true'
  if (type === 'number') {
    const parsed = Number(input)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (type === 'list' || type === 'tags') {
    return input
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return input
}

/**
 * Creates reactive frontmatter/property state and handlers for the active note.
 */
export function useFrontmatterProperties(options: UseFrontmatterPropertiesOptions) {
  const propertyEditorMode = ref<'structured' | 'raw'>('structured')
  const frontmatterByPath = ref<Record<string, FrontmatterEnvelope>>({})
  const rawYamlByPath = ref<Record<string, string>>({})
  const propertiesExpandedByPath = ref<Record<string, boolean>>({})
  const propertySchema = ref<PropertyTypeSchema>({})
  const propertySchemaLoaded = ref(false)
  const propertySchemaSaving = ref(false)

  const activeFrontmatter = computed<FrontmatterEnvelope | null>(() => {
    const path = options.currentPath.value
    if (!path) return null
    return frontmatterByPath.value[path] ?? null
  })

  const activeFields = computed(() => activeFrontmatter.value?.fields ?? [])
  const activeParseErrors = computed(() => activeFrontmatter.value?.parseErrors ?? [])
  const activeRawYaml = computed(() => {
    const path = options.currentPath.value
    if (!path) return ''
    return rawYamlByPath.value[path] ?? ''
  })

  const canUseStructuredProperties = computed(() => !activeParseErrors.value.length)
  const structuredPropertyFields = computed(() => activeFields.value)
  const structuredPropertyKeys = computed(() =>
    structuredPropertyFields.value
      .map((field) => field.key.trim().toLowerCase())
      .filter(Boolean)
  )

  /**
   * Moves one entry in an immutable record map.
   */
  function moveRecordKey<T>(record: Record<string, T>, from: string, to: string): Record<string, T> {
    if (!from || !to || from === to || !(from in record)) return record
    const next = { ...record }
    next[to] = next[from]
    delete next[from]
    return next
  }

  /**
   * Moves path-scoped frontmatter state after a note rename.
   */
  function movePathState(from: string, to: string) {
    if (!from || !to || from === to) return
    frontmatterByPath.value = moveRecordKey(frontmatterByPath.value, from, to)
    rawYamlByPath.value = moveRecordKey(rawYamlByPath.value, from, to)
  }

  /**
   * Loads and sanitizes property schema once per active session.
   */
  async function ensurePropertySchemaLoaded() {
    if (propertySchemaLoaded.value) return
    // Load schema once per editor session to keep property typing stable while editing.
    const loaded = await options.loadPropertyTypeSchema()
    propertySchema.value = sanitizePropertyTypeSchema(loaded)
    propertySchemaLoaded.value = true
  }

  /**
   * Clears cached schema state.
   */
  function resetPropertySchemaState() {
    propertySchemaLoaded.value = false
    propertySchema.value = {}
  }

  /**
   * Persists schema updates while preventing concurrent writes.
   */
  async function persistPropertySchema() {
    if (propertySchemaSaving.value) return
    propertySchemaSaving.value = true
    try {
      await options.savePropertyTypeSchema(propertySchema.value)
    } finally {
      propertySchemaSaving.value = false
    }
  }

  /**
   * Emits normalized property rows for parent consumers.
   */
  function emitProperties(path: string) {
    const envelope = frontmatterByPath.value[path]
    if (!envelope) {
      options.emitProperties({ path, items: [], parseErrorCount: 0 })
      return
    }
    const items = envelope.fields
      .filter((field) => field.key.trim().length > 0)
      .map((field) => ({
        key: field.key,
        value: propertyValuePreview(field.value)
      }))
    options.emitProperties({
      path,
      items,
      parseErrorCount: envelope.parseErrors.length
    })
  }

  /**
   * Parses frontmatter from markdown and stores both raw and structured state.
   */
  function parseAndStoreFrontmatter(path: string, sourceMarkdown: string) {
    const envelope = parseFrontmatter(sourceMarkdown, propertySchema.value)
    frontmatterByPath.value = {
      ...frontmatterByPath.value,
      [path]: envelope
    }
    rawYamlByPath.value = {
      ...rawYamlByPath.value,
      [path]: envelope.rawYaml
    }
    if (options.currentPath.value === path) {
      propertyEditorMode.value = envelope.parseErrors.length ? 'raw' : 'structured'
    }
    if (typeof propertiesExpandedByPath.value[path] === 'undefined') {
      propertiesExpandedByPath.value = {
        ...propertiesExpandedByPath.value,
        [path]: false
      }
    }
    emitProperties(path)
  }

  /**
   * Rewrites fields, recomputes YAML, and validates structured property constraints.
   */
  function updateFrontmatterFields(path: string, nextFields: FrontmatterField[]) {
    const current = frontmatterByPath.value[path]
    if (!current) return

    const normalized = nextFields.map((field, index) => ({
      ...field,
      order: index
    }))

    const serializable = serializableFrontmatterFields(normalized)
    const rawYaml = serializeFrontmatter(serializable)
    const parseErrors = (() => {
      // Validate at edit-time so the UI can stay in structured mode unless data is truly invalid.
      const seen = new Set<string>()
      const out: Array<{ line: number; message: string }> = []
      normalized.forEach((field, index) => {
        const key = field.key.trim().toLowerCase()
        if (!key) return
        if (seen.has(key) && key) out.push({ line: index + 1, message: `Duplicate property key: ${field.key}` })
        seen.add(key)
        if (field.type === 'date' && typeof field.value === 'string' && field.value && !DATE_ONLY_RE.test(field.value)) {
          out.push({ line: index + 1, message: `Invalid date value for ${field.key}. Use YYYY-MM-DD.` })
        }
      })
      return out
    })()

    frontmatterByPath.value = {
      ...frontmatterByPath.value,
      [path]: {
        ...current,
        hasFrontmatter: serializable.length > 0,
        fields: normalized,
        rawYaml,
        parseErrors
      }
    }
    rawYamlByPath.value = {
      ...rawYamlByPath.value,
      [path]: rawYaml
    }
    emitProperties(path)
  }

  /**
   * Marks current note as dirty after property changes.
   */
  function setPropertyDirty(path: string) {
    options.onDirty(path)
  }

  /**
   * Applies a partial update to one property field by index.
   */
  function updatePropertyField(index: number, patch: Partial<FrontmatterField>) {
    const path = options.currentPath.value
    if (!path) return
    const fields = [...activeFields.value]
    const current = fields[index]
    if (!current) return
    fields[index] = {
      ...current,
      ...patch
    }
    updateFrontmatterFields(path, fields)
    setPropertyDirty(path)
  }

  /**
   * Removes one property field from structured mode.
   */
  function removePropertyField(index: number) {
    const path = options.currentPath.value
    if (!path) return
    const fields = [...activeFields.value]
    if (index < 0 || index >= fields.length) return
    fields.splice(index, 1)
    updateFrontmatterFields(path, fields)
    setPropertyDirty(path)
  }

  /**
   * Adds a property field with inferred initial type/value.
   */
  function addPropertyField(initialKey = '') {
    const path = options.currentPath.value
    if (!path) return
    const fields = [...activeFields.value]
    const normalizedKey = initialKey.trim()
    const lockedType = lockedPropertyTypeForKey(normalizedKey)
    const inferredType =
      lockedType ??
      propertySchema.value[normalizePropertyKey(normalizedKey)] ??
      suggestedPropertyTypeForKey(normalizedKey) ??
      'text'
    const initialValue: FrontmatterField['value'] =
      inferredType === 'checkbox'
        ? false
        : inferredType === 'number'
          ? 0
          : inferredType === 'list' || inferredType === 'tags'
            ? []
            : ''
    fields.push({
      key: normalizedKey,
      value: initialValue,
      type: inferredType,
      order: fields.length,
      styleHint: inferredType === 'list' || inferredType === 'tags' ? 'inline-list' : 'plain'
    })
    updateFrontmatterFields(path, fields)
    if (normalizedKey) {
      const normalizedSchemaKey = normalizePropertyKey(normalizedKey)
      if (normalizedSchemaKey) {
        propertySchema.value = {
          ...propertySchema.value,
          [normalizedSchemaKey]: inferredType
        }
        void persistPropertySchema()
      }
    }
    setPropertyDirty(path)
  }

  /**
   * Updates field type and coerces existing value to match the new type.
   */
  async function onPropertyTypeChange(index: number, nextTypeRaw: string) {
    const path = options.currentPath.value
    if (!path) return
    const field = activeFields.value[index]
    if (!field) return
    if (isPropertyTypeLocked(field.key)) return
    const nextType = nextTypeRaw as PropertyType
    const normalizedKey = normalizePropertyKey(field.key)
    if (normalizedKey) {
      propertySchema.value = {
        ...propertySchema.value,
        [normalizedKey]: nextType
      }
      await persistPropertySchema()
    }

    let nextValue: FrontmatterField['value'] = field.value
    if (nextType === 'checkbox') {
      nextValue = Boolean(field.value)
    } else if (nextType === 'number') {
      const parsed = Number(field.value)
      nextValue = Number.isFinite(parsed) ? parsed : 0
    } else if (nextType === 'list' || nextType === 'tags') {
      nextValue = Array.isArray(field.value)
        ? field.value
        : String(field.value ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
    } else {
      nextValue = Array.isArray(field.value) ? field.value.join(', ') : String(field.value ?? '')
    }

    updatePropertyField(index, {
      type: nextType,
      value: nextValue,
      styleHint: nextType === 'list' || nextType === 'tags' ? 'inline-list' : field.styleHint
    })
  }

  /**
   * Handles key edits and keeps schema mappings in sync.
   */
  async function onPropertyKeyInput(index: number, nextKey: string) {
    const field = activeFields.value[index]
    const previousKey = normalizePropertyKey(field?.key ?? '')
    const normalizedNext = normalizePropertyKey(nextKey)
    const lockedType = lockedPropertyTypeForKey(normalizedNext)
    const currentValue = field?.value
    const nextValue = (() => {
      if (!field) return ''
      if (!lockedType) return currentValue ?? ''
      if (lockedType === 'list' || lockedType === 'tags') {
        if (Array.isArray(currentValue)) return currentValue
        return String(currentValue ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      }
      if (lockedType === 'checkbox') return Boolean(currentValue)
      if (lockedType === 'number') {
        const parsed = Number(currentValue)
        return Number.isFinite(parsed) ? parsed : 0
      }
      return String(currentValue ?? '')
    })()
    updatePropertyField(index, {
      key: nextKey,
      ...(lockedType ? { type: lockedType, value: nextValue, styleHint: lockedType === 'list' || lockedType === 'tags' ? 'inline-list' : 'plain' } : {})
    })
    if (!normalizedNext) return

    const nextSchema: PropertyTypeSchema = {
      ...propertySchema.value,
      [normalizedNext]: lockedType ?? (field?.type ?? 'text')
    }
    if (previousKey && previousKey !== normalizedNext) {
      delete nextSchema[previousKey]
    }
    propertySchema.value = nextSchema
    await persistPropertySchema()
  }

  /**
   * Resolves the effective field type (locked type has priority).
   */
  function effectiveTypeForField(field: FrontmatterField): PropertyType {
    return lockedPropertyTypeForKey(field.key) ?? field.type
  }

  /**
   * Handles scalar input changes in structured mode.
   */
  function onPropertyValueInput(index: number, rawInput: string) {
    const field = activeFields.value[index]
    if (!field) return
    const nextValue = coerceValueForType(effectiveTypeForField(field), rawInput)
    updatePropertyField(index, { value: nextValue })
  }

  /**
   * Handles checkbox toggles in structured mode.
   */
  function onPropertyCheckboxInput(index: number, checked: boolean) {
    updatePropertyField(index, { value: checked })
  }

  /**
   * Handles token-list changes for list/tag properties.
   */
  function onPropertyTokensChange(index: number, tokens: string[]) {
    const field = activeFields.value[index]
    if (!field) return
    const type = effectiveTypeForField(field)
    if (type !== 'list' && type !== 'tags') return
    updatePropertyField(index, { value: tokens, styleHint: 'inline-list' })
  }

  /**
   * Returns the expansion state for the properties panel.
   */
  function propertiesExpanded(path: string): boolean {
    const stored = propertiesExpandedByPath.value[path]
    if (typeof stored === 'boolean') return stored
    return false
  }

  /**
   * Toggles properties panel expansion for the current path.
   */
  function togglePropertiesVisibility() {
    const path = options.currentPath.value
    if (!path) return
    propertiesExpandedByPath.value = {
      ...propertiesExpandedByPath.value,
      [path]: !propertiesExpanded(path)
    }
  }

  /**
   * Handles raw YAML edits and reparses frontmatter state.
   */
  function onRawYamlInput(nextRaw: string) {
    const path = options.currentPath.value
    if (!path) return
    rawYamlByPath.value = {
      ...rawYamlByPath.value,
      [path]: nextRaw
    }

    const body = frontmatterByPath.value[path]?.body ?? ''
    const markdown = composeMarkdownDocument(body, nextRaw)
    const parsed = parseFrontmatter(markdown, propertySchema.value)
    frontmatterByPath.value = {
      ...frontmatterByPath.value,
      [path]: parsed
    }
    emitProperties(path)
    setPropertyDirty(path)
  }

  return {
    propertyEditorMode,
    frontmatterByPath,
    rawYamlByPath,
    propertySchema,
    propertySchemaLoaded,
    activeFrontmatter,
    activeFields,
    activeParseErrors,
    activeRawYaml,
    canUseStructuredProperties,
    structuredPropertyFields,
    structuredPropertyKeys,
    ensurePropertySchemaLoaded,
    resetPropertySchemaState,
    parseAndStoreFrontmatter,
    serializableFrontmatterFields,
    addPropertyField,
    removePropertyField,
    onPropertyTypeChange,
    onPropertyKeyInput,
    onPropertyValueInput,
    onPropertyCheckboxInput,
    onPropertyTokensChange,
    effectiveTypeForField,
    isPropertyTypeLocked,
    propertiesExpanded,
    togglePropertiesVisibility,
    onRawYamlInput,
    movePathState
  }
}
