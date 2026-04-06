use crate::models::system::SystemSpecs;
use sysinfo::System;
use tauri::Manager;

#[tauri::command]
pub fn toggle_devtools(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_devtools_open() {
            window.close_devtools();
        } else {
            window.open_devtools();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_system_specs() -> Result<SystemSpecs, String> {
    let system = System::new_all();

    let cpu_brand = system
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_string())
        .filter(|brand| !brand.is_empty())
        .unwrap_or_else(|| "Unknown CPU".to_string());

    Ok(SystemSpecs {
        host_name: System::host_name(),
        os_name: System::name().unwrap_or_else(|| std::env::consts::OS.to_string()),
        os_version: System::os_version(),
        kernel_version: System::kernel_version(),
        cpu_brand,
        cpu_arch: std::env::consts::ARCH.to_string(),
        logical_cores: system.cpus().len(),
        physical_cores: system.physical_core_count(),
        total_memory_bytes: system.total_memory(),
        available_memory_bytes: system.available_memory(),
        total_swap_bytes: system.total_swap(),
    })
}
