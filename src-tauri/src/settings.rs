//! Application settings management persisted in `~/.tomosona/conf.json`.
//!
//! This module centralizes validation, redaction, and save semantics for:
//! - `llm` provider profiles used by second-brain chat features.
//! - `embeddings` runtime configuration used by semantic indexing/search.
//!
//! API keys are never returned by read commands; consumers receive `has_api_key`.

use std::{fs, path::PathBuf};

use directories::BaseDirs;
use serde::{Deserialize, Serialize};

use crate::second_brain::config::{
    validate_config as validate_llm_config, ProfileCapabilities, ProviderProfile, SecondBrainConfig,
};
use crate::{AppError, Result};

const SETTINGS_FILE: &str = "conf.json";
const EMBEDDINGS_MODE_INTERNAL: &str = "internal";
const EMBEDDINGS_MODE_EXTERNAL: &str = "external";
const EMBEDDINGS_PROVIDER_OPENAI: &str = "openai";
const ALTER_DEFAULT_MODE_NEUTRAL: &str = "neutral";
const ALTER_DEFAULT_MODE_LAST_USED: &str = "last_used";
const ALTER_DEFAULT_INTENSITY_LIGHT: &str = "light";
const ALTER_DEFAULT_INTENSITY_BALANCED: &str = "balanced";
const ALTER_DEFAULT_INTENSITY_STRONG: &str = "strong";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingProviderProfile {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub model: String,
    pub api_key: String,
    #[serde(default)]
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingsSettings {
    pub mode: String,
    #[serde(default)]
    pub external: Option<EmbeddingProviderProfile>,
}

impl Default for EmbeddingsSettings {
    fn default() -> Self {
        Self {
            mode: EMBEDDINGS_MODE_INTERNAL.to_string(),
            external: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub llm: SecondBrainConfig,
    pub embeddings: EmbeddingsSettings,
    #[serde(default)]
    pub alters: AltersSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AltersSettings {
    pub default_mode: String,
    pub show_badge_in_chat: bool,
    pub default_influence_intensity: String,
}

impl Default for AltersSettings {
    fn default() -> Self {
        Self {
            default_mode: ALTER_DEFAULT_MODE_NEUTRAL.to_string(),
            show_badge_in_chat: true,
            default_influence_intensity: ALTER_DEFAULT_INTENSITY_BALANCED.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct LlmProfileView {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub model: String,
    pub has_api_key: bool,
    pub base_url: Option<String>,
    pub default_mode: Option<String>,
    pub capabilities: ProfileCapabilities,
}

#[derive(Debug, Clone, Serialize)]
pub struct LlmConfigView {
    pub active_profile: String,
    pub profiles: Vec<LlmProfileView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EmbeddingProfileView {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub model: String,
    pub has_api_key: bool,
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EmbeddingsSettingsView {
    pub mode: String,
    pub external: Option<EmbeddingProfileView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppSettingsView {
    pub exists: bool,
    pub path: String,
    pub llm: Option<LlmConfigView>,
    pub embeddings: EmbeddingsSettingsView,
    pub alters: AltersSettings,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveLlmProfileInput {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub preserve_existing_api_key: bool,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub default_mode: Option<String>,
    #[serde(default)]
    pub capabilities: ProfileCapabilities,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveLlmConfigInput {
    pub active_profile: String,
    pub profiles: Vec<SaveLlmProfileInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveEmbeddingProfileInput {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub preserve_existing_api_key: bool,
    #[serde(default)]
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveEmbeddingsInput {
    pub mode: String,
    #[serde(default)]
    pub external: Option<SaveEmbeddingProfileInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveAppSettingsPayload {
    pub llm: SaveLlmConfigInput,
    pub embeddings: SaveEmbeddingsInput,
    pub alters: SaveAltersInput,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveAltersInput {
    pub default_mode: String,
    pub show_badge_in_chat: bool,
    pub default_influence_intensity: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WriteAppSettingsResult {
    pub path: String,
    pub embeddings_changed: bool,
    pub alters: AltersSettings,
}

fn conf_path() -> Result<PathBuf> {
    let base_dirs = BaseDirs::new().ok_or_else(|| {
        AppError::InvalidOperation("Could not resolve user home directory.".to_string())
    })?;
    Ok(base_dirs.home_dir().join(".tomosona").join(SETTINGS_FILE))
}

fn ensure_conf_parent(path: &PathBuf) -> Result<()> {
    let Some(parent) = path.parent() else {
        return Err(AppError::InvalidPath);
    };
    fs::create_dir_all(parent)?;
    Ok(())
}

fn validate_base_url(base_url: &Option<String>, field_name: &str) -> Result<()> {
    let Some(value) = base_url else {
        return Ok(());
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(());
    }
    Err(AppError::InvalidOperation(format!(
        "{field_name} must start with http:// or https://."
    )))
}

fn resolve_api_key(
    input_value: Option<&str>,
    preserve_existing: bool,
    existing_value: Option<&str>,
    label: &str,
) -> Result<String> {
    if let Some(value) = input_value {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    if preserve_existing {
        if let Some(existing) = existing_value {
            let trimmed = existing.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
    }
    Err(AppError::InvalidOperation(format!(
        "{label} API key is required."
    )))
}

fn validate_embeddings(settings: &EmbeddingsSettings) -> Result<()> {
    let mode = settings.mode.trim().to_lowercase();
    if mode != EMBEDDINGS_MODE_INTERNAL && mode != EMBEDDINGS_MODE_EXTERNAL {
        return Err(AppError::InvalidOperation(
            "Embeddings mode must be internal or external.".to_string(),
        ));
    }
    if mode == EMBEDDINGS_MODE_INTERNAL {
        return Ok(());
    }
    let Some(profile) = &settings.external else {
        return Err(AppError::InvalidOperation(
            "Embeddings external profile is required when external mode is selected.".to_string(),
        ));
    };
    if profile.id.trim().is_empty() {
        return Err(AppError::InvalidOperation(
            "Embeddings profile id is required.".to_string(),
        ));
    }
    if profile.label.trim().is_empty() {
        return Err(AppError::InvalidOperation(
            "Embeddings profile label is required.".to_string(),
        ));
    }
    if profile.provider.trim().to_lowercase() != EMBEDDINGS_PROVIDER_OPENAI {
        return Err(AppError::InvalidOperation(
            "Embeddings provider must be openai.".to_string(),
        ));
    }
    if profile.model.trim().is_empty() {
        return Err(AppError::InvalidOperation(
            "Embeddings model is required.".to_string(),
        ));
    }
    if profile.api_key.trim().is_empty() {
        return Err(AppError::InvalidOperation(
            "Embeddings API key is required.".to_string(),
        ));
    }
    validate_base_url(&profile.base_url, "Embeddings base_url")?;
    Ok(())
}

fn validate_settings(settings: &AppSettings) -> Result<()> {
    validate_llm_config(&settings.llm).map_err(|message| {
        AppError::InvalidOperation(format!("LLM configuration error: {message}"))
    })?;
    validate_embeddings(&settings.embeddings)?;
    validate_alters(&settings.alters)?;
    Ok(())
}

fn validate_alters(settings: &AltersSettings) -> Result<()> {
    let default_mode = settings.default_mode.trim().to_lowercase();
    if default_mode != ALTER_DEFAULT_MODE_NEUTRAL && default_mode != ALTER_DEFAULT_MODE_LAST_USED {
        return Err(AppError::InvalidOperation(
            "Alters default mode must be neutral or last_used.".to_string(),
        ));
    }
    let intensity = settings.default_influence_intensity.trim().to_lowercase();
    if intensity != ALTER_DEFAULT_INTENSITY_LIGHT
        && intensity != ALTER_DEFAULT_INTENSITY_BALANCED
        && intensity != ALTER_DEFAULT_INTENSITY_STRONG
    {
        return Err(AppError::InvalidOperation(
            "Alters default intensity must be light, balanced, or strong.".to_string(),
        ));
    }
    Ok(())
}

fn read_settings_file() -> Result<AppSettings> {
    let path = conf_path()?;
    if !path.exists() {
        return Err(AppError::InvalidOperation(
            "Settings configuration not found (.tomosona/conf.json).".to_string(),
        ));
    }
    let raw = fs::read_to_string(path)?;
    let settings: AppSettings = serde_json::from_str(&raw).map_err(|_| {
        AppError::InvalidOperation("Settings configuration is invalid JSON.".to_string())
    })?;
    validate_settings(&settings)?;
    Ok(settings)
}

fn redact_llm(config: &SecondBrainConfig) -> LlmConfigView {
    LlmConfigView {
        active_profile: config.active_profile.clone(),
        profiles: config
            .profiles
            .iter()
            .map(|profile| LlmProfileView {
                id: profile.id.clone(),
                label: profile.label.clone(),
                provider: profile.provider.clone(),
                model: profile.model.clone(),
                has_api_key: !profile.api_key.trim().is_empty(),
                base_url: profile.base_url.clone(),
                default_mode: profile.default_mode.clone(),
                capabilities: profile.capabilities.clone(),
            })
            .collect(),
    }
}

fn redact_embeddings(settings: &EmbeddingsSettings) -> EmbeddingsSettingsView {
    EmbeddingsSettingsView {
        mode: settings.mode.clone(),
        external: settings
            .external
            .as_ref()
            .map(|profile| EmbeddingProfileView {
                id: profile.id.clone(),
                label: profile.label.clone(),
                provider: profile.provider.clone(),
                model: profile.model.clone(),
                has_api_key: !profile.api_key.trim().is_empty(),
                base_url: profile.base_url.clone(),
            }),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct EmbeddingIdentity {
    mode: String,
    provider: String,
    model: String,
    base_url: String,
}

fn embedding_identity(settings: &EmbeddingsSettings) -> EmbeddingIdentity {
    let mode = settings.mode.trim().to_lowercase();
    if mode == EMBEDDINGS_MODE_EXTERNAL {
        if let Some(profile) = &settings.external {
            return EmbeddingIdentity {
                mode,
                provider: profile.provider.trim().to_lowercase(),
                model: profile.model.trim().to_string(),
                base_url: profile.base_url.as_deref().unwrap_or("").trim().to_string(),
            };
        }
    }
    EmbeddingIdentity {
        mode: EMBEDDINGS_MODE_INTERNAL.to_string(),
        provider: String::new(),
        model: String::new(),
        base_url: String::new(),
    }
}

fn apply_save_payload(
    payload: SaveAppSettingsPayload,
    existing: Option<&AppSettings>,
) -> Result<AppSettings> {
    let existing_llm = existing.map(|item| &item.llm);
    let existing_embeddings = existing.and_then(|item| item.embeddings.external.as_ref());

    let llm_profiles = payload
        .llm
        .profiles
        .iter()
        .map(|profile| {
            let provider = profile.provider.trim().to_lowercase();
            let existing_api_key = existing_llm.and_then(|cfg| {
                cfg.profiles
                    .iter()
                    .find(|item| item.id.trim() == profile.id.trim())
                    .map(|item| item.api_key.as_str())
            });
            let api_key = if provider == "openai-codex" {
                String::new()
            } else {
                resolve_api_key(
                    profile.api_key.as_deref(),
                    profile.preserve_existing_api_key,
                    existing_api_key,
                    "LLM profile",
                )?
            };
            if provider != "openai-codex" {
                validate_base_url(&profile.base_url, "LLM base_url")?;
            }
            Ok(ProviderProfile {
                id: profile.id.trim().to_string(),
                label: profile.label.trim().to_string(),
                provider: profile.provider.trim().to_string(),
                model: profile.model.trim().to_string(),
                api_key,
                base_url: if provider == "openai-codex" {
                    None
                } else {
                    profile
                        .base_url
                        .as_ref()
                        .map(|item| item.trim().to_string())
                },
                default_mode: profile
                    .default_mode
                    .as_ref()
                    .map(|item| item.trim().to_string()),
                capabilities: profile.capabilities.clone(),
            })
        })
        .collect::<Result<Vec<_>>>()?;

    let llm = SecondBrainConfig {
        active_profile: payload.llm.active_profile.trim().to_string(),
        profiles: llm_profiles,
    };

    let mode = payload.embeddings.mode.trim().to_lowercase();
    let external = if mode == EMBEDDINGS_MODE_EXTERNAL {
        let profile = payload.embeddings.external.as_ref().ok_or_else(|| {
            AppError::InvalidOperation(
                "Embeddings external profile is required when external mode is selected."
                    .to_string(),
            )
        })?;
        let existing_key = existing_embeddings
            .filter(|item| item.id.trim() == profile.id.trim())
            .map(|item| item.api_key.as_str());
        let api_key = resolve_api_key(
            profile.api_key.as_deref(),
            profile.preserve_existing_api_key,
            existing_key,
            "Embeddings",
        )?;
        validate_base_url(&profile.base_url, "Embeddings base_url")?;
        Some(EmbeddingProviderProfile {
            id: profile.id.trim().to_string(),
            label: profile.label.trim().to_string(),
            provider: profile.provider.trim().to_string(),
            model: profile.model.trim().to_string(),
            api_key,
            base_url: profile
                .base_url
                .as_ref()
                .map(|item| item.trim().to_string()),
        })
    } else {
        None
    };

    let settings = AppSettings {
        llm,
        embeddings: EmbeddingsSettings { mode, external },
        alters: AltersSettings {
            default_mode: payload.alters.default_mode.trim().to_lowercase(),
            show_badge_in_chat: payload.alters.show_badge_in_chat,
            default_influence_intensity: payload
                .alters
                .default_influence_intensity
                .trim()
                .to_lowercase(),
        },
    };
    validate_settings(&settings)?;
    Ok(settings)
}

pub fn load_llm_for_runtime() -> Result<SecondBrainConfig> {
    let settings = read_settings_file()?;
    Ok(settings.llm)
}

pub fn load_embeddings_for_runtime() -> std::result::Result<EmbeddingsSettings, String> {
    match read_settings_file() {
        Ok(settings) => Ok(settings.embeddings),
        Err(AppError::InvalidOperation(message))
            if message.contains("not found (.tomosona/conf.json)") =>
        {
            Ok(EmbeddingsSettings::default())
        }
        Err(err) => Err(err.to_string()),
    }
}

pub fn write_llm_only(config: SecondBrainConfig) -> Result<PathBuf> {
    validate_llm_config(&config).map_err(|message| {
        AppError::InvalidOperation(format!("LLM configuration error: {message}"))
    })?;
    let existing = read_settings_file().ok();
    let settings = AppSettings {
        llm: config,
        embeddings: existing
            .as_ref()
            .map(|item| item.embeddings.clone())
            .unwrap_or_default(),
        alters: existing
            .as_ref()
            .map(|item| item.alters.clone())
            .unwrap_or_default(),
    };
    validate_settings(&settings)?;
    let path = conf_path()?;
    ensure_conf_parent(&path)?;
    let raw = serde_json::to_string_pretty(&settings).map_err(|_| AppError::OperationFailed)?;
    fs::write(&path, format!("{raw}\n"))?;
    Ok(path)
}

#[tauri::command]
pub fn read_app_settings() -> Result<AppSettingsView> {
    let path = conf_path()?;
    if !path.exists() {
        return Ok(AppSettingsView {
            exists: false,
            path: path.to_string_lossy().to_string(),
            llm: None,
            embeddings: redact_embeddings(&EmbeddingsSettings::default()),
            alters: AltersSettings::default(),
        });
    }
    let settings = read_settings_file()?;
    Ok(AppSettingsView {
        exists: true,
        path: path.to_string_lossy().to_string(),
        llm: Some(redact_llm(&settings.llm)),
        embeddings: redact_embeddings(&settings.embeddings),
        alters: settings.alters,
    })
}

#[tauri::command]
pub fn write_app_settings(payload: SaveAppSettingsPayload) -> Result<WriteAppSettingsResult> {
    let existing = read_settings_file().ok();
    let previous_identity = existing
        .as_ref()
        .map(|item| embedding_identity(&item.embeddings))
        .unwrap_or_else(|| embedding_identity(&EmbeddingsSettings::default()));
    let settings = apply_save_payload(payload, existing.as_ref())?;
    let next_identity = embedding_identity(&settings.embeddings);
    let path = conf_path()?;
    ensure_conf_parent(&path)?;
    let raw = serde_json::to_string_pretty(&settings).map_err(|_| AppError::OperationFailed)?;
    fs::write(&path, format!("{raw}\n"))?;
    Ok(WriteAppSettingsResult {
        path: path.to_string_lossy().to_string(),
        embeddings_changed: previous_identity != next_identity,
        alters: settings.alters,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_profile() -> SaveLlmProfileInput {
        SaveLlmProfileInput {
            id: "openai-profile".to_string(),
            label: "OpenAI".to_string(),
            provider: "openai".to_string(),
            model: "gpt-4.1".to_string(),
            api_key: Some("secret".to_string()),
            preserve_existing_api_key: false,
            base_url: None,
            default_mode: Some("freestyle".to_string()),
            capabilities: ProfileCapabilities::default(),
        }
    }

    #[test]
    fn validates_embeddings_provider_allowlist() {
        let settings = AppSettings {
            llm: SecondBrainConfig {
                active_profile: "openai-profile".to_string(),
                profiles: vec![ProviderProfile {
                    id: "openai-profile".to_string(),
                    label: "OpenAI".to_string(),
                    provider: "openai".to_string(),
                    model: "gpt-4.1".to_string(),
                    api_key: "k".to_string(),
                    base_url: None,
                    default_mode: Some("freestyle".to_string()),
                    capabilities: ProfileCapabilities::default(),
                }],
            },
            embeddings: EmbeddingsSettings {
                mode: EMBEDDINGS_MODE_EXTERNAL.to_string(),
                external: Some(EmbeddingProviderProfile {
                    id: "emb".to_string(),
                    label: "Emb".to_string(),
                    provider: "anthropic".to_string(),
                    model: "text-embedding-3-small".to_string(),
                    api_key: "k".to_string(),
                    base_url: None,
                }),
            },
            alters: AltersSettings::default(),
        };
        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn preserve_api_key_requires_existing_or_new() {
        let payload = SaveAppSettingsPayload {
            llm: SaveLlmConfigInput {
                active_profile: "openai-profile".to_string(),
                profiles: vec![SaveLlmProfileInput {
                    api_key: None,
                    preserve_existing_api_key: true,
                    ..base_profile()
                }],
            },
            embeddings: SaveEmbeddingsInput {
                mode: EMBEDDINGS_MODE_INTERNAL.to_string(),
                external: None,
            },
            alters: SaveAltersInput {
                default_mode: ALTER_DEFAULT_MODE_NEUTRAL.to_string(),
                show_badge_in_chat: true,
                default_influence_intensity: ALTER_DEFAULT_INTENSITY_BALANCED.to_string(),
            },
        };
        assert!(apply_save_payload(payload, None).is_err());
    }

    #[test]
    fn embeddings_identity_changes_when_model_changes() {
        let left = EmbeddingsSettings {
            mode: EMBEDDINGS_MODE_EXTERNAL.to_string(),
            external: Some(EmbeddingProviderProfile {
                id: "emb".to_string(),
                label: "Emb".to_string(),
                provider: "openai".to_string(),
                model: "text-embedding-3-small".to_string(),
                api_key: "k".to_string(),
                base_url: None,
            }),
        };
        let right = EmbeddingsSettings {
            mode: EMBEDDINGS_MODE_EXTERNAL.to_string(),
            external: Some(EmbeddingProviderProfile {
                id: "emb".to_string(),
                label: "Emb".to_string(),
                provider: "openai".to_string(),
                model: "text-embedding-3-large".to_string(),
                api_key: "k".to_string(),
                base_url: None,
            }),
        };
        assert_ne!(embedding_identity(&left), embedding_identity(&right));
    }

    #[test]
    fn allows_codex_profile_without_api_key() {
        let payload = SaveAppSettingsPayload {
            llm: SaveLlmConfigInput {
                active_profile: "codex-profile".to_string(),
                profiles: vec![SaveLlmProfileInput {
                    id: "codex-profile".to_string(),
                    label: "OpenAI Codex".to_string(),
                    provider: "openai-codex".to_string(),
                    model: "gpt-5.2-codex".to_string(),
                    api_key: None,
                    preserve_existing_api_key: false,
                    base_url: Some("https://ignored.example".to_string()),
                    default_mode: Some("freestyle".to_string()),
                    capabilities: ProfileCapabilities::default(),
                }],
            },
            embeddings: SaveEmbeddingsInput {
                mode: EMBEDDINGS_MODE_INTERNAL.to_string(),
                external: None,
            },
            alters: SaveAltersInput {
                default_mode: ALTER_DEFAULT_MODE_NEUTRAL.to_string(),
                show_badge_in_chat: true,
                default_influence_intensity: ALTER_DEFAULT_INTENSITY_BALANCED.to_string(),
            },
        };
        let settings = apply_save_payload(payload, None).expect("codex settings");
        assert_eq!(settings.llm.profiles[0].api_key, "");
        assert_eq!(settings.llm.profiles[0].base_url, None);
    }
}
