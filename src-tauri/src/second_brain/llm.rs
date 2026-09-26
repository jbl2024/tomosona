use futures_util::StreamExt;
use genai::{
	chat::{ChatMessage, ChatOptions, ChatRequest, ChatStreamEvent, MessageContent},
	resolver::{AuthData, Endpoint, ServiceTargetResolver},
	Client,
	ServiceTarget,
};

use super::config::ProviderProfile;
use super::openai_codex::{run_codex, run_codex_stream};

fn is_openai_codex(profile: &ProviderProfile) -> bool {
	profile.provider.trim().eq_ignore_ascii_case("openai-codex")
}

fn is_openai_compatible_provider(profile: &ProviderProfile) -> bool {
	let provider = profile.provider.trim().to_lowercase();
	if provider == "openai" || provider == "openai_compatible" || provider == "custom" {
		return true;
	}

	let is_native_provider = matches!(
		provider.as_str(),
		"openai-codex"
			| "anthropic"
			| "gemini"
			| "groq"
			| "xai"
			| "ollama"
			| "deepseek"
			| "cohere"
			| "fireworks"
			| "nebius"
			| "mimo"
			| "zai"
			| "bigmodel"
	);
	if is_native_provider {
		return false;
	}

	profile
		.base_url
		.as_deref()
		.map(str::trim)
		.map(|value| !value.is_empty())
		.unwrap_or(false)
}

fn llm_log(event: &str, profile: &ProviderProfile, detail: &str) {
	let provider = profile.provider.trim();
	let model = profile.model.trim();
	let profile_id = profile.id.trim();
    let base_url = profile
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("-");
    eprintln!(
        "[second-brain/llm] event={event} provider={provider} model={model} profile_id={profile_id} base_url={base_url} detail={detail}"
	);
}

fn normalize_model_name(profile: &ProviderProfile) -> String {
	let model = profile.model.trim();
	if model.contains("::") {
		return model.to_string();
	}

	if is_openai_compatible_provider(profile) {
		format!("openai::{model}")
	} else {
		let provider = profile.provider.trim().to_lowercase();
		match provider.as_str() {
			"anthropic" => format!("anthropic::{model}"),
			"gemini" => format!("gemini::{model}"),
			"groq" => format!("groq::{model}"),
			"xai" => format!("xai::{model}"),
			"ollama" => format!("ollama::{model}"),
			_ => model.to_string(),
		}
	}
}

fn build_client(profile: &ProviderProfile) -> Client {
	let api_key = profile.api_key.trim().to_string();
	let base_url = profile
		.base_url
		.as_deref()
		.map(str::trim)
		.filter(|value| !value.is_empty())
		.map(ToOwned::to_owned);

	let service_target_resolver = ServiceTargetResolver::from_resolver_fn(
		move |mut service_target: ServiceTarget| -> Result<ServiceTarget, genai::resolver::Error> {
			service_target.auth = AuthData::from_single(api_key.clone());
			if let Some(base_url) = &base_url {
				service_target.endpoint = Endpoint::from_owned(base_url.clone());
			}
			Ok(service_target)
		},
	);

	Client::builder()
		.with_service_target_resolver(service_target_resolver)
		.build()
}

fn chat_options_for_temperature(temperature: f64, capture_content: bool) -> ChatOptions {
    let mut options = ChatOptions::default().with_temperature(temperature);
    if capture_content {
        options = options.with_capture_content(true);
    }
    options
}

fn apply_profile_system_prompt(profile: &ProviderProfile, system_prompt: &str) -> String {
    let global = profile.system_prompt.trim();
    if global.is_empty() {
        return system_prompt.to_string();
    }
    let local = system_prompt.trim();
    if local.is_empty() {
        return global.to_string();
    }
    format!("{global}\n\n{local}")
}

/// Runs a single Second Brain LLM request.
///
/// Callers pass an optional temperature for provider configuration.
/// without changing the provider default for other generation paths.
pub async fn run_llm(
	profile: &ProviderProfile,
	system_prompt: &str,
	user_prompt: &str,
	temperature: Option<f64>,
) -> Result<String, String> {
	let effective_temperature = temperature.unwrap_or(profile.default_temperature);
    let effective_system_prompt = apply_profile_system_prompt(profile, system_prompt);
	if is_openai_codex(profile) {
		return run_codex(
			&profile.model,
            &effective_system_prompt,
			user_prompt,
			Some(effective_temperature),
		)
		.await;
	}

	let model = normalize_model_name(profile);
	let client = build_client(profile);

	let messages = vec![
        ChatMessage::system(MessageContent::from(effective_system_prompt)),
		ChatMessage::user(MessageContent::from(user_prompt)),
    ];

    let request = ChatRequest::new(messages);
    let chat_options = Some(chat_options_for_temperature(effective_temperature, false));
    match client
        .exec_chat(&model, request, chat_options.as_ref())
        .await
    {
        Ok(response) => {
            let text = response
                .first_text()
                .map(str::trim)
                .unwrap_or("")
                .to_string();
            let final_text = if text.is_empty() {
                "(Empty assistant response)".to_string()
            } else {
                text
            };
            Ok(final_text)
        }
        Err(err) => {
            let message = format!("Model request failed: {err}");
            llm_log("request_error", profile, &message);
            Err(message)
        }
    }
}

