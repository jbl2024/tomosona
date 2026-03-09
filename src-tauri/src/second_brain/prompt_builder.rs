//! Prompt assembly and token-budget rules for Second Brain and Pulse.
//!
//! The functions here stay intentionally pure. They own formatting, truncation and
//! ordering rules, but never perform I/O or talk to the LLM provider directly.

use super::{
    context::ContextPromptEntry,
    session_store::{estimate_tokens, MessageRow},
    AppError, PulseSourceKind, Result, RunPulseTransformationPayload,
};

const SB_HISTORY_WINDOW: usize = 12;
const SB_PROMPT_BUDGET_TOKENS: usize = 10_000;
const SB_HISTORY_BUDGET_TOKENS: usize = 3_000;
const SB_CONTEXT_BUDGET_TOKENS: usize = 6_500;
const SB_MAX_FILE_TOKENS: usize = 1_200;
const SB_PROMPT_OVERHEAD_TOKENS: usize = 500;
const TRUNCATION_MARKER: &str = "\n[CONTENU TRONQUE]\n";

#[derive(Debug, Clone)]
pub(super) struct BuiltPrompt {
    pub user_prompt: String,
    pub included_context_paths: Vec<String>,
}

/// Truncates oversized text while preserving both the beginning and the end of the source.
pub(super) fn truncate_text_for_tokens(text: &str, max_tokens: usize) -> String {
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

fn build_history_section(
    history_messages: &[MessageRow],
    history_budget_tokens: usize,
    max_messages: usize,
) -> String {
    let mut selected: Vec<String> = Vec::new();
    let mut consumed = 0usize;
    for item in history_messages.iter().rev() {
        if selected.len() >= max_messages {
            break;
        }
        let entry = format!("[{}]\n{}\n", item.role, item.content_md.trim());
        let entry_tokens = estimate_tokens(&entry);
        let remaining = history_budget_tokens.saturating_sub(consumed);
        if entry_tokens <= remaining {
            selected.push(entry);
            consumed = consumed.saturating_add(entry_tokens);
            continue;
        }
        if selected.is_empty() && remaining >= 32 {
            selected.push(truncate_text_for_tokens(&entry, remaining));
        }
        break;
    }
    selected.reverse();
    selected.join("\n")
}

fn build_context_section(
    session_id: &str,
    context_entries: &[ContextPromptEntry],
    context_budget_tokens: usize,
) -> (String, Vec<String>) {
    if context_entries.is_empty() || context_budget_tokens == 0 {
        return (String::new(), Vec::new());
    }

    let mut section = format!("Session: {session_id}\n\nContexte fourni:\n");
    let mut consumed = estimate_tokens(&section);
    let mut included_paths = Vec::new();
    for entry in context_entries {
        let remaining = context_budget_tokens.saturating_sub(consumed);
        if remaining < 64 {
            break;
        }
        let header = format!("\n--- SOURCE: {} ---\n", entry.path);
        let header_tokens = estimate_tokens(&header);
        if header_tokens >= remaining {
            break;
        }
        let content_budget = remaining
            .saturating_sub(header_tokens)
            .min(SB_MAX_FILE_TOKENS);
        if content_budget < 32 {
            break;
        }
        let content = truncate_text_for_tokens(&entry.content, content_budget);
        section.push_str(&header);
        section.push_str(&content);
        section.push('\n');
        consumed = consumed.saturating_add(estimate_tokens(&header) + estimate_tokens(&content));
        included_paths.push(entry.path.clone());
    }

    if included_paths.is_empty() {
        (String::new(), Vec::new())
    } else {
        (section, included_paths)
    }
}

/// Builds the assistant request prompt from explicit context, recent history and the new message.
pub(super) fn build_user_prompt(
    session_id: &str,
    message: &str,
    history_messages: &[MessageRow],
    context_entries: &[ContextPromptEntry],
) -> BuiltPrompt {
    let user_tokens = estimate_tokens(message);
    let available_budget = SB_PROMPT_BUDGET_TOKENS
        .saturating_sub(SB_PROMPT_OVERHEAD_TOKENS)
        .saturating_sub(user_tokens);
    let history_budget = available_budget.min(SB_HISTORY_BUDGET_TOKENS);
    let context_budget = available_budget
        .saturating_sub(history_budget)
        .min(SB_CONTEXT_BUDGET_TOKENS);

    let (context_section, included_context_paths) =
        build_context_section(session_id, context_entries, context_budget);
    let history_section =
        build_history_section(history_messages, history_budget, SB_HISTORY_WINDOW);

    let mut prompt = String::new();
    if !context_section.is_empty() {
        prompt.push_str(&context_section);
        prompt.push_str("\n\n");
    }
    if !history_section.is_empty() {
        prompt.push_str("Historique recent:\n");
        prompt.push_str(&history_section);
        prompt.push_str("\n\n");
    }
    prompt.push_str("Demande utilisateur:\n");
    prompt.push_str(message.trim());
    prompt.push_str("\n\nReponds en markdown.");

    BuiltPrompt {
        user_prompt: prompt,
        included_context_paths,
    }
}

pub(super) fn normalize_title_from_first_message(raw: &str) -> String {
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let line = normalized
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Second Brain Session");
    let mut compact = line.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.len() > 80 {
        compact.truncate(80);
        compact.push_str("...");
    }
    compact
}

pub(super) fn normalize_pulse_action_id(raw: &str) -> Result<String> {
    let normalized = raw.trim().to_lowercase().replace('-', "_");
    let allowed = [
        "rewrite",
        "condense",
        "expand",
        "change_tone",
        "synthesize",
        "outline",
        "brief",
        "extract_themes",
        "identify_tensions",
    ];
    if allowed.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(AppError::InvalidOperation(
            "Pulse action is not supported.".to_string(),
        ))
    }
}

