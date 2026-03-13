//! Echoes note-context composition.
//!
//! Echoes builds a compact, explainable set of note suggestions around a single
//! markdown anchor. The pipeline intentionally stays deterministic and bounded:
//! gather candidates from a few local sources, merge them by path, then apply a
//! simple diversity-first selection strategy.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
    time::{Instant, SystemTime},
};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::*;

const DEFAULT_LIMIT: usize = 5;
const HARD_MAX_LIMIT: usize = 8;
const EXPLICIT_QUOTA: usize = 2;
const SEMANTIC_QUOTA: usize = 2;
const RECENT_QUOTA: usize = 1;
const MAX_PRIMARY_FAMILY_ITEMS: usize = 3;
const DIRECT_WEIGHT: f64 = 1.0;
const BACKLINK_WEIGHT: f64 = 0.9;
const RECENT_WEIGHT: f64 = 0.45;
const MULTI_SIGNAL_BOOST: f64 = 0.20;
const EXPLICIT_SEMANTIC_BOOST: f64 = 0.10;

fn should_log_echoes_perf(elapsed_ms: u128) -> bool {
    std::env::var("TOMOSONA_DEBUG_OPEN")
        .map(|value| value == "1")
        .unwrap_or(false)
        || elapsed_ms >= 75
}

fn log_echoes_perf(command: &str, started_at: Instant, extra_fields: &[(&str, String)]) {
    let elapsed_ms = started_at.elapsed().as_millis();
    if !should_log_echoes_perf(elapsed_ms) {
        return;
    }

    let mut fields = vec![format!("cmd={command}"), format!("total_ms={elapsed_ms}")];
    for (key, value) in extra_fields {
        fields.push(format!("{key}={value}"));
    }
    eprintln!("[echoes-perf] {}", fields.join(" "));
}

#[derive(Debug, Clone, Deserialize)]
pub struct ComputeEchoesPackPayload {
    pub anchor_path: String,
    pub limit: Option<usize>,
    pub include_recent_activity: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EchoesPackDto {
    pub anchor_path: String,
    pub generated_at_ms: u64,
    pub items: Vec<EchoesItemDto>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EchoesItemDto {
    pub path: String,
    pub title: String,
    pub reason_label: String,
    pub reason_labels: Vec<String>,
    pub score: f64,
    pub signal_sources: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum EchoSource {
    Direct,
    Backlink,
    Semantic,
    Recent,
}

impl EchoSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Backlink => "backlink",
            Self::Semantic => "semantic",
            Self::Recent => "recent",
        }
    }

