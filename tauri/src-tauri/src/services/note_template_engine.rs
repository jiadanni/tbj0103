//! Note template engine.
//! Substitutes `{{variable}}` placeholders in template content.
//!
//! Built-in variables (always available):
//!   {{date}}     – YYYY-MM-DD
//!   {{time}}     – HH:MM
//!   {{datetime}} – YYYY-MM-DD HH:MM
//!   {{weekday}}  – Monday … Sunday
//!   {{month}}    – January … December
//!   {{year}}     – YYYY
//!
//! Caller-supplied vars (via `extra_vars` map) override built-ins.

use std::collections::HashMap;
use chrono::Local;

/// Apply template variable substitution and return the rendered string.
pub fn apply_template(
    template_content: &str,
    extra_vars: &HashMap<String, String>,
) -> String {
    let now = Local::now();
    let mut vars: HashMap<String, String> = HashMap::new();

    // Built-in date/time variables
    vars.insert("date".into(),     now.format("%Y-%m-%d").to_string());
    vars.insert("time".into(),     now.format("%H:%M").to_string());
    vars.insert("datetime".into(), now.format("%Y-%m-%d %H:%M").to_string());
    vars.insert("weekday".into(),  now.format("%A").to_string());
    vars.insert("month".into(),    now.format("%B").to_string());
    vars.insert("year".into(),     now.format("%Y").to_string());

    // Caller-supplied vars override built-ins
    for (k, v) in extra_vars {
        vars.insert(k.clone(), v.clone());
    }

    // Replace all {{key}} occurrences (case-insensitive key match)
    let mut result = template_content.to_string();
    for (key, value) in &vars {
        let placeholder = format!("{{{{{key}}}}}");
        result = result.replace(&placeholder, value);
        // Also handle uppercase variant {{DATE}}
        let placeholder_upper = format!("{{{{{}}}}}", key.to_uppercase());
        result = result.replace(&placeholder_upper, value);
    }
    result
}

/// List all `{{variable}}` names present in a template string.
pub fn list_variables(template_content: &str) -> Vec<String> {
    use regex::Regex;
    use std::sync::OnceLock;
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\{\{([^{}]+)\}\}").unwrap());
    let mut seen = std::collections::HashSet::new();
    re.captures_iter(template_content)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().trim().to_lowercase()))
        .filter(|n| seen.insert(n.clone()))
        .collect()
}
