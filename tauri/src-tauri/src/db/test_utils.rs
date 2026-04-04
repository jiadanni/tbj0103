#[cfg(test)]
pub mod tests {
    use rusqlite::Connection;
    use std::path::Path;
    use crate::db::initialize_database;

    pub fn setup_test_db() -> r2d2::Pool<r2d2_sqlite::SqliteConnectionManager> {
        let conn = initialize_database(Path::new(&format!("file:{}?mode=memory&cache=shared", uuid::Uuid::new_v4()))).expect("Failed to initialize test db");
        conn
    }
}