    fn reason_label(self) -> &'static str {
        match self {
            Self::Direct => "Direct link",
            Self::Backlink => "Backlink",
            Self::Semantic => "Semantically related",
            Self::Recent => "Recently active",
        }
    }

    fn bucket(self) -> EchoBucket {
        match self {
            Self::Direct | Self::Backlink => EchoBucket::Explicit,
            Self::Semantic => EchoBucket::Semantic,
            Self::Recent => EchoBucket::Recent,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EchoBucket {
    Explicit,
    Semantic,
    Recent,
}

#[derive(Debug, Clone)]
struct CandidateSignal {
    source: EchoSource,
    score: f64,
}

#[derive(Debug, Clone)]
struct EchoCandidate {
    path: String,
    title: String,
    signals: Vec<CandidateSignal>,
    score: f64,
    primary_source: EchoSource,
}

#[derive(Debug, Clone)]
struct PathResolver {
    path_by_key: HashMap<String, String>,
    path_by_unique_basename: HashMap<String, Option<String>>,
}

#[tauri::command]
/// Computes a compact Echoes pack for a single markdown anchor note.
pub fn compute_echoes_pack(payload: ComputeEchoesPackPayload) -> Result<EchoesPackDto> {
    let started_at = Instant::now();
    let root = active_workspace_root()?;
    let conn = open_db()?;
    let anchor_relative = normalize_anchor_path(&root, &payload.anchor_path)?;
    let scan_started_at = Instant::now();
    let markdown_paths = list_workspace_markdown_paths(&root)?;
    let scan_ms = scan_started_at.elapsed().as_millis();
    let resolver = build_path_resolver(&root, &markdown_paths);
    let limit = payload
        .limit
        .unwrap_or(DEFAULT_LIMIT)
        .clamp(1, HARD_MAX_LIMIT);
    let include_recent = payload.include_recent_activity.unwrap_or(true);

    let direct = collect_direct_candidates(&conn, &resolver, &anchor_relative)?;
    let backlinks = collect_backlink_candidates(&conn, &resolver, &anchor_relative)?;
    let semantic = collect_semantic_candidates(&conn, &anchor_relative)?;
    let recent = if include_recent {
        collect_recent_candidates(&root, &anchor_relative, &markdown_paths)?
    } else {
        Vec::new()
    };

    let merged = merge_candidates_by_path(direct, backlinks, semantic, recent);
    let selected = select_diverse_pack(merged, limit);
    let pack = build_echoes_pack_dto(&root, &anchor_relative, selected);
    log_echoes_perf(
        "compute_echoes_pack",
        started_at,
        &[
            ("anchor_path", anchor_relative.clone()),
            ("limit", limit.to_string()),
            ("markdown_paths", markdown_paths.len().to_string()),
            ("scan_ms", scan_ms.to_string()),
            ("items", pack.items.len().to_string()),
        ],
    );
    Ok(pack)
}

/// Validates anchor input and returns a workspace-relative markdown path.
fn normalize_anchor_path(root: &Path, raw: &str) -> Result<String> {
    let candidate = normalize_workspace_path(root, raw)?;
    if !candidate.is_file() {
        return Err(AppError::InvalidPath);
    }
    let ext_ok = candidate
        .extension()
        .and_then(|value| value.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false);
    if !ext_ok {
        return Err(AppError::InvalidOperation(
            "Echoes works only with markdown notes.".to_string(),
        ));
    }
    normalize_workspace_relative_path(root, &candidate)
}

fn list_workspace_markdown_paths(root: &Path) -> Result<Vec<String>> {
    let mut items = list_markdown_files_via_find(root)?
        .into_iter()
        .filter_map(|path| fs::canonicalize(path).ok())
        .filter_map(|path| normalize_workspace_relative_path(root, &path).ok())
        .collect::<Vec<_>>();
    items.sort_by_key(|item| item.to_lowercase());
    items.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    Ok(items)
}

fn build_path_resolver(root: &Path, markdown_paths: &[String]) -> PathResolver {
    let mut path_by_key = HashMap::new();
    let mut path_by_unique_basename: HashMap<String, Option<String>> = HashMap::new();

    for path in markdown_paths {
        if let Some(key) = normalize_note_key_from_workspace_path(root, path) {
            let basename = note_key_basename(&key);
            path_by_key
                .entry(key.clone())
                .or_insert_with(|| path.clone());
            match path_by_unique_basename.get(&basename) {
                Some(Some(previous)) if !previous.eq_ignore_ascii_case(path) => {
                    path_by_unique_basename.insert(basename, None);
                }
                Some(None) => {}
                _ => {
                    path_by_unique_basename.insert(basename, Some(path.clone()));
                }
            }
        }
    }

    PathResolver {
        path_by_key,
        path_by_unique_basename,
    }
}

fn resolve_target_path(resolver: &PathResolver, target_key: &str) -> Option<String> {
    resolver.path_by_key.get(target_key).cloned().or_else(|| {
        if target_key.contains('/') {
            None
        } else {
            resolver
                .path_by_unique_basename
                .get(target_key)
                .and_then(|value| value.clone())
        }
    })
}

fn read_title_for_path(root: &Path, relative_path: &str) -> String {
    let fallback = Path::new(relative_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(relative_path)
        .to_string();
    let absolute = root.join(relative_path);
    let Ok(markdown) = fs::read_to_string(absolute) else {
        return fallback;
    };
    for line in markdown.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("# ") {
            if !rest.trim().is_empty() {
                return rest.trim().to_string();
            }
        }
    }
    fallback
}

fn collect_direct_candidates(
    conn: &Connection,
    resolver: &PathResolver,
    anchor_relative: &str,
) -> Result<Vec<(String, CandidateSignal)>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT target_key
        FROM note_links
        WHERE source_path = ?1
        ORDER BY target_key
        "#,
    )?;
    let rows = stmt.query_map(params![anchor_relative], |row| row.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        let target_key = row?;
        let Some(path) = resolve_target_path(resolver, &target_key) else {
            continue;
        };
        if path.eq_ignore_ascii_case(anchor_relative) {
            continue;
        }
        out.push((
            path,
            CandidateSignal {
                source: EchoSource::Direct,
                score: DIRECT_WEIGHT,
            },
        ));
    }
    Ok(out)
}

