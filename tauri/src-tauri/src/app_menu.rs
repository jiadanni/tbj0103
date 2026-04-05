/// App-specific macOS menu bar for Aetherium.
///
/// Builds the full native menu and handles menu events by emitting Tauri
/// events that the React frontend listens to.
use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter,
};

pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // ── Aetherium (app menu) ────────────────────────────────────────────
    let about_meta = AboutMetadata {
        name: Some("Aetherium".to_string()),
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        comments: Some("Your local-first AI learning companion.".to_string()),
        website: Some("https://github.com/tbj0103".to_string()),
        website_label: Some("GitHub".to_string()),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(
        app,
        "Aetherium",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Aetherium"), Some(about_meta))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "preferences",
                "Preferences…",
                true,
                Some("CmdOrCtrl+,"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Quit Aetherium"))?,
        ],
    )?;

    // ── File ────────────────────────────────────────────────────────────
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new-chat", "New Chat", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "new-note", "New Note", true, Some("CmdOrCtrl+Shift+N"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    // ── Edit ────────────────────────────────────────────────────────────
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    // ── View ────────────────────────────────────────────────────────────
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(
                app,
                "quick-search",
                "Quick Search…",
                true,
                Some("CmdOrCtrl+Shift+K"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "cmd-palette",
                "Command Palette",
                true,
                Some("CmdOrCtrl+K"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "nav-dashboard", "Dashboard", true, None::<&str>)?,
            &MenuItem::with_id(app, "nav-chat", "Chat", true, None::<&str>)?,
            &MenuItem::with_id(app, "nav-notes", "Notes", true, None::<&str>)?,
            &MenuItem::with_id(app, "nav-documents", "Documents", true, None::<&str>)?,
            &MenuItem::with_id(app, "nav-webcapture", "Web Captures", true, None::<&str>)?,
            &MenuItem::with_id(app, "nav-graph", "Knowledge Graph", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "nav-flashcards", "Flashcards", true, None::<&str>)?,
            &MenuItem::with_id(app, "nav-learning", "Learning Goals", true, None::<&str>)?,
        ],
    )?;

    // ── Window ──────────────────────────────────────────────────────────
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    // ── Help ────────────────────────────────────────────────────────────
    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[&MenuItem::with_id(
            app,
            "help-release-notes",
            "Release Notes",
            true,
            None::<&str>,
        )?],
    )?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

pub fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "preferences" => {
            let _ = app.emit("menu-navigate", "/preferences");
        }
        "new-chat" => {
            let _ = app.emit("menu-action", "new-chat");
        }
        "new-note" => {
            let _ = app.emit("menu-action", "new-note");
        }
        "cmd-palette" => {
            let _ = app.emit("menu-action", "cmd-palette");
        }
        "quick-search" => {
            let _ = crate::commands::quick_search::show_window(app);
        }
        "nav-dashboard" => {
            let _ = app.emit("menu-navigate", "/project");
        }
        "nav-chat" => {
            let _ = app.emit("menu-navigate", "/chat");
        }
        "nav-notes" => {
            let _ = app.emit("menu-navigate", "/notes");
        }
        "nav-documents" => {
            let _ = app.emit("menu-navigate", "/documents");
        }
        "nav-webcapture" => {
            let _ = app.emit("menu-navigate", "/webcapture");
        }
        "nav-graph" => {
            let _ = app.emit("menu-navigate", "/graph");
        }
        "nav-flashcards" => {
            let _ = app.emit("menu-navigate", "/graph?sub=flashcards");
        }
        "nav-learning" => {
            let _ = app.emit("menu-navigate", "/graph?sub=learning");
        }
        "help-release-notes" => {
            // No-op for now; could open a browser tab or in-app help page.
        }
        _ => {}
    }
}
