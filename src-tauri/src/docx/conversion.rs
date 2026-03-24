//! Markdown to DOCX conversion for the native shell command.
//!
//! This module owns path validation, template discovery, Markdown parsing and
//! DOCX writing. The frontend only invokes the command; it does not perform
//! any document generation itself.

use std::{
    fs,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
};

use comrak::{
    nodes::{AstNode, ListType, NodeTable, NodeValue, TableAlignment},
    parse_document, Arena, Options,
};
use mermaid_rs_renderer::{
    render_with_options, write_output_png, RenderConfig, RenderOptions, Theme,
};
use rdocx::{Alignment, BorderStyle, Document, Length, VerticalAlignment};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use crate::docx::default_style::{ParagraphStyle, TemplateStyle, TextStyle};
use crate::docx::style_from_docx::read_template_style;
use crate::markdown_index::{parse_yaml_frontmatter_properties, strip_yaml_frontmatter};
use crate::{
    active_workspace_root, ensure_within_root, normalize_workspace_path, AppError, Result,
};

const TEMPLATE_DIR_NAME: &str = "_templates";
const CODE_FONT: &str = "Courier New";
const CODE_SIZE: u32 = 20;
const TABLE_WIDTH_IN: f64 = 6.25;
const TABLE_CELL_MARGIN_X_PT: f64 = 0.6;
const TABLE_CELL_MARGIN_Y_PT: f64 = 0.8;
const TABLE_MIN_COLUMN_WIDTH_IN: f64 = 0.75;
const TABLE_MAX_COLUMN_SHARE: f64 = 0.55;
const TABLE_BORDER_SIZE: u32 = 2;
const TABLE_HEADER_FILL: &str = "E8EEF4";
const TABLE_BORDER_COLOR: &str = "B8C4CF";
const CALLOUT_HEADER_TEXT: &str = "333333";
const CALLOUT_BODY_TEXT: &str = "333333";
const MERMAID_MAX_WIDTH_IN: f64 = 6.2;
const MERMAID_FALLBACK_HEIGHT_IN: f64 = 3.5;
const MERMAID_EMOJI_REPLACEMENTS: &[(&str, &str)] = &[
    ("✅", "[done]"),
    ("❌", "[fail]"),
    ("⚠️", "[warning]"),
    ("⚠", "[warning]"),
    ("🚧", "[wip]"),
    ("🔥", "[hot]"),
    ("💡", "[idea]"),
    ("🟢", "[ok]"),
    ("🔴", "[error]"),
    ("🟡", "[warn]"),
    ("🔵", "[info]"),
];

fn log_docx(message: &str) {
    eprintln!("[docx] {message}");
}

#[derive(Debug, Clone)]
struct RunSegment {
    text: String,
    style: TextStyle,
}

#[derive(Debug, Clone)]
struct TableRowData {
    is_header: bool,
    cells: Vec<Vec<RunSegment>>,
    alignments: Vec<TableAlignment>,
}

#[tauri::command]
pub async fn convert_markdown_to_docx(path: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || convert_markdown_to_docx_sync(path))
        .await
        .map_err(|_| AppError::OperationFailed)?
}

fn convert_markdown_to_docx_sync(path: String) -> Result<String> {
    let workspace_root = active_workspace_root()?;
    let source_path = normalize_workspace_path(&workspace_root, &path)?;
    ensure_within_root(&workspace_root, &source_path)?;

    if !source_path.is_file() {
        return Err(AppError::InvalidPath);
    }

    if !is_markdown_path(&source_path) {
        return Err(AppError::InvalidPath);
    }

    let markdown = fs::read_to_string(&source_path)?;
    let template_path = resolve_template_path(&workspace_root)?;
    let mut copied_styles_path: Option<PathBuf> = None;
    let template_style = match template_path {
        Some(ref path) => match read_template_style(path) {
            Ok(style) => {
                log_docx(&format!(
                    "template:loaded path={} font={} body_size={}",
                    path.display(),
                    style.default_font,
                    style.body_size
                ));
                copied_styles_path = Some(path.clone());
                style
            }
            Err(err) => {
                log_docx(&format!(
                    "template:fallback path={} reason={}",
                    path.display(),
                    err
                ));
                TemplateStyle::default()
            }
        },
        None => {
            log_docx("template:none using built-in defaults");
            TemplateStyle::default()
        }
    };

    let mut doc = build_document(&markdown, &template_style);
    let output_path = resolve_output_path(&source_path)?;
    let output_path = next_available_output_path(&output_path);
    doc.save(&output_path)
        .map_err(|_| AppError::OperationFailed)?;
    if let Some(template_path) = copied_styles_path.as_ref() {
        copy_template_styles_into_output(&output_path, template_path)?;
    } else {
        ensure_builtin_heading_styles(&output_path)?;
    }
    strip_leading_empty_table_paragraphs(&output_path)?;

    Ok(output_path.to_string_lossy().to_string())
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false)
}

fn resolve_output_path(source_path: &Path) -> Result<PathBuf> {
    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or(AppError::InvalidPath)?;
    let parent = source_path.parent().ok_or(AppError::InvalidPath)?;
    Ok(parent.join(format!("{stem}.docx")))
}

fn next_available_output_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }

    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("output");
    for index in 1..10_000 {
        let candidate = parent.join(format!("{stem} ({index}).docx"));
        if !candidate.exists() {
            return candidate;
        }
    }

    parent.join(format!("{stem} (9999).docx"))
}

fn resolve_template_path(root: &Path) -> Result<Option<PathBuf>> {
    let templates_dir = root.join(TEMPLATE_DIR_NAME);
    if !templates_dir.is_dir() {
        log_docx(&format!(
            "template:dir_missing path={}",
            templates_dir.display()
        ));
        return Ok(None);
    }

    let mut candidates = fs::read_dir(templates_dir)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("docx"))
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| left.file_name().cmp(&right.file_name()));
    if candidates.is_empty() {
        log_docx("template:dir_empty no_docx_found");
        return Ok(None);
    }

    let chosen = candidates.into_iter().next();
    if let Some(path) = &chosen {
        log_docx(&format!("template:chosen path={}", path.display()));
    }
    Ok(chosen)
}

fn copy_template_styles_into_output(output_path: &Path, template_path: &Path) -> Result<()> {
    let template_file = File::open(template_path)?;
    let mut template_zip = ZipArchive::new(template_file).map_err(|err| {
        AppError::InvalidOperation(format!("DOCX template styles open failed: {err}"))
    })?;
    let mut styles_xml = Vec::new();
    template_zip
        .by_name("word/styles.xml")
        .map_err(|err| AppError::InvalidOperation(format!("DOCX template styles missing: {err}")))?
        .read_to_end(&mut styles_xml)
        .map_err(|err| {
            AppError::InvalidOperation(format!("DOCX template styles read failed: {err}"))
        })?;

    replace_docx_entry(output_path, "word/styles.xml", &styles_xml)
}

fn ensure_builtin_heading_styles(output_path: &Path) -> Result<()> {
    let styles_xml = read_docx_entry_text_file(output_path, "word/styles.xml")?;
    let insertion = builtin_heading_styles_xml();
    let replacement = if styles_xml.contains("</w:styles>") {
        log_docx("styles:injecting_builtin_headings");
        styles_xml.replacen("</w:styles>", &format!("{insertion}\n</w:styles>"), 1)
    } else {
        return Err(AppError::InvalidOperation(
            "DOCX styles.xml missing closing styles tag.".to_string(),
        ));
    };
    replace_docx_entry(output_path, "word/styles.xml", replacement.as_bytes())
}

fn read_docx_entry_text_file(path: &Path, entry_name: &str) -> Result<String> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)
        .map_err(|err| AppError::InvalidOperation(format!("DOCX entry open failed: {err}")))?;
    let mut xml = String::new();
    archive
        .by_name(entry_name)
        .map_err(|err| AppError::InvalidOperation(format!("DOCX entry missing: {err}")))?
        .read_to_string(&mut xml)
        .map_err(|err| AppError::InvalidOperation(format!("DOCX entry read failed: {err}")))?;
    Ok(xml)
}

fn builtin_heading_styles_xml() -> String {
    let mut styles = String::new();
    for level in 1..=6 {
        styles.push_str(&builtin_heading_style_xml(level));
        styles.push('\n');
    }
    styles
}

fn builtin_heading_style_xml(level: u8) -> String {
    let (size, color, space_before, space_after, border_bottom) = match level {
        1 => (36, "1F3864", 360, 120, Some((6, "1F3864"))),
        2 => (28, "2E5090", 280, 100, None),
        3 => (24, "404040", 200, 80, None),
        4 => (22, "505050", 160, 80, None),
        5 => (20, "606060", 120, 60, None),
        _ => (18, "707070", 80, 60, None),
    };
    let style_id = format!("Heading{level}");
    let name = format!("Heading {level}");
    let border_xml = border_bottom.map(|(border_size, border_color)| {
        format!(
            "      <w:pBdr>\n        <w:bottom w:val=\"single\" w:sz=\"{border_size}\" w:color=\"{border_color}\" />\n      </w:pBdr>\n"
        )
    }).unwrap_or_default();

    format!(
        r#"  <w:style w:type="paragraph" w:styleId="{style_id}">
    <w:name w:val="{name}" />
    <w:basedOn w:val="Normal" />
    <w:next w:val="Normal" />
    <w:pPr>
      <w:keepNext />
      <w:spacing w:before="{space_before}" w:after="{space_after}" />
{border_xml}    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" />
      <w:b />
      <w:sz w:val="{size}" />
      <w:color w:val="{color}" />
    </w:rPr>
  </w:style>"#
    )
}

