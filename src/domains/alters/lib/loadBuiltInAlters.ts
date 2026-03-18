import type { FilterableDropdownItem } from '../../../shared/components/ui/UiFilterableDropdown.vue'
import { parseFrontmatterEnvelope } from '../../../shared/lib/markdownFrontmatter'

export type QuickStartLibraryItem = FilterableDropdownItem & {
  prompt: string
}

type BuiltInAlterFrontmatter = {
  id?: string
  label?: string
  group?: string
}

/**
 * Built-in alters loader.
 *
 * Does:
 * - load bundled alter markdown files
 * - extract only the small frontmatter metadata needed for the quick-start list
 * - keep the prompt body as-is for the catalog
 *
 * Does not:
 * - parse full YAML
 * - validate alter authoring beyond the fields this view needs
 * - own the runtime alter model used elsewhere in the app
 */
function parseBuiltInAlterFrontmatter(rawYaml: string): BuiltInAlterFrontmatter {
  const data: BuiltInAlterFrontmatter = {}

  rawYaml.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return

    const separatorIndex = line.indexOf(':')
    if (separatorIndex < 0) return

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (!key) return

    if (key === 'id' || key === 'label' || key === 'group') {
      data[key] = value
    }
  })

  return data
}

/**
 * Parses one built-in alter markdown file into a quick-start item.
 *
 * Returns null when the file does not provide enough catalog metadata.
 */
export function parseBuiltInAlterMarkdown(path: string, raw: string): QuickStartLibraryItem | null {
  const envelope = parseFrontmatterEnvelope(raw)
  const frontmatter = envelope.hasFrontmatter ? parseBuiltInAlterFrontmatter(envelope.rawYaml) : {}
  const prompt = envelope.body.trim()
  const id = frontmatter.id?.trim() || path.split('/').pop()?.replace(/\.(md|markdown)$/, '') || 'unknown'
  const label = frontmatter.label?.trim()
  const group = frontmatter.group?.trim()

  if (!label || !group || !prompt) {
    return null
  }

  return {
    id,
    label,
    group,
    prompt
  }
}

/**
 * Load all built-in alters from markdown files
 */
export const builtInAlterModules = import.meta.glob('../data/*.{md,markdown}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

export const builtInAlters: QuickStartLibraryItem[] = Object.entries(builtInAlterModules)
  .map(([path, raw]) => {
    return parseBuiltInAlterMarkdown(path, raw)
  })
  .filter((item): item is QuickStartLibraryItem => item !== null)
  .sort((a, b) => a.id.localeCompare(b.id))
