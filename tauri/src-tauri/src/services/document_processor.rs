//! Document processor.
//! Extracts plain text from uploaded files for chunking and indexing.

use std::path::Path;

/// Extract plain text from a file at `path`.
/// Supports PDF (via lopdf), plus any text-based format (md, txt, rs, etc.).
pub fn extract_text(path: &str) -> Result<String, String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "pdf" => extract_pdf_text(path),
        _ => std::fs::read_to_string(path).map_err(|e| e.to_string()),
    }
}

fn extract_pdf_text(path: &str) -> Result<String, String> {
    let doc = lopdf::Document::load(path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    if pages.is_empty() {
        return Ok(String::new());
    }
    let mut page_nums: Vec<u32> = pages.keys().copied().collect();
    page_nums.sort();
    doc.extract_text(&page_nums).map_err(|e| e.to_string())
}

/// Detect MIME type from file extension.
pub fn mime_from_path(path: &str) -> &'static str {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "pdf"  => "application/pdf",
        "md"   => "text/markdown",
        "html" | "htm" => "text/html",
        "json" => "application/json",
        _      => "text/plain",
    }
}