fn collect_backlink_candidates(
    conn: &Connection,
    resolver: &PathResolver,
    anchor_relative: &str,
) -> Result<Vec<(String, CandidateSignal)>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT source_path, target_key
        FROM note_links
        ORDER BY source_path, target_key
        "#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (source_path, target_key) = row?;
        if source_path.eq_ignore_ascii_case(anchor_relative) {
            continue;
        }
        let Some(path) = resolve_target_path(resolver, &target_key) else {
            continue;
        };
        if !path.eq_ignore_ascii_case(anchor_relative) {
            continue;
        }
        out.push((
            source_path,
            CandidateSignal {
                source: EchoSource::Backlink,
                score: BACKLINK_WEIGHT,
            },
        ));
    }
    Ok(out)
}

fn collect_semantic_candidates(
    conn: &Connection,
    anchor_relative: &str,
) -> Result<Vec<(String, CandidateSignal)>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT source_path, target_path, score
        FROM semantic_edges
        WHERE source_path = ?1 OR target_path = ?1
        ORDER BY score DESC, source_path, target_path
        "#,
    )?;
    let rows = stmt.query_map(params![anchor_relative], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, f32>(2)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (source_path, target_path, score) = row?;
        let candidate_path = if source_path.eq_ignore_ascii_case(anchor_relative) {
            target_path
        } else {
            source_path
        };
        if candidate_path.eq_ignore_ascii_case(anchor_relative) {
            continue;
        }
        out.push((
            candidate_path,
            CandidateSignal {
                source: EchoSource::Semantic,
                score: 0.80 * f64::from(score.clamp(0.0, 1.0)),
            },
        ));
    }
    Ok(out)
}

fn collect_recent_candidates(
    root: &Path,
    anchor_relative: &str,
    markdown_paths: &[String],
) -> Result<Vec<(String, CandidateSignal)>> {
    let anchor_parent = Path::new(anchor_relative)
        .parent()
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let mut out = Vec::new();
    for path in markdown_paths {
        if path.eq_ignore_ascii_case(anchor_relative) {
            continue;
        }
        let in_local_area = if anchor_parent.is_empty() {
            true
        } else {
            path.starts_with(&format!("{anchor_parent}/"))
        };
        if !in_local_area {
            continue;
        }
        let updated_at_ms = fs::metadata(root.join(path))
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(system_time_to_unix_ms)
            .unwrap_or(0);
        out.push((
            path.clone(),
            CandidateSignal {
                source: EchoSource::Recent,
                score: RECENT_WEIGHT + (updated_at_ms.max(0) as f64 / 1_000_000_000_000_000.0),
            },
        ));
    }
    out.sort_by(|left, right| right.1.score.total_cmp(&left.1.score));
    Ok(out)
}

