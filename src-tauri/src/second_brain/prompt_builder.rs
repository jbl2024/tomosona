//! Prompt assembly and token-budget rules for Second Brain.
//!
//! The functions here stay intentionally pure. They own formatting, truncation and
//! ordering rules, but never perform I/O or talk to the LLM provider directly.

use super::{
    context::ContextPromptEntry,
    frontmatter_generation::{FrontmatterGenerationExistingField, FrontmatterGenerationMode},
    session_store::{estimate_tokens, MessageRow},
};

#[derive(Debug, Clone)]
pub(super) struct FrontmatterGenerationPromptInput {
    pub path: String,
    pub title: String,
    pub body_markdown: String,
    pub raw_yaml: String,
    pub existing_fields: Vec<FrontmatterGenerationExistingField>,
    pub mode: FrontmatterGenerationMode,
    pub target_key: Option<String>,
    pub language_hint: Option<String>,
}

const SB_HISTORY_WINDOW: usize = 12;
const SB_PROMPT_BUDGET_TOKENS: usize = 10_000;
const SB_HISTORY_BUDGET_TOKENS: usize = 3_000;
const SB_CONTEXT_BUDGET_TOKENS: usize = 6_500;
const SB_MAX_FILE_TOKENS: usize = 1_200;
const SB_PROMPT_OVERHEAD_TOKENS: usize = 500;
const FRONTMATTER_BODY_BUDGET_TOKENS: usize = 3_500;
const FRONTMATTER_RAW_YAML_BUDGET_TOKENS: usize = 1_200;
const TRUNCATION_MARKER: &str = "\n[CONTENU TRONQUE]\n";

#[derive(Debug, Clone)]
pub(super) struct BuiltPrompt {
    pub user_prompt: String,
    pub included_context_paths: Vec<String>,
    pub language_hint: String,
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
        language_hint: String::new(),
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

fn frontmatter_candidates() -> &'static [(&'static str, &'static str)] {
    &[
        ("status", "Workflow state"),
        ("tags", "Topic tags"),
        ("aliases", "Alternative note titles"),
        ("date", "Primary date"),
        ("deadline", "Due date"),
        ("category", "Content category"),
        ("created", "Creation date"),
        ("updated", "Last update date"),
        ("priority", "Priority level"),
        ("version", "Version label"),
    ]
}

fn count_hints(text: &str, hints: &[&str]) -> usize {
    let lowered = text.to_lowercase();
    hints.iter().map(|hint| lowered.matches(hint).count()).sum()
}

fn detect_note_language(text: &str) -> &'static str {
    let cleaned = text.trim();
    if cleaned.is_empty() {
        return "unknown";
    }

    let french_score = count_hints(
        cleaned,
        &[
            " le ",
            " la ",
            " les ",
            " des ",
            " une ",
            " un ",
            " et ",
            " pour ",
            " avec ",
            " dans ",
            " que ",
            " est ",
            " être ",
            "sur ",
            " à ",
            " du ",
            "de ",
            "note ",
            "projet ",
            "brouillon ",
        ],
    ) + cleaned
        .chars()
        .filter(|ch| {
            matches!(
                ch,
                'à' | 'â' | 'ç' | 'é' | 'è' | 'ê' | 'ë' | 'î' | 'ï' | 'ô' | 'ù' | 'û' | 'ü'
            )
        })
        .count();
    let english_score = count_hints(
        cleaned,
        &[
            " the ",
            " and ",
            " with ",
            " for ",
            " from ",
            " note ",
            " project ",
            " draft ",
            " should ",
            " this ",
            " that ",
            " are ",
            " is ",
            " to ",
            " of ",
            " in ",
        ],
    );

    if french_score == 0 && english_score == 0 {
        return "unknown";
    }
    if (french_score as i64 - english_score as i64).abs() <= 2 {
        return "mixed";
    }
    if french_score > english_score {
        "fr"
    } else {
        "en"
    }
}

fn language_display_name(code: &str) -> &'static str {
    match code {
        "fr" => "French",
        "en" => "English",
        "mixed" => "Mixed",
        _ => "Unknown",
    }
}

fn summarize_existing_fields(fields: &[FrontmatterGenerationExistingField]) -> String {
    if fields.is_empty() {
        return "(aucune)".to_string();
    }
    fields
        .iter()
        .map(|field| format!("- {} ({}) = {}", field.key, field.field_type, field.value))
        .collect::<Vec<_>>()
        .join("\n")
}

