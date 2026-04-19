use crate::models::system::SystemSpecs;
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
    use std::process::Command;
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

// ── Performance stats GPU helpers (cross-platform) ────────────────────────────

/// Returns `(vram_used_bytes, vram_total_bytes, gpu_name)` when available.
#[cfg(target_os = "linux")]
fn query_gpu_vram() -> Option<(u64, u64, String)> {
    use std::process::Command;
    let out = Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,memory.used,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8(out.stdout).ok()?;
    s.lines()
        .filter_map(|line| {
            let mut p = line.splitn(3, ',').map(str::trim);
            let name = p.next()?.to_string();
            let used = p.next()?.parse::<u64>().ok()? * 1024 * 1024;
            let total = p.next()?.parse::<u64>().ok()? * 1024 * 1024;
            Some((used, total, name))
        })
        .max_by_key(|(_, total, _)| *total)
}

/// On macOS, `system_profiler` only gives total VRAM — used is reported as total.
#[cfg(target_os = "macos")]
fn query_gpu_vram() -> Option<(u64, u64, String)> {
    use std::process::Command;
    let out = Command::new("system_profiler")
        .args(["SPDisplaysDataType", "-json"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let displays = json.get("SPDisplaysDataType")?.as_array()?;
    let mut best: Option<(u64, String)> = None;
    for entry in displays {
        let name = entry
            .get("sppci_model")
            .and_then(|v| v.as_str())
            .unwrap_or("GPU")
            .to_string();
        let raw = entry
            .get("spdisplays_vram")
            .or_else(|| entry.get("spdisplays_vram_shared"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if let Some(bytes) = parse_vram_str(raw) {
            if best.as_ref().map_or(true, |(prev, _)| bytes > *prev) {
                best = Some((bytes, name));
            }
        }
    }
    best.map(|(total, name)| (total, total, name))
}

#[cfg(target_os = "macos")]
fn parse_vram_str(s: &str) -> Option<u64> {
    let s = s.trim();
    if let Some(val) = s.strip_suffix(" GB") {
        return val.trim().parse::<u64>().ok().map(|n| n * 1024 * 1024 * 1024);
    }
    if let Some(val) = s.strip_suffix(" MB") {
        return val.trim().parse::<u64>().ok().map(|n| n * 1024 * 1024);
    }
    None
}

/// On Windows try nvidia-smi first, fall back to wmic for total VRAM only.
#[cfg(target_os = "windows")]
fn query_gpu_vram() -> Option<(u64, u64, String)> {
    use std::process::Command;
    // nvidia-smi (live used + total)
    if let Ok(out) = Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,memory.used,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
    {
        if out.status.success() {
            let s = String::from_utf8(out.stdout).ok()?;
            let result = s.lines().filter_map(|line| {
                let mut p = line.splitn(3, ',').map(str::trim);
                let name = p.next()?.to_string();
                let used = p.next()?.parse::<u64>().ok()? * 1024 * 1024;
                let total = p.next()?.parse::<u64>().ok()? * 1024 * 1024;
                Some((used, total, name))
            }).max_by_key(|(_, total, _)| *total);
            if result.is_some() {
                return result;
            }
        }
    }
    // wmic fallback (total only)
    let out = Command::new("wmic")
        .args(["path", "Win32_VideoController", "get", "Name,AdapterRAM", "/format:csv"])
        .output()
        .ok()?;
    let s = String::from_utf8(out.stdout).ok()?;
    s.lines().skip(1).filter_map(|line| {
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() < 3 { return None; }
        let name = parts[1].trim().to_string();
        let total = parts[2].trim().parse::<u64>().ok()?;
        if total == 0 || name.is_empty() { return None; }
        Some((total, total, name))
    }).max_by_key(|(_, total, _)| *total)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn query_gpu_vram() -> Option<(u64, u64, String)> {
    None
}

// ─────────────────────────────────────────────────────────────────────────────

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
pub fn get_performance_stats() -> Result<crate::models::system::PerformanceStats, String> {
    // sysinfo 0.30: use System::new_all() then refresh to get a CPU delta.
    let mut sys = System::new_all();
    // Pause so sysinfo can compute a CPU usage delta.
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    // global_cpu_info() returns the aggregate CPU, .cpu_usage() gives the percentage.
    let cpu_usage = sys.global_cpu_info().cpu_usage();
    let memory_used = sys.used_memory();
    let memory_total = sys.total_memory();
    let gpu = query_gpu_vram();

    Ok(crate::models::system::PerformanceStats {
        cpu_usage_percent: cpu_usage,
        memory_used_bytes: memory_used,
        memory_total_bytes: memory_total,
        gpu_vram_used_bytes: gpu.as_ref().map(|(used, _, _)| *used),
        gpu_vram_total_bytes: gpu.as_ref().map(|(_, total, _)| *total),
        gpu_name: gpu.map(|(_, _, name)| name),
    })
}

#[tauri::command]
pub async fn open_preferences_window(
    app: tauri::AppHandle,
    single_instance: bool,
) -> Result<(), String> {
    if single_instance {
        // Focus the first existing preferences window if any is open
        for (label, _) in app.webview_windows() {
            if label.starts_with("preferences") {
                let win = app.get_webview_window(&label).ok_or("window gone")?;
                win.show().map_err(|e| e.to_string())?;
                win.set_focus().map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    }

    // Open a new window with a unique label so multiple instances can coexist
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let label = format!("preferences-{ts}");

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("preferences.html".into()))
        .title("Preferences — Aetherium")
        .inner_size(960.0, 640.0)
        .min_inner_size(720.0, 480.0)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}