//! Export engine helpers used by commands/export.rs.

use regex::Regex;
use std::sync::OnceLock;

static INVALID_FILENAME_RE: OnceLock<Regex> = OnceLock::new();
fn invalid_re() -> &'static Regex {
    INVALID_FILENAME_RE.get_or_init(|| Regex::new(r#"[/\\:*?"<>|]"#).unwrap())
}

/// Convert a note title to a safe filename (replaces forbidden chars with `_`).
pub fn title_to_filename(title: &str) -> String {
    let safe = invalid_re().replace_all(title.trim(), "_").to_string();
    if safe.is_empty() {
        "untitled".to_string()
    } else {
        safe
    }
}

/// Format a tag list as a YAML sequence string (`  - tag`).
pub fn tags_to_yaml(tags: &[String]) -> String {
    tags.iter()
        .map(|t| format!("  - {t}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Escape a string for inclusion inside a Markdown code block.
pub fn escape_code_block(s: &str) -> String {
    s.replace("```", "\\`\\`\\`")
}

/// Build Obsidian YAML frontmatter from common fields.
pub fn build_frontmatter(title: &str, tags: &[String], note_type: &str) -> String {
    let tags_yaml = tags_to_yaml(tags);
    format!("---\ntitle: {title}\ntype: {note_type}\ntags:\n{tags_yaml}\n---\n")
}