fn summarize_candidates() -> String {
    frontmatter_candidates()
        .iter()
        .map(|(key, description)| format!("- {key}: {description}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn frontmatter_generation_mode_label(mode: &FrontmatterGenerationMode) -> &'static str {
    match mode {
        FrontmatterGenerationMode::Auto => "auto",
        FrontmatterGenerationMode::Field => "field",
    }
}

fn build_frontmatter_generation_output_schema(target_key: Option<&str>) -> String {
    let mut schema = String::new();
    schema.push_str("{\n");
    schema.push_str("  \"language\": \"fr|en|mixed|unknown\",\n");
    schema.push_str("  \"properties\": [\n");
    if let Some(key) = target_key {
        schema.push_str(&format!(
            "    {{\"key\":\"{key}\",\"type\":\"text|number|checkbox|date|list|tags\",\"value\":\"...\"}}\n"
        ));
    } else {
        schema.push_str("    {\"key\":\"status\",\"type\":\"text|number|checkbox|date|list|tags\",\"value\":\"...\"}\n");
    }
    schema.push_str("  ]\n");
    schema.push('}');
    schema
}

/// Builds the prompt used by frontmatter auto-generation and sparkle actions.
pub(super) fn build_frontmatter_generation_prompt(
    input: &FrontmatterGenerationPromptInput,
) -> BuiltPrompt {
    let body_excerpt =
        truncate_text_for_tokens(&input.body_markdown, FRONTMATTER_BODY_BUDGET_TOKENS);
    let raw_yaml_excerpt =
        truncate_text_for_tokens(&input.raw_yaml, FRONTMATTER_RAW_YAML_BUDGET_TOKENS);
    let detected_language_hint = input
        .language_hint
        .as_deref()
        .map(str::trim)
        .filter(|value| matches!(*value, "fr" | "en" | "mixed"))
        .unwrap_or_else(|| {
            detect_note_language(&format!(
                "{}\n{}\n{}\n{}",
                input.title,
                body_excerpt,
                raw_yaml_excerpt,
                summarize_existing_fields(&input.existing_fields)
            ))
        });

    let mut prompt = String::new();
    prompt.push_str("Tu generes des properties frontmatter pour Tomosona.\n");
    prompt.push_str("Retourne uniquement du JSON valide, sans bloc de code, sans explication, sans texte autour.\n");
    prompt.push_str(
        "Les clefs doivent rester canoniques et stables. Ne traduis pas les clefs systeme.\n",
    );
    prompt.push_str("Adapte les valeurs textuelles a la langue dominante de la note.\n");
    prompt.push_str("N'ecrase pas silencieusement une valeur non vide en mode auto.\n");
    prompt.push_str("Pour un sparkle sur une property, ne renvoie que cette clef.\n\n");
    prompt.push_str(&format!(
        "Mode: {}\nLangue detectee: {} ({})\n",
        frontmatter_generation_mode_label(&input.mode),
        detected_language_hint,
        language_display_name(detected_language_hint)
    ));
    prompt.push_str(&format!("Chemin: {}\n", input.path));
    prompt.push_str(&format!("Titre: {}\n\n", input.title.trim()));

    if !body_excerpt.trim().is_empty() {
        prompt.push_str("Corps de la note:\n");
        prompt.push_str(&body_excerpt);
        prompt.push_str("\n\n");
    }

    if !raw_yaml_excerpt.trim().is_empty() {
        prompt.push_str("Frontmatter YAML actuel:\n");
        prompt.push_str(&raw_yaml_excerpt);
        prompt.push_str("\n\n");
    }

    prompt.push_str("Properties deja presentes:\n");
    prompt.push_str(&summarize_existing_fields(&input.existing_fields));
    prompt.push_str("\n\nProprietes canoniques candidates:\n");
    prompt.push_str(&summarize_candidates());
    prompt.push_str("\n\nRegles:\n");
    prompt.push_str("- En mode auto, propose seulement les properties les plus pertinentes.\n");
    prompt.push_str("- Ne propose pas une clef deja remplie sauf si sa valeur est vide.\n");
    prompt.push_str("- Si aucune property pertinente n'existe, retourne un tableau vide.\n");
    if let Some(target_key) = input
        .target_key
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        prompt.push_str(&format!("- Sparkle cible: {target_key}\n"));
    }
    prompt.push_str("\nFormat JSON attendu:\n");
    prompt.push_str(&build_frontmatter_generation_output_schema(
        input.target_key.as_deref(),
    ));
    prompt.push_str("\n");

    BuiltPrompt {
        user_prompt: prompt,
        included_context_paths: Vec::new(),
        language_hint: detected_language_hint.to_string(),
    }
}

/// Returns the system instruction used for frontmatter generation.
pub(super) fn frontmatter_generation_system_prompt() -> &'static str {
    "Tu es un générateur de properties frontmatter. Retourne uniquement un objet JSON valide, fidèle à la note, avec des clefs canoniques et des valeurs dans la langue dominante de la note."
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
    fn frontmatter_generation_prompt_includes_language_and_existing_properties() {
        let input = FrontmatterGenerationPromptInput {
            path: "notes/a.md".to_string(),
            title: "Compte rendu".to_string(),
            body_markdown: "Voici une note avec du contexte.".to_string(),
            raw_yaml: "status: draft".to_string(),
            existing_fields: vec![FrontmatterGenerationExistingField {
                key: "status".to_string(),
                field_type: "text".to_string(),
                value: "draft".to_string(),
            }],
            mode: FrontmatterGenerationMode::Auto,
            target_key: None,
            language_hint: Some("fr".to_string()),
        };

        let built = build_frontmatter_generation_prompt(&input);
        assert!(built
            .user_prompt
            .contains("Retourne uniquement du JSON valide"));
        assert!(built.user_prompt.contains("Langue detectee: fr"));
        assert!(built.user_prompt.contains("Properties deja presentes"));
        assert!(built.user_prompt.contains("status (text) = draft"));
        assert!(built
            .user_prompt
            .contains("Proprietes canoniques candidates"));
    }
}
