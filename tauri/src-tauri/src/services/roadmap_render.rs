//! Server-side rasterizer for roadmap SVG → PNG / PDF using `headless_chrome`.
//!
//! The frontend (`RoadmapGraph`) is the source of truth for layout: callers send
//! the already-rendered `<svg>` markup and the renderer wraps it in a minimal
//! HTML document, navigates a headless Chromium instance to a data: URL, and
//! captures the result.
//!
//! Chromium / Chrome must be installed on the user's machine — we do not bundle
//! the binary (would balloon the installer). Returns a readable `Err(String)`
//! when the binary cannot be located.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use headless_chrome::protocol::cdp::Page::CaptureScreenshotFormatOption;
use headless_chrome::types::PrintToPdfOptions;
use headless_chrome::{Browser, LaunchOptionsBuilder};
use tokio::task;

fn wrap_html(svg: &str, width: u32, height: u32) -> String {
    // Inline dark-theme CSS variables that mirror the live KnowledgeGraphView so
    // colors survive outside the running app.
    format!(
        r#"<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root {{
    --bg-primary: #0b0f17;
    --bg-elevated: #131a26;
    --border-color: #1f2a3a;
    --border-color-hover: #2d3a4f;
    --text-primary: #e2e8f0;
    --text-secondary: #94a3b8;
    --text-muted: #64748b;
    --accent-color: #6366f1;
    --accent-color-rgb: 99, 102, 241;
  }}
  html, body {{
    margin: 0;
    padding: 0;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }}
  body {{ width: {width}px; height: {height}px; }}
  svg {{ display: block; width: {width}px; height: {height}px; }}
</style>
</head>
<body>{svg}</body>
</html>"#
    )
}

fn launch_browser() -> Result<Browser, String> {
    let opts = LaunchOptionsBuilder::default()
        .headless(true)
        .window_size(Some((1920, 1080)))
        .build()
        .map_err(|e| format!("Failed to build launch options: {e}"))?;
    Browser::new(opts).map_err(|e| {
        format!(
            "Could not launch a headless browser. Install Google Chrome or Chromium and try again. \
             Underlying error: {e}"
        )
    })
}

async fn render(svg: String, width: u32, height: u32, as_pdf: bool) -> Result<Vec<u8>, String> {
    task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let browser = launch_browser()?;
        let tab = browser
            .new_tab()
            .map_err(|e| format!("Failed to open tab: {e}"))?;
        tab.set_default_timeout(std::time::Duration::from_secs(30));

        let html = wrap_html(&svg, width, height);
        let data_url = format!("data:text/html;base64,{}", BASE64.encode(html.as_bytes()));
        tab.navigate_to(&data_url)
            .map_err(|e| format!("Failed to navigate: {e}"))?;
        tab.wait_until_navigated()
            .map_err(|e| format!("Failed to wait for navigation: {e}"))?;

        if as_pdf {
            let opts = PrintToPdfOptions {
                landscape: Some(width > height),
                print_background: Some(true),
                paper_width: Some(width as f64 / 96.0),
                paper_height: Some(height as f64 / 96.0),
                margin_top: Some(0.0),
                margin_bottom: Some(0.0),
                margin_left: Some(0.0),
                margin_right: Some(0.0),
                prefer_css_page_size: Some(true),
                ..Default::default()
            };
            tab.print_to_pdf(Some(opts))
                .map_err(|e| format!("Failed to render PDF: {e}"))
        } else {
            tab.capture_screenshot(CaptureScreenshotFormatOption::Png, None, None, true)
                .map_err(|e| format!("Failed to capture screenshot: {e}"))
        }
    })
    .await
    .map_err(|e| format!("Render task failed: {e}"))?
}

pub async fn render_png(svg: &str, width: u32, height: u32) -> Result<Vec<u8>, String> {
    render(svg.to_string(), width, height, false).await
}

pub async fn render_pdf(svg: &str, width: u32, height: u32) -> Result<Vec<u8>, String> {
    render(svg.to_string(), width, height, true).await
}