pub(super) fn pulse_action_prompt(action_id: &str) -> &'static str {
    match action_id {
        "rewrite" => {
            "Reecris la matiere fournie pour la rendre plus claire et plus fluide sans changer le fond. Reponds en markdown."
        }
        "condense" => {
            "Condense la matiere fournie en conservant les informations essentielles. Reponds en markdown."
        }
        "expand" => {
            "Developpe la matiere fournie avec plus de structure et de details utiles, sans inventer de faits. Reponds en markdown."
        }
        "change_tone" => {
            "Reformule la matiere fournie en adaptant le ton selon l'instruction utilisateur. Si aucun ton n'est precise, choisis un ton sobre et professionnel. Reponds en markdown."
        }
        "synthesize" => {
            "Produis une synthese structuree de la matiere fournie. Fais ressortir les idees principales, les limites et les incertitudes. Reponds en markdown."
        }
        "outline" => {
            "Transforme la matiere fournie en plan structure et exploitable. Reponds en markdown."
        }
        "brief" => {
            "Transforme la matiere fournie en brief de travail clair: objectif, points saillants, tensions, prochaines questions si necessaire. Reponds en markdown."
        }
        "extract_themes" => {
            "Fais emerger les themes dominants de la matiere fournie, avec une formulation concise et exploitable. Reponds en markdown."
        }
        "identify_tensions" => {
            "Identifie les tensions, contradictions, angles morts ou arbitrages visibles dans la matiere fournie. Reponds en markdown."
        }
        _ => "Transforme la matiere fournie en sortie utile et structuree. Reponds en markdown.",
    }
}

fn pulse_source_label(kind: &PulseSourceKind) -> &'static str {
    match kind {
        PulseSourceKind::EditorSelection => "Selection editeur",
        PulseSourceKind::EditorNote => "Note editeur",
        PulseSourceKind::SecondBrainContext => "Contexte Second Brain",
        PulseSourceKind::CosmosFocus => "Focus Cosmos",
    }
}