fn build_document(markdown: &str, template_style: &TemplateStyle) -> Document {
    let arena = Arena::new();
    let mut options = Options::default();
    options.extension.table = true;
    options.extension.strikethrough = true;
    options.extension.tasklist = true;
    options.extension.autolink = true;

    let frontmatter_rows = build_frontmatter_rows(markdown, template_style);
    let content = strip_yaml_frontmatter(markdown);
    let root = parse_document(&arena, content, &options);
    let mut doc = Document::new();

    if !frontmatter_rows.is_empty() {
        render_key_value_table(&mut doc, &frontmatter_rows, template_style);
        let _ = doc
            .add_paragraph("")
            .space_before(Length::pt(0.0))
            .space_after(Length::pt(12.0));
    }

    for child in root.children() {
        render_block(child, &mut doc, template_style, RenderContext::default());
    }

    doc
}

#[derive(Debug, Clone, Copy)]
struct RenderContext {
    quote_depth: usize,
    list_depth: usize,
    callout: Option<CalloutKind>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CalloutKind {
    Note,
    Abstract,
    Info,
    Tip,
    Success,
    Question,
    Warning,
    Failure,
    Danger,
    Bug,
    Example,
    Quote,
}

#[derive(Debug, Clone, Copy)]
struct CalloutStyle {
    fill: &'static str,
    border: &'static str,
}

impl CalloutKind {
    fn label(self) -> &'static str {
        match self {
            Self::Note => "Note",
            Self::Abstract => "Abstract",
            Self::Info => "Info",
            Self::Tip => "Tip",
            Self::Success => "Success",
            Self::Question => "Question",
            Self::Warning => "Warning",
            Self::Failure => "Failure",
            Self::Danger => "Danger",
            Self::Bug => "Bug",
            Self::Example => "Example",
            Self::Quote => "Quote",
        }
    }

    fn style(self) -> CalloutStyle {
        match self {
            Self::Note | Self::Info => CalloutStyle {
                fill: "E7F0FB",
                border: "C9D9EE",
            },
            Self::Tip | Self::Success | Self::Example => CalloutStyle {
                fill: "E6F1E6",
                border: "C8DCC8",
            },
            Self::Question => CalloutStyle {
                fill: "EDE8F6",
                border: "D5CDEB",
            },
            Self::Warning | Self::Failure | Self::Danger | Self::Bug => CalloutStyle {
                fill: "F4E8DF",
                border: "E0CDB8",
            },
            Self::Abstract | Self::Quote => CalloutStyle {
                fill: "EEF1F4",
                border: "D6DCE3",
            },
        }
    }
}

impl Default for RenderContext {
    fn default() -> Self {
        Self {
            quote_depth: 0,
            list_depth: 0,
            callout: None,
        }
    }
}

fn render_block<'a>(
    node: &'a AstNode<'a>,
    doc: &mut Document,
    template: &TemplateStyle,
    ctx: RenderContext,
) {
    match &node.data.borrow().value {
        NodeValue::Heading(heading) => {
            let mut paragraph = doc.add_paragraph("");
            if let Some(style_id) = template.heading_style_id(heading.level as u8) {
                paragraph = paragraph.style(style_id);
            }
            append_segments_to_paragraph(
                &mut paragraph,
                build_inline_segments(node, TextStyle::default(), template, ctx),
                template,
                false,
                false,
            );
        }
        NodeValue::Paragraph => {
            let mut style = template.body().run.clone();
            if ctx.callout.is_some() {
                style.color = Some(CALLOUT_BODY_TEXT.to_string());
            } else if ctx.quote_depth > 0 {
                style = template.quote().run.clone();
            }
            append_paragraph(
                doc,
                build_inline_segments(node, style, template, ctx),
                template,
                ctx,
            );
        }
        NodeValue::BlockQuote | NodeValue::MultilineBlockQuote(_) => {
            if let Some(callout) = detect_callout(node, template) {
                render_callout_block(node, doc, template, ctx, callout);
            } else {
                let next = RenderContext {
                    quote_depth: ctx.quote_depth + 1,
                    list_depth: ctx.list_depth,
                    callout: ctx.callout,
                };
                for child in node.children() {
                    render_block(child, doc, template, next);
                }
            }
        }
        NodeValue::CodeBlock(code_block) => {
            if is_mermaid_code_block(&code_block.info) {
                if render_mermaid_block(&code_block.literal, doc) {
                    return;
                }
            }
            let mut code_lines = code_block.literal.lines().collect::<Vec<_>>();
            if code_lines.is_empty() {
                code_lines.push("");
            }
            for line in code_lines {
                let segments = vec![RunSegment {
                    text: if line.is_empty() {
                        " ".to_string()
                    } else {
                        line.to_string()
                    },
                    style: TextStyle {
                        font: Some(CODE_FONT.to_string()),
                        size: Some(CODE_SIZE),
                        color: Some("2D2D2D".to_string()),
                        ..Default::default()
                    },
                }];
                append_paragraph(doc, segments, template, ctx);
            }
        }
        NodeValue::ThematicBreak => {
            append_paragraph(
                doc,
                vec![RunSegment {
                    text: "────────────────".to_string(),
                    style: TextStyle {
                        font: Some(template.default_font.clone()),
                        size: Some(template.body_size),
                        color: Some("CCCCCC".to_string()),
                        ..Default::default()
                    },
                }],
                template,
                ctx,
            );
        }
        NodeValue::List(list) => {
            render_list(node, doc, template, ctx, list.list_type, list.start);
        }
        NodeValue::Table(table) => {
            render_table(node, table, doc, template);
        }
        NodeValue::Document
        | NodeValue::Item(_)
        | NodeValue::TaskItem(_)
        | NodeValue::TableRow(_)
        | NodeValue::TableCell => {
            for child in node.children() {
                render_block(child, doc, template, ctx);
            }
        }
        NodeValue::HtmlBlock(_) | NodeValue::HtmlInline(_) => {}
        _ => {
            for child in node.children() {
                render_block(child, doc, template, ctx);
            }
        }
    }
}

fn detect_callout<'a>(
    node: &'a AstNode<'a>,
    template: &TemplateStyle,
) -> Option<(CalloutKind, Option<String>)> {
    let mut children = node.children();
    let first = children.next()?;
    if !matches!(first.data.borrow().value, NodeValue::Paragraph) {
        return None;
    }

    let segments = collect_inline_segments_for_node(first, template.body().run.clone(), template);
    let text = segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    parse_callout_marker(&text)
}

fn parse_callout_marker(text: &str) -> Option<(CalloutKind, Option<String>)> {
    let trimmed = text.trim_start();
    let rest = trimmed.strip_prefix("[!")?;
    let end = rest.find(']')?;
    let kind_token = &rest[..end];
    let kind = normalize_callout_kind(kind_token)?;
    let after = rest[end + 1..].trim();
    let title = after
        .strip_prefix(':')
        .map(str::trim_start)
        .unwrap_or(after)
        .trim();
    let title = if title.is_empty() {
        None
    } else {
        Some(title.to_string())
    };
    Some((kind, title))
}

fn normalize_callout_kind(input: &str) -> Option<CalloutKind> {
    let token = input
        .trim()
        .to_uppercase()
        .replace(|ch: char| !ch.is_ascii_alphanumeric(), "");

    match token.as_str() {
        "NOTE" => Some(CalloutKind::Note),
        "ABSTRACT" | "SUMMARY" | "TLDR" => Some(CalloutKind::Abstract),
        "INFO" | "TODO" => Some(CalloutKind::Info),
        "TIP" | "HINT" | "IMPORTANT" => Some(CalloutKind::Tip),
        "SUCCESS" | "CHECK" | "DONE" => Some(CalloutKind::Success),
        "QUESTION" | "HELP" | "FAQ" => Some(CalloutKind::Question),
        "WARNING" | "CAUTION" | "ATTENTION" => Some(CalloutKind::Warning),
        "FAILURE" | "FAIL" | "MISSING" => Some(CalloutKind::Failure),
        "DANGER" | "ERROR" => Some(CalloutKind::Danger),
        "BUG" => Some(CalloutKind::Bug),
        "EXAMPLE" => Some(CalloutKind::Example),
        "QUOTE" | "CITE" => Some(CalloutKind::Quote),
        _ => None,
    }
}

fn render_callout_block<'a>(
    node: &'a AstNode<'a>,
    doc: &mut Document,
    template: &TemplateStyle,
    ctx: RenderContext,
    callout: (CalloutKind, Option<String>),
) {
    let (kind, title) = callout;
    let mut children = node.children();
    let _ = children.next();

    let mut header_segments = vec![RunSegment {
        text: kind.label().to_string(),
        style: TextStyle {
            bold: true,
            color: Some(CALLOUT_HEADER_TEXT.to_string()),
            ..template.body().run.clone()
        },
    }];
    if let Some(title) = title {
        header_segments.push(RunSegment {
            text: " — ".to_string(),
            style: TextStyle {
                color: Some(CALLOUT_HEADER_TEXT.to_string()),
                ..template.body().run.clone()
            },
        });
        header_segments.push(RunSegment {
            text: title,
            style: TextStyle {
                color: Some(CALLOUT_HEADER_TEXT.to_string()),
                ..template.body().run.clone()
            },
        });
    }
    let mut header_paragraph = doc.add_paragraph("");
    header_paragraph = style_paragraph(
        header_paragraph,
        ParagraphKind::CalloutHeader { kind },
        template,
    );
    append_segments_to_paragraph(
        &mut header_paragraph,
        header_segments,
        template,
        false,
        true,
    );

    let body_ctx = RenderContext {
        quote_depth: ctx.quote_depth,
        list_depth: ctx.list_depth,
        callout: Some(kind),
    };

    for child in children {
        render_block(child, doc, template, body_ctx);
    }
}