/// Runs a streaming Second Brain LLM request.
///
/// The optional temperature follows the same rules as [`run_llm`].
pub async fn run_llm_stream<F>(
	profile: &ProviderProfile,
	system_prompt: &str,
	user_prompt: &str,
	temperature: Option<f64>,
    mut on_chunk: F,
) -> Result<String, String>
where
	F: FnMut(&str) -> Result<(), String>,
{
	let effective_temperature = temperature.unwrap_or(profile.default_temperature);
    let effective_system_prompt = apply_profile_system_prompt(profile, system_prompt);
	if is_openai_codex(profile) {
		return run_codex_stream(
			&profile.model,
            &effective_system_prompt,
			user_prompt,
			Some(effective_temperature),
			on_chunk,
		)
		.await;
	}

	let model = normalize_model_name(profile);
	let client = build_client(profile);

    let messages = vec![
        ChatMessage::system(MessageContent::from(effective_system_prompt)),
        ChatMessage::user(MessageContent::from(user_prompt)),
    ];

    let request = ChatRequest::new(messages);
    let options = Some(chat_options_for_temperature(effective_temperature, true));
    let mut response = client
        .exec_chat_stream(&model, request, options.as_ref())
        .await
        .map_err(|err| {
            let message = format!("Model request failed: {err}");
            llm_log("stream_start_error", profile, &message);
            message
        })?;

    let mut full_text = String::new();
    while let Some(next) = response.stream.next().await {
        match next {
            Ok(ChatStreamEvent::Chunk(chunk)) => {
                if !chunk.content.is_empty() {
                    full_text.push_str(&chunk.content);
                    on_chunk(&chunk.content)?;
                }
            }
            Ok(ChatStreamEvent::End(end)) => {
                if full_text.trim().is_empty() {
                    if let Some(captured) = end.captured_first_text() {
                        full_text = captured.to_string();
                    }
                }
            }
            Ok(_) => {}
            Err(err) => {
                let message = format!("Model stream failed: {err}");
                llm_log("stream_error", profile, &message);
                return Err(message);
            }
        }
    }

    if full_text.trim().is_empty() {
        Ok("(Empty assistant response)".to_string())
    } else {
        Ok(full_text)
    }
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn normalizes_openai_compatible_model() {
        let profile = ProviderProfile {
            id: "p1".to_string(),
            label: "Local".to_string(),
            provider: "openai_compatible".to_string(),
            model: "gpt-oss".to_string(),
            api_key: "x".to_string(),
            default_temperature: 0.15,
            system_prompt: String::new(),
            base_url: Some("http://localhost:11434/v1".to_string()),
            default_mode: None,
            capabilities: Default::default(),
		};
		assert_eq!(normalize_model_name(&profile), "openai::gpt-oss");
	}

	#[test]
	fn normalizes_custom_provider_model() {
		let profile = ProviderProfile {
			id: "p1".to_string(),
			label: "Custom".to_string(),
			provider: "custom".to_string(),
			model: "openweight-medium".to_string(),
			api_key: "x".to_string(),
			default_temperature: 0.15,
            system_prompt: String::new(),
			base_url: Some("https://albert.api.etalab.gouv.fr/v1/".to_string()),
			default_mode: None,
			capabilities: Default::default(),
		};
		assert_eq!(normalize_model_name(&profile), "openai::openweight-medium");
	}

	#[test]
	fn detects_codex_provider_case_insensitive() {
		let profile = ProviderProfile {
            id: "p1".to_string(),
            label: "Codex".to_string(),
            provider: "OpenAI-Codex".to_string(),
            model: "gpt-5.2-codex".to_string(),
            api_key: String::new(),
            default_temperature: 0.15,
            system_prompt: String::new(),
            base_url: None,
            default_mode: None,
            capabilities: Default::default(),
        };
        assert!(is_openai_codex(&profile));
    }

    #[test]
	fn keeps_non_codex_provider_out_of_codex_path() {
		let profile = ProviderProfile {
			id: "p1".to_string(),
			label: "OpenAI".to_string(),
			provider: "openai".to_string(),
            model: "gpt-4.1".to_string(),
            api_key: "x".to_string(),
            default_temperature: 0.15,
            system_prompt: String::new(),
            base_url: None,
            default_mode: None,
            capabilities: Default::default(),
		};
		assert!(!is_openai_codex(&profile));
	}

	#[test]
	fn builds_client_with_custom_base_url() {
		let profile = ProviderProfile {
			id: "p1".to_string(),
			label: "Custom".to_string(),
			provider: "custom".to_string(),
			model: "openweight-medium".to_string(),
			api_key: "secret".to_string(),
			default_temperature: 0.15,
            system_prompt: String::new(),
			base_url: Some("https://albert.api.etalab.gouv.fr/v1/".to_string()),
			default_mode: None,
			capabilities: Default::default(),
		};
		let client = build_client(&profile);
		let target = tauri::async_runtime::block_on(async {
			client.resolve_service_target("openweight-medium").await
		})
		.expect("resolve target");
		assert_eq!(
			target.endpoint.base_url(),
			"https://albert.api.etalab.gouv.fr/v1/"
		);
	}

	#[test]
	fn builds_chat_options_with_temperature() {
		let options = chat_options_for_temperature(0.42, true);
		assert_eq!(options.temperature, Some(0.42));
	}

    #[test]
    fn prepends_profile_system_prompt_to_local_system_prompt() {
        let profile = ProviderProfile {
            id: "p1".to_string(),
            label: "OpenAI".to_string(),
            provider: "openai".to_string(),
            model: "gpt-4.1".to_string(),
            api_key: "x".to_string(),
            default_temperature: 0.15,
            system_prompt: "Global instruction.".to_string(),
            base_url: None,
            default_mode: None,
            capabilities: Default::default(),
        };

        assert_eq!(
            apply_profile_system_prompt(&profile, "Local instruction."),
            "Global instruction.\n\nLocal instruction."
        );
    }
}
