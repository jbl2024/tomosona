use std::{collections::HashSet, fs, path::PathBuf};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone)]
struct CodexTokens {
    access_token: String,
    id_token: Option<String>,
    account_id: Option<String>,
}

fn parse_codex_cli_tokens(raw: &str) -> Option<CodexTokens> {
    let json: Value = serde_json::from_str(raw).ok()?;
    let tokens = json.get("tokens")?;
    let access_token = tokens.get("access_token")?.as_str()?.trim().to_string();
    if access_token.is_empty() {
        return None;
    }
    let id_token = tokens
        .get("id_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let account_id = tokens
        .get("account_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    Some(CodexTokens {
        access_token,
        id_token,
        account_id,
    })
}

fn load_codex_cli_tokens() -> Option<CodexTokens> {
    let home = std::env::var("HOME").ok()?;
    let path = PathBuf::from(home).join(".codex").join("auth.json");
    let raw = fs::read_to_string(path).ok()?;
    parse_codex_cli_tokens(&raw)
}

pub fn has_codex_tokens() -> bool {
    load_codex_cli_tokens().is_some()
}

fn extract_account_id_from_claims(claims: &Value) -> Option<String> {
    claims
        .get("chatgpt_account_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            claims
                .get("https://api.openai.com/auth")
                .and_then(|value| value.get("chatgpt_account_id"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(ToString::to_string)
        })
        .or_else(|| {
            claims
                .get("organizations")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("id"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(ToString::to_string)
        })
}

fn decode_jwt_payload(payload: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(payload).ok().or_else(|| {
        let padded = match payload.len() % 4 {
            2 => format!("{payload}=="),
            3 => format!("{payload}="),
            _ => payload.to_string(),
        };
        base64::engine::general_purpose::STANDARD
            .decode(padded)
            .ok()
    })
}

fn extract_account_id_from_jwt(jwt: &str) -> Option<String> {
    let mut parts = jwt.split('.');
    let _header = parts.next()?;
    let payload = parts.next()?;
    let decoded = decode_jwt_payload(payload)?;
    let claims: Value = serde_json::from_slice(&decoded).ok()?;
    extract_account_id_from_claims(&claims)
}

fn resolve_account_id(tokens: &CodexTokens) -> Option<String> {
    if let Some(account_id) = tokens.account_id.as_ref() {
        return Some(account_id.clone());
    }
    if let Some(id_token) = tokens.id_token.as_ref() {
        if let Some(account_id) = extract_account_id_from_jwt(id_token) {
            return Some(account_id);
        }
    }
    extract_account_id_from_jwt(&tokens.access_token)
}

fn load_credentials() -> Result<(String, String), String> {
    let tokens = load_codex_cli_tokens().ok_or_else(|| {
        "OpenAI Codex is not authenticated. Run `codex auth login` first.".to_string()
    })?;
    let account_id = resolve_account_id(&tokens).ok_or_else(|| {
        "OpenAI Codex account is missing. Run `codex auth login` again.".to_string()
    })?;
    Ok((tokens.access_token, account_id))
}

#[derive(Debug, Clone, Serialize)]
pub struct CodexDiscoveredModel {
    pub id: String,
    pub display_name: String,
}

const CODEX_MODELS_ENDPOINT: &str = "https://chatgpt.com/backend-api/codex/models";
const CODEX_MODELS_CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");

fn looks_like_model_id(value: &str) -> bool {
    if value.trim().is_empty() || value.len() > 120 {
        return false;
    }
    if value.chars().any(char::is_whitespace) {
        return false;
    }
    value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
}

fn format_model_display_name(model_id: &str) -> String {
    let mut parts = Vec::new();
    for part in model_id.split('-') {
        let item = match part {
            "gpt" => "GPT".to_string(),
            "codex" => "Codex".to_string(),
            "mini" => "Mini".to_string(),
            "max" => "Max".to_string(),
            other => {
                if other.is_empty() {
                    continue;
                }
                let mut chars = other.chars();
                match chars.next() {
                    Some(first) => {
                        let mut chunk = String::new();
                        chunk.push(first.to_ascii_uppercase());
                        chunk.push_str(chars.as_str());
                        chunk
                    }
                    None => continue,
                }
            }
        };
        parts.push(item);
    }
    if parts.is_empty() {
        model_id.to_string()
    } else {
        parts.join(" ")
    }
}

fn normalize_model_display_name(model_id: &str, display_name: Option<&str>) -> String {
    let normalized = display_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(model_id);
    if normalized == model_id {
        return format_model_display_name(model_id);
    }
    normalized.to_string()
}

fn parse_model_entry(entry: &Value) -> Option<CodexDiscoveredModel> {
    let object = entry.as_object()?;
    let model_id = object
        .get("id")
        .or_else(|| object.get("slug"))
        .or_else(|| object.get("model"))
        .and_then(Value::as_str)?;
    if !looks_like_model_id(model_id) {
        return None;
    }
    let display_name = object
        .get("display_name")
        .or_else(|| object.get("displayName"))
        .or_else(|| object.get("name"))
        .or_else(|| object.get("title"))
        .and_then(Value::as_str);
    Some(CodexDiscoveredModel {
        id: model_id.to_string(),
        display_name: normalize_model_display_name(model_id, display_name),
    })
}

fn collect_candidate_items<'a>(value: &'a Value, out: &mut Vec<&'a Value>) {
    match value {
        Value::Array(items) => out.extend(items),
        Value::Object(map) => {
            for key in ["models", "data", "items", "results", "available"] {
                if let Some(nested) = map.get(key) {
                    collect_candidate_items(nested, out);
                }
            }
        }
        _ => {}
    }
}

fn parse_models_payload(payload: &Value) -> Vec<CodexDiscoveredModel> {
    let mut candidates = Vec::new();
    collect_candidate_items(payload, &mut candidates);
    let mut models = Vec::new();
    let mut seen = HashSet::new();
    for item in candidates {
        if let Some(model) = parse_model_entry(item) {
            if seen.insert(model.id.clone()) {
                models.push(model);
            }
        }
    }
    models
}

pub async fn discover_models() -> Result<Vec<CodexDiscoveredModel>, String> {
    let (access_token, account_id) = load_credentials()?;
    let client = reqwest::Client::new();
    let url = format!("{CODEX_MODELS_ENDPOINT}?client_version={CODEX_MODELS_CLIENT_VERSION}");
    let response = client
        .get(url)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("chatgpt-account-id", account_id)
        .header("originator", "pi")
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|_| "OpenAI Codex model discovery failed.".to_string())?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|_| "OpenAI Codex model discovery failed.".to_string())?;
    if !status.is_success() {
        return Err(format!(
            "OpenAI Codex model discovery returned HTTP {status}."
        ));
    }
    let payload: Value = serde_json::from_str(&body)
        .map_err(|_| "OpenAI Codex model discovery returned invalid JSON.".to_string())?;
    let models = parse_models_payload(&payload);
    if models.is_empty() {
        return Err("OpenAI Codex model discovery returned no models.".to_string());
    }
    Ok(models)
}

