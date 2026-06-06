//! Shared helpers for the concept hierarchy (chapter → section → concept).
//!
//! These functions are the single source of truth for what counts as a
//! valid `part_of` parent/child pair and for name-based dedup keys used by
//! the LLM extraction (`commands::ai_knowledge`), the chat-extraction path
//! (`commands::knowledge_graph`), the background hierarchy job
//! (`services::concept_hierarchy_service`), and the read-side tree builder
//! (`services::roadmap_export`).
//!
//! Keep these helpers free of DB / Tauri imports so they can be called from
//! anywhere in the backend without forcing extra dependencies.

/// Returns the expected parent `hierarchy_level` for a node at `child_level`,
/// or `None` when the child sits at the top of the hierarchy (chapters) or
/// is at an unknown level.
pub fn expected_parent_level(child_level: &str) -> Option<&'static str> {
    match child_level {
        "concept" => Some("section"),
        "section" => Some("chapter"),
        "chapter" => None,
        _ => None,
    }
}

/// True iff inserting a `part_of` edge with the given child/parent
/// `hierarchy_level` values is consistent with the chapter → section →
/// concept invariant.
pub fn is_valid_parent_pair(child_level: &str, parent_level: &str) -> bool {
    expected_parent_level(child_level)
        .map(|expected| expected == parent_level)
        .unwrap_or(false)
}

/// Normalize a concept name for dedup: lowercase, collapse whitespace,
/// strip a single trailing `s` for very simple plural handling. Used by
/// both the LLM and chat-extraction paths so the same name reaches the
/// same `concept_nodes` row regardless of which extractor saw it first.
pub fn normalize_concept_name(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    let collapsed: String = lower.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.len() > 4 && collapsed.ends_with('s') && !collapsed.ends_with("ss") {
        collapsed[..collapsed.len() - 1].to_string()
    } else {
        collapsed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_parent_pairs() {
        assert!(is_valid_parent_pair("concept", "section"));
        assert!(is_valid_parent_pair("section", "chapter"));
    }

    #[test]
    fn invalid_parent_pairs() {
        assert!(!is_valid_parent_pair("chapter", "chapter"));
        assert!(!is_valid_parent_pair("section", "section"));
        assert!(!is_valid_parent_pair("concept", "concept"));
        assert!(!is_valid_parent_pair("concept", "chapter"));
        assert!(!is_valid_parent_pair("section", "concept"));
        assert!(!is_valid_parent_pair("chapter", "section"));
        assert!(!is_valid_parent_pair("chapter", "concept"));
    }

    #[test]
    fn unknown_levels_are_invalid() {
        assert!(!is_valid_parent_pair("topic", "chapter"));
        assert!(!is_valid_parent_pair("concept", ""));
        assert!(!is_valid_parent_pair("", ""));
    }

    #[test]
    fn expected_parent_level_matches_pairs() {
        assert_eq!(expected_parent_level("concept"), Some("section"));
        assert_eq!(expected_parent_level("section"), Some("chapter"));
        assert_eq!(expected_parent_level("chapter"), None);
        assert_eq!(expected_parent_level("other"), None);
    }

    #[test]
    fn normalize_collapses_whitespace_and_case() {
        assert_eq!(
            normalize_concept_name("  Python  Decorators  "),
            "python decorator"
        );
        assert_eq!(normalize_concept_name("F-Strings"), "f-string");
        assert_eq!(normalize_concept_name("class"), "class");
    }

    #[test]
    fn normalize_preserves_double_s() {
        assert_eq!(normalize_concept_name("Process"), "process");
    }
}
