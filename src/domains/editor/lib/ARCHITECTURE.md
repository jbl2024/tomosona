# Markdown Bridge

`markdownBlocks.ts` is the lightweight bridge between raw markdown and the EditorJS-style block model used by the editor runtime.

The bridge only applies to the rich markdown surface. Raw-text source mode bypasses this parser/serializer loop and saves the file content verbatim.

## Pipeline

- `markdownToEditorData` parses markdown into normalized blocks.
- The editor mutates block data.
- `editorDataToMarkdown` serializes blocks back into canonical markdown.
- `clipboardHtmlToMarkdown` converts pasted HTML into markdown before entering the same parser.

## Tolerance Rules

- Input newlines are normalized to `\n`, including common Unicode separators.
- Leading indentation uses plain spaces for structure, even if the source used Unicode space characters.
- Lists are tolerant to:
  - nested items with deeper indentation,
  - one blank line inside an item when the following line is still attached to that item,
  - continuation lines that stay indented more than the current list marker.
- Ambiguous inline markdown is normalized instead of preserved exactly.

## Supported Canonical Examples

```md
- parent
  continued line
  - child

- [x] task
  more details
```

## Preview Rendering

`markdownPreviewHtml.ts` renders note markdown as an HTML fragment for read-only previews
(explorer quick preview). It reuses `markdownToEditorData` so previews and the editor agree on
block structure, drops frontmatter, sanitizes embedded HTML, and keeps links inert because the
preview surface has no navigation handler. It never shells out to an external converter, so
previews do not depend on Pandoc being installed.

## Deliberate Non-goals

- Full CommonMark compatibility.
- Preserving every ambiguous input form through round-trip.
- Parsing every mixed list style into one combined tree.

If a source markdown form is ambiguous, the serializer should emit a stable canonical markdown form rather than reproduce the original input verbatim.
