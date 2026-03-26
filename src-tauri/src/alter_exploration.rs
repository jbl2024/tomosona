//! Alter Exploration Mode orchestration and persistence.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use atomicwrites::{AllowOverwrite, AtomicFile};
use serde::{Deserialize, Serialize};

use crate::second_brain::config::{active_profile, ProviderProfile, SecondBrainConfig};
use crate::second_brain::session_store::estimate_tokens;
use crate::settings;
use crate::{
    active_workspace_root, now_ms, next_index_run_id, AppError, Result,
};

#[cfg(test)]
use std::collections::VecDeque;

const EXPLORATION_PREFIX: &str = "alter-explore";
const EXPLORATIONS_DIR: &str = "alter-explorations";
const MIN_ALTERS: usize = 2;
const MAX_ALTERS: usize = 4;
const MIN_ROUNDS: i64 = 2;
const MAX_ROUNDS: i64 = 3;
const CONTEXT_PROMPT_BUDGET_TOKENS: usize = 6_500;
const CONTEXT_MAX_FILE_TOKENS: usize = 1_200;
const TRUNCATION_MARKER: &str = "\n[CONTENU TRONQUE]\n";

static CANCELLED_SESSIONS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlterExplorationSubjectType {
    Prompt,
    Note,
    Selection,
    Response,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterExplorationSubject {
    pub subject_type: AlterExplorationSubjectType,
    pub text: String,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlterExplorationMode {
    Challenge,
    Explore,
    Decide,
    Refine,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlterExplorationOutputFormat {
    Summary,
    TensionMap,
    DecisionBrief,
    RefinedProposal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlterExplorationState {
    Draft,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterRoundResult {
    pub round_number: i64,
    pub alter_id: String,
    pub content: String,
    #[serde(default)]
    pub references_alter_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterExplorationSession {
    pub id: String,
    pub workspace_id: String,
    pub subject: AlterExplorationSubject,
    pub alter_ids: Vec<String>,
    pub mode: AlterExplorationMode,
    pub rounds: i64,
    pub output_format: AlterExplorationOutputFormat,
    pub state: AlterExplorationState,
    #[serde(default)]
    pub round_results: Vec<AlterRoundResult>,
    pub final_synthesis: Option<String>,
    pub error_message: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateAlterExplorationPayload {
    pub subject: AlterExplorationSubject,
    pub alter_ids: Vec<String>,
    pub mode: AlterExplorationMode,
    pub rounds: i64,
    pub output_format: AlterExplorationOutputFormat,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoadAlterExplorationPayload {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RunAlterExplorationPayload {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CancelAlterExplorationPayload {
    pub session_id: String,
}

#[derive(Clone)]
struct AlterInvocation {
    id: String,
    name: String,
    invocation_prompt: String,
    temperature: f64,
}

#[derive(Debug, Clone)]
struct ExplorationContextEntry {
    path: String,
    content: String,
}

#[derive(Debug, Clone)]
enum ExplorationModelRole {
    Basic,
    Normal,
}

fn cancel_registry() -> &'static Mutex<HashSet<String>> {
    CANCELLED_SESSIONS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn mark_cancelled(session_id: &str) {
    if let Ok(mut guard) = cancel_registry().lock() {
        guard.insert(session_id.to_string());
    }
}

fn clear_cancelled(session_id: &str) {
    if let Ok(mut guard) = cancel_registry().lock() {
        guard.remove(session_id);
    }
}

fn is_cancelled(session_id: &str) -> bool {
    cancel_registry()
        .lock()
        .map(|guard| guard.contains(session_id))
        .unwrap_or(false)
}

fn next_id(prefix: &str) -> String {
    format!("{prefix}-{}-{}", now_ms(), next_index_run_id())
}

fn normalize_session_id(raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidOperation(
            "Exploration session id is required.".to_string(),
        ));
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    {
        return Err(AppError::InvalidOperation(
            "Exploration session id is invalid.".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

fn normalize_markdown_context_path(raw: &str) -> Result<String> {
    let root = active_workspace_root()?;
    let candidate = {
        let normalized = raw.trim().replace('\\', "/");
        if normalized.is_empty() {
            return Err(AppError::InvalidPath);
        }
        let path = PathBuf::from(&normalized);
        if path.is_absolute() {
            path
        } else {
            root.join(path)
        }
    };

    if !candidate.exists() || !candidate.is_file() {
        return Err(AppError::InvalidPath);
    }

    let canonical = fs::canonicalize(candidate)?;
    if !canonical.starts_with(&root) {
        return Err(AppError::InvalidPath);
    }

    let ext_ok = canonical
        .extension()
        .and_then(|value| value.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false);
    if !ext_ok {
        return Err(AppError::InvalidOperation(
            "Only markdown notes can be used in Alter Exploration context.".to_string(),
        ));
    }

    let relative = canonical
        .strip_prefix(&root)
        .map_err(|_| AppError::InvalidPath)?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(relative)
}

fn parse_context_source_paths(source_id: Option<&str>) -> Vec<String> {
    let raw = match source_id {
        Some(value) => value.trim(),
        None => "",
    };
    if raw.is_empty() {
        return Vec::new();
    }

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for token in raw.split(['\n', ',']) {
        let path = token.trim();
        if path.is_empty() {
            continue;
        }
        let key = path.to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        out.push(path.to_string());
    }
    out
}

fn truncate_text_for_tokens(text: &str, max_tokens: usize) -> String {
    if max_tokens == 0 {
        return String::new();
    }
    if estimate_tokens(text) <= max_tokens {
        return text.to_string();
    }

    let max_chars = max_tokens.saturating_mul(4);
    let marker_len = TRUNCATION_MARKER.chars().count();
    if max_chars <= marker_len + 32 {
        return TRUNCATION_MARKER.trim().to_string();
    }

    let keep_each = (max_chars - marker_len) / 2;
    let start: String = text.chars().take(keep_each).collect();
    let end_vec: Vec<char> = text.chars().rev().take(keep_each).collect();
    let end: String = end_vec.into_iter().rev().collect();
    format!("{start}{TRUNCATION_MARKER}{end}")
}

fn load_exploration_context_entries(subject: &AlterExplorationSubject) -> Result<Vec<ExplorationContextEntry>> {
    let root = active_workspace_root()?;
    let mut entries = Vec::new();
    for path in parse_context_source_paths(subject.source_id.as_deref()) {
        let normalized = normalize_markdown_context_path(&path)?;
        let content = fs::read_to_string(root.join(&normalized))?;
        entries.push(ExplorationContextEntry {
            path: normalized,
            content,
        });
    }
    Ok(entries)
}

fn build_context_section(entries: &[ExplorationContextEntry], budget_tokens: usize) -> String {
    if entries.is_empty() || budget_tokens == 0 {
        return String::new();
    }

    let mut section = String::from("Contextes fournis:\n");
    let mut consumed = estimate_tokens(&section);
    for entry in entries {
        let remaining = budget_tokens.saturating_sub(consumed);
        if remaining < 64 {
            break;
        }

        let header = format!("\n--- SOURCE: {} ---\n", entry.path);
        let header_tokens = estimate_tokens(&header);
        if header_tokens >= remaining {
            break;
        }

        let content_budget = remaining.saturating_sub(header_tokens).min(CONTEXT_MAX_FILE_TOKENS);
        if content_budget < 32 {
            break;
        }

        let content = truncate_text_for_tokens(&entry.content, content_budget);
        section.push_str(&header);
        section.push_str(&content);
        section.push('\n');
        consumed = consumed.saturating_add(estimate_tokens(&header) + estimate_tokens(&content));
    }

    if section.trim() == "Contextes fournis:" {
        String::new()
    } else {
        section.trim().to_string()
    }
}

fn explorations_dir() -> Result<PathBuf> {
    let root = active_workspace_root()?;
    Ok(PathBuf::from(root).join(".tomosona").join(EXPLORATIONS_DIR))
}

fn exploration_path(session_id: &str) -> Result<PathBuf> {
    let normalized = normalize_session_id(session_id)?;
    Ok(explorations_dir()?.join(format!("{normalized}.json")))
}

fn list_exploration_sessions() -> Result<Vec<AlterExplorationSession>> {
    let dir = explorations_dir()?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut sessions = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        match read_session_file(&path) {
            Ok(session) => sessions.push(session),
            Err(_) => continue,
        }
    }
    sessions.sort_by(|left, right| right.updated_at_ms.cmp(&left.updated_at_ms));
    Ok(sessions)
}

fn read_session_file(path: &Path) -> Result<AlterExplorationSession> {
    let raw = fs::read_to_string(path)?;
    serde_json::from_str(&raw).map_err(|_| AppError::OperationFailed)
}

fn write_session_file(session: &AlterExplorationSession) -> Result<()> {
    let path = exploration_path(&session.id)?;
    let parent = path.parent().ok_or(AppError::OperationFailed)?;
    fs::create_dir_all(parent)?;
    let json = serde_json::to_string_pretty(session).map_err(|_| AppError::OperationFailed)?;
    let atomic = AtomicFile::new(&path, AllowOverwrite);
    atomic
        .write(|file| {
            use std::io::Write;
            file.write_all(json.as_bytes())?;
            file.write_all(b"\n")?;
            file.flush()?;
            file.sync_all()?;
            Ok(())
        })
        .map_err(|_: atomicwrites::Error<std::io::Error>| AppError::OperationFailed)
}

fn ensure_valid_payload(payload: &CreateAlterExplorationPayload) -> Result<()> {
    let subject = payload.subject.text.trim();
    if subject.is_empty() {
        return Err(AppError::InvalidOperation(
            "Exploration subject is required.".to_string(),
        ));
    }
    let count = payload.alter_ids.len();
    if count < MIN_ALTERS || count > MAX_ALTERS {
        return Err(AppError::InvalidOperation(format!(
            "Exploration requires between {MIN_ALTERS} and {MAX_ALTERS} Alters."
        )));
    }
    if payload.rounds < MIN_ROUNDS || payload.rounds > MAX_ROUNDS {
        return Err(AppError::InvalidOperation(format!(
            "Exploration rounds must be between {MIN_ROUNDS} and {MAX_ROUNDS}."
        )));
    }
    let mut seen = HashSet::new();
    for alter_id in &payload.alter_ids {
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
        if !seen.insert(trimmed.to_string()) {
            return Err(AppError::InvalidOperation(
                "Alter ids must be unique.".to_string(),
            ));
        }
    }
    Ok(())
}

fn load_invocations(alter_ids: &[String]) -> Result<Vec<AlterInvocation>> {
    let mut out = Vec::new();
    for alter_id in alter_ids {
        let record = crate::alters::load_alter(alter_id.to_string())?;
        out.push(AlterInvocation {
            id: record.id.clone(),
            name: record.name.clone(),
            invocation_prompt: record.invocation_prompt.clone(),
            temperature: record.style.temperature,
        });
    }
    Ok(out)
}

fn resolve_model_role_profile<'a>(
    config: &'a SecondBrainConfig,
    role: ExplorationModelRole,
) -> Result<&'a ProviderProfile> {
    let target = match role {
        ExplorationModelRole::Basic => "gpt-oss-20b",
        ExplorationModelRole::Normal => "gpt-oss-120b",
    };
    let mut candidate = config
        .profiles
        .iter()
        .find(|profile| profile.model.to_lowercase().contains(target) && profile.capabilities.text);
    if candidate.is_none() {
        candidate = active_profile(config).filter(|profile| profile.capabilities.text);
    }
    if candidate.is_none() {
        candidate = config.profiles.iter().find(|profile| profile.capabilities.text);
    }
    candidate.ok_or_else(|| {
        AppError::InvalidOperation("No text-capable model profile available.".to_string())
    })
}

fn mode_guidance(mode: &AlterExplorationMode) -> &'static str {
    match mode {
        AlterExplorationMode::Challenge => {
            "Expose weaknesses, contradictions, and fragile assumptions."
        }
        AlterExplorationMode::Explore => {
            "Widen the space of interpretation and surface alternatives."
        }
        AlterExplorationMode::Decide => {
            "Surface trade-offs and converge on a direction."
        }
        AlterExplorationMode::Refine => {
            "Improve the draft through confrontation and targeted adjustments."
        }
    }
}

fn output_format_guidance(format: &AlterExplorationOutputFormat) -> &'static str {
    match format {
        AlterExplorationOutputFormat::Summary => {
            "Provide a concise narrative summary with key agreements, disagreements, trade-offs, and a recommended next step."
        }
        AlterExplorationOutputFormat::TensionMap => {
            "Return a structured tension map with: Agreements, Disagreements, Unresolved Issues, Trade-offs, and Next Step."
        }
        AlterExplorationOutputFormat::DecisionBrief => {
            "Return a decision brief with: Options, Risks, Preferred Path, and Rationale."
        }
        AlterExplorationOutputFormat::RefinedProposal => {
            "Rewrite the subject into a refined proposal, then list the key changes applied."
        }
    }
}

fn round1_prompt(
    subject: &AlterExplorationSubject,
    mode: &AlterExplorationMode,
    context_section: &str,
) -> String {
    format!(
        "Alter Exploration Mode (Round 1)\nMode guidance: {}\n\nSubject ({}):\n{}\n\n{}\n\nInstructions:\n- Provide your reading of the subject.\n- State your main concern.\n- State your main recommendation.\n\nConstraints:\n- Keep each section short and dense.\n- Do not roleplay.\n\nResponse format:\nReading: ...\nConcern: ...\nRecommendation: ...",
        mode_guidance(mode),
        format!("{:?}", subject.subject_type).to_lowercase(),
        subject.text.trim(),
        context_section
    )
}

fn round2_prompt(
    subject: &AlterExplorationSubject,
    mode: &AlterExplorationMode,
    context_section: &str,
    target_name: &str,
    target_content: &str,
    round_digest: &str,
) -> String {
    format!(
        "Alter Exploration Mode (Round 2)\nMode guidance: {}\n\nSubject ({}):\n{}\n\n{}\n\nRound 1 digest:\n{}\n\nYou must react to {}'s position below. Reference them explicitly.\n\n--- {} position ---\n{}\n\nInstructions:\n- Respond with agreement, disagreement, or refinement.\n- Add something new; no restating your own Round 1.\n\nResponse format:\nReaction (to {}): ...\nAgreement/Disagreement: ...\nAdjustment: ...",
        mode_guidance(mode),
        format!("{:?}", subject.subject_type).to_lowercase(),
        subject.text.trim(),
        context_section,
        round_digest.trim(),
        target_name,
        target_name,
        target_content.trim(),
        target_name
    )
}

fn round3_prompt(
    subject: &AlterExplorationSubject,
    mode: &AlterExplorationMode,
    context_section: &str,
    tension_digest: &str,
) -> String {
    format!(
        "Alter Exploration Mode (Round 3)\nMode guidance: {}\n\nSubject ({}):\n{}\n\n{}\n\nRound 2 tension digest:\n{}\n\nInstructions:\n- State what you now see as the strongest point.\n- State what remains unresolved.\n- State what should happen next.\n\nResponse format:\nStrongest point: ...\nUnresolved: ...\nNext step: ...",
        mode_guidance(mode),
        format!("{:?}", subject.subject_type).to_lowercase(),
        subject.text.trim(),
        context_section,
        tension_digest.trim()
    )
}

fn synthesis_prompt(
    subject: &AlterExplorationSubject,
    mode: &AlterExplorationMode,
    output_format: &AlterExplorationOutputFormat,
    context_section: &str,
    rounds_text: &str,
) -> String {
    format!(
        "You are the silent moderator. Produce the final artifact.\nMode guidance: {}\nOutput format: {}\n\nSubject ({}):\n{}\n\n{}\n\nRound results:\n{}\n\nConstraints:\n- Be actionable.\n- Keep it concise and dense.\n- Do not roleplay.\n\n{}",
        mode_guidance(mode),
        format!("{:?}", output_format).to_lowercase(),
        format!("{:?}", subject.subject_type).to_lowercase(),
        subject.text.trim(),
        context_section,
        rounds_text.trim(),
        output_format_guidance(output_format)
    )
}

fn render_round_results(round_results: &[AlterRoundResult], alter_names: &HashMap<String, String>) -> String {
    let mut grouped: HashMap<i64, Vec<&AlterRoundResult>> = HashMap::new();
    for result in round_results {
        grouped.entry(result.round_number).or_default().push(result);
    }
    let mut rounds: Vec<i64> = grouped.keys().cloned().collect();
    rounds.sort();
    let mut out = String::new();
    for round in rounds {
        out.push_str(&format!("Round {round}:\n"));
        if let Some(items) = grouped.get(&round) {
            for item in items {
                let name = alter_names
                    .get(&item.alter_id)
                    .cloned()
                    .unwrap_or_else(|| item.alter_id.clone());
                out.push_str(&format!("- {name}:\n{}\n\n", item.content.trim()));
            }
        }
        out.push('\n');
    }
    out.trim().to_string()
}

#[cfg(test)]
fn mock_llm_queue() -> &'static Mutex<VecDeque<String>> {
    static MOCK: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();
    MOCK.get_or_init(|| Mutex::new(VecDeque::new()))
}

#[cfg(test)]
fn set_mock_llm_responses(responses: Vec<&str>) {
    let mut guard = mock_llm_queue().lock().expect("mock queue");
    guard.clear();
    for response in responses {
        guard.push_back(response.to_string());
    }
}

#[cfg(test)]
async fn run_llm_for_exploration(
    _profile: &ProviderProfile,
    _system_prompt: &str,
    _user_prompt: &str,
    _temperature: Option<f64>,
) -> std::result::Result<String, String> {
    let mut guard = mock_llm_queue().lock().expect("mock queue");
    Ok(guard
        .pop_front()
        .unwrap_or_else(|| "mock-response".to_string()))
}

#[cfg(not(test))]
use crate::second_brain::llm::run_llm;

#[cfg(not(test))]
async fn run_llm_for_exploration(
    profile: &ProviderProfile,
    system_prompt: &str,
    user_prompt: &str,
    temperature: Option<f64>,
) -> std::result::Result<String, String> {
    run_llm(profile, system_prompt, user_prompt, temperature).await
}

fn summarize_round_results(round_results: &[AlterRoundResult]) -> String {
    let mut out = String::new();
    for item in round_results {
        out.push_str(&format!(
            "[{}:{}]\n{}\n\n",
            item.round_number,
            item.alter_id,
            item.content.trim()
        ));
    }
    out.trim().to_string()
}

fn fail_session(session: &mut AlterExplorationSession, message: &str) -> Result<()> {
    session.state = AlterExplorationState::Failed;
    session.error_message = Some(message.to_string());
    session.updated_at_ms = now_ms();
    write_session_file(session)?;
    Ok(())
}

async fn run_llm_step(
    session: &mut AlterExplorationSession,
    profile: &ProviderProfile,
    system_prompt: &str,
    user_prompt: &str,
    temperature: Option<f64>,
) -> Result<String> {
    match run_llm_for_exploration(profile, system_prompt, user_prompt, temperature).await {
        Ok(output) => Ok(output),
        Err(_) => {
            let _ = fail_session(session, "Exploration request failed.");
            clear_cancelled(&session.id);
            Err(AppError::InvalidOperation(
                "Exploration request failed.".to_string(),
            ))
        }
    }
}

async fn run_exploration(
    mut session: AlterExplorationSession,
) -> Result<AlterExplorationSession> {
    if matches!(session.state, AlterExplorationState::Running) {
        return Err(AppError::InvalidOperation(
            "Exploration session is already running.".to_string(),
        ));
    }
    if matches!(session.state, AlterExplorationState::Completed) {
        return Ok(session);
    }

    clear_cancelled(&session.id);
    session.state = AlterExplorationState::Running;
    session.round_results.clear();
    session.final_synthesis = None;
    session.error_message = None;
    session.updated_at_ms = now_ms();
    write_session_file(&session)?;

    let config = settings::load_llm_for_runtime().map_err(|err| {
        if matches!(err, AppError::InvalidOperation(_)) {
            err
        } else {
            AppError::InvalidOperation("Second Brain configuration is unavailable.".to_string())
        }
    })?;

    let basic_profile = resolve_model_role_profile(&config, ExplorationModelRole::Basic)?;
    let normal_profile = resolve_model_role_profile(&config, ExplorationModelRole::Normal)?;
    let invocations = load_invocations(&session.alter_ids)?;
    let alter_names: HashMap<String, String> = invocations
        .iter()
        .map(|alter| (alter.id.clone(), alter.name.clone()))
        .collect();

    let subject = session.subject.clone();
    let mode = session.mode.clone();
    let context_entries = load_exploration_context_entries(&subject)?;
    let context_section = build_context_section(&context_entries, CONTEXT_PROMPT_BUDGET_TOKENS);

    for alter in &invocations {
        if is_cancelled(&session.id) {
            fail_session(&mut session, "Exploration cancelled.")?;
            clear_cancelled(&session.id);
            return Err(AppError::InvalidOperation("Exploration cancelled.".to_string()));
        }
        let prompt = round1_prompt(&subject, &mode, &context_section);
        let response = run_llm_step(
            &mut session,
            normal_profile,
            &alter.invocation_prompt,
            &prompt,
            Some(alter.temperature),
        )
        .await?;
        session.round_results.push(AlterRoundResult {
            round_number: 1,
            alter_id: alter.id.clone(),
            content: response,
            references_alter_ids: Vec::new(),
        });
        session.updated_at_ms = now_ms();
        write_session_file(&session)?;
    }

    if is_cancelled(&session.id) {
        fail_session(&mut session, "Exploration cancelled.")?;
        clear_cancelled(&session.id);
        return Err(AppError::InvalidOperation("Exploration cancelled.".to_string()));
    }

    let round1_summary = summarize_round_results(
        &session
            .round_results
            .iter()
            .filter(|item| item.round_number == 1)
            .cloned()
            .collect::<Vec<_>>(),
    );
    let round1_digest = run_llm_step(
        &mut session,
        basic_profile,
        "You are a silent moderator. Summarize Round 1 into concise bullets highlighting overlaps and differences.",
        &round1_summary,
        None,
    )
    .await?;

    for (index, alter) in invocations.iter().enumerate() {
        if is_cancelled(&session.id) {
            fail_session(&mut session, "Exploration cancelled.")?;
            clear_cancelled(&session.id);
            return Err(AppError::InvalidOperation("Exploration cancelled.".to_string()));
        }
        let target_index = (index + 1) % invocations.len();
        let target = &invocations[target_index];
        let target_content = session
            .round_results
            .iter()
            .find(|item| item.round_number == 1 && item.alter_id == target.id)
            .map(|item| item.content.clone())
            .unwrap_or_default();
        let prompt = round2_prompt(
            &subject,
            &mode,
            &context_section,
            &target.name,
            &target_content,
            &round1_digest,
        );
        let response = run_llm_step(
            &mut session,
            normal_profile,
            &alter.invocation_prompt,
            &prompt,
            Some(alter.temperature),
        )
        .await?;
        session.round_results.push(AlterRoundResult {
            round_number: 2,
            alter_id: alter.id.clone(),
            content: response,
            references_alter_ids: vec![target.id.clone()],
        });
        session.updated_at_ms = now_ms();
        write_session_file(&session)?;
    }

    if session.rounds == 3 {
        let round2_summary = summarize_round_results(
            &session
                .round_results
                .iter()
                .filter(|item| item.round_number == 2)
                .cloned()
                .collect::<Vec<_>>(),
        );
        let round2_digest = run_llm_step(
            &mut session,
            basic_profile,
            "You are a silent moderator. Summarize Round 2 into the key tensions and convergences.",
            &round2_summary,
            None,
        )
        .await?;

        for alter in &invocations {
            if is_cancelled(&session.id) {
                fail_session(&mut session, "Exploration cancelled.")?;
                clear_cancelled(&session.id);
                return Err(AppError::InvalidOperation("Exploration cancelled.".to_string()));
            }
            let prompt = round3_prompt(&subject, &mode, &context_section, &round2_digest);
            let response = run_llm_step(
                &mut session,
                normal_profile,
                &alter.invocation_prompt,
                &prompt,
                Some(alter.temperature),
            )
            .await?;
            session.round_results.push(AlterRoundResult {
                round_number: 3,
                alter_id: alter.id.clone(),
                content: response,
                references_alter_ids: Vec::new(),
            });
            session.updated_at_ms = now_ms();
            write_session_file(&session)?;
        }
    }

    if is_cancelled(&session.id) {
        fail_session(&mut session, "Exploration cancelled.")?;
        clear_cancelled(&session.id);
        return Err(AppError::InvalidOperation("Exploration cancelled.".to_string()));
    }

    let rounds_text = render_round_results(&session.round_results, &alter_names);
    let synth_prompt = synthesis_prompt(
        &subject,
        &mode,
        &session.output_format,
        &context_section,
        &rounds_text,
    );
    let synthesis = run_llm_step(
        &mut session,
        normal_profile,
        "You are the exploration moderator.",
        &synth_prompt,
        None,
    )
    .await?;

    session.final_synthesis = Some(synthesis);
    session.state = AlterExplorationState::Completed;
    session.updated_at_ms = now_ms();
    write_session_file(&session)?;
    clear_cancelled(&session.id);
    Ok(session)
}

#[tauri::command]
pub fn create_alter_exploration_session(
    payload: CreateAlterExplorationPayload,
) -> Result<AlterExplorationSession> {
    ensure_valid_payload(&payload)?;
    let workspace_id = active_workspace_root()?.to_string_lossy().to_string();
    let ts = now_ms();
    let AlterExplorationSubject {
        subject_type,
        text,
        source_id,
    } = payload.subject;
    let subject = AlterExplorationSubject {
        subject_type,
        text: text.trim().to_string(),
        source_id: source_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    };
    let alter_ids = payload
        .alter_ids
        .into_iter()
        .map(|value| value.trim().to_string())
        .collect::<Vec<_>>();
    let session = AlterExplorationSession {
        id: next_id(EXPLORATION_PREFIX),
        workspace_id,
        subject,
        alter_ids,
        mode: payload.mode,
        rounds: payload.rounds,
        output_format: payload.output_format,
        state: AlterExplorationState::Draft,
        round_results: Vec::new(),
        final_synthesis: None,
        error_message: None,
        created_at_ms: ts,
        updated_at_ms: ts,
    };
    write_session_file(&session)?;
    Ok(session)
}

#[tauri::command]
pub fn load_alter_exploration_session(
    payload: LoadAlterExplorationPayload,
) -> Result<AlterExplorationSession> {
    let path = exploration_path(&payload.session_id)?;
    if !path.is_file() {
        return Err(AppError::InvalidOperation(
            "Exploration session not found.".to_string(),
        ));
    }
    read_session_file(&path)
}

#[tauri::command]
pub fn list_alter_exploration_sessions() -> Result<Vec<AlterExplorationSession>> {
    list_exploration_sessions()
}

#[tauri::command]
pub async fn run_alter_exploration_session(
    payload: RunAlterExplorationPayload,
) -> Result<AlterExplorationSession> {
    let path = exploration_path(&payload.session_id)?;
    if !path.is_file() {
        return Err(AppError::InvalidOperation(
            "Exploration session not found.".to_string(),
        ));
    }
    let session = read_session_file(&path)?;
    run_exploration(session).await
}

#[tauri::command]
pub fn cancel_alter_exploration_session(
    payload: CancelAlterExplorationPayload,
) -> Result<bool> {
    let session_id = normalize_session_id(&payload.session_id)?;
    mark_cancelled(&session_id);
    Ok(true)
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
            "tomosona-exploration-test-{}-{}",
            now_ms(),
            next_index_run_id()
        ));
        fs::create_dir_all(&root)?;
        let root_str = root.to_string_lossy().to_string();
        crate::set_active_workspace(&root_str)?;
        let _cleanup = TestWorkspace { root };
        run()
    }

    fn sample_subject() -> AlterExplorationSubject {
        AlterExplorationSubject {
            subject_type: AlterExplorationSubjectType::Prompt,
            text: "Should we add runtime blocks?".to_string(),
            source_id: None,
        }
    }

    #[test]
    fn validates_payload_bounds() {
        let mut payload = CreateAlterExplorationPayload {
            subject: sample_subject(),
            alter_ids: vec!["a".to_string()],
            mode: AlterExplorationMode::Explore,
            rounds: 2,
            output_format: AlterExplorationOutputFormat::Summary,
        };
        assert!(ensure_valid_payload(&payload).is_err());
        payload.alter_ids = vec!["a".to_string(), "b".to_string()];
        payload.rounds = 1;
        assert!(ensure_valid_payload(&payload).is_err());
    }

    #[test]
    fn resolves_profiles_with_fallbacks() {
        let config = SecondBrainConfig {
            active_profile: "p2".to_string(),
            profiles: vec![
                ProviderProfile {
                    id: "p1".to_string(),
                    label: "Basic".to_string(),
                    provider: "openai".to_string(),
                    model: "gpt-oss-20b".to_string(),
                    api_key: "x".to_string(),
                    base_url: None,
                    default_mode: None,
                    capabilities: crate::second_brain::config::ProfileCapabilities {
                        text: true,
                        image_input: false,
                        audio_input: false,
                        tool_calling: false,
                        streaming: true,
                    },
                },
                ProviderProfile {
                    id: "p2".to_string(),
                    label: "Normal".to_string(),
                    provider: "openai".to_string(),
                    model: "gpt-oss-120b".to_string(),
                    api_key: "x".to_string(),
                    base_url: None,
                    default_mode: None,
                    capabilities: crate::second_brain::config::ProfileCapabilities {
                        text: true,
                        image_input: false,
                        audio_input: false,
                        tool_calling: false,
                        streaming: true,
                    },
                },
            ],
        };
        let basic = resolve_model_role_profile(&config, ExplorationModelRole::Basic).unwrap();
        assert_eq!(basic.id, "p1");
        let normal = resolve_model_role_profile(&config, ExplorationModelRole::Normal).unwrap();
        assert_eq!(normal.id, "p2");
    }

    #[test]
    fn writes_and_reads_session() -> Result<()> {
        use_test_workspace(|| {
            let payload = CreateAlterExplorationPayload {
                subject: sample_subject(),
                alter_ids: vec!["a".to_string(), "b".to_string()],
                mode: AlterExplorationMode::Explore,
                rounds: 2,
                output_format: AlterExplorationOutputFormat::Summary,
            };
            ensure_valid_payload(&payload)?;
            let workspace_id = active_workspace_root()?.to_string_lossy().to_string();
            let ts = now_ms();
            let session = AlterExplorationSession {
                id: next_id(EXPLORATION_PREFIX),
                workspace_id,
                subject: payload.subject,
                alter_ids: payload.alter_ids,
                mode: payload.mode,
                rounds: payload.rounds,
                output_format: payload.output_format,
                state: AlterExplorationState::Draft,
                round_results: Vec::new(),
                final_synthesis: None,
                error_message: None,
                created_at_ms: ts,
                updated_at_ms: ts,
            };
            write_session_file(&session)?;
            let path = exploration_path(&session.id)?;
            let loaded = read_session_file(&path)?;
            assert_eq!(loaded.id, session.id);
            Ok(())
        })
    }

    #[test]
    fn builds_round_prompts() {
        let subject = sample_subject();
        let mode = AlterExplorationMode::Challenge;
        let context_section = "Contextes fournis:\n--- SOURCE: notes/a.md ---\nEvidence from note";
        let round1 = round1_prompt(&subject, &mode, context_section);
        assert!(round1.contains("Round 1"));
        assert!(round1.contains("Evidence from note"));
        let round2 = round2_prompt(&subject, &mode, context_section, "Alter A", "content", "digest");
        assert!(round2.contains("Alter A"));
        let round3 = round3_prompt(&subject, &mode, context_section, "tension");
        assert!(round3.contains("Round 3"));
        let synth = synthesis_prompt(&subject, &mode, &AlterExplorationOutputFormat::Summary, context_section, "rounds");
        assert!(synth.contains("Evidence from note"));
    }

    #[test]
    fn loads_source_notes_into_prompt_context() -> Result<()> {
        use_test_workspace(|| {
            let note_path = active_workspace_root()?.join("notes/source.md");
            if let Some(parent) = note_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&note_path, "# Source\n\nThis note should be injected.")?;
            let subject = AlterExplorationSubject {
                subject_type: AlterExplorationSubjectType::Prompt,
                text: "Discuss this".to_string(),
                source_id: Some(note_path.to_string_lossy().to_string()),
            };
            let entries = load_exploration_context_entries(&subject)?;
            assert_eq!(entries.len(), 1);
            let context = build_context_section(&entries, CONTEXT_PROMPT_BUDGET_TOKENS);
            assert!(context.contains("This note should be injected."));
            assert!(context.contains("SOURCE: notes/source.md"));
            Ok(())
        })
    }

    #[test]
    fn runs_happy_path_with_mocked_llm() -> Result<()> {
        use_test_workspace(|| {
            set_mock_llm_responses(vec![
                "r1-a",
                "r1-b",
                "digest1",
                "r2-a",
                "r2-b",
                "final",
            ]);
            let alter_a = crate::alters::create_alter(crate::alters::CreateAlterPayload {
                name: "Alter A".to_string(),
                description: "Test alter".to_string(),
                icon: None,
                color: None,
                category: None,
                mission: "Provide pragmatic input.".to_string(),
                inspirations: Vec::new(),
                principles: vec!["Keep it short.".to_string()],
                reflexes: Vec::new(),
                values: Vec::new(),
                critiques: Vec::new(),
                blind_spots: Vec::new(),
                system_hints: Vec::new(),
                style: crate::alters::AlterStyle {
                    tone: "strategic".to_string(),
                    verbosity: "short".to_string(),
                    temperature: 0.1,
                    contradiction_level: 40,
                    exploration_level: 50,
                    influence_intensity: "balanced".to_string(),
                    response_style: "analytic".to_string(),
                    cite_hypotheses: false,
                    signal_biases: false,
                },
                is_favorite: false,
            })?;
            let alter_b = crate::alters::create_alter(crate::alters::CreateAlterPayload {
                name: "Alter B".to_string(),
                description: "Test alter".to_string(),
                icon: None,
                color: None,
                category: None,
                mission: "Provide critical input.".to_string(),
                inspirations: Vec::new(),
                principles: vec!["Be direct.".to_string()],
                reflexes: Vec::new(),
                values: Vec::new(),
                critiques: Vec::new(),
                blind_spots: Vec::new(),
                system_hints: Vec::new(),
                style: crate::alters::AlterStyle {
                    tone: "direct".to_string(),
                    verbosity: "short".to_string(),
                    temperature: 0.1,
                    contradiction_level: 40,
                    exploration_level: 50,
                    influence_intensity: "balanced".to_string(),
                    response_style: "analytic".to_string(),
                    cite_hypotheses: false,
                    signal_biases: false,
                },
                is_favorite: false,
            })?;
            let payload = CreateAlterExplorationPayload {
                subject: sample_subject(),
                alter_ids: vec![alter_a.id.clone(), alter_b.id.clone()],
                mode: AlterExplorationMode::Explore,
                rounds: 2,
                output_format: AlterExplorationOutputFormat::Summary,
            };
            let session = create_alter_exploration_session(payload)?;
            let session = read_session_file(&exploration_path(&session.id)?)?;
            let result = tauri::async_runtime::block_on(run_exploration(session))?;
            assert!(matches!(result.state, AlterExplorationState::Completed));
            assert_eq!(result.round_results.len(), 4);
            assert_eq!(result.final_synthesis.as_deref(), Some("final"));
            Ok(())
        })
    }
}
