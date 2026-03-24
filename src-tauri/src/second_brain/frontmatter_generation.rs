//! Frontmatter generation workflow powered by the active Second Brain LLM profile.
//!
//! The flow keeps prompt assembly separate from provider execution so the editor
//! can request structured suggestions without depending on the `alters` system.

use serde::{Deserialize, Serialize};

use super::prompt_builder::{
    build_frontmatter_generation_prompt, frontmatter_generation_system_prompt,
    FrontmatterGenerationPromptInput,
};
use super::{active_profile, llm::run_llm, load_config, AppError, Result};
use crate::second_brain::config::SecondBrainConfig;

/// How the frontend is asking the model to generate properties.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrontmatterGenerationMode {
    Auto,
    Field,
}

/// Compact representation of one existing frontmatter field used as prompt context.
#[derive(Debug, Clone, Deserialize)]
pub struct FrontmatterGenerationExistingField {
    pub key: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub value: String,
}

/// Payload accepted by the Tauri frontmatter-generation command.
#[derive(Debug, Clone, Deserialize)]
pub struct GenerateFrontmatterPropertiesPayload {
    pub path: String,
    pub title: String,
    pub body_markdown: String,
    pub raw_yaml: String,
    #[serde(default)]
    pub existing_fields: Vec<FrontmatterGenerationExistingField>,
    pub mode: FrontmatterGenerationMode,
    pub target_key: Option<String>,
    pub language_hint: Option<String>,
}

/// Narrow JSON value union accepted from the model response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum GeneratedFrontmatterValue {
    Text(String),
    Number(f64),
    Bool(bool),
    List(Vec<String>),
}

/// One AI-generated frontmatter property suggestion.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedFrontmatterProperty {
    pub key: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub value: GeneratedFrontmatterValue,
}

/// Structured result returned to the editor after AI generation.
#[derive(Debug, Clone, Serialize)]
pub struct GenerateFrontmatterPropertiesResult {
    pub language: String,
    pub properties: Vec<GeneratedFrontmatterProperty>,
}

#[derive(Debug, Clone, Deserialize)]
struct GeneratedFrontmatterPayload {
    #[serde(default)]
    language: String,
    #[serde(default)]
    properties: Vec<GeneratedFrontmatterProperty>,
}

fn extract_json_object(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed);
    }
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(&trimmed[start..=end])
}

fn sanitize_property_key(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn sanitize_value_text(value: &str) -> String {
    value.trim().to_string()
}

fn normalize_existing_fields(
    fields: &[FrontmatterGenerationExistingField],
) -> Vec<FrontmatterGenerationExistingField> {
    fields
        .iter()
        .filter_map(|field| {
            let key = sanitize_property_key(&field.key)?;
            Some(FrontmatterGenerationExistingField {
                key,
                field_type: field.field_type.trim().to_string(),
                value: sanitize_value_text(&field.value),
            })
        })
        .collect()
}

fn parse_generated_frontmatter_response(raw: &str) -> Result<GeneratedFrontmatterPayload> {
    let json = extract_json_object(raw).ok_or_else(|| {
        AppError::InvalidOperation("Model response was not valid JSON.".to_string())
    })?;
    serde_json::from_str::<GeneratedFrontmatterPayload>(json)
        .map_err(|_| AppError::InvalidOperation("Model response was not valid JSON.".to_string()))
}

fn load_active_second_brain_config() -> Result<SecondBrainConfig> {
    load_config()
}

fn active_profile_for_frontmatter(
    config: &SecondBrainConfig,
) -> Result<super::config::ProviderProfile> {
    active_profile(config).cloned().ok_or_else(|| {
        AppError::InvalidOperation("Second Brain configuration is unavailable.".to_string())
    })
}

/// Generates frontmatter suggestions from the active Second Brain LLM profile.
///
/// This workflow keeps prompt assembly isolated from the transport and parses the
/// model response as strict JSON so the frontend only receives structured output.
pub async fn generate_frontmatter_properties(
    payload: GenerateFrontmatterPropertiesPayload,
) -> Result<GenerateFrontmatterPropertiesResult> {
    let config = load_active_second_brain_config()?;
    let profile = active_profile_for_frontmatter(&config)?;
    let prompt_input = FrontmatterGenerationPromptInput {
        path: payload.path.trim().to_string(),
        title: payload.title.trim().to_string(),
        body_markdown: payload.body_markdown,
        raw_yaml: payload.raw_yaml,
        existing_fields: normalize_existing_fields(&payload.existing_fields),
        mode: payload.mode.clone(),
        target_key: payload
            .target_key
            .and_then(|value| sanitize_property_key(&value)),
        language_hint: payload
            .language_hint
            .and_then(|value| sanitize_property_key(&value)),
    };
    let built_prompt = build_frontmatter_generation_prompt(&prompt_input);
    let raw = run_llm(
        &profile,
        frontmatter_generation_system_prompt(),
        &built_prompt.user_prompt,
        Some(0.2),
    )
    .await
    .map_err(|message| AppError::InvalidOperation(message))?;
    let parsed = parse_generated_frontmatter_response(&raw)?;
    Ok(GenerateFrontmatterPropertiesResult {
        language: if parsed.language.trim().is_empty() {
            built_prompt.language_hint
        } else {
            parsed.language.trim().to_string()
        },
        properties: parsed.properties,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_json_object_from_wrapped_content() {
        let raw = "```json\n{\"language\":\"fr\",\"properties\":[]}\n```";
        let parsed = parse_generated_frontmatter_response(raw).expect("parse response");
        assert_eq!(parsed.language, "fr");
        assert!(parsed.properties.is_empty());
    }

    #[test]
    fn rejects_invalid_json_content() {
        let raw = "not json";
        let err = parse_generated_frontmatter_response(raw).expect_err("invalid json should fail");
        assert!(format!("{err}").contains("JSON"));
    }

    #[test]
    fn normalizes_empty_values_from_existing_fields() {
        let fields = normalize_existing_fields(&[FrontmatterGenerationExistingField {
            key: "  status  ".to_string(),
            field_type: "text".to_string(),
            value: "  brouillon  ".to_string(),
        }]);
        assert_eq!(fields[0].key, "status");
        assert_eq!(fields[0].value, "brouillon");
    }
}