fn render_list<'a>(
    node: &'a AstNode<'a>,
    doc: &mut Document,
    template: &TemplateStyle,
    ctx: RenderContext,
    list_type: ListType,
    start: usize,
) {
    let mut ordinal = start;
    for item in node.children() {
        let item_value = item.data.borrow().value.clone();
        let (is_task_item, task_prefix) = match item_value {
            NodeValue::Item(_) => (false, None),
            NodeValue::TaskItem(task_item) => (true, Some(task_item_prefix(task_item.symbol))),
            _ => continue,
        };

        if is_task_item {
            // Task list items use the same list semantics as regular items, with a visible checkbox.
        }

        let item_ctx = RenderContext {
            quote_depth: ctx.quote_depth,
            list_depth: ctx.list_depth + 1,
            callout: ctx.callout,
        };
        let item_prefix = template.list_prefix(list_type, item_ctx.list_depth, ordinal);
        let base_style = if ctx.callout.is_some() {
            let mut style = template.body().run.clone();
            style.color = Some(CALLOUT_BODY_TEXT.to_string());
            style
        } else if ctx.quote_depth > 0 {
            template.quote().run.clone()
        } else {
            template.list().run.clone()
        };
        let item_prefix = if let Some(task_prefix) = task_prefix {
            format!("{item_prefix}{task_prefix}")
        } else {
            item_prefix
        };
        let mut rendered_primary_paragraph = false;

        for child in item.children() {
            match &child.data.borrow().value {
                NodeValue::Paragraph => {
                    let mut segments =
                        build_inline_segments(child, base_style.clone(), template, item_ctx);
                    if !rendered_primary_paragraph {
                        if let Some(first) = segments.first_mut() {
                            first.text = format!("{item_prefix}{}", first.text);
                        } else {
                            segments.push(RunSegment {
                                text: item_prefix.clone(),
                                style: base_style.clone(),
                            });
                        }
                        append_list_paragraph(doc, segments, template);
                        rendered_primary_paragraph = true;
                    } else {
                        append_list_paragraph(doc, segments, template);
                    }
                }
                NodeValue::Item(_) | NodeValue::TaskItem(_) | NodeValue::List(_) => {
                    render_block(child, doc, template, item_ctx);
                }
                _ => {
                    render_block(child, doc, template, item_ctx);
                }
            }
        }

        if !rendered_primary_paragraph {
            append_list_paragraph(
                doc,
                vec![RunSegment {
                    text: item_prefix,
                    style: base_style,
                }],
                template,
            );
        }

        if matches!(list_type, ListType::Ordered) {
            ordinal += 1;
        }
    }
}

fn task_item_prefix(symbol: Option<char>) -> &'static str {
    if symbol.is_some() {
        "[x] "
    } else {
        "[ ] "
    }
}

fn render_table<'a>(
    node: &'a AstNode<'a>,
    table_meta: &NodeTable,
    doc: &mut Document,
    template: &TemplateStyle,
) {
    let mut rows = Vec::new();
    for row in node.children() {
        let is_header = matches!(row.data.borrow().value, NodeValue::TableRow(true));
        if !matches!(row.data.borrow().value, NodeValue::TableRow(_)) {
            continue;
        }

        let mut cells = Vec::new();
        for cell in row.children() {
            if !matches!(cell.data.borrow().value, NodeValue::TableCell) {
                continue;
            }
            cells.push(collect_inline_segments_for_node(
                cell,
                template.body().run.clone(),
                template,
            ));
        }
        rows.push(TableRowData {
            is_header,
            cells,
            alignments: table_meta.alignments.clone(),
        });
    }

    if rows.is_empty() {
        return;
    }

    render_compact_table(doc, rows, template);
}

fn render_key_value_table(doc: &mut Document, rows: &[TableRowData], template: &TemplateStyle) {
    if rows.is_empty() {
        return;
    }

    let mut data_rows = Vec::with_capacity(rows.len() + 1);
    data_rows.push(TableRowData {
        is_header: true,
        cells: vec![
            vec![RunSegment {
                text: "Key".to_string(),
                style: TextStyle {
                    bold: true,
                    ..template.body().run.clone()
                },
            }],
            vec![RunSegment {
                text: "Value".to_string(),
                style: TextStyle {
                    bold: true,
                    ..template.body().run.clone()
                },
            }],
        ],
        alignments: vec![TableAlignment::Left, TableAlignment::Left],
    });
    data_rows.extend(rows.iter().cloned());
    render_compact_table(doc, data_rows, template);
}

fn is_mermaid_code_block(info: &str) -> bool {
    info.split_whitespace()
        .next()
        .map(|token| token.eq_ignore_ascii_case("mermaid"))
        .unwrap_or(false)
}

fn render_mermaid_block(code: &str, doc: &mut Document) -> bool {
    let sanitized_code = sanitize_mermaid_emojis(code);
    let Ok(svg) = render_with_options(&sanitized_code, RenderOptions::mermaid_default()) else {
        return false;
    };

    let theme = Theme::mermaid_default();
    let render_cfg = RenderConfig {
        background: theme.background.clone(),
        ..RenderConfig::default()
    };
    let png_path = std::env::temp_dir().join(format!(
        "tomosona-mermaid-{}-{}.png",
        std::process::id(),
        unique_temp_stamp()
    ));

    if write_output_png(&svg, &png_path, &render_cfg, &theme).is_err() {
        return false;
    }

    let Ok(png) = fs::read(&png_path) else {
        #[cfg(test)]
        eprintln!("mermaid png read failed: {}", png_path.display());
        let _ = fs::remove_file(&png_path);
        return false;
    };
    let _ = fs::remove_file(&png_path);

    let Some((width_px, height_px)) = png_dimensions(&png) else {
        return false;
    };

    let (width, height) = png_display_size(width_px as f64, height_px as f64).unwrap_or((
        Length::inches(MERMAID_MAX_WIDTH_IN),
        Length::inches(MERMAID_FALLBACK_HEIGHT_IN),
    ));
    let mut paragraph = doc
        .add_picture(&png, "mermaid.png", width, height)
        .alignment(Alignment::Center)
        .space_before(Length::pt(2.0))
        .space_after(Length::pt(4.0));
    paragraph = paragraph.keep_together(true);
    let _ = paragraph;
    true
}

fn sanitize_mermaid_emojis(input: &str) -> String {
    let mut output = input.to_string();
    for (emoji, replacement) in MERMAID_EMOJI_REPLACEMENTS {
        output = output.replace(emoji, replacement);
    }
    output
}

fn unique_temp_stamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 24 || &bytes[..8] != PNG_SIGNATURE {
        return None;
    }

    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    Some((width, height))
}

fn png_display_size(width_px: f64, height_px: f64) -> Option<(Length, Length)> {
    if width_px <= 0.0 || height_px <= 0.0 {
        return None;
    }

    let width_in = width_px / 96.0;
    let height_in = height_px / 96.0;
    if width_in <= MERMAID_MAX_WIDTH_IN {
        return Some((Length::inches(width_in), Length::inches(height_in)));
    }

    let scale = MERMAID_MAX_WIDTH_IN / width_in;
    let scaled_height = (height_in * scale).max(1.0 / 96.0);
    Some((
        Length::inches(MERMAID_MAX_WIDTH_IN),
        Length::inches(scaled_height),
    ))
}

fn build_frontmatter_rows(markdown: &str, template: &TemplateStyle) -> Vec<TableRowData> {
    let properties = parse_yaml_frontmatter_properties(markdown);
    if properties.is_empty() {
        return Vec::new();
    }

    let mut rows: Vec<TableRowData> = Vec::new();

    for property in properties {
        let key = property.key;
        let value = property.value_text.unwrap_or_default();
        if let Some(existing) = rows.iter_mut().find(|row| {
            row.cells
                .first()
                .map(|cell| table_cell_text(cell).eq_ignore_ascii_case(&key))
                .unwrap_or(false)
        }) {
            if let Some(value_cell) = existing.cells.get_mut(1) {
                if !value.is_empty() {
                    if !value_cell.is_empty() {
                        value_cell.push(RunSegment {
                            text: ", ".to_string(),
                            style: template.body().run.clone(),
                        });
                    }
                    value_cell.push(RunSegment {
                        text: value,
                        style: TextStyle {
                            ..template.body().run.clone()
                        },
                    });
                }
            }
            continue;
        }

        rows.push(TableRowData {
            is_header: false,
            cells: vec![
                vec![RunSegment {
                    text: key,
                    style: TextStyle {
                        bold: true,
                        ..template.body().run.clone()
                    },
                }],
                vec![RunSegment {
                    text: value,
                    style: TextStyle {
                        ..template.body().run.clone()
                    },
                }],
            ],
            alignments: vec![TableAlignment::Left, TableAlignment::Left],
        });
    }

    rows
}