fn merge_candidates_by_path(
    direct: Vec<(String, CandidateSignal)>,
    backlinks: Vec<(String, CandidateSignal)>,
    semantic: Vec<(String, CandidateSignal)>,
    recent: Vec<(String, CandidateSignal)>,
) -> Vec<EchoCandidate> {
    let root = active_workspace_root().ok();
    let mut merged: HashMap<String, Vec<CandidateSignal>> = HashMap::new();

    for (path, signal) in direct
        .into_iter()
        .chain(backlinks)
        .chain(semantic)
        .chain(recent)
    {
        let entry = merged.entry(path).or_default();
        if entry.iter().any(|item| item.source == signal.source) {
            continue;
        }
        entry.push(signal);
    }

    let mut candidates = merged
        .into_iter()
        .map(|(path, signals)| {
            let mut score = signals.iter().map(|signal| signal.score).sum::<f64>();
            if signals.len() > 1 {
                score += MULTI_SIGNAL_BOOST;
            }
            let has_explicit = signals
                .iter()
                .any(|signal| matches!(signal.source, EchoSource::Direct | EchoSource::Backlink));
            let has_semantic = signals
                .iter()
                .any(|signal| matches!(signal.source, EchoSource::Semantic));
            if has_explicit && has_semantic {
                score += EXPLICIT_SEMANTIC_BOOST;
            }
            let primary_source = assign_primary_reason(&signals);
            let title = root
                .as_ref()
                .map(|root_path| read_title_for_path(root_path, &path))
                .unwrap_or_else(|| path.clone());
            EchoCandidate {
                path,
                title,
                signals,
                score,
                primary_source,
            }
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.path.to_lowercase().cmp(&right.path.to_lowercase()))
    });
    candidates
}

/// Chooses the primary source that will drive labeling and diversity buckets.
fn assign_primary_reason(signals: &[CandidateSignal]) -> EchoSource {
    signals
        .iter()
        .max_by(|left, right| {
            left.score
                .total_cmp(&right.score)
                .then_with(|| source_priority(left.source).cmp(&source_priority(right.source)))
        })
        .map(|signal| signal.source)
        .unwrap_or(EchoSource::Recent)
}

fn source_priority(source: EchoSource) -> usize {
    match source {
        EchoSource::Direct => 4,
        EchoSource::Backlink => 3,
        EchoSource::Semantic => 2,
        EchoSource::Recent => 1,
    }
}

/// Applies fixed quotas first, then backfills by score while keeping family diversity.
fn select_diverse_pack(candidates: Vec<EchoCandidate>, limit: usize) -> Vec<EchoCandidate> {
    let mut selected = Vec::new();
    let mut selected_paths = HashSet::new();
    let mut primary_family_counts: HashMap<EchoSource, usize> = HashMap::new();

    select_from_bucket(
        &candidates,
        &mut selected,
        &mut selected_paths,
        &mut primary_family_counts,
        EchoBucket::Explicit,
        EXPLICIT_QUOTA,
    );
    select_from_bucket(
        &candidates,
        &mut selected,
        &mut selected_paths,
        &mut primary_family_counts,
        EchoBucket::Semantic,
        SEMANTIC_QUOTA,
    );
    select_from_bucket(
        &candidates,
        &mut selected,
        &mut selected_paths,
        &mut primary_family_counts,
        EchoBucket::Recent,
        RECENT_QUOTA,
    );

    for candidate in candidates {
        if selected.len() >= limit {
            break;
        }
        if selected_paths.contains(&candidate.path) {
            continue;
        }
        let family_count = primary_family_counts
            .get(&candidate.primary_source)
            .copied()
            .unwrap_or(0);
        if family_count >= MAX_PRIMARY_FAMILY_ITEMS {
            continue;
        }
        primary_family_counts
            .entry(candidate.primary_source)
            .and_modify(|count| *count += 1)
            .or_insert(1);
        selected_paths.insert(candidate.path.clone());
        selected.push(candidate);
    }

    selected.sort_by(|left, right| {
        bucket_priority(left.primary_source)
            .cmp(&bucket_priority(right.primary_source))
            .then_with(|| right.score.total_cmp(&left.score))
            .then_with(|| left.path.to_lowercase().cmp(&right.path.to_lowercase()))
    });
    selected.truncate(limit);
    selected
}

