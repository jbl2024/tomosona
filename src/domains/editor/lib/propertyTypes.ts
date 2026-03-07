export type PropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'tags'

export type PropertyTypeSchema = Record<string, PropertyType>

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

export function normalizePropertyKey(key: string): string {
  return key.trim().toLowerCase()
}

export function inferPropertyType(value: unknown): PropertyType {
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number' && Number.isFinite(value)) return 'number'
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) return 'date'
  return 'text'
}

export function defaultPropertyTypeForKey(key: string): PropertyType | null {
  const normalized = normalizePropertyKey(key)
  if (normalized === 'tags') return 'tags'
  if (normalized === 'aliases' || normalized === 'cssclasses') return 'list'
  return null
}

export function resolvePropertyType(key: string, value: unknown, schema: PropertyTypeSchema): PropertyType {
  const normalized = normalizePropertyKey(key)
  const fromSchema = schema[normalized]
  if (fromSchema) return fromSchema

  const fromDefault = defaultPropertyTypeForKey(normalized)
  if (fromDefault) return fromDefault

  return inferPropertyType(value)
}

export function sanitizePropertyTypeSchema(value: unknown): PropertyTypeSchema {
  const out: PropertyTypeSchema = {}
  if (!value || typeof value !== 'object') return out

  const entries = Object.entries(value as Record<string, unknown>)
  for (const [key, rawType] of entries) {
    if (typeof key !== 'string' || typeof rawType !== 'string') continue
    const normalizedKey = normalizePropertyKey(key)
    if (!normalizedKey) continue
    if (!isPropertyType(rawType)) continue
    out[normalizedKey] = rawType
  }

  return out
}

export function isPropertyType(value: string): value is PropertyType {
  return value === 'text' || value === 'list' || value === 'number' || value === 'checkbox' || value === 'date' || value === 'tags'
}
