use rusqlite::Connection;

fn parse_setting_string(raw: String) -> String {
    serde_json::from_str::<String>(&raw).unwrap_or(raw)
}

pub fn get_string_setting(conn: &Connection, key: &str) -> Option<String> {
    let raw: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get(0),
        )
        .ok()?;
    let value = parse_setting_string(raw).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

pub fn get_ollama_base_url(conn: &Connection) -> Option<String> {
    get_string_setting(conn, "ollama_base_url")
}

pub fn get_configured_background_model(conn: &Connection) -> Option<String> {
    get_string_setting(conn, "background_model").or_else(|| get_configured_chat_model(conn))
}

pub fn get_configured_chat_model(conn: &Connection) -> Option<String> {
    let enabled_model = conn
        .query_row(
            "SELECT model_id FROM ai_models WHERE enabled = 1 ORDER BY priority ASC LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    enabled_model.or_else(|| get_string_setting(conn, "preferred_model"))
}

pub fn get_embedding_model(conn: &Connection) -> Option<String> {
    get_string_setting(conn, "embedding_model")
}