fn render_compact_table(doc: &mut Document, rows: Vec<TableRowData>, template: &TemplateStyle) {
    if rows.is_empty() {
        return;
    }

    let column_count = rows
        .iter()
        .map(|row| row.cells.len())
        .max()
        .unwrap_or(1)
        .max(1);
    let row_count = rows.len();
    let key_value_table = is_key_value_table(&rows);
    let column_widths = if key_value_table {
        key_value_column_widths(&rows)
    } else {
        compute_table_column_widths(&rows, column_count)
    };
    let mut table = doc
        .add_table(row_count, column_count)
        .width(Length::inches(TABLE_WIDTH_IN))
        .layout_fixed()
        .borders(BorderStyle::Single, TABLE_BORDER_SIZE, TABLE_BORDER_COLOR)
        .cell_margins(
            Length::pt(TABLE_CELL_MARGIN_Y_PT),
            Length::pt(TABLE_CELL_MARGIN_X_PT),
            Length::pt(TABLE_CELL_MARGIN_Y_PT),
            Length::pt(TABLE_CELL_MARGIN_X_PT),
        );

    for (row_idx, row) in rows.into_iter().enumerate() {
        if row.is_header {
            if let Some(r) = table.row(row_idx) {
                let _ = r.header().cant_split();
            }
        }

        for col_idx in 0..column_count {
            let alignment = row
                .alignments
                .get(col_idx)
                .copied()
                .unwrap_or(TableAlignment::None);
            let cell_segments = row.cells.get(col_idx).cloned().unwrap_or_default();

            if let Some(mut cell) = table.cell(row_idx, col_idx) {
                cell = cell.vertical_alignment(VerticalAlignment::Top);
                if let Some(width) = column_widths.get(col_idx) {
                    cell = cell.width(*width);
                }
                if row.is_header {
                    cell = cell.shading(TABLE_HEADER_FILL);
                }

                let mut paragraph = cell
                    .add_paragraph("")
                    .space_before(Length::pt(0.0))
                    .space_after(Length::pt(0.0))
                    .line_spacing_multiple(0.9)
                    .keep_together(true);
                if let Some(paragraph_alignment) = table_alignment_to_paragraph_alignment(alignment)
                {
                    paragraph = paragraph.alignment(paragraph_alignment);
                }
                append_segments_to_paragraph(
                    &mut paragraph,
                    cell_segments,
                    template,
                    row.is_header,
                    true,
                );
            }
        }
    }
}

fn is_key_value_table(rows: &[TableRowData]) -> bool {
    let Some(first_row) = rows.first() else {
        return false;
    };
    if !first_row.is_header || first_row.cells.len() != 2 {
        return false;
    }

    let key = table_cell_text(first_row.cells.first().map(Vec::as_slice).unwrap_or(&[]));
    let value = table_cell_text(first_row.cells.get(1).map(Vec::as_slice).unwrap_or(&[]));
    key.eq_ignore_ascii_case("key") && value.eq_ignore_ascii_case("value")
}

fn key_value_column_widths(rows: &[TableRowData]) -> Vec<Length> {
    let key_score = rows
        .iter()
        .skip(1)
        .filter_map(|row| row.cells.first())
        .map(|cell| estimate_table_cell_score(cell, false))
        .fold(1.5, f64::max)
        .clamp(1.35, 1.9);
    let key_width = key_score.max(1.35);
    let value_width = (TABLE_WIDTH_IN - key_width).max(4.0);
    vec![Length::inches(key_width), Length::inches(value_width)]
}

fn compute_table_column_widths(rows: &[TableRowData], column_count: usize) -> Vec<Length> {
    if column_count == 0 {
        return Vec::new();
    }

    let mut scores = vec![1.0; column_count];
    for row in rows {
        for (col_idx, cell) in row.cells.iter().enumerate() {
            let score = estimate_table_cell_score(cell, row.is_header);
            if let Some(existing) = scores.get_mut(col_idx) {
                if score > *existing {
                    *existing = score;
                }
            }
        }
    }

    let widths = distribute_table_widths(
        scores,
        TABLE_WIDTH_IN,
        TABLE_MIN_COLUMN_WIDTH_IN,
        TABLE_WIDTH_IN * TABLE_MAX_COLUMN_SHARE,
    );
    widths.into_iter().map(Length::inches).collect()
}

fn distribute_table_widths(
    scores: Vec<f64>,
    total_width: f64,
    min_width: f64,
    max_width: f64,
) -> Vec<f64> {
    let count = scores.len();
    if count == 0 {
        return Vec::new();
    }

    let mut widths = vec![min_width; count];
    let mut remaining_extra = (total_width - (min_width * count as f64)).max(0.0);
    let mut active = vec![true; count];

    loop {
        let active_score_sum: f64 = scores
            .iter()
            .enumerate()
            .filter_map(|(index, score)| {
                active
                    .get(index)
                    .copied()
                    .unwrap_or(false)
                    .then_some(*score)
            })
            .sum();

        if active_score_sum <= 0.0 || remaining_extra <= 0.0 {
            break;
        }

        let mut overflow = 0.0;
        let mut changed = false;

        for index in 0..count {
            if !active[index] {
                continue;
            }

            let share = remaining_extra * scores[index] / active_score_sum;
            let proposed = widths[index] + share;
            if proposed > max_width {
                overflow += proposed - max_width;
                widths[index] = max_width;
                active[index] = false;
                changed = true;
            } else {
                widths[index] = proposed;
            }
        }

        if !changed {
            break;
        }
        remaining_extra = overflow;
    }

    if remaining_extra > 0.0 {
        let active_indices = active
            .iter()
            .enumerate()
            .filter_map(|(index, active)| active.then_some(index))
            .collect::<Vec<_>>();
        if active_indices.is_empty() {
            if let Some(last) = widths.last_mut() {
                *last += remaining_extra;
            }
        } else {
            let share = remaining_extra / active_indices.len() as f64;
            for index in active_indices {
                widths[index] += share;
            }
        }
    }

    widths
}

fn estimate_table_cell_score(cell: &[RunSegment], header_row: bool) -> f64 {
    let text = table_cell_text(cell);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return if header_row { 1.5 } else { 1.0 };
    }

    let mut score = trimmed
        .lines()
        .map(|line| {
            let line = line.trim();
            let line_len = line.chars().count() as f64;
            let word_count = line.split_whitespace().count() as f64;
            let max_word = line
                .split_whitespace()
                .map(|word| word.chars().count() as f64)
                .fold(0.0, f64::max);
            (max_word * 0.16) + (word_count * 0.5) + (line_len * 0.03)
        })
        .fold(1.0, f64::max);

    if header_row {
        score *= 1.15;
    }

    score.clamp(1.0, 20.0)
}

fn table_cell_text(cell: &[RunSegment]) -> String {
    cell.iter().map(|segment| segment.text.as_str()).collect()
}

fn strip_leading_empty_table_paragraphs(docx_path: &Path) -> Result<()> {
    rewrite_docx(docx_path, |name, bytes| {
        if name == "word/document.xml" {
            let xml = String::from_utf8(bytes.to_vec()).map_err(|err| {
                AppError::InvalidOperation(format!("DOCX postprocess decode xml failed: {err}"))
            })?;
            Ok(strip_empty_first_table_paragraphs_from_xml(&xml).into_bytes())
        } else {
            Ok(bytes.to_vec())
        }
    })
}

fn replace_docx_entry(docx_path: &Path, target_name: &str, replacement: &[u8]) -> Result<()> {
    rewrite_docx(docx_path, |name, bytes| {
        if name == target_name {
            Ok(replacement.to_vec())
        } else {
            Ok(bytes.to_vec())
        }
    })
}

fn rewrite_docx<F>(docx_path: &Path, mut transform: F) -> Result<()>
where
    F: FnMut(&str, &[u8]) -> Result<Vec<u8>>,
{
    let file = File::open(docx_path)?;
    let mut archive = ZipArchive::new(file).map_err(|err| {
        AppError::InvalidOperation(format!("DOCX postprocess open failed: {err}"))
    })?;
    let temp_path = docx_path.with_extension("docx.tmp");
    let temp_file = File::create(&temp_path)?;
    let mut writer = ZipWriter::new(temp_file);

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|err| {
            AppError::InvalidOperation(format!("DOCX postprocess read entry failed: {err}"))
        })?;
        let options = SimpleFileOptions::default().compression_method(entry.compression());
        let name = entry.name().to_string();
        if entry.is_dir() {
            writer.add_directory(&name, options).map_err(|err| {
                AppError::InvalidOperation(format!(
                    "DOCX postprocess write directory failed: {err}"
                ))
            })?;
            continue;
        }

        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|err| {
            AppError::InvalidOperation(format!("DOCX postprocess read bytes failed: {err}"))
        })?;
        bytes = transform(&name, &bytes)?;

        writer.start_file(&name, options).map_err(|err| {
            AppError::InvalidOperation(format!("DOCX postprocess write file failed: {err}"))
        })?;
        writer.write_all(&bytes).map_err(|err| {
            AppError::InvalidOperation(format!("DOCX postprocess write bytes failed: {err}"))
        })?;
    }

    writer.finish().map_err(|err| {
        AppError::InvalidOperation(format!("DOCX postprocess finish failed: {err}"))
    })?;
    fs::rename(&temp_path, docx_path)?;
    Ok(())
}

fn strip_empty_first_table_paragraphs_from_xml(xml: &str) -> String {
    let mut output = String::with_capacity(xml.len());
    let mut remainder = xml;

    while let Some(cell_start) = remainder.find("<w:tc>") {
        output.push_str(&remainder[..cell_start]);
        remainder = &remainder[cell_start..];

        let Some(cell_end) = remainder.find("</w:tc>") else {
            output.push_str(remainder);
            return output;
        };

        let cell_xml = &remainder[..cell_end + "</w:tc>".len()];
        output.push_str(&strip_empty_first_table_paragraph_from_cell(cell_xml));
        remainder = &remainder[cell_end + "</w:tc>".len()..];
    }

    output.push_str(remainder);
    output
}

fn strip_empty_first_table_paragraph_from_cell(cell_xml: &str) -> String {
    let Some(first_para_start) = cell_xml.find("<w:p>") else {
        return cell_xml.to_string();
    };
    let Some(first_para_end) = cell_xml[first_para_start..].find("</w:p>") else {
        return cell_xml.to_string();
    };

    let first_para_end = first_para_start + first_para_end + "</w:p>".len();
    let first_para = &cell_xml[first_para_start..first_para_end];
    if paragraph_contains_text(first_para) {
        return cell_xml.to_string();
    }

    if !cell_xml[first_para_end..].contains("<w:p>") {
        return cell_xml.to_string();
    }

    let mut output = String::with_capacity(cell_xml.len());
    output.push_str(&cell_xml[..first_para_start]);
    output.push_str(&cell_xml[first_para_end..]);
    output
}