/// Builds the Pulse prompt while keeping action-specific guidance and context budgeting explicit.
pub(super) fn build_pulse_user_prompt(
    payload: &RunPulseTransformationPayload,
    action_id: &str,
    context_entries: &[ContextPromptEntry],
) -> BuiltPrompt {
    let mut prompt = String::new();
    prompt.push_str("Pulse est un moteur de transformation redactionnelle.\n");
    prompt.push_str("Travaille uniquement a partir de la matiere fournie. ");
    prompt.push_str("Ne fais pas de retrieval implicite et ne presente pas le resultat comme une validation de verite.\n\n");
    prompt.push_str(&format!(
        "Source: {}\nAction: {}\n",
        pulse_source_label(&payload.source_kind),
        action_id
    ));
    if let Some(label) = payload.selection_label.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        prompt.push_str(&format!("Libelle: {label}\n"));
    }
    if let Some(session_id) = payload.session_id.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        prompt.push_str(&format!("Session: {session_id}\n"));
    }
    if let Some(node_id) = payload
        .cosmos_selected_node_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        prompt.push_str(&format!("Cosmos node: {node_id}\n"));
    }
    if !payload.cosmos_neighbor_paths.is_empty() {
        prompt.push_str("Cosmos neighbors:\n");
        for path in &payload.cosmos_neighbor_paths {
            prompt.push_str(&format!("- {path}\n"));
        }
    }
    if let Some(instructions) = payload.instructions.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        prompt.push_str("\nInstruction supplementaire:\n");
        prompt.push_str(instructions);
        prompt.push('\n');
    }
    if let Some(source_text) = payload.source_text.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        prompt.push_str("\nMatiere source explicite:\n");
        prompt.push_str(source_text);
        prompt.push('\n');
    }

    let mut included_context_paths = Vec::new();
    if !context_entries.is_empty() {
        let (context_section, paths) =
            build_context_section("pulse", context_entries, SB_CONTEXT_BUDGET_TOKENS);
        if !context_section.is_empty() {
            prompt.push('\n');
            prompt.push_str(&context_section);
            prompt.push('\n');
            included_context_paths = paths;
        }
    }

    prompt.push_str("\nTache:\n");
    prompt.push_str(pulse_action_prompt(action_id));
    prompt.push_str("\n\nExigences:\n");
    prompt.push_str("- Reponds en markdown.\n");
    prompt.push_str("- Signale les incertitudes lorsque la matiere est incomplete.\n");
    prompt.push_str("- Reste fidele a la matiere fournie.\n");

    BuiltPrompt {
        user_prompt: prompt,
        included_context_paths,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(id: &str, role: &str, content: &str) -> MessageRow {
        MessageRow {
            id: id.to_string(),
            role: role.to_string(),
            mode: "freestyle".to_string(),
            content_md: content.to_string(),
            citations_json: "[]".to_string(),
            attachments_json: "[]".to_string(),
            created_at_ms: 0,
        }
    }

    #[test]
    fn truncates_text_with_marker_when_budget_is_small() {
        let long_text = "x".repeat(20_000);
        let truncated = truncate_text_for_tokens(&long_text, 50);
        assert!(truncated.contains("[CONTENU TRONQUE]"));
        assert!(estimate_tokens(&truncated) <= 70);
    }

    #[test]
    fn history_section_keeps_recent_window() {
        let history = (0..20)
            .map(|idx| message(&format!("m{idx}"), "user", &format!("msg-{idx}")))
            .collect::<Vec<_>>();
        let section = build_history_section(&history, 10_000, 12);
        assert!(!section.contains("msg-0"));
        assert!(section.contains("msg-19"));
        assert!(section.contains("msg-8"));
    }

    #[test]
    fn user_prompt_without_context_is_valid() {
        let history = vec![message("m1", "assistant", "old answer")];
        let built = build_user_prompt("s1", "nouvelle demande", &history, &[]);
        assert!(built.user_prompt.contains("Historique recent"));
        assert!(built.user_prompt.contains("Demande utilisateur"));
        assert!(built.user_prompt.contains("Reponds en markdown."));
        assert!(built.included_context_paths.is_empty());
    }

    #[test]
    fn user_prompt_includes_only_context_that_fits_budget() {
        let history = vec![message("m1", "assistant", "ok")];
        let contexts = vec![
            ContextPromptEntry {
                path: "a.md".to_string(),
                content: "a".repeat(8_000),
            },
            ContextPromptEntry {
                path: "b.md".to_string(),
                content: "b".repeat(8_000),
            },
        ];
        let built = build_user_prompt("s1", "question", &history, &contexts);
        assert!(built.user_prompt.contains("--- SOURCE: a.md ---"));
        assert!(built.user_prompt.contains("[CONTENU TRONQUE]"));
        assert!(!built.included_context_paths.is_empty());
    }

    #[test]
    fn normalizes_supported_pulse_actions() {
        assert_eq!(normalize_pulse_action_id("rewrite").unwrap(), "rewrite");
        assert_eq!(
            normalize_pulse_action_id("identify-tensions").unwrap(),
            "identify_tensions"
        );
        assert!(normalize_pulse_action_id("freestyle").is_err());
    }

    #[test]
    fn pulse_prompt_includes_explicit_source_text() {
        let payload = RunPulseTransformationPayload {
            request_id: Some("pulse-test".to_string()),
            source_kind: PulseSourceKind::EditorSelection,
            action_id: "rewrite".to_string(),
            instructions: Some("Use a diplomatic tone.".to_string()),
            context_paths: Vec::new(),
            source_text: Some("Original paragraph".to_string()),
            selection_label: Some("Selected paragraph".to_string()),
            session_id: None,
            cosmos_selected_node_id: None,
            cosmos_neighbor_paths: Vec::new(),
        };

        let built = build_pulse_user_prompt(&payload, "rewrite", &[]);
        assert!(built.user_prompt.contains("Pulse est un moteur"));
        assert!(built.user_prompt.contains("Original paragraph"));
        assert!(built.user_prompt.contains("Use a diplomatic tone."));
        assert!(built.user_prompt.contains("Selection editeur"));
        assert!(built.included_context_paths.is_empty());
    }
}
