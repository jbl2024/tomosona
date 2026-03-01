use genai::{
    chat::{ChatMessage, ChatOptions, ChatRequest, ChatStreamEvent, MessageContent},
    Client,
};
use futures_util::StreamExt;

use super::config::ProviderProfile;

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

pub async fn run_llm(
    profile: &ProviderProfile,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    configure_environment(profile);

    let model = normalize_model_name(profile);
    let client = Client::default();

    let messages = vec![
        ChatMessage::system(MessageContent::from(system_prompt)),
        ChatMessage::user(MessageContent::from(user_prompt)),
    ];

    let request = ChatRequest::new(messages);
    match client.exec_chat(&model, request, None).await {
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
        Err(err) => Err(format!("Model request failed: {err}")),
    }
}

pub async fn run_llm_stream<F>(
    profile: &ProviderProfile,
    system_prompt: &str,
    user_prompt: &str,
    mut on_chunk: F,
) -> Result<String, String>
where
    F: FnMut(&str),
{
    configure_environment(profile);

    let model = normalize_model_name(profile);
    let client = Client::default();

    let messages = vec![
        ChatMessage::system(MessageContent::from(system_prompt)),
        ChatMessage::user(MessageContent::from(user_prompt)),
    ];

    let request = ChatRequest::new(messages);
    let options = ChatOptions::default().with_capture_content(true);
    let mut response = client
        .exec_chat_stream(&model, request, Some(&options))
        .await
        .map_err(|err| format!("Model request failed: {err}"))?;

    let mut full_text = String::new();
    while let Some(next) = response.stream.next().await {
        match next {
            Ok(ChatStreamEvent::Chunk(chunk)) => {
                if !chunk.content.is_empty() {
                    full_text.push_str(&chunk.content);
                    on_chunk(&chunk.content);
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
            Err(err) => return Err(format!("Model stream failed: {err}")),
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
}