fn paragraph_contains_text(paragraph_xml: &str) -> bool {
    let mut remainder = paragraph_xml;
    while let Some(text_start) = remainder.find("<w:t") {
        remainder = &remainder[text_start..];
        let Some(tag_end) = remainder.find('>') else {
            break;
        };
        let content_start = tag_end + 1;
        let Some(text_end) = remainder[content_start..].find("</w:t>") else {
            break;
        };
        let text = &remainder[content_start..content_start + text_end];
        if !text.trim().is_empty() {
            return true;
        }
        remainder = &remainder[content_start + text_end + "</w:t>".len()..];
    }
    false
}

fn build_inline_segments<'a>(
    node: &'a AstNode<'a>,
    style: TextStyle,
    template: &TemplateStyle,
    _ctx: RenderContext,
) -> Vec<RunSegment> {
    let mut segments = Vec::new();
    collect_inline_segments(node, &style, &mut segments, template);
    segments
}

fn collect_inline_segments<'a>(
    node: &'a AstNode<'a>,
    base_style: &TextStyle,
    segments: &mut Vec<RunSegment>,
    template: &TemplateStyle,
) {
    for child in node.children() {
        match &child.data.borrow().value {
            NodeValue::Text(text) => {
                push_segment(segments, text.as_ref(), base_style.clone());
            }
            NodeValue::Code(code) => {
                let mut style = base_style.clone();
                style.code = true;
                style.font = Some(CODE_FONT.to_string());
                style.size = Some(CODE_SIZE);
                push_segment(segments, &code.literal, style);
            }
            NodeValue::Strong => {
                let mut style = base_style.clone();
                style.bold = true;
                collect_inline_segments(child, &style, segments, template);
            }
            NodeValue::Emph => {
                let mut style = base_style.clone();
                style.italic = true;
                collect_inline_segments(child, &style, segments, template);
            }
            NodeValue::Strikethrough => {
                collect_inline_segments(child, base_style, segments, template);
            }
            NodeValue::Link(_) | NodeValue::WikiLink(_) | NodeValue::Image(_) => {
                collect_inline_segments(child, base_style, segments, template);
            }
            NodeValue::SoftBreak => {
                push_segment(segments, " ", base_style.clone());
            }
            NodeValue::LineBreak => {
                push_segment(segments, " ", base_style.clone());
            }
            NodeValue::Raw(raw) => {
                push_segment(segments, raw, base_style.clone());
            }
            NodeValue::HtmlInline(html) => {
                push_segment(segments, html, base_style.clone());
            }
            NodeValue::TaskItem(_) => {}
            _ => {
                if child.data.borrow().value.contains_inlines() {
                    collect_inline_segments(child, base_style, segments, template);
                }
            }
        }
    }

    if segments.is_empty() {
        segments.push(RunSegment {
            text: String::new(),
            style: base_style.clone(),
        });
    }
}

fn collect_inline_segments_for_node<'a>(
    node: &'a AstNode<'a>,
    base_style: TextStyle,
    template: &TemplateStyle,
) -> Vec<RunSegment> {
    let mut segments = Vec::new();
    collect_inline_segments(node, &base_style, &mut segments, template);
    segments
}

fn push_segment(segments: &mut Vec<RunSegment>, text: &str, style: TextStyle) {
    if text.is_empty() {
        return;
    }

    if let Some(last) = segments.last_mut() {
        if last.style == style {
            last.text.push_str(text);
            return;
        }
    }

    segments.push(RunSegment {
        text: text.to_string(),
        style,
    });
}

fn append_paragraph(
    doc: &mut Document,
    segments: Vec<RunSegment>,
    template: &TemplateStyle,
    ctx: RenderContext,
) {
    let mut paragraph = doc.add_paragraph("");
    paragraph = style_paragraph(
        paragraph,
        ParagraphKind::Body {
            quote_depth: ctx.quote_depth,
            callout: ctx.callout,
        },
        template,
    );
    append_segments_to_paragraph(&mut paragraph, segments, template, false, true);
}

fn append_list_paragraph(doc: &mut Document, segments: Vec<RunSegment>, template: &TemplateStyle) {
    let mut paragraph = doc.add_paragraph("");
    if let Some(style_id) = template.list().style_id.as_deref() {
        paragraph = paragraph.style(style_id);
    }
    paragraph = apply_paragraph_style(paragraph, &template.list().paragraph, 1.0);
    append_segments_to_paragraph(&mut paragraph, segments, template, false, true);
}

enum ParagraphKind {
    Body {
        quote_depth: usize,
        callout: Option<CalloutKind>,
    },
    CalloutHeader {
        kind: CalloutKind,
    },
}

fn style_paragraph<'a>(
    paragraph: rdocx::Paragraph<'a>,
    kind: ParagraphKind,
    template: &TemplateStyle,
) -> rdocx::Paragraph<'a> {
    match kind {
        ParagraphKind::Body {
            quote_depth,
            callout,
        } => {
            if let Some(callout_kind) = callout {
                let palette = callout_kind.style();
                paragraph
                    .space_before(Length::pt(0.0))
                    .space_after(Length::pt(2.0))
                    .indent_left(Length::pt(0.0))
                    .indent_right(Length::pt(0.0))
                    .shading(palette.fill)
                    .border_all(BorderStyle::Single, 8, palette.border)
                    .line_spacing_multiple(1.0)
                    .keep_together(true)
            } else if quote_depth == 0 {
                let paragraph = if let Some(style_id) = template.body().style_id.as_deref() {
                    paragraph.style(style_id)
                } else {
                    paragraph
                };
                apply_paragraph_style(paragraph, &template.body().paragraph, 1.0)
            } else {
                let paragraph = if let Some(style_id) = template.quote().style_id.as_deref() {
                    paragraph.style(style_id)
                } else {
                    paragraph
                };
                apply_paragraph_style(paragraph, &template.quote().paragraph, quote_depth as f64)
            }
        }
        ParagraphKind::CalloutHeader { kind } => {
            let palette = kind.style();
            paragraph
                .space_before(Length::pt(2.0))
                .space_after(Length::pt(2.0))
                .indent_left(Length::pt(0.0))
                .indent_right(Length::pt(0.0))
                .shading(palette.fill)
                .border_all(BorderStyle::Single, 8, palette.border)
                .line_spacing_multiple(1.0)
                .keep_together(true)
        }
    }
}

fn apply_paragraph_style<'a>(
    mut paragraph: rdocx::Paragraph<'a>,
    style: &ParagraphStyle,
    indent_multiplier: f64,
) -> rdocx::Paragraph<'a> {
    if let Some(space_before) = style.space_before {
        paragraph = paragraph.space_before(Length::pt(space_before));
    }
    if let Some(space_after) = style.space_after {
        paragraph = paragraph.space_after(Length::pt(space_after));
    }
    if let Some(indent_left) = style.indent_left {
        paragraph = paragraph.indent_left(Length::pt(indent_left * indent_multiplier.max(1.0)));
    }
    if let Some(indent_right) = style.indent_right {
        paragraph = paragraph.indent_right(Length::pt(indent_right));
    }
    if let Some(line_spacing_multiple) = style.line_spacing_multiple {
        paragraph = paragraph.line_spacing_multiple(line_spacing_multiple);
    }
    if let Some(shading_fill) = style.shading_fill.as_deref() {
        paragraph = paragraph.shading(shading_fill);
    }
    if let Some(border_bottom) = &style.border_bottom {
        paragraph = paragraph.border_bottom(
            border_bottom.style,
            border_bottom.size_eighths_pt,
            &border_bottom.color,
        );
    }
    if style.keep_together {
        paragraph = paragraph.keep_together(true);
    }
    paragraph
}

fn append_segments_to_paragraph<'a>(
    paragraph: &mut rdocx::Paragraph<'a>,
    segments: Vec<RunSegment>,
    template: &TemplateStyle,
    header_row: bool,
    inherit_defaults: bool,
) {
    for segment in segments {
        if segment.text.is_empty() {
            continue;
        }

        let mut style = segment.style.clone();
        if header_row {
            style.bold = true;
        }
        let run = paragraph.add_run(&segment.text);
        let _run = apply_run_style(run, &style, template, inherit_defaults);
    }
}

fn apply_run_style<'a>(
    run: rdocx::Run<'a>,
    style: &TextStyle,
    template: &TemplateStyle,
    inherit_defaults: bool,
) -> rdocx::Run<'a> {
    let mut run = run;
    if inherit_defaults || style.font.is_some() {
        let font = style
            .font
            .as_deref()
            .unwrap_or(template.default_font.as_str());
        run = run.font(font);
    }
    if inherit_defaults || style.size.is_some() {
        let size = style.size.unwrap_or(template.body_size) as f64 / 2.0;
        run = run.size(size);
    }
    if style.bold {
        run = run.bold(true);
    }
    if style.italic {
        run = run.italic(true);
    }
    if style.code {
        run = run.font(CODE_FONT).size(CODE_SIZE as f64 / 2.0);
    }
    if let Some(color) = style.color.as_deref() {
        run = run.color(color);
    }
    run
}

fn table_alignment_to_paragraph_alignment(alignment: TableAlignment) -> Option<Alignment> {
    match alignment {
        TableAlignment::None => None,
        TableAlignment::Left => Some(Alignment::Left),
        TableAlignment::Center => Some(Alignment::Center),
        TableAlignment::Right => Some(Alignment::Right),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        io::{Read, Write},
        time::{SystemTime, UNIX_EPOCH},
    };

    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    fn workspace_test_guard() -> std::sync::MutexGuard<'static, ()> {
        crate::workspace_test_guard()
    }

    fn create_temp_workspace(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("{prefix}-{nonce}"));
        fs::create_dir_all(&dir).expect("create temp workspace");
        dir
    }

    fn write_minimal_docx(path: &Path, font: &str, size: u32) {
        let file = File::create(path).expect("create docx fixture");
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

        let styles_xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="{font}" w:hAnsi="{font}" />
        <w:sz w:val="{size}" />
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal" />
    <w:rPr>
      <w:rFonts w:ascii="{font}" w:hAnsi="{font}" />
      <w:sz w:val="{size}" />
    </w:rPr>
  </w:style>
</w:styles>"#
        );
        let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Template</w:t></w:r></w:p>
  </w:body>
