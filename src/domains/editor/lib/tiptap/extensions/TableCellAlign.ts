import { Extension } from '@tiptap/core'

type TableAlign = 'left' | 'center' | 'right' | null

function normalizeTableAlign(value: string | null | undefined): TableAlign {
  const token = String(value ?? '').trim().toLowerCase()
  if (token === 'left' || token === 'center' || token === 'right') return token
  return null
}

/**
 * Adds per-column text alignment attrs for table cells/headers.
 *
 * Why:
 * - Keep alignment state in document attrs so markdown round-trip can preserve
 *   `:---`, `:---:`, `---:` separators.
 */
export const TableCellAlign = Extension.create({
  name: 'tableCellAlign',
  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => {
              const el = element as HTMLElement
              return normalizeTableAlign(el.getAttribute('data-align') ?? el.style.textAlign)
            },
            renderHTML: (attrs) => {
              const align = normalizeTableAlign(attrs.textAlign as string | null | undefined)
              if (!align) return {}
              return {
                'data-align': align,
                style: `text-align: ${align};`
              }
            }
          }
        }
      }
    ]
  }
})
