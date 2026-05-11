// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("GDK_BACKEND", "x11");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

        // Suppress libayatana-appindicator deprecation warning which is a known upstream issue in Tauri's Linux tray.
        glib::log_set_handler(
            Some("libayatana-appindicator"),
            glib::LogLevels::LEVEL_WARNING | glib::LogLevels::LEVEL_CRITICAL,
            false, // fatal
            false, // recursion
            |log_domain: Option<&str>, log_level: glib::LogLevel, message: &str| {
                if !message.contains("is deprecated") {
                    glib::log_default_handler(log_domain, log_level, Some(message));
                }
            },
        );
    }

    aetherium_lib::run();
}
