#[cfg(test)]
pub mod tests {
    use crate::db::initialize_database;
    use std::path::PathBuf;

    pub fn setup_test_db() -> r2d2::Pool<r2d2_sqlite::SqliteConnectionManager> {
        let dir = tempfile::tempdir().expect("Failed to create temp dir");
        let path: PathBuf = dir.into_path().join("test.db");
        initialize_database(&path).expect("Failed to initialize test db")
    }
}
