//! Default DOCX style model used when no template is available.
//!
//! This module owns the shared style structs plus the built-in fallback
//! values. The renderer consumes this model whether the values came from the
//! fallback or were extracted from a template DOCX.

use rdocx::BorderStyle;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct TextStyle {
    pub bold: bool,
    pub italic: bool,
    pub code: bool,
    pub font: Option<String>,
    pub size: Option<u32>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ParagraphStyle {
    pub space_before: Option<f64>,
    pub space_after: Option<f64>,
    pub indent_left: Option<f64>,
    pub indent_right: Option<f64>,
    pub line_spacing_multiple: Option<f64>,
    pub shading_fill: Option<String>,
    pub border_bottom: Option<BorderSpec>,
    pub keep_together: bool,
}

impl Default for ParagraphStyle {
    fn default() -> Self {
        Self {
            space_before: None,
            space_after: None,
            indent_left: None,
            indent_right: None,
            line_spacing_multiple: None,
            shading_fill: None,
            border_bottom: None,
            keep_together: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct BorderSpec {
    pub style: BorderStyle,
    pub size_eighths_pt: u32,
    pub color: String,
}

impl BorderSpec {
    pub(crate) fn single(size_eighths_pt: u32, color: &str) -> Self {
        Self {
            style: BorderStyle::Single,
            size_eighths_pt,
            color: color.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct BlockStyle {
    pub run: TextStyle,
    pub paragraph: ParagraphStyle,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TemplateStyle {
    pub default_font: String,
    pub body_size: u32,
    pub body: BlockStyle,
    pub title: BlockStyle,
    pub heading1: BlockStyle,
    pub heading2: BlockStyle,
    pub heading3: BlockStyle,
    pub quote: BlockStyle,
    pub list: BlockStyle,
}

impl Default for TemplateStyle {
    fn default() -> Self {
        let body = BlockStyle {
            run: TextStyle {
                font: Some(DEFAULT_FONT.to_string()),
                size: Some(DEFAULT_BODY_SIZE),
                ..Default::default()
            },
            paragraph: ParagraphStyle {
                space_after: Some(5.0),
                ..Default::default()
            },
        };

        let heading1 = BlockStyle {
            run: TextStyle {
                bold: true,
                font: Some(DEFAULT_FONT.to_string()),
                size: Some(36),
                color: Some("1F3864".to_string()),
                ..Default::default()
            },
            paragraph: ParagraphStyle {
                space_before: Some(18.0),
                space_after: Some(6.0),
                border_bottom: Some(BorderSpec::single(6, "1F3864")),
                ..Default::default()
            },
        };

        let heading2 = BlockStyle {
            run: TextStyle {
                bold: true,
                font: Some(DEFAULT_FONT.to_string()),
                size: Some(28),
                color: Some("2E5090".to_string()),
                ..Default::default()
            },
            paragraph: ParagraphStyle {
                space_before: Some(14.0),
                space_after: Some(5.0),
                ..Default::default()
            },
        };

        let heading3 = BlockStyle {
            run: TextStyle {
                bold: true,
                font: Some(DEFAULT_FONT.to_string()),
                size: Some(24),
                color: Some("404040".to_string()),
                ..Default::default()
            },
            paragraph: ParagraphStyle {
                space_before: Some(10.0),
                space_after: Some(4.0),
                ..Default::default()
            },
        };

        let title = BlockStyle {
            run: TextStyle {
                bold: true,
                font: Some(DEFAULT_FONT.to_string()),
                size: Some(42),
                color: Some("1F3864".to_string()),
                ..Default::default()
            },
            paragraph: ParagraphStyle {
                space_after: Some(12.0),
                ..Default::default()
            },
        };

        let quote = BlockStyle {
            run: TextStyle {
                italic: true,
                font: Some(DEFAULT_FONT.to_string()),
                size: Some(DEFAULT_BODY_SIZE),
                color: Some("666666".to_string()),
                ..Default::default()
            },
            paragraph: ParagraphStyle {
                space_before: Some(2.0),
                space_after: Some(2.0),
                indent_left: Some(18.0),
                shading_fill: Some("F5F7F9".to_string()),
                line_spacing_multiple: Some(1.0),
                ..Default::default()
            },
        };

        let list = BlockStyle {
            run: TextStyle {
                font: Some(DEFAULT_FONT.to_string()),
                size: Some(DEFAULT_BODY_SIZE),
                ..Default::default()
            },
            paragraph: ParagraphStyle {
                space_after: Some(4.0),
                ..Default::default()
            },
        };

        Self {
            default_font: DEFAULT_FONT.to_string(),
            body_size: DEFAULT_BODY_SIZE,
            body,
            title,
            heading1,
            heading2,
            heading3,
            quote,
            list,
        }
    }
}

pub(crate) const DEFAULT_FONT: &str = "Calibri";
pub(crate) const DEFAULT_BODY_SIZE: u32 = 24;

impl TemplateStyle {
    pub(crate) fn body(&self) -> &BlockStyle {
        &self.body
    }

    pub(crate) fn heading(&self, level: u8) -> &BlockStyle {
        match level {
            1 => &self.heading1,
            2 => &self.heading2,
            3 => &self.heading3,
            _ => &self.heading3,
        }
    }

    pub(crate) fn quote(&self) -> &BlockStyle {
        &self.quote
    }

    pub(crate) fn list(&self) -> &BlockStyle {
        &self.list
    }

    pub(crate) fn list_prefix(
        &self,
        list_type: comrak::nodes::ListType,
        depth: usize,
        ordinal: usize,
    ) -> String {
        let indent = "  ".repeat(depth.saturating_sub(1));
        match list_type {
            comrak::nodes::ListType::Bullet => {
                let bullet = match depth {
                    0 | 1 => '•',
                    _ => '◦',
                };
                format!("{indent}{bullet} ")
            }
            comrak::nodes::ListType::Ordered => {
                let marker = if ordinal == 0 {
                    "1.".to_string()
                } else {
                    format!("{ordinal}.")
                };
                format!("{indent}{marker} ")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use comrak::nodes::ListType;

    #[test]
    fn default_template_style_matches_current_fallbacks() {
        let style = TemplateStyle::default();

        assert_eq!(style.default_font, DEFAULT_FONT);
        assert_eq!(style.body_size, DEFAULT_BODY_SIZE);

        assert_eq!(style.body.run.font.as_deref(), Some(DEFAULT_FONT));
        assert_eq!(style.body.run.size, Some(DEFAULT_BODY_SIZE));
        assert_eq!(style.body.paragraph.space_after, Some(5.0));

        assert_eq!(style.title.run.bold, true);
        assert_eq!(style.title.run.size, Some(42));
        assert_eq!(style.title.paragraph.space_after, Some(12.0));

        assert_eq!(style.heading1.run.size, Some(36));
        assert_eq!(style.heading2.run.size, Some(28));
        assert_eq!(style.heading3.run.size, Some(24));
        assert_eq!(style.heading1.paragraph.border_bottom.as_ref().map(|spec| spec.color.as_str()), Some("1F3864"));

        assert_eq!(style.quote.run.italic, true);
        assert_eq!(style.quote.paragraph.shading_fill.as_deref(), Some("F5F7F9"));
        assert_eq!(style.quote.paragraph.indent_left, Some(18.0));

        assert_eq!(style.list.run.font.as_deref(), Some(DEFAULT_FONT));
        assert_eq!(style.list.paragraph.space_after, Some(4.0));

        assert_eq!(style.list_prefix(ListType::Bullet, 1, 0), "• ");
        assert_eq!(style.list_prefix(ListType::Bullet, 2, 0), "  ◦ ");
        assert_eq!(style.list_prefix(ListType::Ordered, 1, 3), "3. ");
    }

    #[test]
    fn every_known_block_style_is_available_without_template() {
        let style = TemplateStyle::default();

        let blocks = [
            &style.body,
            &style.title,
            &style.heading1,
            &style.heading2,
            &style.heading3,
            &style.quote,
            &style.list,
        ];

        for block in blocks {
            assert!(block.run.font.is_some());
            assert!(block.run.size.is_some());
        }
    }
}
