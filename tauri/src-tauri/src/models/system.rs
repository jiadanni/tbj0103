use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemSpecs {
    pub host_name: Option<String>,
    pub os_name: String,
    pub os_version: Option<String>,
    pub kernel_version: Option<String>,
    pub cpu_brand: String,
    pub cpu_arch: String,
    pub logical_cores: usize,
    pub physical_cores: Option<usize>,
    pub total_memory_bytes: u64,
    pub available_memory_bytes: u64,
    pub total_swap_bytes: u64,
    pub gpu_name: Option<String>,
    pub gpu_memory_bytes: Option<u64>,
    pub gpu_detection_source: Option<String>,
}

/// Lightweight snapshot sampled every few seconds for the status bar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceStats {
    /// Global CPU usage across all cores, 0–100.
    pub cpu_usage_percent: f32,
    /// RAM currently in use (bytes).
    pub memory_used_bytes: u64,
    /// Total physical RAM (bytes).
    pub memory_total_bytes: u64,
    /// GPU VRAM currently in use (bytes). `None` when unavailable.
    pub gpu_vram_used_bytes: Option<u64>,
    /// Total GPU VRAM (bytes). `None` when unavailable.
    pub gpu_vram_total_bytes: Option<u64>,
    /// Human-readable GPU name. `None` when unavailable.
    pub gpu_name: Option<String>,
}
