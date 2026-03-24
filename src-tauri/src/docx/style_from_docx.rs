//! Template DOCX style extraction.
//!
//! This module reads an optional `_templates/*.docx` file and resolves the
//! paragraph/run properties that our renderer understands. If the template is
//! missing, malformed, or omits a style, the caller keeps the default style
//! values from `default_style.rs`.

use std::path::Path;

use rdocx::{BorderStyle, Document};

use crate::docx::default_style::{
    BlockStyle, BorderSpec, ParagraphStyle, TemplateStyle, TextStyle, DEFAULT_BODY_SIZE,
    DEFAULT_FONT,
};
use crate::{AppError, Result};

pub(crate) fn read_template_style(template_path: &Path) -> Result<TemplateStyle> {
    let doc = Document::open(template_path).map_err(|_| {
        AppError::InvalidOperation("Template DOCX is not a valid Word file.".to_string())
    })?;
    Ok(extract_template_style(&doc))
}

fn extract_template_style(doc: &Document) -> TemplateStyle {
    let mut styles = TemplateStyle::default();
    let normal_run = doc.resolve_run_properties(Some("Normal"), None);
    styles.default_font = normal_run
        .font_ascii
        .clone()
        .or(normal_run.font_hansi.clone())
        .or(normal_run.font_east_asia.clone())
        .or_else(|| styles.body.run.font.clone())
        .unwrap_or_else(|| DEFAULT_FONT.to_string());
    styles.body_size = normal_run
        .sz
        .map(|size| size.0)
        .or(styles.body.run.size)
        .unwrap_or(DEFAULT_BODY_SIZE);

    styles.body = extract_block_style(doc, "body", &["Normal"], styles.body.clone());
    styles.title = extract_block_style(doc, "title", &["Titre", "Title"], styles.title.clone());
    styles.heading1 = extract_heading_style(doc, 1, styles.heading1.clone());
    styles.heading2 = extract_heading_style(doc, 2, styles.heading2.clone());
    styles.heading3 = extract_heading_style(doc, 3, styles.heading3.clone());
    styles.heading4 = extract_heading_style(doc, 4, styles.heading4.clone());
    styles.heading5 = extract_heading_style(doc, 5, styles.heading5.clone());
    styles.heading6 = extract_heading_style(doc, 6, styles.heading6.clone());
    styles.quote = extract_block_style(
        doc,
        "quote",
        &["Citation", "CitationIntense", "Quote", "IntenseQuote"],
        styles.quote.clone(),
    );
    styles.list = extract_block_style(
        doc,
        "list",
        &[
            "Paragraphedeliste",
            "ListParagraph",
            "ListBullet",
            "ListNumber",
        ],
        styles.list.clone(),
    );

    styles
}

fn extract_heading_style(doc: &Document, level: u8, fallback: BlockStyle) -> BlockStyle {
    extract_block_style(
        doc,
        &format!("heading{level}"),
        heading_style_candidates(level),
        fallback,
    )
}

fn heading_style_candidates(level: u8) -> &'static [&'static str] {
    match level {
        1 => &["Titre1", "Heading1"],
        2 => &["Titre2", "Heading2"],
        3 => &["Titre3", "Heading3"],
        4 => &["Titre4", "Heading4"],
        5 => &["Titre5", "Heading5"],
        6 => &["Titre6", "Heading6"],
        _ => &["Heading6", "Titre6"],
    }
}