fn codex_request_body(
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    temperature: Option<f64>,
) -> Value {
    let mut body = serde_json::json!({
        "model": model,
        "stream": true,
        "store": false,
        "instructions": system_prompt,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": user_prompt}
                ]
            }
        ],
        "text": {"verbosity": "medium"},
        "include": ["reasoning.encrypted_content"]
    });
    if let Some(temperature) = temperature {
        body["temperature"] = serde_json::json!(temperature);
    }
    body
}

async fn post_codex_request(
    access_token: &str,
    account_id: &str,
    body: &Value,
) -> Result<reqwest::Response, String> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://chatgpt.com/backend-api/codex/responses")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("chatgpt-account-id", account_id)
        .header("OpenAI-Beta", "responses=experimental")
        .header("originator", "pi")
        .header("content-type", "application/json")
        .json(body)
        .send()
        .await
        .map_err(|_| "OpenAI Codex request failed.".to_string())?;

    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let message = response.text().await.unwrap_or_default();
    if message.trim().is_empty() {
        Err(format!("OpenAI Codex returned HTTP {status}."))
    } else {
        Err(format!("OpenAI Codex returned HTTP {status}: {message}"))
    }
}

fn parse_sse_line(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    trimmed.strip_prefix("data: ")
}

async fn stream_codex_text<F>(
    response: reqwest::Response,
    mut on_chunk: F,
) -> Result<String, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full_text = String::new();

    while let Some(next) = stream.next().await {
        let bytes = next.map_err(|_| "OpenAI Codex stream failed.".to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(position) = buffer.find('\n') {
            let line = buffer[..position].to_string();
            buffer = buffer[position + 1..].to_string();

            let Some(data) = parse_sse_line(&line) else {
                continue;
            };
            if data == "[DONE]" {
                return Ok(full_text);
            }

            let event: Value = match serde_json::from_str(data) {
                Ok(value) => value,
                Err(_) => continue,
            };
            match event
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                "response.output_text.delta" => {
                    if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                        if !delta.is_empty() {
                            full_text.push_str(delta);
                            on_chunk(delta)?;
                        }
                    }
                }
                "error" | "response.failed" => {
                    let message = event
                        .get("error")
                        .and_then(|value| value.get("message"))
                        .and_then(Value::as_str)
                        .or_else(|| event.get("message").and_then(Value::as_str))
                        .unwrap_or("OpenAI Codex returned an error.");
                    return Err(message.to_string());
                }
                "response.completed" => return Ok(full_text),
                _ => {}
            }
        }
    }

    Ok(full_text)
}

