use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModeKind {
    PromptTemplate,
    AgentBuiltin,
    SkillRef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModeSpec {
    pub id: String,
    pub label: String,
    pub kind: ModeKind,
    pub prompt_template: String,
    pub agent_id: Option<String>,
    pub skill_ref: Option<String>,
}

pub fn default_mode_specs() -> Vec<ModeSpec> {
    vec![
        ModeSpec {
            id: "freestyle".to_string(),
            label: "Freestyle".to_string(),
            kind: ModeKind::PromptTemplate,
            prompt_template: "Tu es un assistant polyvalent. Execute la demande utilisateur avec precision. Utilise le contexte fourni s'il existe et signale clairement les incertitudes lorsqu'il manque des informations. Reponds en markdown. Ne cite des sources que si l'utilisateur le demande explicitement."
                .to_string(),
            agent_id: None,
            skill_ref: None,
        },
        ModeSpec {
            id: "synthese".to_string(),
            label: "Synthese".to_string(),
            kind: ModeKind::PromptTemplate,
            prompt_template: "Fournis une synthese structuree, concise, avec limites et points d'incertitude. Cite les sources de contexte utilisees."
                .to_string(),
            agent_id: None,
            skill_ref: None,
        },
        ModeSpec {
            id: "plan_action".to_string(),
            label: "Plan d'action".to_string(),
            kind: ModeKind::PromptTemplate,
            prompt_template: "Construis un plan d'action concret, ordonne et verifiable. Cite les sources de contexte pour chaque decision."
                .to_string(),
            agent_id: None,
            skill_ref: None,
        },
        ModeSpec {
            id: "diagnostic".to_string(),
            label: "Diagnostic".to_string(),
            kind: ModeKind::AgentBuiltin,
            prompt_template: "Etablis un diagnostic: problemes, hypotheses, evidences, tests de validation. Cite les sources de contexte."
                .to_string(),
            agent_id: Some("builtin.diagnostic.v1".to_string()),
            skill_ref: None,
        },
        ModeSpec {
            id: "fusion_notes".to_string(),
            label: "Fusion de notes".to_string(),
            kind: ModeKind::PromptTemplate,
            prompt_template: "Fusionne les notes en eliminant doublons et contradictions. Preserve les faits traces aux sources."
                .to_string(),
            agent_id: None,
            skill_ref: None,
        },
        ModeSpec {
            id: "extraction_concepts".to_string(),
            label: "Extraction de concepts".to_string(),
            kind: ModeKind::SkillRef,
            prompt_template: "Extrait les concepts, definitons, relations et ambiguities restantes. Cite les sources."
                .to_string(),
            agent_id: None,
            skill_ref: Some("second_brain.extract_concepts".to_string()),
        },
    ]
}

pub fn resolve_mode_prompt(mode: &str) -> String {
    let mode_trimmed = mode.trim().to_lowercase();
    default_mode_specs()
        .into_iter()
        .find(|item| item.id == mode_trimmed)
        .map(|item| item.prompt_template)
        .unwrap_or_else(|| {
            "Tu es un assistant polyvalent. Execute la demande utilisateur avec precision. Utilise le contexte fourni s'il existe et signale clairement les incertitudes lorsqu'il manque des informations. Reponds en markdown. Ne cite des sources que si l'utilisateur le demande explicitement."
                .to_string()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_known_mode_prompt() {
        let prompt = resolve_mode_prompt("diagnostic");
        assert!(prompt.contains("diagnostic"));
    }

    #[test]
    fn has_freestyle_mode() {
        let modes = default_mode_specs();
        assert!(modes.iter().any(|item| item.id == "freestyle"));
    }

    #[test]
    fn freestyle_prompt_is_markdown_without_forced_citations() {
        let prompt = resolve_mode_prompt("freestyle");
        assert!(prompt.contains("Reponds en markdown"));
        assert!(prompt.contains("Ne cite des sources que si l'utilisateur le demande"));
        assert!(!prompt.contains("assistant de deliberation"));
    }
}
