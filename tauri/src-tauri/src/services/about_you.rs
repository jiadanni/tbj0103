//! About You — resolves the user's learner profile (global setting +
//! optional per-workspace override) and renders it to a plain-text block
//! suitable for prepending to AI prompts.
//!
//! Storage:
//! - Global default: `settings.about_you` (JSON-encoded `AboutYouProfile`).
//! - Per-workspace override: `workspaces.about_you` (same shape; empty = inherit).
//!
//! Injection points: chat system prompt (gated by
//! `inject_about_you_into_chat`), learning goal generation, and workspace
//! prompt auto-generation. Frontend mirrors `format_about_you` in
//! `src/lib/aboutYou.ts` so survey-context calls stay client-side.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AboutYouProfile {
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub profession: String,
    #[serde(default)]
    pub education_level: String,
    #[serde(default)]
    pub field_of_study: String,
    #[serde(default)]
    pub interests: String,
    #[serde(default)]
    pub preferred_language: String,
    #[serde(default)]
    pub default_approach: String,
    #[serde(default)]
    pub bio: String,
}

fn parse_profile(raw: &str) -> Option<AboutYouProfile> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Stored as a JSON string of the JSON object (settings.value is itself
    // JSON-encoded text). Try two-stage decode first, then a direct decode.
    if let Ok(inner) = serde_json::from_str::<String>(trimmed) {
        if inner.trim().is_empty() {
            return None;
        }
        return serde_json::from_str::<AboutYouProfile>(&inner).ok();
    }
    serde_json::from_str::<AboutYouProfile>(trimmed).ok()
}

fn render_label(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Render a profile to a stable, prompt-friendly block. Returns `None`
/// when the profile contains no meaningful content.
pub fn format_about_you(profile: &AboutYouProfile) -> Option<String> {
    let mut lines: Vec<String> = Vec::new();
    if let Some(v) = render_label(&profile.display_name) {
        lines.push(format!("- Name: {v}"));
    }
    if let Some(v) = render_label(&profile.profession) {
        lines.push(format!("- Profession / role: {v}"));
    }
    if let Some(v) = render_label(&profile.education_level) {
        lines.push(format!("- Education level: {v}"));
    }
    if let Some(v) = render_label(&profile.field_of_study) {
        lines.push(format!("- Field of study / expertise: {v}"));
    }
    if let Some(v) = render_label(&profile.interests) {
        lines.push(format!("- Interests: {v}"));
    }
    if let Some(v) = render_label(&profile.preferred_language) {
        lines.push(format!("- Preferred language: {v}"));
    }
    if let Some(v) = render_label(&profile.default_approach) {
        lines.push(format!("- Preferred learning approach: {v}"));
    }
    if let Some(v) = render_label(&profile.bio) {
        lines.push(format!("- Bio: {v}"));
    }
    if lines.is_empty() {
        None
    } else {
        let mut out = String::from("About the user:\n");
        out.push_str(&lines.join("\n"));
        Some(out)
    }
}

/// Resolve the effective About You text for a workspace:
/// per-workspace override → global default → `None`.
pub fn resolve_about_you_text(
    conn: &Connection,
    workspace_id: &str,
) -> Result<Option<String>, String> {
    // Per-workspace override
    let workspace_raw: Option<String> = conn
        .query_row(
            "SELECT about_you FROM workspaces WHERE id = ?1",
            rusqlite::params![workspace_id],
            |row| row.get(0),
        )
        .ok();
    if let Some(raw) = workspace_raw.as_deref() {
        if let Some(profile) = parse_profile(raw) {
            if let Some(text) = format_about_you(&profile) {
                return Ok(Some(text));
            }
        }
    }

    // Global default
    let global_raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'about_you'",
            [],
            |row| row.get(0),
        )
        .ok();
    if let Some(raw) = global_raw.as_deref() {
        if let Some(profile) = parse_profile(raw) {
            if let Some(text) = format_about_you(&profile) {
                return Ok(Some(text));
            }
        }
    }

    Ok(None)
}

/// Whether the chat-time injection toggle is enabled (default true).
pub fn inject_into_chat_enabled(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'inject_about_you_into_chat'",
        [],
        |row| row.get::<_, String>(0),
    )
    .map(|v| v != "false")
    .unwrap_or(true)
}
