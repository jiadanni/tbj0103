#[cfg(test)]
mod tests {
    use tauri::test::{mock_builder, mock_context};
    fn test() {
        mock_builder().build(mock_context(tauri::test::NoopAsset {}));
    }
}
