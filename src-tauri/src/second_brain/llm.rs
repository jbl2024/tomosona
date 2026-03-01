use genai::{
    chat::{ChatMessage, ChatRequest, MessageContent},
    Client,
};

use super::config::ProviderProfile;

pub struct LlmAnswer {
    pub full_text: String,
    pub chunks: Vec<String>,
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

fn chunk_text(text: &str, chunk_size: usize) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut buffer = String::with_capacity(chunk_size);
    for ch in text.chars() {
        buffer.push(ch);
        if buffer.len() >= chunk_size {
            chunks.push(buffer.clone());
            buffer.clear();
        }
    }
    if !buffer.is_empty() {
        chunks.push(buffer);
    }
    chunks
}

pub async fn run_llm(
    profile: &ProviderProfile,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<LlmAnswer, String> {
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
            Ok(LlmAnswer {
                chunks: chunk_text(&final_text, 56),
                full_text: final_text,
            })
        }
        Err(err) => Err(format!("Model request failed: {err}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_text_non_empty() {
        let out = chunk_text("abcdefghij", 3);
        assert_eq!(out, vec!["abc", "def", "ghi", "j"]);
    }

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
