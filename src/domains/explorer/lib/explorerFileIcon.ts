/** Classifies explorer entries by filename; the tree API does not expose MIME types. */
export type ExplorerFileKind = 'folder' | 'markdown' | 'text' | 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'audio' | 'video' | 'archive' | 'code' | 'data' | 'file'

const extensions: Record<string, ExplorerFileKind> = {}
for (const [kind, names] of Object.entries({
  text: 'txt rtf log',
  image: 'png jpg jpeg gif webp svg bmp ico avif heic tif tiff',
  pdf: 'pdf',
  document: 'doc docx odt pages',
  spreadsheet: 'xls xlsx ods csv tsv numbers',
  presentation: 'ppt pptx odp keynote',
  audio: 'mp3 m4a wav ogg flac aac opus',
  video: 'mp4 mov webm avi mkv m4v',
  archive: 'zip rar 7z tar gz bz2 xz',
  code: 'js jsx ts tsx vue html css scss py rs go java c cpp h sh sql',
  data: 'json jsonl yaml yml xml toml ini'
} satisfies Partial<Record<ExplorerFileKind, string>>)) {
  for (const name of names.split(' ')) extensions[name] = kind as ExplorerFileKind
}

/** Returns a stable visual family, falling back for extensionless or unknown files. */
export function explorerFileKind(node: { name: string; is_dir: boolean; is_markdown: boolean }): ExplorerFileKind {
  if (node.is_dir) return 'folder'
  if (node.is_markdown) return 'markdown'
  const dot = node.name.lastIndexOf('.')
  if (dot <= 0 || dot === node.name.length - 1) return 'file'
  return extensions[node.name.slice(dot + 1).toLowerCase()] ?? 'file'
}

/** Returns the badge for recognized office formats and PDFs. */
export function explorerFileBadge(node: { name: string; is_dir: boolean; is_markdown: boolean }): string | null {
  const kind = explorerFileKind(node)
  if (!['pdf', 'document', 'spreadsheet', 'presentation'].includes(kind)) return null
  return node.name.slice(node.name.lastIndexOf('.') + 1).toUpperCase()
}
