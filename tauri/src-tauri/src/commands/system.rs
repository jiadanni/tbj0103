use crate::models::system::SystemSpecs;
#[cfg(target_os = "linux")]
use std::process::Command;
use sysinfo::System;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug)]
struct GpuInfo {
    name: String,
    memory_bytes: Option<u64>,
    detection_source: String,
}

#[cfg(target_os = "linux")]
fn detect_gpu_info() -> Option<GpuInfo> {
    detect_nvidia_gpu()
}

#[cfg(not(target_os = "linux"))]
fn detect_gpu_info() -> Option<GpuInfo> {
    None
}

#[cfg(target_os = "linux")]
fn detect_nvidia_gpu() -> Option<GpuInfo> {
    let output = Command::new("nvidia-smi")
        .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    let best_gpu = stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(2, ',').map(|part| part.trim());
            let name = parts.next()?.to_string();
            let memory_mib = parts.next()?.parse::<u64>().ok()?;
            Some((name, memory_mib * 1024 * 1024))
        })
        .max_by_key(|(_, memory_bytes)| *memory_bytes)?;

    Some(GpuInfo {
        name: best_gpu.0,
        memory_bytes: Some(best_gpu.1),
        detection_source: "nvidia-smi".to_string(),
    })
}

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
    let gpu_info = detect_gpu_info();

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
        gpu_name: gpu_info.as_ref().map(|gpu| gpu.name.clone()),
        gpu_memory_bytes: gpu_info.as_ref().and_then(|gpu| gpu.memory_bytes),
        gpu_detection_source: gpu_info.map(|gpu| gpu.detection_source),
    })
}

#[tauri::command]
pub async fn open_preferences_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("preferences") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "preferences", WebviewUrl::App("index.html".into()))
        .title("Preferences — Aetherium")
        .inner_size(960.0, 640.0)
        .min_inner_size(720.0, 480.0)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}