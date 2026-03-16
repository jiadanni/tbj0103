/// Link Syntax Parser
/// Ported from Services/LinkSyntaxParser.swift
///
/// Detects [[concept]] links and Markdown syntax in text.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedLink {
    pub name: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownSpan {
    pub span_type: MarkdownSpanType,
    pub start: usize,
    pub end: usize,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MarkdownSpanType {
    WikiLink,   // [[concept]]
    Bold,       // **text**
    Italic,     // *text* or _text_
    Code,       // `code`
    Header,     // # heading
    ListItem,   // - item
    BlockCode,  // ```code```
}

static WIKI_LINK_RE: OnceLock<Regex> = OnceLock::new();
static BOLD_RE: OnceLock<Regex> = OnceLock::new();
static ITALIC_RE: OnceLock<Regex> = OnceLock::new();
static INLINE_CODE_RE: OnceLock<Regex> = OnceLock::new();
static HEADER_RE: OnceLock<Regex> = OnceLock::new();

fn wiki_link_re() -> &'static Regex {
    WIKI_LINK_RE.get_or_init(|| Regex::new(r"\[\[([^\[\]]+)\]\]").unwrap())
}

fn bold_re() -> &'static Regex {
    BOLD_RE.get_or_init(|| Regex::new(r"\*\*([^*]+)\*\*").unwrap())
}

fn italic_re() -> &'static Regex {
    ITALIC_RE.get_or_init(|| Regex::new(r"(?<!\*)\*([^*]+)\*(?!\*)").unwrap())
}

fn inline_code_re() -> &'static Regex {
    INLINE_CODE_RE.get_or_init(|| Regex::new(r"`([^`]+)`").unwrap())
}

fn header_re() -> &'static Regex {
    HEADER_RE.get_or_init(|| Regex::new(r"(?m)^(#{1,6})\s+(.+)$").unwrap())
}

/// Extract all [[concept]] links from text.
pub fn extract_wiki_links(text: &str) -> Vec<ParsedLink> {
    wiki_link_re()
        .captures_iter(text)
        .map(|cap| {
            let m = cap.get(0).unwrap();
            let name = cap.get(1).unwrap().as_str().trim().to_string();
            ParsedLink { name, start: m.start(), end: m.end() }
        })
        .collect()
}

/// Extract all concept names mentioned as [[links]], deduplicated.
pub fn extract_concept_names(text: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    extract_wiki_links(text)
        .into_iter()
        .filter(|l| seen.insert(l.name.to_lowercase()))
        .map(|l| l.name)
        .collect()
}

/// Parse all markdown spans (links, bold, italic, code, headers) in text.
pub fn parse_markdown_spans(text: &str) -> Vec<MarkdownSpan> {
    let mut spans = Vec::new();

    for cap in wiki_link_re().captures_iter(text) {
        let m = cap.get(0).unwrap();
        spans.push(MarkdownSpan {
            span_type: MarkdownSpanType::WikiLink,
            start: m.start(),
            end: m.end(),
            content: cap.get(1).unwrap().as_str().to_string(),
        });
    }
    for cap in bold_re().captures_iter(text) {
        let m = cap.get(0).unwrap();
        spans.push(MarkdownSpan {
            span_type: MarkdownSpanType::Bold,
            start: m.start(),
            end: m.end(),
            content: cap.get(1).unwrap().as_str().to_string(),
        });
    }
    for cap in italic_re().captures_iter(text) {
        let m = cap.get(0).unwrap();
        spans.push(MarkdownSpan {
            span_type: MarkdownSpanType::Italic,
            start: m.start(),
            end: m.end(),
            content: cap.get(1).unwrap().as_str().to_string(),
        });
    }
    for cap in inline_code_re().captures_iter(text) {
        let m = cap.get(0).unwrap();
        spans.push(MarkdownSpan {
            span_type: MarkdownSpanType::Code,
            start: m.start(),
            end: m.end(),
            content: cap.get(1).unwrap().as_str().to_string(),
        });
    }
    for cap in header_re().captures_iter(text) {
        let m = cap.get(0).unwrap();
        spans.push(MarkdownSpan {
            span_type: MarkdownSpanType::Header,
            start: m.start(),
            end: m.end(),
            content: cap.get(2).unwrap().as_str().to_string(),
        });
    }

    spans.sort_by_key(|s| s.start);
    spans
}

/// Find concept names in plain text that match known concept names
/// (used for auto-linking without explicit [[]] syntax).
pub fn find_concept_mentions<'a>(text: &str, known_concepts: &[&'a str]) -> Vec<(&'a str, usize)> {
    let lower_text = text.to_lowercase();
    let mut mentions = Vec::new();
    for &concept in known_concepts {
        let lower_concept = concept.to_lowercase();
        let mut start = 0;
        while let Some(pos) = lower_text[start..].find(&lower_concept) {
            let abs_pos = start + pos;
            // Word boundary check
            let before_ok = abs_pos == 0 || !lower_text.as_bytes()[abs_pos - 1].is_ascii_alphanumeric();
            let after = abs_pos + lower_concept.len();
            let after_ok = after >= lower_text.len() || !lower_text.as_bytes()[after].is_ascii_alphanumeric();
            if before_ok && after_ok {
                mentions.push((concept, abs_pos));
            }
            start = abs_pos + 1;
        }
    }
    mentions.sort_by_key(|&(_, pos)| pos);
    mentions
}

/// Autocomplete candidates: concepts whose name starts with prefix (case-insensitive).
pub fn autocomplete_concepts<'a>(prefix: &str, concepts: &[&'a str]) -> Vec<&'a str> {
    let lower = prefix.to_lowercase();
    concepts.iter().filter(|&&c| c.to_lowercase().starts_with(&lower)).copied().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_wiki_links() {
        let text = "See [[Attention Mechanism]] and [[Transformer]] for details.";
        let links = extract_wiki_links(text);
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].name, "Attention Mechanism");
        assert_eq!(links[1].name, "Transformer");
    }

    #[test]
    fn test_no_links() {
        let text = "No links here.";
        assert!(extract_wiki_links(text).is_empty());
    }

    #[test]
    fn test_extract_concept_names_deduped() {
        let text = "[[A]] and [[A]] and [[B]]";
        let names = extract_concept_names(text);
        assert_eq!(names.len(), 2);
    }

    #[test]
    fn test_autocomplete() {
        let concepts = vec!["Attention", "Autoencoder", "BERT", "Backprop"];
        let results = autocomplete_concepts("att", &concepts);
        assert_eq!(results, vec!["Attention"]);
        let results2 = autocomplete_concepts("a", &concepts);
        assert_eq!(results2.len(), 2);
    }

    #[test]
    fn test_find_concept_mentions() {
        let text = "The transformer architecture uses attention extensively.";
        let concepts = vec!["transformer", "attention"];
        let mentions = find_concept_mentions(text, &concepts);
        assert_eq!(mentions.len(), 2);
    }
}