fn select_from_bucket(
    candidates: &[EchoCandidate],
    selected: &mut Vec<EchoCandidate>,
    selected_paths: &mut HashSet<String>,
    primary_family_counts: &mut HashMap<EchoSource, usize>,
    bucket: EchoBucket,
    quota: usize,
) {
    let mut taken = 0usize;
    for candidate in candidates {
        if taken >= quota {
            break;
        }
        if candidate.primary_source.bucket() != bucket {
            continue;
        }
        if selected_paths.contains(&candidate.path) {
            continue;
        }
        selected_paths.insert(candidate.path.clone());
        primary_family_counts
            .entry(candidate.primary_source)
            .and_modify(|count| *count += 1)
            .or_insert(1);
        selected.push(candidate.clone());
        taken += 1;
    }
}

fn bucket_priority(source: EchoSource) -> usize {
    match source.bucket() {
        EchoBucket::Explicit => 0,
        EchoBucket::Semantic => 1,
        EchoBucket::Recent => 2,
    }
}

fn build_echoes_pack_dto(
    root: &Path,
    anchor_relative: &str,
    candidates: Vec<EchoCandidate>,
) -> EchoesPackDto {
    let items = candidates
        .into_iter()
        .map(|candidate| {
            let mut reasons = candidate
                .signals
                .iter()
                .map(|signal| signal.source)
                .collect::<Vec<_>>();
            reasons.sort_by_key(|source| bucket_priority(*source));
            reasons.dedup();
            let reason_label = candidate.primary_source.reason_label().to_string();
            let reason_labels = reasons
                .into_iter()
                .take(2)
                .map(|source| source.reason_label().to_string())
                .collect::<Vec<_>>();
            EchoesItemDto {
                path: workspace_absolute_path(root, &candidate.path),
                title: candidate.title,
                reason_label,
                reason_labels,
                score: candidate.score,
                signal_sources: candidate
                    .signals
                    .iter()
                    .map(|signal| signal.source.as_str().to_string())
                    .collect(),
            }
        })
        .collect();

    EchoesPackDto {
        anchor_path: workspace_absolute_path(root, anchor_relative),
        generated_at_ms: now_ms(),
        items,
    }
}

fn system_time_to_unix_ms(value: SystemTime) -> Option<i64> {
    value
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assign_primary_reason_prefers_stronger_signal() {
        let primary = assign_primary_reason(&[
            CandidateSignal {
                source: EchoSource::Recent,
                score: 0.45,
            },
            CandidateSignal {
                source: EchoSource::Direct,
                score: 1.0,
            },
        ]);
        assert_eq!(primary, EchoSource::Direct);
    }

    #[test]
    fn select_diverse_pack_respects_bucket_bias_and_limit() {
        let candidates = vec![
            EchoCandidate {
                path: "a.md".to_string(),
                title: "A".to_string(),
                signals: vec![CandidateSignal {
                    source: EchoSource::Direct,
                    score: 1.0,
                }],
                score: 1.0,
                primary_source: EchoSource::Direct,
            },
            EchoCandidate {
                path: "b.md".to_string(),
                title: "B".to_string(),
                signals: vec![CandidateSignal {
                    source: EchoSource::Backlink,
                    score: 0.9,
                }],
                score: 0.9,
                primary_source: EchoSource::Backlink,
            },
            EchoCandidate {
                path: "c.md".to_string(),
                title: "C".to_string(),
                signals: vec![CandidateSignal {
                    source: EchoSource::Semantic,
                    score: 0.8,
                }],
                score: 0.8,
                primary_source: EchoSource::Semantic,
            },
            EchoCandidate {
                path: "d.md".to_string(),
                title: "D".to_string(),
                signals: vec![CandidateSignal {
                    source: EchoSource::Recent,
                    score: 0.46,
                }],
                score: 0.46,
                primary_source: EchoSource::Recent,
            },
        ];

        let selected = select_diverse_pack(candidates, 3);
        assert_eq!(selected.len(), 3);
        assert_eq!(selected[0].path, "a.md");
        assert_eq!(selected[1].path, "b.md");
        assert_eq!(selected[2].path, "c.md");
    }
}
