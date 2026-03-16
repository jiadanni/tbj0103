//! Concept extractor.
//! Extracts potential concept names from text using heuristics:
//! explicit [[wiki-links]], CamelCase terms, and Title Case phrases.

use regex::Regex;
use std::collections::HashSet;
use std::sync::OnceLock;

static WIKI_RE: OnceLock<Regex> = OnceLock::new();
static CAMEL_RE: OnceLock<Regex> = OnceLock::new();
static PHRASE_RE: OnceLock<Regex> = OnceLock::new();

fn wiki_re()   -> &'static Regex { WIKI_RE.get_or_init(||   Regex::new(r"\[\[([^\[\]]+)\]\]").unwrap()) }
fn camel_re()  -> &'static Regex { CAMEL_RE.get_or_init(||  Regex::new(r"\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b").unwrap()) }
fn phrase_re() -> &'static Regex { PHRASE_RE.get_or_init(|| Regex::new(r"\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,3}\b").unwrap()) }

/// Extract deduplicated concept name candidates from text.
/// Priority order: [[wiki-links]] > CamelCase > Title Case phrases.
pub fn extract_concepts(text: &str) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut results: Vec<String> = Vec::new();

    // Explicit wiki-links
    for cap in wiki_re().captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let name = m.as_str().trim().to_string();
            if !name.is_empty() && seen.insert(name.to_lowercase()) {
                results.push(name);
            }
        }
    }

    // CamelCase technical terms
    for m in camel_re().find_iter(text) {
        let term = m.as_str().to_string();
        if seen.insert(term.to_lowercase()) {
            results.push(term);
        }
    }

    // Title Case multi-word phrases (2-4 words)
    for m in phrase_re().find_iter(text) {
        let phrase = m.as_str().to_string();
        if seen.insert(phrase.to_lowercase()) {
            results.push(phrase);
        }
    }

    results
}

/// Filter `candidates` against `existing_names` (case-insensitive) and return novel ones.
pub fn filter_new_concepts(candidates: Vec<String>, existing_names: &[String]) -> Vec<String> {
    let existing_lower: HashSet<String> = existing_names.iter().map(|n| n.to_lowercase()).collect();
    candidates.into_iter().filter(|c| !existing_lower.contains(&c.to_lowercase())).collect()
}
