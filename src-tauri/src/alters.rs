//! Workspace-scoped Alters file persistence and prompt compilation.

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use atomicwrites::{AllowOverwrite, AtomicFile, DisallowOverwrite};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::second_brain::config::active_profile;
use crate::second_brain::llm::run_llm;
use crate::settings;
use crate::{
    ensure_index_schema, next_index_run_id, normalize_workspace_relative_from_input, now_ms,
    open_db, workspace_runtime::active_workspace_root, AppError, Result,
};

const ALTER_PREFIX: &str = "alter";
pub const ALTER_DEFAULT_TEMPERATURE: f64 = 0.15;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlterInspirationSourceType {
    Manual,
    Template,
    ReferenceFigure,
    Note,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterInspiration {
    pub id: String,
    pub label: String,
    pub source_type: AlterInspirationSourceType,
    pub weight: Option<f64>,
    pub reference_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterStyle {
    pub tone: String,
    pub verbosity: String,
    #[serde(default = "default_alter_temperature")]
    pub temperature: f64,
    pub contradiction_level: i64,
    pub exploration_level: i64,
    pub influence_intensity: String,
    pub response_style: String,
    pub cite_hypotheses: bool,
    pub signal_biases: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterRecord {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub category: Option<String>,
    pub mission: String,
    pub inspirations: Vec<AlterInspiration>,
    pub principles: Vec<String>,
    pub reflexes: Vec<String>,
    pub values: Vec<String>,
    pub critiques: Vec<String>,
    pub blind_spots: Vec<String>,
    pub system_hints: Vec<String>,
    pub style: AlterStyle,
    pub invocation_prompt: String,
    pub is_favorite: bool,
    pub is_built_in: bool,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlterSummary {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub category: Option<String>,
    pub mission: String,
    pub is_favorite: bool,
    pub is_built_in: bool,
    pub revision_count: usize,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlterRevisionSummary {
    pub revision_id: String,
    pub alter_id: String,
    pub created_at_ms: u64,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterRevisionPayload {
    pub revision_id: String,
    pub alter_id: String,
    pub created_at_ms: u64,
    pub reason: Option<String>,
    #[serde(flatten)]
    pub alter: AlterRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAlterPayload {
    pub name: String,
    pub description: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub category: Option<String>,
    pub mission: String,
    pub inspirations: Vec<AlterInspiration>,
    pub principles: Vec<String>,
    pub reflexes: Vec<String>,
    pub values: Vec<String>,
    pub critiques: Vec<String>,
    pub blind_spots: Vec<String>,
    pub system_hints: Vec<String>,
    pub style: AlterStyle,
    pub is_favorite: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateAlterPayload {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub category: Option<String>,
    pub mission: String,
    pub inspirations: Vec<AlterInspiration>,
    pub principles: Vec<String>,
    pub reflexes: Vec<String>,
    pub values: Vec<String>,
    pub critiques: Vec<String>,
    pub blind_spots: Vec<String>,
    pub system_hints: Vec<String>,
    pub style: AlterStyle,
    pub is_favorite: bool,
    pub revision_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PreviewAlterPayload {
    pub draft: CreateAlterPayload,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateAlterDraftPayload {
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreviewAlterResult {
    pub invocation_prompt: String,
    pub preview_prompt: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GeneratedAlterDraft {
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub category: Option<String>,
    pub mission: Option<String>,
    #[serde(default)]
    pub inspirations: Vec<GeneratedAlterInspiration>,
    #[serde(default)]
    pub principles: Vec<String>,
    #[serde(default)]
    pub reflexes: Vec<String>,
    #[serde(default)]
    pub values: Vec<String>,
    #[serde(default)]
    pub critiques: Vec<String>,
    #[serde(default)]
    pub blind_spots: Vec<String>,
    #[serde(default)]
    pub system_hints: Vec<String>,
    pub style: Option<GeneratedAlterStyle>,
    pub is_favorite: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
struct GeneratedAlterInspiration {
    pub label: Option<String>,
    pub source_type: Option<String>,
    pub weight: Option<f64>,
    pub reference_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct GeneratedAlterStyle {
    pub tone: Option<String>,
    pub verbosity: Option<String>,
    pub temperature: Option<f64>,
    pub contradiction_level: Option<i64>,
    pub exploration_level: Option<i64>,
    pub influence_intensity: Option<String>,
    pub response_style: Option<String>,
    pub cite_hypotheses: Option<bool>,
    pub signal_biases: Option<bool>,
}

fn next_id(prefix: &str) -> String {
    format!("{prefix}-{}-{}", now_ms(), next_index_run_id())
}

fn empty_to_none(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn default_alter_temperature() -> f64 {
    ALTER_DEFAULT_TEMPERATURE
}

fn sanitize_lines(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn default_style() -> AlterStyle {
    AlterStyle {
        tone: "strategic".to_string(),
        verbosity: "medium".to_string(),
        temperature: ALTER_DEFAULT_TEMPERATURE,
        contradiction_level: 55,
        exploration_level: 60,
        influence_intensity: "balanced".to_string(),
        response_style: "analytic".to_string(),
        cite_hypotheses: true,
        signal_biases: true,
    }
}

fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in name.trim().chars() {
        let next = if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
        } else {
            '-'
        };
        if next == '-' {
            if last_dash || slug.is_empty() {
                continue;
            }
            last_dash = true;
            slug.push('-');
            continue;
        }
        last_dash = false;
        slug.push(next);
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "alter".to_string()
    } else {
        slug
    }
}

fn normalize_generated_source_type(raw: Option<&str>) -> AlterInspirationSourceType {
    match raw.unwrap_or("").trim().to_lowercase().as_str() {
        "template" => AlterInspirationSourceType::Template,
        "reference_figure" | "reference figure" => AlterInspirationSourceType::ReferenceFigure,
        "note" => AlterInspirationSourceType::Note,
        _ => AlterInspirationSourceType::Manual,
    }
}

fn extract_json_object(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (offset, ch) in raw[start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    let end = start + offset + ch.len_utf8();
                    return Some(&raw[start..end]);
                }
            }
            _ => {}
        }
    }

    None
}

fn fallback_name_from_prompt(prompt: &str) -> String {
    let compact = prompt
        .split_whitespace()
        .take(5)
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if compact.is_empty() {
        "Generated Alter".to_string()
    } else {
        compact
    }
}

fn normalize_generated_draft(parsed: GeneratedAlterDraft, prompt: &str) -> CreateAlterPayload {
    let fallback_name = fallback_name_from_prompt(prompt);
    let fallback_mission = format!(
        "When invoked, analyze requests using this intent: {}",
        prompt.trim()
    );
    let style = parsed.style.unwrap_or(GeneratedAlterStyle {
        tone: None,
        verbosity: None,
        temperature: None,
        contradiction_level: None,
        exploration_level: None,
        influence_intensity: None,
        response_style: None,
        cite_hypotheses: None,
        signal_biases: None,
    });
    let defaults = default_style();

    CreateAlterPayload {
        name: parsed.name.unwrap_or(fallback_name).trim().to_string(),
        description: parsed
            .description
            .unwrap_or_else(|| "Generated from a quick-start brief.".to_string())
            .trim()
            .to_string(),
        icon: parsed.icon.and_then(|value| empty_to_none(Some(value))),
        color: parsed
            .color
            .and_then(|value| empty_to_none(Some(value)))
            .or(Some("#8d6e63".to_string())),
        category: parsed.category.and_then(|value| empty_to_none(Some(value))),
        mission: parsed
            .mission
            .unwrap_or(fallback_mission)
            .trim()
            .to_string(),
        inspirations: parsed
            .inspirations
            .into_iter()
            .filter_map(|item| {
                let label = item.label.unwrap_or_default().trim().to_string();
                if label.is_empty() {
                    return None;
                }
                let reference_id = item
                    .reference_id
                    .and_then(|value| empty_to_none(Some(value)));
                let source_type = normalize_generated_source_type(item.source_type.as_deref());
                let safe_source_type = if matches!(source_type, AlterInspirationSourceType::Note)
                    && reference_id.is_none()
                {
                    AlterInspirationSourceType::Manual
                } else {
                    source_type
                };
                Some(AlterInspiration {
                    id: String::new(),
                    label,
                    source_type: safe_source_type,
                    weight: item.weight,
                    reference_id,
                })
            })
            .collect(),
        principles: sanitize_lines(&parsed.principles),
        reflexes: sanitize_lines(&parsed.reflexes),
        values: sanitize_lines(&parsed.values),
        critiques: sanitize_lines(&parsed.critiques),
        blind_spots: sanitize_lines(&parsed.blind_spots),
        system_hints: sanitize_lines(&parsed.system_hints),
        style: AlterStyle {
            tone: style.tone.unwrap_or(defaults.tone).trim().to_string(),
            verbosity: style
                .verbosity
                .unwrap_or(defaults.verbosity)
                .trim()
                .to_string(),
            temperature: style.temperature.unwrap_or(defaults.temperature),
            contradiction_level: style
                .contradiction_level
                .unwrap_or(defaults.contradiction_level),
            exploration_level: style
                .exploration_level
                .unwrap_or(defaults.exploration_level),
            influence_intensity: style
                .influence_intensity
                .unwrap_or(defaults.influence_intensity)
                .trim()
                .to_string(),
            response_style: style
                .response_style
                .unwrap_or(defaults.response_style)
                .trim()
                .to_string(),
            cite_hypotheses: style.cite_hypotheses.unwrap_or(defaults.cite_hypotheses),
            signal_biases: style.signal_biases.unwrap_or(defaults.signal_biases),
        },
        is_favorite: parsed.is_favorite.unwrap_or(false),
    }
}

fn validate_style(style: &AlterStyle) -> Result<()> {
    let valid_tones = ["neutral", "direct", "socratic", "strategic", "creative"];
    let valid_verbosity = ["short", "medium", "long"];
    let valid_intensity = ["light", "balanced", "strong"];
    let valid_response = ["concise", "analytic", "dialectic", "frontal"];
    if !valid_tones.contains(&style.tone.trim()) {
        return Err(AppError::InvalidOperation(
            "Alter tone is invalid.".to_string(),
        ));
    }
    if !valid_verbosity.contains(&style.verbosity.trim()) {
        return Err(AppError::InvalidOperation(
            "Alter verbosity is invalid.".to_string(),
        ));
    }
    if !valid_intensity.contains(&style.influence_intensity.trim()) {
        return Err(AppError::InvalidOperation(
            "Alter intensity is invalid.".to_string(),
        ));
    }
    if !valid_response.contains(&style.response_style.trim()) {
        return Err(AppError::InvalidOperation(
            "Alter response style is invalid.".to_string(),
        ));
    }
    if !(0.0..=1.0).contains(&style.temperature) {
        return Err(AppError::InvalidOperation(
            "Alter temperature must be between 0 and 1.".to_string(),
        ));
    }
    if !(0..=100).contains(&style.contradiction_level)
        || !(0..=100).contains(&style.exploration_level)
    {
        return Err(AppError::InvalidOperation(
            "Alter behavior levels must be between 0 and 100.".to_string(),
        ));
    }
    Ok(())
}

fn validate_inspirations(items: &[AlterInspiration]) -> Result<Vec<AlterInspiration>> {
    let root = active_workspace_root()?;
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let label = item.label.trim();
        if label.is_empty() {
            return Err(AppError::InvalidOperation(
                "Alter inspiration label is required.".to_string(),
            ));
        }
        let reference_id = match item.source_type {
            AlterInspirationSourceType::Note => {
                let raw = item.reference_id.as_deref().unwrap_or("").trim();
                if raw.is_empty() {
                    return Err(AppError::InvalidOperation(
                        "Note inspiration requires a note reference.".to_string(),
                    ));
                }
                Some(normalize_workspace_relative_from_input(&root, raw)?)
            }
            _ => empty_to_none(item.reference_id.clone()),
        };
        out.push(AlterInspiration {
            id: if item.id.trim().is_empty() {
                next_id("insp")
            } else {
                item.id.trim().to_string()
            },
            label: label.to_string(),
            source_type: item.source_type.clone(),
            weight: item.weight,
            reference_id,
        });
    }
    Ok(out)
}

fn compile_invocation_prompt(record: &AlterRecord) -> String {
    let mut out = String::from("Alter invocation contract.\n");
    out.push_str(&format!("Identity: {}\n", record.name));
    if !record.description.trim().is_empty() {
        out.push_str(&format!("Description: {}\n", record.description.trim()));
    }
    out.push_str(&format!("Mission: {}\n", record.mission.trim()));
    if !record.inspirations.is_empty() {
        out.push_str("Inspirations:\n");
        for item in &record.inspirations {
            out.push_str(&format!("- {} ({:?})", item.label, item.source_type).to_lowercase());
            if let Some(weight) = item.weight {
                out.push_str(&format!(" weight={weight}"));
            }
            out.push('\n');
        }
    }
    for (label, values) in [
        ("Principles", &record.principles),
        ("Reflexes", &record.reflexes),
        ("Values", &record.values),
        ("Critiques", &record.critiques),
        ("Blind spots", &record.blind_spots),
    ] {
        if values.is_empty() {
            continue;
        }
        out.push_str(&format!("{label}:\n"));
        for value in values {
            out.push_str(&format!("- {value}\n"));
        }
    }
    out.push_str(&format!(
        "Style: tone={}, verbosity={}, contradiction_level={}, exploration_level={}, intensity={}, response_style={}\n",
        record.style.tone,
        record.style.verbosity,
        record.style.contradiction_level,
        record.style.exploration_level,
        record.style.influence_intensity,
        record.style.response_style
    ));
    if record.style.cite_hypotheses {
        out.push_str("Always cite hypotheses explicitly.\n");
    }
    if record.style.signal_biases {
        out.push_str("Signal potential biases and blind spots in the answer.\n");
    }
    if !record.system_hints.is_empty() {
        out.push_str("Hints:\n");
        for hint in &record.system_hints {
            out.push_str(&format!("- {hint}\n"));
        }
    }
    out.push_str("Respond in markdown and keep the Alter framing explicit but not theatrical.");
    out
}

fn normalize_create_payload(
    payload: CreateAlterPayload,
    existing_id: Option<String>,
    created_at_ms: Option<u64>,
) -> Result<AlterRecord> {
    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::InvalidOperation(
            "Alter name is required.".to_string(),
        ));
    }
    let mission = payload.mission.trim().to_string();
    if mission.is_empty() {
        return Err(AppError::InvalidOperation(
            "Alter mission is required.".to_string(),
        ));
    }
    validate_style(&payload.style)?;
    let ts = now_ms();
    let inspirations = validate_inspirations(&payload.inspirations)?;
    let mut record = AlterRecord {
        id: existing_id.unwrap_or_else(|| next_id(ALTER_PREFIX)),
        name: name.clone(),
        slug: slugify(&name),
        description: payload.description.trim().to_string(),
        icon: empty_to_none(payload.icon),
        color: empty_to_none(payload.color),
        category: empty_to_none(payload.category),
        mission,
        inspirations,
        principles: sanitize_lines(&payload.principles),
        reflexes: sanitize_lines(&payload.reflexes),
        values: sanitize_lines(&payload.values),
        critiques: sanitize_lines(&payload.critiques),
        blind_spots: sanitize_lines(&payload.blind_spots),
        system_hints: sanitize_lines(&payload.system_hints),
        style: payload.style,
        invocation_prompt: String::new(),
        is_favorite: payload.is_favorite,
        is_built_in: false,
        created_at_ms: created_at_ms.unwrap_or(ts),
        updated_at_ms: ts,
    };
    record.invocation_prompt = compile_invocation_prompt(&record);
    Ok(record)
}

fn normalize_alter_id(alter_id: &str) -> Result<String> {
    let trimmed = alter_id.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidOperation(
            "Alter id is required.".to_string(),
        ));
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    {
        return Err(AppError::InvalidOperation(
            "Alter id is invalid.".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

fn alters_dir() -> Result<PathBuf> {
    let root = active_workspace_root()?;
    Ok(root.join(".tomosona").join("alters"))
}

fn alter_path(alter_id: &str) -> Result<PathBuf> {
    let normalized = normalize_alter_id(alter_id)?;
    Ok(alters_dir()?.join(format!("{normalized}.json")))
}

fn alter_summary(alter: &AlterRecord) -> AlterSummary {
    AlterSummary {
        id: alter.id.clone(),
        name: alter.name.clone(),
        slug: alter.slug.clone(),
        description: alter.description.clone(),
        icon: alter.icon.clone(),
        color: alter.color.clone(),
        category: alter.category.clone(),
        mission: alter.mission.clone(),
        is_favorite: alter.is_favorite,
        is_built_in: alter.is_built_in,
        revision_count: 0,
        updated_at_ms: alter.updated_at_ms,
    }
}

fn read_alter_file(path: &Path) -> Result<AlterRecord> {
    let raw = fs::read_to_string(path)?;
    serde_json::from_str(&raw).map_err(|_| AppError::OperationFailed)
}

fn list_alter_records() -> Result<Vec<AlterRecord>> {
    let dir = alters_dir()?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut records = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        match read_alter_file(&path) {
            Ok(record) => records.push(record),
            Err(_) => continue,
        }
    }

    records.sort_by(|left, right| {
        right
            .is_favorite
            .cmp(&left.is_favorite)
            .then_with(|| right.updated_at_ms.cmp(&left.updated_at_ms))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(records)
}

fn load_alter_record(alter_id: &str) -> Result<AlterRecord> {
    let path = alter_path(alter_id)?;
    if !path.is_file() {
        return Err(AppError::InvalidOperation("Alter not found.".to_string()));
    }
    read_alter_file(&path)
}

fn write_alter_record(alter: &AlterRecord, overwrite: bool) -> Result<()> {
    let path = alter_path(&alter.id)?;
    let parent = path.parent().ok_or(AppError::OperationFailed)?;
    fs::create_dir_all(parent)?;

    if !overwrite && path.exists() {
        return Err(AppError::InvalidOperation(
            "Alter already exists.".to_string(),
        ));
    }

    let json = serde_json::to_string_pretty(alter).map_err(|_| AppError::OperationFailed)?;
    let atomic = AtomicFile::new(
        &path,
        if overwrite {
            AllowOverwrite
        } else {
            DisallowOverwrite
        },
    );
    atomic
        .write(|file| {
            file.write_all(json.as_bytes())?;
            file.write_all(b"\n")?;
            file.flush()?;
            file.sync_all()?;
            Ok(())
        })
        .map_err(|err| match err {
            atomicwrites::Error::Internal(error) => {
                if !overwrite && error.kind() == std::io::ErrorKind::AlreadyExists {
                    AppError::InvalidOperation("Alter already exists.".to_string())
                } else {
                    AppError::Io(error)
                }
            }
            atomicwrites::Error::User(error) => AppError::Io(error),
        })
}

fn remove_alter_record(alter_id: &str) -> Result<()> {
    let path = alter_path(alter_id)?;
    if !path.exists() {
        return Err(AppError::InvalidOperation("Alter not found.".to_string()));
    }
    fs::remove_file(path)?;
    Ok(())
}

pub fn resolve_invocation_prompt(
    _conn: &Connection,
    alter_id: Option<&str>,
) -> Result<Option<String>> {
    let Some(alter_id) = alter_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let alter = load_alter_record(alter_id)?;
    Ok(Some(alter.invocation_prompt))
}

/// Resolves the normalized sampling temperature for an Alter invocation.
pub fn resolve_invocation_temperature(alter_id: Option<&str>) -> Result<Option<f64>> {
    let Some(alter_id) = alter_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let alter = load_alter_record(alter_id)?;
    Ok(Some(alter.style.temperature))
}

/// Returns the effective generation temperature, defaulting neutral runs to `0.15`.
pub fn effective_generation_temperature(temperature: Option<f64>) -> f64 {
    temperature.unwrap_or(ALTER_DEFAULT_TEMPERATURE)
}

fn quick_start_system_prompt() -> &'static str {
    "You design structured Alter personas for a workspace-centric thinking tool.

Return exactly one JSON object and nothing else.
Do not wrap in markdown fences.
Generate a pragmatic, usable Alter configuration from the user's brief.

Required JSON shape:
{
  \"name\": string,
  \"description\": string,
  \"icon\": null,
  \"color\": string,
  \"category\": string,
  \"mission\": string,
  \"inspirations\": [{\"label\": string, \"source_type\": \"manual\" | \"template\" | \"reference_figure\" | \"note\", \"weight\": number | null, \"reference_id\": string | null}],
  \"principles\": string[],
  \"reflexes\": string[],
  \"values\": string[],
  \"critiques\": string[],
  \"blind_spots\": string[],
  \"system_hints\": string[],
  \"style\": {
    \"tone\": \"neutral\" | \"direct\" | \"socratic\" | \"strategic\" | \"creative\",
    \"verbosity\": \"short\" | \"medium\" | \"long\",
    \"temperature\": number,
    \"contradiction_level\": number,
    \"exploration_level\": number,
    \"influence_intensity\": \"light\" | \"balanced\" | \"strong\",
    \"response_style\": \"concise\" | \"analytic\" | \"dialectic\" | \"frontal\",
    \"cite_hypotheses\": boolean,
    \"signal_biases\": boolean
  },
  \"is_favorite\": boolean
}

Constraints:
- Make the name compact and product-ready.
- Generate category, description, and mission automatically.
- Prefer 3 to 6 items for each list when relevant.
- Keep inspirations concrete and use reference_figure/manual unless the user explicitly implies a note.
- Use null for unknown optional values.
- Keep temperature between 0 and 1.
- Keep contradiction_level and exploration_level between 0 and 100."
}

fn quick_start_user_prompt(prompt: &str) -> String {
    format!(
        "User brief for the Alter quick start:\n{}\n\nGenerate the full Alter JSON now.",
        prompt.trim()
    )
}

#[tauri::command]
pub async fn generate_alter_draft(
    payload: GenerateAlterDraftPayload,
) -> Result<CreateAlterPayload> {
    let normalized_prompt = payload.prompt.trim().to_string();
    if normalized_prompt.is_empty() {
        return Err(AppError::InvalidOperation(
            "Quick start prompt is required.".to_string(),
        ));
    }

    let config = settings::load_llm_for_runtime().map_err(|err| {
        if matches!(err, AppError::InvalidOperation(_)) {
            err
        } else {
            AppError::InvalidOperation("Second Brain configuration is unavailable.".to_string())
        }
    })?;
    let active = active_profile(&config).ok_or_else(|| {
        AppError::InvalidOperation("active profile is missing from config.".to_string())
    })?;
    if !active.capabilities.text {
        return Err(AppError::InvalidOperation(
            "The active profile does not support text generation.".to_string(),
        ));
    }

    let raw = run_llm(
        active,
        quick_start_system_prompt(),
        &quick_start_user_prompt(&normalized_prompt),
        None,
    )
    .await
    .map_err(AppError::InvalidOperation)?;
    let json = extract_json_object(&raw).ok_or_else(|| {
        AppError::InvalidOperation("Could not parse Alter quick start response.".to_string())
    })?;
    let parsed: GeneratedAlterDraft = serde_json::from_str(json).map_err(|_| {
        AppError::InvalidOperation("Alter quick start returned invalid JSON.".to_string())
    })?;
    Ok(normalize_generated_draft(parsed, &normalized_prompt))
}

#[tauri::command]
pub fn list_alters() -> Result<Vec<AlterSummary>> {
    Ok(list_alter_records()?.iter().map(alter_summary).collect())
}

#[tauri::command]
pub fn create_alter(payload: CreateAlterPayload) -> Result<AlterRecord> {
    let alter = normalize_create_payload(payload, None, None)?;
    write_alter_record(&alter, false)?;
    Ok(alter)
}

#[tauri::command]
pub fn load_alter(alter_id: String) -> Result<AlterRecord> {
    load_alter_record(&alter_id)
}

#[tauri::command]
pub fn update_alter(payload: UpdateAlterPayload) -> Result<AlterRecord> {
    let current = load_alter_record(&payload.id)?;
    let alter = normalize_create_payload(
        CreateAlterPayload {
            name: payload.name,
            description: payload.description,
            icon: payload.icon,
            color: payload.color,
            category: payload.category,
            mission: payload.mission,
            inspirations: payload.inspirations,
            principles: payload.principles,
            reflexes: payload.reflexes,
            values: payload.values,
            critiques: payload.critiques,
            blind_spots: payload.blind_spots,
            system_hints: payload.system_hints,
            style: payload.style,
            is_favorite: payload.is_favorite,
        },
        Some(current.id.clone()),
        Some(current.created_at_ms),
    )?;
    let _ = payload.revision_reason;
    write_alter_record(&alter, true)?;
    Ok(alter)
}

#[tauri::command]
pub fn delete_alter(alter_id: String) -> Result<()> {
    let conn = open_db()?;
    ensure_index_schema(&conn)?;
    conn.execute(
        "UPDATE second_brain_sessions SET alter_id = '' WHERE alter_id = ?1",
        params![alter_id.clone()],
    )?;
    remove_alter_record(&alter_id)
}

#[tauri::command]
pub fn duplicate_alter(alter_id: String) -> Result<AlterRecord> {
    let current = load_alter_record(&alter_id)?;
    let mut clone = current.clone();
    clone.id = next_id(ALTER_PREFIX);
    clone.name = format!("{} Copy", current.name);
    clone.slug = slugify(&clone.name);
    clone.is_built_in = false;
    clone.created_at_ms = now_ms();
    clone.updated_at_ms = clone.created_at_ms;
    clone.invocation_prompt = compile_invocation_prompt(&clone);
    write_alter_record(&clone, false)?;
    Ok(clone)
}

#[tauri::command]
pub fn list_alter_revisions(alter_id: String) -> Result<Vec<AlterRevisionSummary>> {
    let _ = alter_id;
    Ok(Vec::new())
}

#[tauri::command]
pub fn load_alter_revision(revision_id: String) -> Result<AlterRevisionPayload> {
    let _ = revision_id;
    Err(AppError::InvalidOperation(
        "Alter revisions are not available in file-backed storage.".to_string(),
    ))
}

#[tauri::command]
pub fn preview_alter(payload: PreviewAlterPayload) -> Result<PreviewAlterResult> {
    let record =
        normalize_create_payload(payload.draft, Some("preview".to_string()), Some(now_ms()))?;
    let preview_prompt = format!(
        "{}\n\nPrompt utilisateur de test:\n{}\n\nReponds comme cet Alter.",
        record.invocation_prompt,
        payload.prompt.trim()
    );
    Ok(PreviewAlterResult {
        invocation_prompt: record.invocation_prompt,
        preview_prompt,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct TestWorkspace {
        root: PathBuf,
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = crate::clear_active_workspace();
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn use_test_workspace<R>(run: impl FnOnce() -> Result<R>) -> Result<R> {
        let _guard = crate::workspace_test_guard();
        let root = std::env::temp_dir().join(format!(
            "tomosona-alters-test-{}-{}",
            now_ms(),
            next_index_run_id()
        ));
        fs::create_dir_all(&root)?;
        let root_str = root.to_string_lossy().to_string();
        crate::set_active_workspace(&root_str)?;
        let _cleanup = TestWorkspace { root };
        run()
    }

    fn sample_create_payload(name: &str) -> CreateAlterPayload {
        CreateAlterPayload {
            name: name.to_string(),
            description: "Workspace alter used for tests.".to_string(),
            icon: Some("sparkles".to_string()),
            color: Some("#8d6e63".to_string()),
            category: Some("Testing".to_string()),
            mission: "Support a predictable testing workflow.".to_string(),
            inspirations: vec![AlterInspiration {
                id: String::new(),
                label: "Test reference".to_string(),
                source_type: AlterInspirationSourceType::Manual,
                weight: Some(1.0),
                reference_id: None,
            }],
            principles: vec!["Prefer explicit behavior".to_string()],
            reflexes: vec!["Ask for the concrete failure mode".to_string()],
            values: vec!["Reliability".to_string()],
            critiques: vec!["Avoid hidden state".to_string()],
            blind_spots: vec!["May overfit to tests".to_string()],
            system_hints: vec!["Keep the JSON stable".to_string()],
            style: default_style(),
            is_favorite: true,
        }
    }

    #[test]
    fn extract_json_object_accepts_fenced_or_prefixed_output() {
        let raw = "```json\n{\"name\":\"A\"}\n```";
        assert_eq!(extract_json_object(raw), Some("{\"name\":\"A\"}"));
    }

    #[test]
    fn normalize_generated_draft_fills_missing_defaults() {
        let draft = normalize_generated_draft(
            GeneratedAlterDraft {
                name: None,
                description: None,
                icon: None,
                color: None,
                category: None,
                mission: None,
                inspirations: vec![],
                principles: vec!["Prefer robustness".to_string()],
                reflexes: vec![],
                values: vec![],
                critiques: vec![],
                blind_spots: vec![],
                system_hints: vec![],
                style: None,
                is_favorite: None,
            },
            "Build an alter for strategy under uncertainty",
        );

        assert!(!draft.name.trim().is_empty());
        assert!(draft
            .mission
            .contains("Build an alter for strategy under uncertainty"));
        assert_eq!(draft.style.influence_intensity, "balanced");
        assert_eq!(draft.style.temperature, ALTER_DEFAULT_TEMPERATURE);
        assert_eq!(draft.color.as_deref(), Some("#8d6e63"));
    }

    #[test]
    fn effective_generation_temperature_defaults_to_neutral() {
        assert_eq!(
            effective_generation_temperature(None),
            ALTER_DEFAULT_TEMPERATURE
        );
        assert_eq!(effective_generation_temperature(Some(0.42)), 0.42);
    }

    #[test]
    fn file_backed_alters_round_trip_duplicate_and_delete() {
        use_test_workspace(|| {
            let created = create_alter(sample_create_payload("Test Alter"))?;
            assert_eq!(created.slug, "test-alter");
            assert!(alter_path(&created.id)?.is_file());

            let listed = list_alters()?;
            assert_eq!(listed.len(), 1);
            assert_eq!(listed[0].id, created.id);

            let loaded = load_alter(created.id.clone())?;
            assert_eq!(loaded.id, created.id);
            assert_eq!(loaded.name, created.name);
            assert_eq!(loaded.slug, created.slug);
            assert_eq!(loaded.description, created.description);
            assert_eq!(loaded.icon, created.icon);
            assert_eq!(loaded.color, created.color);
            assert_eq!(loaded.category, created.category);
            assert_eq!(loaded.mission, created.mission);
            assert_eq!(loaded.inspirations.len(), created.inspirations.len());
            assert_eq!(loaded.principles, created.principles);
            assert_eq!(loaded.reflexes, created.reflexes);
            assert_eq!(loaded.values, created.values);
            assert_eq!(loaded.critiques, created.critiques);
            assert_eq!(loaded.blind_spots, created.blind_spots);
            assert_eq!(loaded.system_hints, created.system_hints);
            assert_eq!(loaded.style.tone, created.style.tone);
            assert_eq!(loaded.style.verbosity, created.style.verbosity);
            assert_eq!(loaded.style.temperature, created.style.temperature);
            assert_eq!(
                loaded.style.contradiction_level,
                created.style.contradiction_level
            );
            assert_eq!(
                loaded.style.exploration_level,
                created.style.exploration_level
            );
            assert_eq!(
                loaded.style.influence_intensity,
                created.style.influence_intensity
            );
            assert_eq!(loaded.style.response_style, created.style.response_style);
            assert_eq!(loaded.style.cite_hypotheses, created.style.cite_hypotheses);
            assert_eq!(loaded.style.signal_biases, created.style.signal_biases);
            assert_eq!(loaded.invocation_prompt, created.invocation_prompt);
            assert_eq!(loaded.is_favorite, created.is_favorite);
            assert_eq!(loaded.is_built_in, created.is_built_in);
            assert_eq!(loaded.created_at_ms, created.created_at_ms);
            assert_eq!(loaded.updated_at_ms, created.updated_at_ms);

            let updated = update_alter(UpdateAlterPayload {
                id: created.id.clone(),
                name: "Updated Alter".to_string(),
                description: "Updated description".to_string(),
                icon: None,
                color: Some("#123456".to_string()),
                category: Some("Testing".to_string()),
                mission: "Support an updated workflow.".to_string(),
                inspirations: created.inspirations.clone(),
                principles: vec!["Prefer explicit behavior".to_string()],
                reflexes: vec!["Prefer deterministic results".to_string()],
                values: vec!["Reliability".to_string()],
                critiques: vec!["Avoid hidden state".to_string()],
                blind_spots: vec!["May overfit to tests".to_string()],
                system_hints: vec!["Keep the JSON stable".to_string()],
                style: created.style.clone(),
                is_favorite: false,
                revision_reason: Some("manual_save".to_string()),
            })?;
            assert_eq!(updated.id, created.id);
            assert_eq!(updated.created_at_ms, created.created_at_ms);
            assert_eq!(updated.name, "Updated Alter");
            assert!(alter_path(&created.id)?.is_file());

            let duplicated = duplicate_alter(created.id.clone())?;
            assert_ne!(duplicated.id, created.id);
            assert_eq!(duplicated.name, "Updated Alter Copy");
            assert!(alter_path(&duplicated.id)?.is_file());

            let after_duplicate = list_alters()?;
            assert_eq!(after_duplicate.len(), 2);

            delete_alter(created.id.clone())?;
            assert!(!alter_path(&created.id)?.exists());

            let remaining = list_alters()?;
            assert_eq!(remaining.len(), 1);
            assert_eq!(remaining[0].id, duplicated.id);

            Ok(())
        })
        .expect("file-backed alters workflow")
    }

    #[test]
    fn file_backed_alters_loads_missing_temperature_with_default() {
        use_test_workspace(|| {
            let created = create_alter(sample_create_payload("Legacy Temperature"))?;
            let path = alter_path(&created.id)?;
            let mut json: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path)?)
                .map_err(|_| AppError::OperationFailed)?;
            if let Some(style) = json
                .get_mut("style")
                .and_then(|value| value.as_object_mut())
            {
                style.remove("temperature");
            }
            fs::write(
                &path,
                serde_json::to_string_pretty(&json).map_err(|_| AppError::OperationFailed)?,
            )?;

            let loaded = load_alter(created.id.clone())?;
            assert_eq!(loaded.style.temperature, ALTER_DEFAULT_TEMPERATURE);

            Ok(())
        })
        .expect("missing temperature should fall back to the default")
    }

    #[test]
    fn file_backed_alters_allow_slug_collisions() {
        use_test_workspace(|| {
            let first = create_alter(sample_create_payload("Same Name"))?;
            let second = create_alter(sample_create_payload("Same Name"))?;

            assert_ne!(first.id, second.id);
            assert_eq!(first.slug, second.slug);

            let listed = list_alters()?;
            assert_eq!(listed.len(), 2);

            Ok(())
        })
        .expect("slug collisions should not block storage")
    }

    #[test]
    fn file_backed_alters_reject_duplicate_file_ids_on_write() {
        use_test_workspace(|| {
            let created = create_alter(sample_create_payload("Duplicate Guard"))?;

            assert!(matches!(
                write_alter_record(&created, false),
                Err(AppError::InvalidOperation(message)) if message == "Alter already exists."
            ));

            Ok(())
        })
        .expect("duplicate alter ids should not be overwritten during create")
    }

    #[test]
    fn file_backed_alters_delete_detaches_second_brain_sessions() {
        use_test_workspace(|| {
            let created = create_alter(sample_create_payload("Session Guard"))?;
            let conn = open_db()?;
            ensure_index_schema(&conn)?;
            conn.execute(
                "INSERT INTO second_brain_sessions (id, title, provider, model, alter_id, created_at_ms, updated_at_ms)
                 VALUES (?1, 'Session', 'openai', 'gpt-4o-mini', ?2, ?3, ?3)",
                params!["sb-session-1", created.id.clone(), now_ms() as i64],
            )?;

            delete_alter(created.id.clone())?;

            let alter_id: String = conn.query_row(
                "SELECT alter_id FROM second_brain_sessions WHERE id = ?1",
                params!["sb-session-1"],
                |row| row.get(0),
            )?;
            assert_eq!(alter_id, "");

            Ok(())
        })
        .expect("delete should detach session alter references")
    }

    #[test]
    fn file_backed_alters_reject_loads_without_active_workspace() {
        let _guard = crate::workspace_test_guard();
        let _ = crate::clear_active_workspace();

        assert!(matches!(
            load_alter("missing".to_string()),
            Err(AppError::InvalidOperation(message)) if message == "No workspace is selected."
        ));
    }

    #[test]
    fn file_backed_alters_reject_invalid_temperature_values() {
        use_test_workspace(|| {
            let mut payload = sample_create_payload("Invalid Temperature");
            payload.style.temperature = 1.5;

            assert!(matches!(
                create_alter(payload),
                Err(AppError::InvalidOperation(message)) if message == "Alter temperature must be between 0 and 1."
            ));

            Ok(())
        })
        .expect("invalid temperatures should be rejected")
    }

    #[test]
    fn file_backed_alters_skip_invalid_list_entries_and_reject_invalid_json_loads() {
        use_test_workspace(|| {
            let valid = create_alter(sample_create_payload("Valid Alter"))?;
            let invalid_path = alters_dir()?.join("broken.json");
            fs::write(&invalid_path, "{ not valid json")?;

            let listed = list_alters()?;
            assert_eq!(listed.len(), 1);
            assert_eq!(listed[0].id, valid.id);

            assert!(matches!(
                load_alter("broken".to_string()),
                Err(AppError::OperationFailed) | Err(AppError::InvalidOperation(_))
            ));

            assert!(matches!(
                list_alter_revisions(valid.id.clone()),
                Ok(revisions) if revisions.is_empty()
            ));

            assert!(matches!(
                load_alter_revision("rev-1".to_string()),
                Err(AppError::InvalidOperation(_))
            ));

            Ok(())
        })
        .expect("invalid files should not break valid alters")
    }
}
