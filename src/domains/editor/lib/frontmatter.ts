import { resolvePropertyType, type PropertyType, type PropertyTypeSchema } from './propertyTypes'

export type FrontmatterStyleHint = 'inline-list' | 'block-list' | 'literal-block' | 'plain'

export type FrontmatterValue = string | number | boolean | string[]

export type FrontmatterField = {
  key: string
  value: FrontmatterValue
  type: PropertyType
  order: number
  styleHint: FrontmatterStyleHint
}

export type FrontmatterError = {
  line: number
  message: string
}

export type FrontmatterEnvelope = {
  hasFrontmatter: boolean
  rawYaml: string
  fields: FrontmatterField[]
  body: string
  parseErrors: FrontmatterError[]
}

// Detects YAML-like "key: value" pairs, e.g. "title: My note".
const KEY_VALUE_RE = /^([A-Za-z0-9_-][A-Za-z0-9_\- ]*?):\s*(.*)$/
// Detects ISO date-only strings, e.g. "2026-02-25".
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n?/g, '\n')
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function parseInlineList(input: string): string[] | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null
  const inner = trimmed.slice(1, -1).trim()
  if (!inner) return []
  return inner
    .split(',')
    .map((part) => unquote(part.trim()))
    .filter((part) => part.length > 0)
}

function parseScalar(raw: string): string | number | boolean {
  const trimmed = raw.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  // Detects integer/float scalar values, e.g. "-2", "3.14".
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return unquote(trimmed)
}

function splitFrontmatter(markdown: string): { hasFrontmatter: boolean; rawYaml: string; body: string } {
  const normalized = normalizeNewlines(markdown)
  if (!normalized.startsWith('---\n')) {
    return { hasFrontmatter: false, rawYaml: '', body: normalized }
  }

  const closingIndex = normalized.indexOf('\n---\n', 4)
  if (closingIndex < 0) {
    return { hasFrontmatter: false, rawYaml: '', body: normalized }
  }

  const rawYaml = normalized.slice(4, closingIndex)
  const body = normalized.slice(closingIndex + 5)
  return { hasFrontmatter: true, rawYaml, body }
}

function ensureUniqueKeys(fields: FrontmatterField[]): FrontmatterError[] {
  const seen = new Set<string>()
  const errors: FrontmatterError[] = []
  for (const field of fields) {
    const normalized = field.key.trim().toLowerCase()
    if (!normalized) continue
    if (seen.has(normalized)) {
      errors.push({ line: field.order + 1, message: `Duplicate property key: ${field.key}` })
      continue
    }
    seen.add(normalized)
  }
  return errors
}

function parseYamlFields(rawYaml: string, schema: PropertyTypeSchema): { fields: FrontmatterField[]; errors: FrontmatterError[] } {
  const lines = normalizeNewlines(rawYaml).split('\n').map((raw, idx) => ({ raw, lineNo: idx + 1 }))
  const fields: FrontmatterField[] = []
  const errors: FrontmatterError[] = []

  let idx = 0
  while (idx < lines.length) {
    const line = lines[idx]
    const trimmed = line.raw.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      idx += 1
      continue
    }

    if (line.raw.startsWith('  ') || line.raw.startsWith('\t')) {
      errors.push({ line: line.lineNo, message: 'Unexpected indentation.' })
      idx += 1
      continue
    }

    const keyMatch = line.raw.match(KEY_VALUE_RE)
    if (!keyMatch) {
      errors.push({ line: line.lineNo, message: 'Invalid property syntax.' })
      idx += 1
      continue
    }

    const key = keyMatch[1].trim()
    const valuePart = keyMatch[2] ?? ''

    if (valuePart === '|') {
      const textLines: string[] = []
      idx += 1
      while (idx < lines.length) {
        const candidate = lines[idx]
        if (candidate.raw.startsWith('  ')) {
          textLines.push(candidate.raw.slice(2))
          idx += 1
          continue
        }
        if (!candidate.raw.trim()) {
          textLines.push('')
          idx += 1
          continue
        }
        break
      }
      const textValue = textLines.join('\n')
      const type = resolvePropertyType(key, textValue, schema)
      fields.push({ key, value: textValue, type, order: fields.length, styleHint: 'literal-block' })
      continue
    }

    const inlineList = parseInlineList(valuePart)
    if (inlineList) {
      const type = resolvePropertyType(key, inlineList, schema)
      fields.push({ key, value: inlineList, type, order: fields.length, styleHint: 'inline-list' })
      idx += 1
      continue
    }

    if (!valuePart.trim()) {
      const listItems: string[] = []
      let consumed = false
      idx += 1
      while (idx < lines.length) {
        const candidate = lines[idx]
        const trimmedCandidate = candidate.raw.trim()

        if (!trimmedCandidate) {
          idx += 1
          continue
        }

        if (candidate.raw.startsWith('  - ')) {
          consumed = true
          listItems.push(unquote(candidate.raw.slice(4).trim()))
          idx += 1
          continue
        }

        break
      }

      if (consumed) {
        const type = resolvePropertyType(key, listItems, schema)
        fields.push({ key, value: listItems, type, order: fields.length, styleHint: 'block-list' })
        continue
      }

      const type = resolvePropertyType(key, '', schema)
      fields.push({ key, value: '', type, order: fields.length, styleHint: 'plain' })
      continue
    }

    const scalar = parseScalar(valuePart)
    const type = resolvePropertyType(key, scalar, schema)
    fields.push({ key, value: scalar, type, order: fields.length, styleHint: 'plain' })
    idx += 1
  }

  errors.push(...ensureUniqueKeys(fields))
  return { fields, errors }
}