pub async fn run_codex(
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    temperature: Option<f64>,
) -> Result<String, String> {
    run_codex_stream(model, system_prompt, user_prompt, temperature, |_| Ok(())).await
}

pub async fn run_codex_stream<F>(
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    temperature: Option<f64>,
    on_chunk: F,
) -> Result<String, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    let (access_token, account_id) = load_credentials()?;
    let body = codex_request_body(model, system_prompt, user_prompt, temperature);
    let response = post_codex_request(&access_token, &account_id, &body).await?;
    let full_text = stream_codex_text(response, on_chunk).await?;
    let trimmed = full_text.trim();
    if trimmed.is_empty() {
        Ok("(Empty assistant response)".to_string())
    } else {
        Ok(full_text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_codex_tokens_full() {
        let raw = r#"{
            "tokens": {
                "access_token": "access",
                "id_token": "idtoken",
                "account_id": "acct",
                "refresh_token": "ignored"
            }
        }"#;
        let parsed = parse_codex_cli_tokens(raw).expect("tokens");
        assert_eq!(parsed.access_token, "access");
        assert_eq!(parsed.id_token.as_deref(), Some("idtoken"));
        assert_eq!(parsed.account_id.as_deref(), Some("acct"));
    }

    #[test]
    fn parse_codex_tokens_minimal() {
        let raw = r#"{"tokens":{"access_token":"access-only"}}"#;
        let parsed = parse_codex_cli_tokens(raw).expect("tokens");
        assert_eq!(parsed.access_token, "access-only");
        assert!(parsed.id_token.is_none());
        assert!(parsed.account_id.is_none());
    }

    #[test]
    fn parse_codex_tokens_invalid() {
        assert!(parse_codex_cli_tokens("not-json").is_none());
        assert!(parse_codex_cli_tokens(r#"{"tokens":{}}"#).is_none());
        assert!(parse_codex_cli_tokens(r#"{"tokens":{"access_token":""}}"#).is_none());
    }

    #[test]
    fn extract_account_id_prefers_root_then_nested_then_org() {
        let claims_root: Value = serde_json::from_str(r#"{"chatgpt_account_id":"root"}"#).unwrap();
        let claims_nested: Value = serde_json::from_str(
            r#"{"https://api.openai.com/auth":{"chatgpt_account_id":"nested"}}"#,
        )
        .unwrap();
        let claims_org: Value =
            serde_json::from_str(r#"{"organizations":[{"id":"org"}]}"#).unwrap();
        assert_eq!(
            extract_account_id_from_claims(&claims_root),
            Some("root".to_string())
        );
        assert_eq!(
            extract_account_id_from_claims(&claims_nested),
            Some("nested".to_string())
        );
        assert_eq!(
            extract_account_id_from_claims(&claims_org),
            Some("org".to_string())
        );
    }

    #[test]
    fn parse_sse_line_works() {
        assert_eq!(parse_sse_line("data: hello"), Some("hello"));
        assert_eq!(parse_sse_line("event: x"), None);
        assert_eq!(parse_sse_line(""), None);
    }

    #[test]
    fn parse_models_payload_reads_models_array() {
        let payload = serde_json::json!({
            "models": [
                {"id": "gpt-5.3-codex", "name": "GPT-5.3 Codex"},
                {"slug": "gpt-5.2-codex"}
            ]
        });
        let models = parse_models_payload(&payload);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gpt-5.3-codex");
        assert_eq!(models[1].id, "gpt-5.2-codex");
    }

    #[test]
    fn parse_models_payload_dedupes_and_filters_invalid() {
        let payload = serde_json::json!({
            "data": {
                "items": [
                    {"id": "gpt-5.2-codex"},
                    {"id": "gpt-5.2-codex"},
                    {"id": "bad model id"}
                ]
            }
        });
        let models = parse_models_payload(&payload);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-5.2-codex");
    }

    #[test]
    fn codex_request_body_includes_temperature_when_provided() {
        let body = codex_request_body("gpt-5.2-codex", "system", "user", Some(0.15));
        assert_eq!(body.get("temperature"), Some(&serde_json::json!(0.15)));
    }

    #[test]
    fn codex_request_body_omits_temperature_when_missing() {
        let body = codex_request_body("gpt-5.2-codex", "system", "user", None);
        assert!(body.get("temperature").is_none());
    }
}
