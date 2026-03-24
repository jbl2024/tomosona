use futures_util::StreamExt;
use genai::{
    chat::{ChatMessage, ChatOptions, ChatRequest, ChatStreamEvent, MessageContent},
    Client,
};

use super::config::ProviderProfile;
use super::openai_codex::{run_codex, run_codex_stream};

fn is_openai_codex(profile: &ProviderProfile) -> bool {
    profile.provider.trim().eq_ignore_ascii_case("openai-codex")
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
    let provider = profile.provider.trim().to_lowercase();
    let model = profile.model.trim();
    if model.contains("::") {
        return model.to_string();
    }

    match provider.as_str() {
        "openai" => format!("openai::{model}"),
        "anthropic" => format!("anthropic::{model}"),
        "gemini" => format!("gemini::{model}"),
        "groq" => format!("groq::{model}"),
        "xai" => format!("xai::{model}"),
        "ollama" => format!("ollama::{model}"),
        "openai_compatible" => format!("openai::{model}"),
        _ => model.to_string(),
    }
}

fn configure_environment(profile: &ProviderProfile) {
    let provider = profile.provider.trim().to_lowercase();
    let key = profile.api_key.trim();

    match provider.as_str() {
        "anthropic" => std::env::set_var("ANTHROPIC_API_KEY", key),
        "gemini" => std::env::set_var("GEMINI_API_KEY", key),
        "groq" => std::env::set_var("GROQ_API_KEY", key),
        "xai" => std::env::set_var("XAI_API_KEY", key),
        "ollama" => std::env::set_var("OLLAMA_API_KEY", key),
        _ => std::env::set_var("OPENAI_API_KEY", key),
    }

    if let Some(base_url) = &profile.base_url {
        let trimmed = base_url.trim();
        if !trimmed.is_empty() {
            std::env::set_var("OPENAI_BASE_URL", trimmed);
        }
    }
}

fn chat_options_for_temperature(temperature: f64, capture_content: bool) -> ChatOptions {
    let mut options = ChatOptions::default().with_temperature(temperature);
    if capture_content {
        options = options.with_capture_content(true);
    }
    options
}

/// Runs a single Second Brain LLM request.
///
/// Callers pass an optional temperature so alter-scoped tuning can be applied
/// without changing the provider default for other generation paths.
pub async fn run_llm(
    profile: &ProviderProfile,
    system_prompt: &str,
    user_prompt: &str,
    temperature: Option<f64>,
) -> Result<String, String> {
    if is_openai_codex(profile) {
        return run_codex(&profile.model, system_prompt, user_prompt, temperature).await;
    }

    configure_environment(profile);

    let model = normalize_model_name(profile);
    let client = Client::default();

    let messages = vec![
        ChatMessage::system(MessageContent::from(system_prompt)),
        ChatMessage::user(MessageContent::from(user_prompt)),
    ];

    let request = ChatRequest::new(messages);
    let chat_options = temperature.map(|value| chat_options_for_temperature(value, false));
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
    if is_openai_codex(profile) {
        return run_codex_stream(
            &profile.model,
            system_prompt,
            user_prompt,
            temperature,
            on_chunk,
        )
        .await;
    }

    configure_environment(profile);

    let model = normalize_model_name(profile);
    let client = Client::default();

    let messages = vec![
        ChatMessage::system(MessageContent::from(system_prompt)),
        ChatMessage::user(MessageContent::from(user_prompt)),
    ];

    let request = ChatRequest::new(messages);
    let options = temperature.map(|value| chat_options_for_temperature(value, true));
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
            base_url: Some("http://localhost:11434/v1".to_string()),
            default_mode: None,
            capabilities: Default::default(),
        };
        assert_eq!(normalize_model_name(&profile), "openai::gpt-oss");
    }

    #[test]
    fn detects_codex_provider_case_insensitive() {
        let profile = ProviderProfile {
            id: "p1".to_string(),
            label: "Codex".to_string(),
            provider: "OpenAI-Codex".to_string(),
            model: "gpt-5.2-codex".to_string(),
            api_key: String::new(),
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
            base_url: None,
            default_mode: None,
            capabilities: Default::default(),
        };
        assert!(!is_openai_codex(&profile));
    }

    #[test]
    fn builds_chat_options_with_temperature() {
        let options = chat_options_for_temperature(0.42, true);
        assert_eq!(options.temperature, Some(0.42));
    }
}
