use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProfileCapabilities {
    #[serde(default = "default_true")]
    pub text: bool,
    #[serde(default)]
    pub image_input: bool,
    #[serde(default)]
    pub audio_input: bool,
    #[serde(default)]
    pub tool_calling: bool,
    #[serde(default = "default_true")]
    pub streaming: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderProfile {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub model: String,
    pub api_key: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub default_mode: Option<String>,
    #[serde(default)]
    pub capabilities: ProfileCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecondBrainConfig {
    pub active_profile: String,
    pub profiles: Vec<ProviderProfile>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigStatus {
    pub configured: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub profile_id: Option<String>,
    pub supports_streaming: bool,
    pub supports_image_input: bool,
    pub supports_audio_input: bool,
    pub error: Option<String>,
}

fn default_true() -> bool {
    true
}

pub fn validate_config(config: &SecondBrainConfig) -> Result<(), String> {
    if config.active_profile.trim().is_empty() {
        return Err("active_profile is required.".to_string());
    }
    if config.profiles.is_empty() {
        return Err("profiles must not be empty.".to_string());
    }
    for profile in &config.profiles {
        if profile.id.trim().is_empty() {
            return Err("profile.id is required.".to_string());
        }
        if profile.provider.trim().is_empty() {
            return Err("profile.provider is required.".to_string());
        }
        if profile.model.trim().is_empty() {
            return Err("profile.model is required.".to_string());
        }
        let provider = profile.provider.trim().to_lowercase();
        if provider != "openai-codex" && profile.api_key.trim().is_empty() {
            return Err("profile.api_key is required.".to_string());
        }
        if let Some(base_url) = &profile.base_url {
            let trimmed = base_url.trim();
            if !trimmed.is_empty()
                && !trimmed.starts_with("http://")
                && !trimmed.starts_with("https://")
            {
                return Err("profile.base_url must be http(s).".to_string());
            }
        }
    }

    if config
        .profiles
        .iter()
        .all(|profile| profile.id.trim() != config.active_profile.trim())
    {
        return Err("active_profile was not found in profiles.".to_string());
    }

    Ok(())
}

pub fn active_profile<'a>(config: &'a SecondBrainConfig) -> Option<&'a ProviderProfile> {
    let active = config.active_profile.trim();
    config.profiles.iter().find(|item| item.id.trim() == active)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_config() -> SecondBrainConfig {
        SecondBrainConfig {
            active_profile: "p1".to_string(),
            profiles: vec![ProviderProfile {
                id: "p1".to_string(),
                label: "Primary".to_string(),
                provider: "openai_compatible".to_string(),
                model: "gpt-oss".to_string(),
                api_key: "abc".to_string(),
                base_url: Some("http://localhost:11434/v1".to_string()),
                default_mode: Some("freestyle".to_string()),
                capabilities: ProfileCapabilities::default(),
            }],
        }
    }

    #[test]
    fn validates_ok_config() {
        let config = base_config();
        assert!(validate_config(&config).is_ok());
    }

    #[test]
    fn fails_on_missing_active_profile_match() {
        let mut config = base_config();
        config.active_profile = "missing".to_string();
        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn fails_on_invalid_base_url() {
        let mut config = base_config();
        config.profiles[0].base_url = Some("ftp://localhost".to_string());
        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn allows_codex_without_api_key() {
        let config = SecondBrainConfig {
            active_profile: "codex".to_string(),
            profiles: vec![ProviderProfile {
                id: "codex".to_string(),
                label: "Codex".to_string(),
                provider: "openai-codex".to_string(),
                model: "gpt-5.2-codex".to_string(),
                api_key: "".to_string(),
                base_url: None,
                default_mode: Some("freestyle".to_string()),
                capabilities: ProfileCapabilities::default(),
            }],
        };
        assert!(validate_config(&config).is_ok());
    }

    #[test]
    fn requires_api_key_for_non_codex() {
        let mut config = base_config();
        config.profiles[0].provider = "openai".to_string();
        config.profiles[0].api_key = String::new();
        assert!(validate_config(&config).is_err());
    }
}