fn extract_block_style(
    doc: &Document,
    _label: &str,
    style_ids: &[&str],
    fallback: BlockStyle,
) -> BlockStyle {
    for style_id in style_ids {
        if doc.style(style_id).is_some() {
            let ppr = doc.resolve_paragraph_properties(Some(style_id));
            let rpr = doc.resolve_run_properties(Some(style_id), None);
            return BlockStyle {
                style_id: Some((*style_id).to_string()),
                run: TextStyle {
                    bold: rpr.bold.unwrap_or(fallback.run.bold),
                    italic: rpr.italic.unwrap_or(fallback.run.italic),
                    code: fallback.run.code,
                    font: Some(
                        rpr.font_ascii
                            .clone()
                            .or(rpr.font_hansi.clone())
                            .or(rpr.font_east_asia.clone())
                            .or_else(|| fallback.run.font.clone())
                            .unwrap_or_else(|| DEFAULT_FONT.to_string()),
                    ),
                    size: rpr.sz.map(|size| size.0).or(fallback.run.size),
                    color: rpr.color.clone().or(fallback.run.color.clone()),
                },
                paragraph: ParagraphStyle {
                    space_before: ppr
                        .space_before
                        .map(|value| value.to_pt())
                        .or(fallback.paragraph.space_before),
                    space_after: ppr
                        .space_after
                        .map(|value| value.to_pt())
                        .or(fallback.paragraph.space_after),
                    indent_left: ppr
                        .ind_left
                        .map(|value| value.to_pt())
                        .or(fallback.paragraph.indent_left),
                    indent_right: ppr
                        .ind_right
                        .map(|value| value.to_pt())
                        .or(fallback.paragraph.indent_right),
                    line_spacing_multiple: match (ppr.line_spacing, ppr.line_rule.as_deref()) {
                        (Some(line_spacing), Some("auto")) => Some(line_spacing.0 as f64 / 240.0),
                        _ => fallback.paragraph.line_spacing_multiple,
                    },
                    shading_fill: ppr
                        .shading
                        .as_ref()
                        .and_then(|shading| shading.fill.clone())
                        .or(fallback.paragraph.shading_fill.clone()),
                    border_bottom: ppr
                        .borders
                        .as_ref()
                        .and_then(|borders| borders.bottom.as_ref())
                        .map(|edge| BorderSpec {
                            style: match edge.val.to_str() {
                                "single" => BorderStyle::Single,
                                "thick" => BorderStyle::Thick,
                                "double" => BorderStyle::Double,
                                "dotted" => BorderStyle::Dotted,
                                "dashed" => BorderStyle::Dashed,
                                "dotDash" => BorderStyle::DotDash,
                                "wave" => BorderStyle::Wave,
                                _ => BorderStyle::Single,
                            },
                            size_eighths_pt: edge.sz.unwrap_or(0),
                            color: edge.color.clone().unwrap_or_else(|| "000000".to_string()),
                        })
                        .or_else(|| fallback.paragraph.border_bottom.clone()),
                    keep_together: ppr.keep_lines.unwrap_or(fallback.paragraph.keep_together),
                },
            };
        }
    }

    fallback
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        fs::File,
        io::{Read, Write},
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use zip::ZipArchive;
    use zip::{write::SimpleFileOptions, ZipWriter};

    fn create_temp_workspace(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("{prefix}-{nonce}"));
        fs::create_dir_all(&dir).expect("create temp workspace");
        dir
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

    #[test]
    fn extracts_heading_and_list_styles_by_style_id() {
        let workspace = create_temp_workspace("tomosona-style-extract");
        let path = workspace.join("template.docx");
        write_valid_docx_with_styles(
            &path,
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
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Titre" />
    <w:rPr>
      <w:rFonts w:ascii="Inter" w:hAnsi="Inter" />
      <w:b />
      <w:sz w:val="48" />
      <w:color w:val="223344" />
    </w:rPr>
    <w:pPr>
      <w:spacing w:after="240" />
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Titre1">
    <w:name w:val="Titre 1" />
    <w:rPr>
      <w:rFonts w:ascii="Inter" w:hAnsi="Inter" />
      <w:b />
      <w:sz w:val="40" />
      <w:color w:val="112233" />
    </w:rPr>
    <w:pPr>
      <w:spacing w:before="360" w:after="120" />
      <w:pBdr>
      <w:bottom w:val="single" w:sz="6" w:color="112233" />
      </w:pBdr>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Titre2">
    <w:name w:val="Titre 2" />
  </w:style>
  <w:style w:type="paragraph" w:styleId="Titre3">
    <w:name w:val="Titre 3" />
  </w:style>
  <w:style w:type="paragraph" w:styleId="Titre4">
    <w:name w:val="Titre 4" />
  </w:style>
  <w:style w:type="paragraph" w:styleId="Titre5">
    <w:name w:val="Titre 5" />
  </w:style>
  <w:style w:type="paragraph" w:styleId="Titre6">
    <w:name w:val="Titre 6" />
  </w:style>
  <w:style w:type="paragraph" w:styleId="Paragraphedeliste">
    <w:name w:val="Liste" />
    <w:pPr>
      <w:spacing w:after="80" />
      <w:ind w:left="720" />
    </w:pPr>
  </w:style>
</w:styles>"#,
        );

        let style = read_template_style(&path).expect("extract style");
        assert_eq!(style.default_font, "Aptos");
        assert_eq!(style.body_size, 30);
        assert_eq!(style.title.run.font.as_deref(), Some("Inter"));
        assert_eq!(style.title.run.size, Some(48));
        assert_eq!(style.title.run.bold, true);
        assert_eq!(style.title.paragraph.space_after, Some(12.0));
        assert_eq!(style.heading1.run.font.as_deref(), Some("Inter"));
        assert_eq!(style.heading1.run.size, Some(40));
        assert_eq!(style.heading1.run.bold, true);
        assert_eq!(style.heading1.run.color.as_deref(), Some("112233"));
        assert_eq!(style.heading1.paragraph.space_before, Some(18.0));
        assert_eq!(style.heading1.paragraph.space_after, Some(6.0));
        assert_eq!(style.heading2.style_id.as_deref(), Some("Titre2"));
        assert_eq!(style.heading3.style_id.as_deref(), Some("Titre3"));
        assert_eq!(style.heading4.style_id.as_deref(), Some("Titre4"));
        assert_eq!(style.heading5.style_id.as_deref(), Some("Titre5"));
        assert_eq!(style.heading6.style_id.as_deref(), Some("Titre6"));
        assert_eq!(style.list.paragraph.space_after, Some(4.0));
        assert_eq!(style.list.paragraph.indent_left, Some(36.0));
    }

    #[test]
    fn missing_styles_fall_back_to_defaults() {
        let workspace = create_temp_workspace("tomosona-style-fallback");
        let path = workspace.join("template.docx");
        write_valid_docx_with_styles(
            &path,
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal" />
    <w:rPr>
      <w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" />
      <w:sz w:val="30" />
    </w:rPr>
  </w:style>
</w:styles>"#,
        );

        let style = read_template_style(&path).expect("extract style");
        assert_eq!(style.title.run.size, Some(42));
        assert_eq!(style.heading2.run.size, Some(28));
        assert_eq!(style.heading4.run.size, Some(22));
        assert_eq!(style.heading5.run.size, Some(20));
        assert_eq!(style.heading6.run.size, Some(18));
        assert_eq!(
            style.quote.paragraph.shading_fill.as_deref(),
            Some("F5F7F9")
        );
        assert_eq!(style.list.paragraph.space_after, Some(4.0));
    }
}