</w:document>"#;
        let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"#;
        let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;
        let document_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#;

        zip.start_file("[Content_Types].xml", options)
            .expect("write content types");
        zip.write_all(content_types.as_bytes())
            .expect("content types");
        zip.add_directory("_rels", options).expect("dir");
        zip.start_file("_rels/.rels", options).expect("write rels");
        zip.write_all(rels.as_bytes()).expect("rels");
        zip.add_directory("word", options).expect("dir");
        zip.start_file("word/document.xml", options)
            .expect("write doc");
        zip.write_all(document_xml.as_bytes()).expect("doc xml");
        zip.start_file("word/styles.xml", options)
            .expect("write styles");
        zip.write_all(styles_xml.as_bytes()).expect("styles xml");
        zip.add_directory("word/_rels", options).expect("dir");
        zip.start_file("word/_rels/document.xml.rels", options)
            .expect("write doc rels");
        zip.write_all(document_rels.as_bytes()).expect("doc rels");
        zip.finish().expect("finish docx");
    }

    fn write_valid_docx_with_styles(path: &Path, styles_xml: &str) {
        Document::new().save(path).expect("create base docx");

        let file = File::open(path).expect("open base docx");
        let mut archive = ZipArchive::new(file).expect("open docx zip");
        let temp_path = path.with_extension("docx.tmp");
        let temp_file = File::create(&temp_path).expect("create temp docx");
        let mut writer = ZipWriter::new(temp_file);

        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).expect("zip entry");
            let options = SimpleFileOptions::default().compression_method(entry.compression());
            let name = entry.name().to_string();
            if entry.is_dir() {
                writer.add_directory(&name, options).expect("write dir");
                continue;
            }

            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).expect("read entry");
            if name == "word/styles.xml" {
                bytes = styles_xml.as_bytes().to_vec();
            }

            writer.start_file(&name, options).expect("write entry");
            writer.write_all(&bytes).expect("write bytes");
        }

        writer.finish().expect("finish docx");
        fs::rename(&temp_path, path).expect("replace docx");
    }

    fn read_docx_paragraphs(path: &Path) -> Vec<String> {
        let doc = Document::open(path).expect("open docx");
        doc.paragraphs()
            .into_iter()
            .map(|para| para.text())
            .collect()
    }

    fn read_docx_paragraph_style_ids(path: &Path) -> Vec<Option<String>> {
        let doc = Document::open(path).expect("open docx");
        doc.paragraphs()
            .into_iter()
            .map(|para| para.style_id().map(|value| value.to_string()))
            .collect()
    }

    fn assert_paragraph_has_only_style_driven_heading_runs(
        paragraph: &rdocx::paragraph::ParagraphRef<'_>,
    ) {
        assert!(paragraph.runs().all(|run| {
            !run.is_bold()
                && !run.is_italic()
                && run.font_name().is_none()
                && run.size().is_none()
                && run.color().is_none()
        }));
    }

    fn read_docx_table(
        path: &Path,
    ) -> (
        usize,
        usize,
        Vec<Vec<String>>,
        Vec<bool>,
        Vec<Vec<Option<String>>>,
        Vec<Vec<Option<Alignment>>>,
    ) {
        let doc = Document::open(path).expect("open docx");
        let tables = doc.tables();
        assert_eq!(tables.len(), 1, "expected exactly one table");
        let table = &tables[0];

        let row_count = table.row_count();
        let column_count = table.column_count();
        let mut cells = Vec::new();
        let mut headers = Vec::new();
        let mut shadings = Vec::new();
        let mut alignments = Vec::new();

        for row_idx in 0..row_count {
            let row = table.row(row_idx).expect("row");
            headers.push(row.is_header());

            let mut row_text = Vec::new();
            let mut row_shading = Vec::new();
            let mut row_alignment = Vec::new();
            for col_idx in 0..column_count {
                let cell = table.cell(row_idx, col_idx).expect("cell");
                row_text.push(cell.text().trim().to_string());
                row_shading.push(cell.shading_fill().map(|value| value.to_string()));
                row_alignment.push(
                    cell.paragraphs()
                        .find(|p| !p.text().is_empty() || p.alignment().is_some())
                        .and_then(|p| p.alignment()),
                );
            }
            cells.push(row_text);
            shadings.push(row_shading);
            alignments.push(row_alignment);
        }

        (
            row_count,
            column_count,
            cells,
            headers,
            shadings,
            alignments,
        )
    }

    fn read_docx_media_names(path: &Path) -> Vec<String> {
        let file = File::open(path).expect("open docx file");
        let mut archive = ZipArchive::new(file).expect("open docx zip");
        let mut names = Vec::new();
        for index in 0..archive.len() {
            let entry = archive.by_index(index).expect("zip entry");
            let name = entry.name().to_string();
            if name.starts_with("word/media/") {
                names.push(name);
            }
        }
        names
    }

    fn read_docx_document_xml(path: &Path) -> String {
        read_docx_entry_text(path, "word/document.xml")
    }

    fn read_docx_entry_text(path: &Path, entry_name: &str) -> String {
        let file = File::open(path).expect("open docx file");
        let mut archive = ZipArchive::new(file).expect("open docx zip");
        let mut xml = String::new();
        archive
            .by_name(entry_name)
            .expect("docx entry")
            .read_to_string(&mut xml)
            .expect("read docx entry");
        xml
    }

    fn extract_row_widths(row_xml: &str) -> Vec<Option<i32>> {
        let mut widths = Vec::new();
        let mut remainder = row_xml;
        let needle = r#"w:tcW w:w=""#;

        while let Some(pos) = remainder.find(needle) {
            remainder = &remainder[pos + needle.len()..];
            let Some(end) = remainder.find('"') else {
                break;
            };
            widths.push(remainder[..end].parse::<i32>().ok());
            remainder = &remainder[end + 1..];
        }

        widths
    }

    fn read_docx_table_cell_widths(path: &Path) -> Vec<Vec<Option<i32>>> {
        let xml = read_docx_document_xml(path);
        let mut rows = Vec::new();
        let mut remainder = xml.as_str();

        while let Some(row_start) = remainder.find("<w:tr") {
            remainder = &remainder[row_start..];
            let Some(row_end) = remainder.find("</w:tr>") else {
                break;
            };
            rows.push(extract_row_widths(&remainder[..row_end]));
            remainder = &remainder[row_end + "</w:tr>".len()..];
        }

        rows
    }

    #[test]
    fn resolve_template_path_picks_first_docx() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-template");
        let templates = workspace.join("_templates");
        fs::create_dir_all(&templates).expect("create templates");
        write_minimal_docx(&templates.join("b.docx"), "Courier New", 24);
        write_minimal_docx(&templates.join("a.docx"), "Aptos", 28);
        fs::write(templates.join("ignore.txt"), "x").expect("write ignore");

        let template = resolve_template_path(&workspace).expect("resolve template");
        assert_eq!(
            template
                .as_ref()
                .and_then(|path| path.file_name())
                .and_then(|name| name.to_str()),
            Some("a.docx")
        );
    }

    #[test]
    fn resolve_template_path_returns_none_without_templates_dir() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-no-template-dir");

        let template = resolve_template_path(&workspace).expect("resolve template");
        assert!(template.is_none());
    }

    #[test]
    fn next_available_output_path_adds_suffix_on_collision() {
        let workspace = create_temp_workspace("tomosona-docx-output");
        let source = workspace.join("note.md");
        fs::write(&source, "# Note").expect("write note");
        let output = resolve_output_path(&source).expect("output");
        fs::write(&output, "occupied").expect("occupy output");
        let next = next_available_output_path(&output);
        assert!(next.ends_with("note (1).docx"));
    }

    #[test]
    fn convert_markdown_to_docx_writes_docx_and_uses_template() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-convert");
        let templates = workspace.join("_templates");
        fs::create_dir_all(&templates).expect("create templates");
        write_valid_docx_with_styles(
            &templates.join("template.docx"),
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" />
        <w:sz w:val="30" />
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal" />
    <w:rPr>
      <w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" />
      <w:sz w:val="30" />
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Titre1">
    <w:name w:val="heading 1" />
    <w:basedOn w:val="Normal" />
    <w:next w:val="Normal" />
    <w:pPr>
      <w:spacing w:before="240" w:after="0" />
    </w:pPr>
    <w:rPr>
      <w:b />
      <w:sz w:val="32" />
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Paragraphedeliste">
    <w:name w:val="List Paragraph" />
    <w:basedOn w:val="Normal" />
    <w:pPr>
      <w:ind w:left="720" />
    </w:pPr>
  </w:style>
</w:styles>"#,
        );

        let source = workspace.join("note.md");
        fs::write(
            &source,
            "# Title\n\nParagraph with **bold**, *italic*, and `code`.\n\n> Quote\n\n- One\n- Two\n\n1. First\n2. Second\n\n| A | B |\n|---|---|\n| 1 | 2 |\n",
        )
        .expect("write note");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        assert!(output.ends_with("note.docx"));
        let paragraphs = read_docx_paragraphs(Path::new(&output));
        let joined = paragraphs.join("\n");
        assert!(joined.contains("Title"));
        assert!(joined.contains("Paragraph with"));
        assert!(joined.contains("bold"));
        assert!(joined.contains("italic"));
        assert!(joined.contains("code"));
        assert!(joined.contains("Quote"));
        assert!(joined.contains("• One") || joined.contains("•  One"));
        assert!(joined.contains("1. First"));
        assert!(!joined.contains("| A | B |"));

        let (row_count, column_count, cells, headers, shadings, alignments) =
            read_docx_table(Path::new(&output));
        assert_eq!(row_count, 2);
        assert_eq!(column_count, 2);
        assert_eq!(
            cells,
            vec![
                vec!["A".to_string(), "B".to_string()],
                vec!["1".to_string(), "2".to_string()],
            ]
        );
        assert_eq!(headers, vec![true, false]);
        assert_eq!(shadings[0][0].as_deref(), Some(TABLE_HEADER_FILL));
        assert_eq!(shadings[0][1].as_deref(), Some(TABLE_HEADER_FILL));
        assert_eq!(alignments[0][0], None);

        let doc = Document::open(&output).expect("open docx");
        let table = doc.tables().into_iter().next().expect("table");
        let first_body_cell = table.cell(1, 0).expect("first body cell");
        let first_paragraph = first_body_cell
            .paragraphs()
            .next()
            .expect("first paragraph in cell");
        assert_eq!(first_paragraph.text().trim(), "1");

        let styles_xml = read_docx_entry_text(Path::new(&output), "word/styles.xml");
        assert!(styles_xml.contains(r#"w:styleId="Titre1""#));
        assert!(styles_xml.contains(r#"w:styleId="Paragraphedeliste""#));
        assert!(!styles_xml.contains(r#"w:styleId="Heading1""#));

        let style_ids = read_docx_paragraph_style_ids(Path::new(&output));
        assert!(style_ids
            .iter()
            .any(|style_id| style_id.as_deref() == Some("Titre1")));
        assert!(style_ids
            .iter()
            .any(|style_id| style_id.as_deref() == Some("Paragraphedeliste")));
    }

    #[test]
    fn convert_markdown_to_docx_preserves_empty_and_ragged_table_cells() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-ragged");
        fs::create_dir_all(workspace.join("_templates")).expect("templates");
        let source = workspace.join("ragged.md");
        fs::write(
            &source,
            "| H1 | H2 | H3 |\n| --- | :---: | ---: |\n| A | | C |\n| B | C |\n",
        )
        .expect("write ragged");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        let (row_count, column_count, cells, headers, shadings, alignments) =
            read_docx_table(Path::new(&output));
        assert_eq!(row_count, 3);
        assert_eq!(column_count, 3);
        assert_eq!(headers, vec![true, false, false]);
        assert_eq!(
            cells,
            vec![
                vec!["H1".to_string(), "H2".to_string(), "H3".to_string()],
                vec!["A".to_string(), String::new(), "C".to_string()],
                vec!["B".to_string(), "C".to_string(), String::new()],
            ]
        );
        assert_eq!(shadings[0][0].as_deref(), Some(TABLE_HEADER_FILL));
        assert_eq!(alignments[0][0], None);
        assert_eq!(alignments[0][1], Some(Alignment::Center));
        assert_eq!(alignments[0][2], Some(Alignment::Right));
        assert_eq!(alignments[1][1], Some(Alignment::Center));
    }

    #[test]
    fn convert_markdown_to_docx_keeps_inline_formatting_in_table_cells() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-inline-table");
        fs::create_dir_all(workspace.join("_templates")).expect("templates");
        let source = workspace.join("inline.md");
        fs::write(
            &source,
            "| Label | Value |\n| --- | --- |\n| Plain | **Bold** and `code` |\n",
        )
        .expect("write inline table");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        let doc = Document::open(&output).expect("open docx");
        let table = doc.tables().into_iter().next().expect("table");
        let cell = table.cell(1, 1).expect("body cell");
        let paragraph = cell
            .paragraphs()
            .find(|p| !p.text().is_empty())
            .expect("content paragraph");
        assert_eq!(paragraph.text(), "Bold and code");
        assert!(paragraph
            .runs()
            .any(|run| run.text() == "Bold" && run.is_bold()));
        assert!(paragraph
            .runs()
            .any(|run| run.text() == "code" && run.font_name() == Some(CODE_FONT)));
    }

    #[test]
    fn convert_markdown_to_docx_uses_compact_column_widths_for_tables() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-table-widths");
        fs::create_dir_all(workspace.join("_templates")).expect("templates");
        let source = workspace.join("widths.md");
        fs::write(
            &source,
            "| Nom | Type | Valeur par défaut | Description |\n| --- | --- | --- | --- |\n| font_size | u32 | 12 | Taille de la police en points |\n| bold | bool | false | Mise en gras |\n",
        )
        .expect("write table");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        let widths = read_docx_table_cell_widths(Path::new(&output));
        assert!(!widths.is_empty());
        let first_row = &widths[0];
        assert_eq!(first_row.len(), 4);
        assert!(first_row.iter().all(|width| width.is_some()));
        let widths: Vec<i32> = first_row.iter().map(|width| width.unwrap()).collect();
        assert!(widths[0] < widths[2]);
        assert!(widths[0] < widths[3]);
        assert!(widths[3] >= widths[1]);
        assert!(widths.windows(2).any(|pair| pair[0] != pair[1]));
    }

    #[test]
    fn convert_markdown_to_docx_renders_quotes_with_quote_styling() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-quote");
        fs::create_dir_all(workspace.join("_templates")).expect("templates");
        let source = workspace.join("quote.md");
        fs::write(
            &source,
            "> First line\n>\n> Second line\n\nRegular paragraph.\n",
        )
        .expect("write quote");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        let paragraphs = read_docx_paragraphs(Path::new(&output));
        assert!(paragraphs.iter().any(|text| text == "First line"));
        assert!(paragraphs.iter().any(|text| text == "Second line"));
        assert!(!paragraphs.iter().any(|text| text.contains("> ")));

        let doc = Document::open(&output).expect("open docx");
        let quote_paragraph = doc
            .paragraphs()
            .into_iter()
            .find(|paragraph| paragraph.text().trim() == "First line")
            .expect("quote paragraph");
        assert_eq!(
            quote_paragraph.shading_fill(),
            Some(
                TemplateStyle::default()
                    .quote
                    .paragraph
                    .shading_fill
                    .as_deref()
                    .unwrap()
            )
        );
        assert!(quote_paragraph.runs().any(|run| run.is_italic()));
    }

    #[test]
    fn convert_markdown_to_docx_uses_builtin_heading_styles_without_template() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-no-template-headings");
        let source = workspace.join("styled.md");
        fs::write(
            &source,
            "# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n",
        )
        .expect("write source");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        let styles_xml = read_docx_entry_text(Path::new(&output), "word/styles.xml");
        for level in 1..=6 {
            assert!(styles_xml.contains(&format!(r#"w:styleId="Heading{level}""#)));
        }

        let doc = Document::open(&output).expect("open docx");
        for level in 1..=6 {
            let expected_text = match level {
                1 => "One",
                2 => "Two",
                3 => "Three",
                4 => "Four",
                5 => "Five",
                _ => "Six",
            };
            let paragraph = doc
                .paragraphs()
                .into_iter()
                .find(|paragraph| paragraph.text().trim() == expected_text)
                .expect("heading paragraph");
            let expected_style_id = format!("Heading{level}");
            assert_eq!(paragraph.style_id(), Some(expected_style_id.as_str()));
            assert_paragraph_has_only_style_driven_heading_runs(&paragraph);
        }
    }

    #[test]
    fn convert_markdown_to_docx_uses_heading_style_from_template() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-heading-style");
        let templates = workspace.join("_templates");
        fs::create_dir_all(&templates).expect("templates");
        let template_styles = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" />
        <w:sz w:val="30" />
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal" />
    <w:rPr>
      <w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" />
      <w:sz w:val="30" />
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="Heading 1" />
    <w:rPr>
      <w:rFonts w:ascii="Inter" w:hAnsi="Inter" />
      <w:b />
      <w:sz w:val="42" />
      <w:color w:val="1357AF" />
    </w:rPr>
    <w:pPr>
      <w:spacing w:before="360" w:after="120" />
    </w:pPr>
  </w:style>
</w:styles>"#;
        write_valid_docx_with_styles(&templates.join("template.docx"), template_styles);

        let source = workspace.join("styled.md");
        fs::write(&source, "# Styled heading").expect("write source");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        let doc = Document::open(&output).expect("open docx");
        let heading = doc
            .paragraphs()
            .into_iter()
            .find(|paragraph| paragraph.text().trim() == "Styled heading")
            .expect("heading paragraph");
        assert_eq!(heading.style_id(), Some("Heading1"));
        assert_paragraph_has_only_style_driven_heading_runs(&heading);
        let styles_xml = read_docx_entry_text(Path::new(&output), "word/styles.xml");
        assert!(styles_xml.contains(r#"w:styleId="Heading1""#));
        assert!(!styles_xml.contains(r#"w:styleId="Titre1""#));
    }

    #[test]
    fn convert_markdown_to_docx_uses_localized_heading_style_from_template() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-localized-heading-style");
        let templates = workspace.join("_templates");
        fs::create_dir_all(&templates).expect("templates");
        let template_styles = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" />
        <w:sz w:val="30" />
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal" />
    <w:rPr>
      <w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" />
      <w:sz w:val="30" />
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Titre1">
    <w:name w:val="Titre 1" />
    <w:rPr>
      <w:rFonts w:ascii="Inter" w:hAnsi="Inter" />
      <w:b />
      <w:sz w:val="42" />
      <w:color w:val="1357AF" />
    </w:rPr>
    <w:pPr>
      <w:spacing w:before="360" w:after="120" />
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Titre2">
    <w:name w:val="Titre 2" />
    <w:rPr>
      <w:rFonts w:ascii="Inter" w:hAnsi="Inter" />
      <w:b />
      <w:sz w:val="36" />
      <w:color w:val="2A4B7C" />
    </w:rPr>
  </w:style>
</w:styles>"#;
        write_valid_docx_with_styles(&templates.join("template.docx"), template_styles);

        let source = workspace.join("styled.md");
        fs::write(&source, "# Styled heading\n\n## Secondary").expect("write source");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        let doc = Document::open(&output).expect("open docx");
        let heading = doc
            .paragraphs()
            .into_iter()
            .find(|paragraph| paragraph.text().trim() == "Styled heading")
            .expect("heading paragraph");
        assert_eq!(heading.style_id(), Some("Titre1"));
        assert_paragraph_has_only_style_driven_heading_runs(&heading);

        let subheading = doc
            .paragraphs()
            .into_iter()
            .find(|paragraph| paragraph.text().trim() == "Secondary")
            .expect("subheading paragraph");
        assert_eq!(subheading.style_id(), Some("Titre2"));
        assert_paragraph_has_only_style_driven_heading_runs(&subheading);

        let styles_xml = read_docx_entry_text(Path::new(&output), "word/styles.xml");
        assert!(styles_xml.contains(r#"w:styleId="Titre1""#));
        assert!(styles_xml.contains(r#"w:styleId="Titre2""#));
        assert!(!styles_xml.contains(r#"w:styleId="Heading1""#));
    }

    #[test]
    fn convert_markdown_to_docx_renders_callouts() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-callout");
        fs::create_dir_all(workspace.join("_templates")).expect("templates");
        let source = workspace.join("callouts.md");
        fs::write(
            &source,
            "> [!NOTE]\n>\n> Callouts are useful.\n>\n> They keep related content together.\n\n> [!WARNING]\n>\n> Inline `code` stays readable.\n",
        )
        .expect("write callouts");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        let doc = Document::open(&output).expect("open docx");
        let note_fill = CalloutKind::Note.style().fill;
        let warning_fill = CalloutKind::Warning.style().fill;

        let note_header = doc
            .paragraphs()
            .into_iter()
            .find(|paragraph| paragraph.text().contains("Note"))
            .expect("note header");
        assert_eq!(note_header.shading_fill(), Some(note_fill));

        let note_body = doc
            .paragraphs()
            .into_iter()
            .find(|paragraph| paragraph.text().contains("Callouts are useful."))
            .expect("note body");
        assert_eq!(note_body.shading_fill(), Some(note_fill));
        assert!(note_body.text().contains("Callouts are useful."));

        let warning_header = doc
            .paragraphs()
            .into_iter()
            .find(|paragraph| paragraph.text().contains("Warning"))
            .expect("warning header");
        assert_eq!(warning_header.shading_fill(), Some(warning_fill));

        let warning_body = doc
            .paragraphs()
            .into_iter()
            .find(|paragraph| paragraph.text().contains("Inline code stays readable."))
            .expect("warning body");
        assert_eq!(warning_body.shading_fill(), Some(warning_fill));
        assert!(warning_body.runs().any(|run| run.text() == "code"));
    }

    #[test]
    fn convert_markdown_to_docx_renders_mermaid_as_image() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-mermaid");
        fs::create_dir_all(workspace.join("_templates")).expect("templates");
        let source = workspace.join("diagram.md");
        fs::write(
            &source,
            "```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```\n\nAfter diagram.\n",
        )
        .expect("write mermaid");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        let doc = Document::open(&output).expect("open docx");
        let images = doc.images();
        assert_eq!(images.len(), 1);
        assert!(images[0].width_emu > 0);
        assert!(images[0].height_emu > 0);
        assert!(!images[0].is_anchor);

        let media = read_docx_media_names(Path::new(&output));
        assert!(media.iter().any(|name| name.ends_with(".png")));
        assert!(!media.iter().any(|name| name.ends_with(".svg")));

        let paragraphs = read_docx_paragraphs(Path::new(&output));
        assert!(paragraphs
            .iter()
            .any(|text| text.contains("After diagram.")));
    }

    #[test]
    fn sanitize_mermaid_emojis_replaces_supported_symbols() {
        let sanitized = sanitize_mermaid_emojis("Done ✅ / Fail ❌ / Warn ⚠️ / Fire 🔥");
        assert_eq!(
            sanitized,
            "Done [done] / Fail [fail] / Warn [warning] / Fire [hot]"
        );
    }

    #[test]
    fn sanitize_mermaid_emojis_reaches_the_renderer() {
        let sanitized = sanitize_mermaid_emojis("flowchart LR\n  A[✅ Ready] --> B[⚠️ Review]");
        let svg = render_with_options(&sanitized, RenderOptions::mermaid_default())
            .expect("render sanitized mermaid");

        assert!(svg.contains("[done]"));
        assert!(svg.contains("[warning]"));
        assert!(!svg.contains("✅"));
        assert!(!svg.contains("⚠"));
    }

    #[test]
    fn convert_markdown_to_docx_renders_checklists() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-checklist");
        fs::create_dir_all(workspace.join("_templates")).expect("templates");
        let source = workspace.join("checklist.md");
        fs::write(
            &source,
            "- [ ] Draft plan\n- [x] Review plan\n- [ ] Ship it\n",
        )
        .expect("write checklist");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        let paragraphs = read_docx_paragraphs(Path::new(&output));
        let joined = paragraphs.join("\n");
        assert!(joined.contains("Draft plan"));
        assert!(joined.contains("Review plan"));
        assert!(joined.contains("Ship it"));
        assert!(joined.contains("[ ] Draft plan"));
        assert!(joined.contains("[x] Review plan"));
        assert!(joined.contains("[ ] Ship it"));
    }

    #[test]
    fn convert_markdown_to_docx_renders_nested_checklists() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-nested-checklist");
        fs::create_dir_all(workspace.join("_templates")).expect("templates");
        let source = workspace.join("nested-checklist.md");
        fs::write(&source, "- [ ] Parent\n  - [x] Child\n  - [ ] Child two\n")
            .expect("write nested checklist");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        let paragraphs = read_docx_paragraphs(Path::new(&output));
        let joined = paragraphs.join("\n");
        assert!(joined.contains("[ ] Parent"));
        assert!(joined.contains("[x] Child"));
        assert!(joined.contains("[ ] Child two"));
    }

    #[test]
    fn convert_markdown_to_docx_renders_frontmatter_as_key_value_table() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-frontmatter");
        fs::create_dir_all(workspace.join("_templates")).expect("templates");
        let source = workspace.join("frontmatter.md");
        fs::write(
            &source,
            "---\ntitle: Example\ntags: [One, Two]\ndraft: true\n---\n\nBody paragraph.\n",
        )
        .expect("write frontmatter");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        let (row_count, column_count, cells, headers, shadings, _) =
            read_docx_table(Path::new(&output));
        assert_eq!(row_count, 4);
        assert_eq!(column_count, 2);
        assert_eq!(headers, vec![true, false, false, false]);
        assert_eq!(
            cells,
            vec![
                vec!["Key".to_string(), "Value".to_string()],
                vec!["title".to_string(), "example".to_string()],
                vec!["tags".to_string(), "one, two".to_string()],
                vec!["draft".to_string(), "true".to_string()],
            ]
        );
        assert_eq!(shadings[0][0].as_deref(), Some(TABLE_HEADER_FILL));
        assert_eq!(shadings[0][1].as_deref(), Some(TABLE_HEADER_FILL));

        let widths = read_docx_table_cell_widths(Path::new(&output));
        assert!(!widths.is_empty());
        let first_row = &widths[0];
        assert_eq!(first_row.len(), 2);
        assert!(first_row.iter().all(|width| width.is_some()));
        let widths: Vec<i32> = first_row.iter().map(|width| width.unwrap()).collect();
        assert!(widths[0] < widths[1]);

        let paragraphs = read_docx_paragraphs(Path::new(&output));
        assert!(paragraphs
            .iter()
            .any(|text| text.contains("Body paragraph.")));
    }

    #[test]
    fn convert_markdown_to_docx_uses_collision_suffix() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-collision");
        fs::create_dir_all(workspace.join("_templates")).expect("templates");
        let source = workspace.join("note.markdown");
        fs::write(&source, "# Title").expect("write note");
        fs::write(workspace.join("note.docx"), "occupied").expect("occupy output");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        assert!(output.ends_with("note (1).docx"));
        assert!(Path::new(&output).exists());
    }

    #[test]
    fn convert_markdown_to_docx_rejects_non_markdown() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-invalid");
        fs::create_dir_all(&workspace).expect("workspace");
        let source = workspace.join("note.txt");
        fs::write(&source, "text").expect("write text");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let result = convert_markdown_to_docx_sync(source.to_string_lossy().to_string());
        assert!(matches!(result, Err(AppError::InvalidPath)));
    }

    #[test]
    fn convert_markdown_to_docx_falls_back_when_template_is_invalid() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-invalid-template");
        let templates = workspace.join("_templates");
        fs::create_dir_all(&templates).expect("templates");
        fs::write(templates.join("broken.docx"), "not a zip").expect("broken template");
        let source = workspace.join("note.md");
        fs::write(&source, "# Title").expect("write note");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        assert!(output.ends_with("note.docx"));
        assert!(Path::new(&output).exists());
    }

    #[test]
    fn convert_markdown_to_docx_falls_back_without_template_dir() {
        let _guard = workspace_test_guard();
        let workspace = create_temp_workspace("tomosona-docx-no-template");
        let source = workspace.join("note.md");
        fs::write(&source, "# Title\n\nBody.\n").expect("write note");

        crate::set_active_workspace(&workspace.to_string_lossy()).expect("set workspace");
        let output =
            convert_markdown_to_docx_sync(source.to_string_lossy().to_string()).expect("convert");

        assert!(output.ends_with("note.docx"));
        assert!(Path::new(&output).exists());
    }
}
