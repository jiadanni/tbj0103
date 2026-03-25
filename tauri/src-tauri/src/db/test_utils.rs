#[cfg(test)]
pub mod tests {
    use rusqlite::Connection;
    use std::path::Path;
    use crate::db::initialize_database;

    pub fn setup_test_db() -> Connection {
        let conn = initialize_database(Path::new(":memory:")).expect("Failed to initialize test db");
        conn
    }
}
