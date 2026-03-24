//! DOCX export module tree.
//!
//! This namespace groups the conversion pipeline plus its style sources so the
//! rest of the backend can treat DOCX export as one bounded subsystem.

pub(crate) mod conversion;
pub(crate) mod default_style;
pub(crate) mod style_from_docx;

pub(crate) use conversion::convert_markdown_to_docx;