function quoteIfNeeded(value: string): string {
  if (!value) return '""'
  if (DATE_ONLY_RE.test(value)) return value
  // Detects wiki tokens that must stay quoted in YAML, e.g. "[[notes/today]]".
  if (/^\[\[.*\]\]$/.test(value)) return `"${value.replace(/"/g, '\\"')}"`
  // Detects leading/trailing spaces, YAML-significant chars, booleans, and numeric-like values.
  // Examples: " hello", "a:b", "true", "42".
  if (/^\s|\s$/.test(value) || /[:#\-\[\]{}!,&*?]|^true$|^false$|^-?\d+(\.\d+)?$/i.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`
  }
  return value
}

function serializeField(field: FrontmatterField): string {
  if (Array.isArray(field.value)) {
    const list = field.value
    if (field.styleHint === 'inline-list' || field.type === 'tags') {
      const inline = list.map((item) => quoteIfNeeded(item)).join(', ')
      return `${field.key}: [${inline}]`
    }

    if (list.length === 0) return `${field.key}: []`
    const block = list.map((item) => `  - ${quoteIfNeeded(item)}`).join('\n')
    return `${field.key}:\n${block}`
  }

  if (typeof field.value === 'boolean') {
    return `${field.key}: ${field.value ? 'true' : 'false'}`
  }

  if (typeof field.value === 'number') {
    return `${field.key}: ${field.value}`
  }

  if (field.styleHint === 'literal-block' || (typeof field.value === 'string' && field.value.includes('\n'))) {
    const lines = String(field.value)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')
    return `${field.key}: |\n${lines}`
  }

  return `${field.key}: ${quoteIfNeeded(String(field.value ?? ''))}`
}

export function parseFrontmatter(markdown: string, schema: PropertyTypeSchema): FrontmatterEnvelope {
  const parts = splitFrontmatter(markdown)
  if (!parts.hasFrontmatter) {
    return {
      hasFrontmatter: false,
      rawYaml: '',
      fields: [],
      body: parts.body,
      parseErrors: []
    }
  }

  const parsed = parseYamlFields(parts.rawYaml, schema)
  return {
    hasFrontmatter: true,
    rawYaml: parts.rawYaml,
    fields: parsed.fields,
    body: parts.body,
    parseErrors: parsed.errors
  }
}

export function serializeFrontmatter(fields: FrontmatterField[]): string {
  if (!fields.length) return ''
  const sorted = [...fields].sort((a, b) => a.order - b.order)
  return sorted.map((field) => serializeField(field)).join('\n')
}

export function composeMarkdownDocument(body: string, frontmatterYaml: string): string {
  const normalizedBody = normalizeNewlines(body)
  if (!frontmatterYaml.trim()) {
    return normalizedBody
  }

  // Trims only outer blank lines in frontmatter payload, e.g. "\n\ntitle: A\n\n" -> "title: A".
  const normalizedYaml = normalizeNewlines(frontmatterYaml).replace(/^\n+|\n+$/g, '')
  return `---\n${normalizedYaml}\n---\n${normalizedBody}`
}
