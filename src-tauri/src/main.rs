// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use walkdir::WalkDir;
use tauri::Manager;

#[cfg(windows)]
use winreg::enums::*;
#[cfg(windows)]
use winreg::RegKey;

// Process manager module
mod process_manager;
use process_manager::PROCESS_MANAGER;

#[derive(Debug, Serialize, Deserialize)]
struct Settings {
    theme: String,
    language: String,
    ffmpeg_path: String,
    ffprobe_path: String,
    output_suffix: String,
    default_video_codec: String,
    default_audio_codec: String,
    #[serde(rename = "gpuAvailable")]
    gpu_available: bool,
    #[serde(rename = "renderMode")]
    render_mode: String,
    #[serde(rename = "screenAnimation", default = "default_screen_animation")]
    screen_animation: String,
}

fn default_screen_animation() -> String {
    "default".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "light".to_string(),
            language: "ru".to_string(),
            ffmpeg_path: "ffmpeg".to_string(),
            ffprobe_path: "ffprobe".to_string(),
            output_suffix: "_szhatoe".to_string(),
            default_video_codec: "h264".to_string(),
            default_audio_codec: "aac".to_string(),
            gpu_available: false,
            render_mode: "cpu".to_string(),
            screen_animation: "default".to_string(),
        }
    }
}

fn get_app_data_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".szhimatar")
}

fn get_presets_dir() -> PathBuf {
    get_app_data_dir().join("presets")
}

fn ensure_app_dirs() -> Result<(), String> {
    let app_dir = get_app_data_dir();
    let logs_dir = app_dir.join("logs");
    let stats_dir = app_dir.join("stats");
    let presets_dir = get_presets_dir();
    
    fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&stats_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&presets_dir).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn load_settings() -> Result<Settings, String> {
    let settings_path = get_app_data_dir().join("settings.json");
    
    if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(Settings::default())
    }
}

#[tauri::command]
fn save_settings(settings: Settings) -> Result<(), String> {
    let settings_path = get_app_data_dir().join("settings.json");
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| e.to_string())?;
    
    fs::write(&settings_path, content).map_err(|e| e.to_string())
}

/// Check GPU (NVENC) compatibility and persist result in settings.json
/// WARNING: This can be overridden for UI testing, but actual FFmpeg rendering
/// will still use real hardware capabilities
#[tauri::command]
fn check_gpu_compatibility() -> Result<bool, String> {
    // Check for override first (for UI testing only)
    if let Some(override_config) = load_hardware_override() {
        println!("[HARDWARE OVERRIDE] GPU Available: {}", override_config.gpu_available);
        return Ok(override_config.gpu_available);
    }
    
    let config = load_ffmpeg_config();
    if config.ffmpeg_path.trim().is_empty() {
        return Err("FFmpeg path not configured".to_string());
    }

    // Run `ffmpeg -hide_banner -encoders` and search for nvenc encoders
    #[cfg(target_os = "windows")]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new(&config.ffmpeg_path)
            .creation_flags(CREATE_NO_WINDOW)
            .args(["-hide_banner", "-encoders"])
            .output()
            .map_err(|e| format!("Failed to run ffmpeg: {}", e))?
    };

    #[cfg(not(target_os = "windows"))]
    let output = Command::new(&config.ffmpeg_path)
        .args(["-hide_banner", "-encoders"])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
    let gpu_available = stdout.contains("nvenc");

    // Persist in settings
    let mut settings = load_settings().unwrap_or_default();
    settings.gpu_available = gpu_available;
    let _ = save_settings(settings);

    Ok(gpu_available)
}

/// Detect hardware information (CPU and GPU vendors)
#[tauri::command]
fn detect_hardware_info() -> Result<HardwareInfo, String> {
    // Check for override first (for testing UI only)
    if let Some(override_config) = load_hardware_override() {
        return Ok(HardwareInfo {
            cpu_vendor: override_config.cpu_vendor,
            gpu_vendor: override_config.gpu_vendor,
        });
    }
    
    // Use real hardware detection
    let cpu_vendor = detect_cpu_vendor();
    let gpu_vendor = detect_gpu_vendor();
    
    Ok(HardwareInfo {
        cpu_vendor,
        gpu_vendor,
    })
}

#[derive(serde::Serialize, serde::Deserialize)]
struct HardwareInfo {
    cpu_vendor: String,
    gpu_vendor: String,
}

/// Hardware override configuration for testing (DOES NOT affect actual rendering)
#[derive(serde::Deserialize)]
struct HardwareOverride {
    enabled: bool,
    cpu_vendor: String,
    gpu_vendor: String,
    gpu_available: bool,
}

/// Load hardware override from .hardware-override.json if exists and enabled
fn load_hardware_override() -> Option<HardwareOverride> {
    // Try to read .hardware-override.json from app directory
    let config_path = std::env::current_dir()
        .ok()?
        .join(".hardware-override.json");
    
    if !config_path.exists() {
        return None;
    }
    
    let content = fs::read_to_string(config_path).ok()?;
    let override_config: HardwareOverride = serde_json::from_str(&content).ok()?;
    
    if override_config.enabled {
        println!("[HARDWARE OVERRIDE] Enabled: CPU={}, GPU={}", 
                 override_config.cpu_vendor, override_config.gpu_vendor);
        Some(override_config)
    } else {
        None
    }
}

fn detect_cpu_vendor() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        
        // Use WMIC to get CPU info
        let output = Command::new("wmic")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["cpu", "get", "name"])
            .output();
        
        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
            if stdout.contains("intel") {
                return "intel".to_string();
            } else if stdout.contains("amd") {
                return "amd".to_string();
            }
        }
    }
    
    #[cfg(target_os = "linux")]
    {
        if let Ok(content) = fs::read_to_string("/proc/cpuinfo") {
            let lower = content.to_lowercase();
            if lower.contains("intel") {
                return "intel".to_string();
            } else if lower.contains("amd") {
                return "amd".to_string();
            }
        }
    }
    
    "unknown".to_string()
}

fn detect_gpu_vendor() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        
        // Use WMIC to get GPU info
        let output = Command::new("wmic")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["path", "win32_videocontroller", "get", "name"])
            .output();
        
        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
            if stdout.contains("nvidia") || stdout.contains("geforce") || stdout.contains("rtx") || stdout.contains("gtx") {
                return "nvidia".to_string();
            } else if stdout.contains("amd") || stdout.contains("radeon") {
                return "amd".to_string();
            } else if stdout.contains("intel") {
                return "intel".to_string();
            }
        }
    }
    
    #[cfg(target_os = "linux")]
    {
        let output = Command::new("lspci")
            .output();
        
        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
            if stdout.contains("nvidia") {
                return "nvidia".to_string();
            } else if stdout.contains("amd") || stdout.contains("radeon") {
                return "amd".to_string();
            }
        }
    }
    
    "unknown".to_string()
}

/// Save render mode to settings
#[tauri::command]
fn save_render_mode(mode: String) -> Result<(), String> {
    let mut settings = load_settings().unwrap_or_default();
    settings.render_mode = mode;
    save_settings(settings)
}

#[tauri::command]
fn write_log(message: String) -> Result<(), String> {
    let log_path = get_app_data_dir().join("logs").join("app.log");
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let log_entry = format!("[{}] {}\n", timestamp, message);
    
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .and_then(|mut file| {
            use std::io::Write;
            file.write_all(log_entry.as_bytes())
        })
        .map_err(|e| e.to_string())
}

/// Get the size of the logs directory in bytes
#[tauri::command]
fn get_logs_size() -> Result<u64, String> {
    let logs_dir = get_app_data_dir().join("logs");
    
    // If directory doesn't exist, return 0
    if !logs_dir.exists() {
        return Ok(0);
    }
    
    let mut total_size: u64 = 0;
    
    // Walk through all files and subdirectories recursively
    for entry in WalkDir::new(&logs_dir)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            if let Ok(metadata) = entry.metadata() {
                total_size += metadata.len();
            }
        }
    }
    
    Ok(total_size)
}

/// Get the path to the logs directory
#[tauri::command]
fn get_logs_path() -> Result<String, String> {
    let logs_dir = get_app_data_dir().join("logs");
    
    // Create directory if it doesn't exist
    if !logs_dir.exists() {
        fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
    }
    
    logs_dir
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to convert path to string".to_string())
}

/// Clear all contents of the logs directory (but keep the directory itself)
#[tauri::command]
fn clear_logs() -> Result<(), String> {
    let logs_dir = get_app_data_dir().join("logs");
    
    // If directory doesn't exist, nothing to clear
    if !logs_dir.exists() {
        return Ok(());
    }
    
    // Remove all contents but keep the directory
    for entry in fs::read_dir(&logs_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        
        if path.is_file() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        } else if path.is_dir() {
            fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        }
    }
    
    Ok(())
}

/// Open the logs folder in the system file manager
#[tauri::command]
fn open_logs_folder() -> Result<(), String> {
    let logs_dir = get_app_data_dir().join("logs");
    
    // Ensure the directory exists before opening
    fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
    
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(logs_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(logs_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(logs_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

/// Show file in system file manager with file selected
#[tauri::command]
fn show_in_explorer(file_path: String) -> Result<(), String> {
    use std::path::Path;
    
    let path = Path::new(&file_path);
    
    // Check if file exists
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }
    
    #[cfg(target_os = "windows")]
    {
        // Use explorer.exe /select to highlight the file
        Command::new("explorer")
            .args(["/select,", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        // Use 'open -R' to reveal file in Finder
        Command::new("open")
            .args(["-R", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        // Try various Linux file managers
        // Most support --show-file or similar
        let managers = [
            ("nautilus", vec!["--select", &file_path]),
            ("dolphin", vec!["--select", &file_path]),
            ("nemo", vec![&file_path]),
            ("thunar", vec![&file_path]),
        ];
        
        let mut success = false;
        for (manager, args) in &managers {
            if Command::new(manager)
                .args(args.as_slice())
                .spawn()
                .is_ok()
            {
                success = true;
                break;
            }
        }
        
        if !success {
            // Fallback: open containing directory
            if let Some(parent) = path.parent() {
                Command::new("xdg-open")
                    .arg(parent)
                    .spawn()
                    .map_err(|e| format!("Failed to open file manager: {}", e))?;
            }
        }
    }
    
    Ok(())
}


// ============================================================================
// FFMPEG INTEGRATION
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FfmpegConfig {
    ffmpeg_path: String,
    ffprobe_path: String,
    discovered_at: String,
}

impl Default for FfmpegConfig {
    fn default() -> Self {
        Self {
            ffmpeg_path: String::new(),
            ffprobe_path: String::new(),
            discovered_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct FfmpegStatus {
    ffmpeg_found: bool,
    ffprobe_found: bool,
    ffmpeg_path: String,
    ffprobe_path: String,
    ffmpeg_version: String,
    ffprobe_version: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct FfmpegPaths {
    ffmpeg_path: String,
    ffprobe_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SearchResult {
    found: bool,
    path: String,
    version: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct PathResult {
    path: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct VersionResult {
    output: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SaveResult {
    success: bool,
}

fn get_ffmpeg_config_path() -> PathBuf {
    get_app_data_dir().join("ffmpeg.json")
}

fn load_ffmpeg_config() -> FfmpegConfig {
    let config_path = get_ffmpeg_config_path();
    
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }
    
    FfmpegConfig::default()
}

fn save_ffmpeg_config(config: &FfmpegConfig) -> Result<(), String> {
    let config_path = get_ffmpeg_config_path();
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    
    fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    
    Ok(())
}

/// Get version string from binary by running it with -version
fn get_binary_version_internal(path: &str) -> Option<String> {
    Command::new(path)
        .arg("-version")
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout)
                    .ok()
                    .and_then(|s| s.lines().next().map(|l| l.to_string()))
            } else {
                None
            }
        })
}

/// Search for binary in PATH using 'where' (Windows) or 'which' (Unix)
fn find_binary_in_path(binary_name: &str) -> Option<PathBuf> {
    let exe_name = if cfg!(windows) {
        format!("{}.exe", binary_name)
    } else {
        binary_name.to_string()
    };

    #[cfg(target_os = "windows")]
    {
        // Use 'where' command on Windows
        if let Ok(output) = Command::new("where").arg(&exe_name).output() {
            if output.status.success() {
                if let Ok(result) = String::from_utf8(output.stdout) {
                    // 'where' returns multiple paths, take first one
                    if let Some(first_line) = result.lines().next() {
                        let path = PathBuf::from(first_line.trim());
                        if path.exists() {
                            return path.canonicalize().ok();
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Use 'which' command on Unix-like systems
        if let Ok(output) = Command::new("which").arg(binary_name).output() {
            if output.status.success() {
                if let Ok(result) = String::from_utf8(output.stdout) {
                    let path = PathBuf::from(result.trim());
                    if path.exists() {
                        return path.canonicalize().ok();
                    }
                }
            }
        }
    }

    None
}

/// Search for binary next to the application executable
fn find_next_to_app(binary_name: &str) -> Option<PathBuf> {
    let exe_name = if cfg!(windows) {
        format!("{}.exe", binary_name)
    } else {
        binary_name.to_string()
    };

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidate = exe_dir.join(&exe_name);
            if candidate.exists() {
                return candidate.canonicalize().ok();
            }
        }
    }
    None
}

/// Search standard directories (fast search)
fn search_standard_dirs(binary_name: &str) -> Option<PathBuf> {
    let exe_name = if cfg!(windows) {
        format!("{}.exe", binary_name)
    } else {
        binary_name.to_string()
    };

    let standard_dirs = if cfg!(windows) {
        vec![
            PathBuf::from("C:\\ffmpeg\\bin"),
            PathBuf::from("C:\\ffmpeg"),
            PathBuf::from("C:\\Program Files\\ffmpeg\\bin"),
            PathBuf::from("C:\\Program Files\\ffmpeg"),
            PathBuf::from("C:\\Program Files (x86)\\ffmpeg\\bin"),
            PathBuf::from("C:\\Program Files (x86)\\ffmpeg"),
            dirs::download_dir().unwrap_or_default(),
            dirs::desktop_dir().unwrap_or_default(),
        ]
    } else {
        vec![
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/opt/homebrew/bin"),
            dirs::download_dir().unwrap_or_default(),
            dirs::desktop_dir().unwrap_or_default(),
            dirs::home_dir().unwrap_or_default().join("ffmpeg"),
        ]
    };

    for dir in standard_dirs {
        if !dir.exists() {
            continue;
        }

        let candidate = dir.join(&exe_name);
        if candidate.exists() {
            if let Ok(abs_path) = candidate.canonicalize() {
                // Validate that binary actually works
                if get_binary_version_internal(abs_path.to_str().unwrap_or("")).is_some() {
                    return Some(abs_path);
                }
            }
        }
    }

    None
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

/// Search for a single binary (ffmpeg or ffprobe) and return absolute path + version
#[tauri::command]
fn search_ffmpeg_single(name: String) -> Result<SearchResult, String> {
    // Stage 1: Try PATH first
    if let Some(path) = find_binary_in_path(&name) {
        if let Some(version) = get_binary_version_internal(path.to_str().unwrap_or("")) {
            return Ok(SearchResult {
                found: true,
                path: path.to_string_lossy().to_string(),
                version,
            });
        }
    }

    // Stage 2: Check next to app
    if let Some(path) = find_next_to_app(&name) {
        if let Some(version) = get_binary_version_internal(path.to_str().unwrap_or("")) {
            return Ok(SearchResult {
                found: true,
                path: path.to_string_lossy().to_string(),
                version,
            });
        }
    }

    // Stage 3: Search standard directories
    if let Some(path) = search_standard_dirs(&name) {
        if let Some(version) = get_binary_version_internal(path.to_str().unwrap_or("")) {
            return Ok(SearchResult {
                found: true,
                path: path.to_string_lossy().to_string(),
                version,
            });
        }
    }

    // Not found
    Ok(SearchResult {
        found: false,
        path: String::new(),
        version: String::new(),
    })
}

/// Resolve relative or short path to absolute path
#[tauri::command]
fn resolve_absolute_path(relative_path: String) -> Result<PathResult, String> {
    if relative_path.trim().is_empty() {
        return Err("Path cannot be empty".to_string());
    }

    let path = PathBuf::from(&relative_path);

    // Try to canonicalize (will fail if file doesn't exist)
    match path.canonicalize() {
        Ok(abs_path) => Ok(PathResult {
            path: abs_path.to_string_lossy().to_string(),
        }),
        Err(_) => {
            // If canonicalize fails, check if file at least exists
            if path.exists() {
                // File exists but canonicalize failed (rare case)
                Ok(PathResult {
                    path: path.to_string_lossy().to_string(),
                })
            } else {
                Err(format!("File does not exist: {}", relative_path))
            }
        }
    }
}

/// Get version output from a binary (validates it's executable)
#[tauri::command]
fn get_binary_version(binary_path: String) -> Result<VersionResult, String> {
    if binary_path.trim().is_empty() {
        return Err("Binary path cannot be empty".to_string());
    }

    // Check if file exists
    let path = PathBuf::from(&binary_path);
    if !path.exists() {
        return Err(format!("Binary not found: {}", binary_path));
    }

    // Try to get version
    match get_binary_version_internal(&binary_path) {
        Some(version) => Ok(VersionResult { output: version }),
        None => Err(format!("Cannot execute binary or get version: {}", binary_path)),
    }
}

/// Save FFmpeg and FFprobe paths to config file
#[tauri::command]
fn save_ffmpeg_paths(ffmpeg_path: String, ffprobe_path: String) -> Result<SaveResult, String> {
    let config = FfmpegConfig {
        ffmpeg_path: ffmpeg_path.trim().to_string(),
        ffprobe_path: ffprobe_path.trim().to_string(),
        discovered_at: chrono::Utc::now().to_rfc3339(),
    };

    save_ffmpeg_config(&config)?;

    Ok(SaveResult { success: true })
}

/// Load saved FFmpeg/FFprobe paths from config
#[tauri::command]
fn load_ffmpeg_paths() -> Result<FfmpegPaths, String> {
    let config = load_ffmpeg_config();
    
    Ok(FfmpegPaths {
        ffmpeg_path: config.ffmpeg_path,
        ffprobe_path: config.ffprobe_path,
    })
}

/// Check FFmpeg status - reads from config and validates binaries
#[tauri::command]
fn check_ffmpeg_status() -> Result<FfmpegStatus, String> {
    let config = load_ffmpeg_config();
    
    let mut status = FfmpegStatus {
        ffmpeg_found: false,
        ffprobe_found: false,
        ffmpeg_path: config.ffmpeg_path.clone(),
        ffprobe_path: config.ffprobe_path.clone(),
        ffmpeg_version: String::new(),
        ffprobe_version: String::new(),
    };

    // Check FFmpeg
    if !config.ffmpeg_path.is_empty() {
        if let Some(version) = get_binary_version_internal(&config.ffmpeg_path) {
            status.ffmpeg_found = true;
            status.ffmpeg_version = version;
        }
    }

    // Check FFprobe
    if !config.ffprobe_path.is_empty() {
        if let Some(version) = get_binary_version_internal(&config.ffprobe_path) {
            status.ffprobe_found = true;
            status.ffprobe_version = version;
        }
    }

    Ok(status)
}

/// Deep recursive search (slow, last resort) - kept for compatibility
fn deep_search(binary_name: &str, window: tauri::Window) -> Option<String> {
    let exe_name = if cfg!(windows) {
        format!("{}.exe", binary_name)
    } else {
        binary_name.to_string()
    };

    let search_roots = if cfg!(windows) {
        vec![PathBuf::from("C:\\")]
    } else {
        vec![PathBuf::from("/")]
    };

    for root in search_roots {
        let walker = WalkDir::new(&root)
            .max_depth(10)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                let path = e.path();
                let path_str = path.to_string_lossy().to_lowercase();
                
                if cfg!(windows) {
                    if path_str.contains("windows\\winsxs")
                        || path_str.contains("windows\\system32")
                        || path_str.contains("$recycle.bin")
                        || path_str.contains("system volume information")
                    {
                        return false;
                    }
                }
                
                true
            });

        let mut checked_count = 0;
        for entry in walker.filter_map(|e| e.ok()) {
            let path = entry.path();
            
            if path.file_name() == Some(std::ffi::OsStr::new(&exe_name)) {
                if let Ok(abs_path) = path.canonicalize() {
                    let path_str = abs_path.to_string_lossy().to_string();
                    if get_binary_version_internal(&path_str).is_some() {
                        return Some(path_str);
                    }
                }
            }

            checked_count += 1;
            if checked_count % 100 == 0 {
                let _ = window.emit("ffmpeg-search-progress", checked_count);
            }
        }
    }

    None
}

/// Fast search for FFmpeg - searches PATH and standard directories
#[tauri::command]
async fn search_ffmpeg_fast(window: tauri::Window) -> Result<FfmpegStatus, String> {
    window.emit("ffmpeg-search-stage", "Searching for FFmpeg...").ok();

    // Search for both binaries
    let ffmpeg_result = search_ffmpeg_single("ffmpeg".to_string())?;
    let ffprobe_result = search_ffmpeg_single("ffprobe".to_string())?;

    // If found, save to config
    if ffmpeg_result.found || ffprobe_result.found {
        let _ = save_ffmpeg_paths(
            if ffmpeg_result.found { ffmpeg_result.path.clone() } else { String::new() },
            if ffprobe_result.found { ffprobe_result.path.clone() } else { String::new() },
        );
    }

    check_ffmpeg_status()
}

/// Deep search (kept for compatibility with existing UI)
#[tauri::command]
async fn search_ffmpeg_deep(window: tauri::Window) -> Result<FfmpegStatus, String> {
    // First try fast search
    let fast_result = search_ffmpeg_fast(window.clone()).await?;
    
    if fast_result.ffmpeg_found && fast_result.ffprobe_found {
        return Ok(fast_result);
    }

    // Deep search for missing binaries
    let mut ffmpeg_path = fast_result.ffmpeg_path.clone();
    let mut ffprobe_path = fast_result.ffprobe_path.clone();

    if !fast_result.ffmpeg_found {
        window.emit("ffmpeg-search-stage", "Deep searching for ffmpeg...").ok();
        if let Some(path) = deep_search("ffmpeg", window.clone()) {
            ffmpeg_path = path;
        }
    }

    if !fast_result.ffprobe_found {
        window.emit("ffmpeg-search-stage", "Deep searching for ffprobe...").ok();
        if let Some(path) = deep_search("ffprobe", window.clone()) {
            ffprobe_path = path;
        }
    }

    // Save found paths
    let _ = save_ffmpeg_paths(ffmpeg_path, ffprobe_path);

    check_ffmpeg_status()
}

/// Set FFmpeg paths manually (kept for compatibility)
#[tauri::command]
fn set_ffmpeg_paths(ffmpeg_path: String, ffprobe_path: String) -> Result<FfmpegStatus, String> {
    // Validate paths if provided
    if !ffmpeg_path.is_empty() && get_binary_version_internal(&ffmpeg_path).is_none() {
        return Err("Invalid ffmpeg path or binary not executable".to_string());
    }
    if !ffprobe_path.is_empty() && get_binary_version_internal(&ffprobe_path).is_none() {
        return Err("Invalid ffprobe path or binary not executable".to_string());
    }

    // Save to config
    save_ffmpeg_paths(ffmpeg_path, ffprobe_path)?;

    check_ffmpeg_status()
}

// ============================================================================
// FFMPEG RENDERING COMMANDS
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RenderJob {
    pub job_id: String,
    pub input_path: String,
    pub output_path: String,
    pub ffmpeg_args: Vec<String>,
    pub duration_seconds: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RenderProgress {
    pub job_id: String,
    pub frame: u64,
    pub fps: f64,
    pub bitrate: String,
    pub total_size: String,
    pub time_seconds: f64,
    pub speed: f64,
    pub progress_percent: f64,
    pub eta_seconds: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RenderResult {
    pub job_id: String,
    pub success: bool,
    pub error: Option<String>,
    pub output_path: String,
}

/// Parse FFmpeg progress line and extract metrics
fn parse_ffmpeg_progress_line(line: &str) -> Option<(u64, f64, String, String, f64, f64)> {
    // Example line: frame=  150 fps=30 q=28.0 size=    1024kB time=00:00:05.00 bitrate=1677.7kbits/s speed=2.5x
    let frame_re = regex::Regex::new(r"frame=\s*(\d+)").ok()?;
    let fps_re = regex::Regex::new(r"fps=\s*([\d.]+)").ok()?;
    let size_re = regex::Regex::new(r"size=\s*(\S+)").ok()?;
    let time_re = regex::Regex::new(r"time=(\d+):(\d+):(\d+\.?\d*)").ok()?;
    let bitrate_re = regex::Regex::new(r"bitrate=\s*(\S+)").ok()?;
    let speed_re = regex::Regex::new(r"speed=\s*([\d.]+)x").ok()?;

    let frame = frame_re.captures(line)?.get(1)?.as_str().parse::<u64>().ok()?;
    let fps = fps_re.captures(line).and_then(|c| c.get(1)?.as_str().parse::<f64>().ok()).unwrap_or(0.0);
    let size = size_re.captures(line).and_then(|c| Some(c.get(1)?.as_str().to_string())).unwrap_or_default();
    let bitrate = bitrate_re.captures(line).and_then(|c| Some(c.get(1)?.as_str().to_string())).unwrap_or_default();
    let speed = speed_re.captures(line).and_then(|c| c.get(1)?.as_str().parse::<f64>().ok()).unwrap_or(0.0);

    let time_seconds = if let Some(caps) = time_re.captures(line) {
        let hours: f64 = caps.get(1)?.as_str().parse().ok()?;
        let minutes: f64 = caps.get(2)?.as_str().parse().ok()?;
        let seconds: f64 = caps.get(3)?.as_str().parse().ok()?;
        hours * 3600.0 + minutes * 60.0 + seconds
    } else {
        0.0
    };

    Some((frame, fps, size, bitrate, time_seconds, speed))
}

/// Run FFmpeg render job with progress reporting
#[tauri::command]
async fn run_ffmpeg_render(
    window: tauri::Window,
    job: RenderJob,
) -> Result<RenderResult, String> {
    let config = load_ffmpeg_config();
    
    if config.ffmpeg_path.is_empty() {
        return Err("FFmpeg path not configured".to_string());
    }

    // Log start
    let log_message = format!(
        "Starting render job: {} -> {}",
        job.input_path, job.output_path
    );
    let _ = write_log(log_message);

    // Register process with ProcessManager and get owned child handle
    let mut child = {
        let mut manager = PROCESS_MANAGER.lock()
            .map_err(|e| format!("Failed to lock ProcessManager: {}", e))?;

        let (child, pid) = manager.spawn_render(
            job.job_id.clone(),
            config.ffmpeg_path.clone(),
            job.input_path.clone(),
            job.output_path.clone(),
            job.ffmpeg_args.clone(),
        ).map_err(|e| format!("Failed to spawn render: {}", e))?;

        // eprintln!("📡 [run_ffmpeg_render] Process registered - Job: {}, PID: {}", job.job_id, pid);
        child
    };

    // Read stderr in a separate thread for progress
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    
    let job_id_stdout = job.job_id.clone();
    let job_id_stderr = job.job_id.clone();
    let job_id_final = job.job_id.clone();
    let duration = job.duration_seconds;
    let window_stdout = window.clone();
    let window_stderr = window.clone();
    let window_final = window.clone();

    // Spawn thread to read progress from stdout (pipe:1)
    let stdout_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut current_frame: u64 = 0;
        let mut current_fps: f64 = 0.0;
        let mut current_time: f64 = 0.0;
        let mut current_speed: f64 = 0.0;
        let mut current_bitrate = String::new();
        let mut current_size = String::new();

        for line in reader.lines() {
            if let Ok(line) = line {
                // Parse progress format from -progress pipe:1
                // Format is key=value pairs
                if line.starts_with("frame=") {
                    if let Ok(val) = line.trim_start_matches("frame=").parse::<u64>() {
                        current_frame = val;
                    }
                } else if line.starts_with("fps=") {
                    if let Ok(val) = line.trim_start_matches("fps=").parse::<f64>() {
                        current_fps = val;
                    }
                } else if line.starts_with("bitrate=") {
                    current_bitrate = line.trim_start_matches("bitrate=").to_string();
                } else if line.starts_with("total_size=") {
                    current_size = line.trim_start_matches("total_size=").to_string();
                } else if line.starts_with("out_time_ms=") {
                    if let Ok(val) = line.trim_start_matches("out_time_ms=").parse::<f64>() {
                        current_time = val / 1_000_000.0; // Convert microseconds to seconds
                    }
                } else if line.starts_with("speed=") {
                    let speed_str = line.trim_start_matches("speed=").trim_end_matches('x');
                    if let Ok(val) = speed_str.parse::<f64>() {
                        current_speed = val;
                    }
                } else if line.starts_with("progress=") {
                    // Emit progress event on each "progress=" line
                    let progress_percent = if duration > 0.0 {
                        (current_time / duration * 100.0).min(100.0)
                    } else {
                        0.0
                    };

                    let eta_seconds = if current_speed > 0.0 && duration > 0.0 {
                        (duration - current_time) / current_speed
                    } else {
                        0.0
                    };

                    let progress = RenderProgress {
                        job_id: job_id_stdout.clone(),
                        frame: current_frame,
                        fps: current_fps,
                        bitrate: current_bitrate.clone(),
                        total_size: current_size.clone(),
                        time_seconds: current_time,
                        speed: current_speed,
                        progress_percent,
                        eta_seconds,
                    };

                    let _ = window_stdout.emit("render-progress", &progress);
                }
            }
        }
    });

    // Spawn thread to read stderr for errors
    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        let mut errors = Vec::new();
        for line in reader.lines() {
            if let Ok(line) = line {
                // Parse traditional stderr output for backup progress
                if line.contains("frame=") && line.contains("time=") {
                    if let Some((frame, fps, size, bitrate, time, speed)) = parse_ffmpeg_progress_line(&line) {
                        let progress_percent = if duration > 0.0 {
                            (time / duration * 100.0).min(100.0)
                        } else {
                            0.0
                        };

                        let eta_seconds = if speed > 0.0 && duration > 0.0 {
                            (duration - time) / speed
                        } else {
                            0.0
                        };

                        let progress = RenderProgress {
                            job_id: job_id_stderr.clone(),
                            frame,
                            fps,
                            bitrate,
                            total_size: size,
                            time_seconds: time,
                            speed,
                            progress_percent,
                            eta_seconds,
                        };

                        let _ = window_stderr.emit("render-progress", &progress);
                    }
                }
                // Collect error lines
                if line.contains("Error") || line.contains("error") || line.contains("Invalid") {
                    errors.push(line);
                }
            }
        }
        errors
    });

    // Wait for process to complete
    let status = child.wait().map_err(|e| format!("FFmpeg process error: {}", e))?;

    // Check if this job was stopped by user
    let was_stopped = {
        let mut manager = PROCESS_MANAGER.lock()
            .map_err(|e| format!("Failed to lock ProcessManager: {}", e))?;
        manager.take_stopped(&job_id_final)
    };

    // Wait for threads
    let _ = stdout_handle.join();
    let errors = stderr_handle.join().unwrap_or_default();

    // Clean up process from manager
    {
        let mut manager = PROCESS_MANAGER.lock()
            .map_err(|e| format!("Failed to lock ProcessManager: {}", e))?;
        manager.remove_process(&job_id_final);
        // eprintln!("🧹 [run_ffmpeg_render] Process cleaned up - Job: {}", job_id_final);
    }

    // Log completion
    let log_message = format!(
        "Render job {} completed with status: {}",
        job.job_id,
        if status.success() { "success" } else { "failed" }
    );
    let _ = write_log(log_message);

    if was_stopped {
        let _ = window_final.emit("render-stopped", &serde_json::json!({
            "job_id": job.job_id,
            "stopped_by": "user"
        }));

        Ok(RenderResult {
            job_id: job.job_id,
            success: false,
            error: Some("stopped".to_string()),
            output_path: job.output_path,
        })
    } else if status.success() {
        // Emit complete event
        let _ = window_final.emit("render-complete", &job.job_id);
        
        Ok(RenderResult {
            job_id: job.job_id,
            success: true,
            error: None,
            output_path: job.output_path,
        })
    } else {
        let error_msg = if errors.is_empty() {
            format!("FFmpeg exited with code: {:?}", status.code())
        } else {
            errors.join("\n")
        };

        // Emit error event
        let _ = window_final.emit("render-error", serde_json::json!({
            "job_id": job.job_id,
            "error": error_msg.clone()
        }));

        Ok(RenderResult {
            job_id: job.job_id,
            success: false,
            error: Some(error_msg),
            output_path: job.output_path,
        })
    }
}

/// Request to stop a rendering job
#[derive(Debug, Deserialize)]
struct StopRenderRequest {
    #[serde(rename = "jobId")]
    job_id: String,
}

/// Stop a running FFmpeg render job
#[tauri::command]
fn stop_ffmpeg_render(window: tauri::Window, request: StopRenderRequest) -> Result<bool, String> {
    let job_id = request.job_id;
    
    // Mark as stopped in ProcessManager
    let pid = {
        let mut manager = PROCESS_MANAGER.lock().map_err(|e| e.to_string())?;
        let marked = manager.stop_render(&job_id);
        
        if !marked {
            eprintln!("❌ [Tauri] stop_ffmpeg_render: Process not found - Job: {}", job_id);
            manager.diagnose();
            return Ok(false);
        }
        
        // Get PID for killing
        manager.get_pid(&job_id)
    };

    // Kill the process by PID if we found it
    if let Some(pid) = pid {
        #[cfg(target_os = "windows")]
        {
            // On Windows, use taskkill command
            let _ = Command::new("taskkill")
                .arg("/PID")
                .arg(pid.to_string())
                .arg("/F")  // Force kill
                .output();
        }

        #[cfg(not(target_os = "windows"))]
        {
            // On Unix/Linux, use kill command
            let _ = Command::new("kill")
                .arg("-9")
                .arg(pid.to_string())
                .output();
        }

        // eprintln!("✅ [Tauri] stop_ffmpeg_render killed process - Job: {}, PID: {}", job_id, pid);
    }

    // Emit event that render was stopped
    let _ = window.emit("render-stopped", &serde_json::json!({
        "job_id": job_id,
        "stopped_by": "user"
    }));

    Ok(true)
}

/// Stop all running FFmpeg processes
#[tauri::command]
fn stop_all_renders(window: tauri::Window) -> Result<(), String> {
    let pids = {
        let mut manager = PROCESS_MANAGER.lock().map_err(|e| e.to_string())?;
        let active_jobs = manager.active_jobs();
        let pids = manager.active_pids();
        manager.stop_all_renders();
        // eprintln!("✅ [Tauri] stop_all_renders executed for {} jobs", active_jobs.len());
        pids
    };

    // Kill all processes by PID
    for (job_id, pid) in pids {
        #[cfg(target_os = "windows")]
        {
            let _ = Command::new("taskkill")
                .arg("/PID")
                .arg(pid.to_string())
                .arg("/F")
                .output();
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = Command::new("kill")
                .arg("-9")
                .arg(pid.to_string())
                .output();
        }

        let _ = window.emit("render-stopped", &serde_json::json!({
            "job_id": job_id,
            "stopped_by": "user"
        }));
    }
    
    Ok(())
}

/// Get video duration using FFprobe
#[tauri::command]
async fn get_video_duration(input_path: String) -> Result<f64, String> {
    let config = load_ffmpeg_config();
    
    if config.ffprobe_path.is_empty() {
        return Err("FFprobe path not configured".to_string());
    }

    #[cfg(target_os = "windows")]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new(&config.ffprobe_path)
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                &input_path
            ])
            .output()
            .map_err(|e| format!("Failed to run FFprobe: {}", e))?
    };

    #[cfg(not(target_os = "windows"))]
    let output = Command::new(&config.ffprobe_path)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            &input_path
        ])
        .output()
        .map_err(|e| format!("Failed to run FFprobe: {}", e))?;

    if !output.status.success() {
        return Err("FFprobe failed to analyze file".to_string());
    }

    let json_str = String::from_utf8(output.stdout)
        .map_err(|e| format!("Failed to parse FFprobe output: {}", e))?;

    let json: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let duration = json["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    Ok(duration)
}

/// Write render log to file
#[tauri::command]
fn write_render_log(job_id: String, message: String) -> Result<(), String> {
    let log_dir = get_app_data_dir().join("logs").join("renders");
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    
    let log_path = log_dir.join(format!("{}.log", job_id));
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let log_entry = format!("[{}] {}\n", timestamp, message);
    
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .and_then(|mut file| {
            use std::io::Write;
            file.write_all(log_entry.as_bytes())
        })
        .map_err(|e| e.to_string())
}

// Preset management commands

#[tauri::command]
fn list_presets() -> Result<Vec<String>, String> {
    let presets_dir = get_presets_dir();
    
    if !presets_dir.exists() {
        return Ok(Vec::new());
    }

    let mut preset_names = Vec::new();
    
    for entry in fs::read_dir(&presets_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Some(name) = path.file_stem().and_then(|s| s.to_str()) {
                preset_names.push(name.to_string());
            }
        }
    }
    
    preset_names.sort();
    Ok(preset_names)
}

#[tauri::command]
fn save_preset(name: String, content: String) -> Result<(), String> {
    let presets_dir = get_presets_dir();
    let preset_path = presets_dir.join(format!("{}.json", name));
    
    // Validate JSON before saving
    serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    
    fs::write(&preset_path, content)
        .map_err(|e| format!("Failed to save preset: {}", e))?;
    
    Ok(())
}

#[tauri::command]
fn load_preset(name: String) -> Result<String, String> {
    let presets_dir = get_presets_dir();
    let preset_path = presets_dir.join(format!("{}.json", name));
    
    if !preset_path.exists() {
        return Err(format!("Preset '{}' not found", name));
    }
    
    fs::read_to_string(&preset_path)
        .map_err(|e| format!("Failed to load preset: {}", e))
}

#[tauri::command]
fn delete_preset(name: String) -> Result<(), String> {
    let presets_dir = get_presets_dir();
    let preset_path = presets_dir.join(format!("{}.json", name));
    
    if !preset_path.exists() {
        return Err(format!("Preset '{}' not found", name));
    }
    
    fs::remove_file(&preset_path)
        .map_err(|e| format!("Failed to delete preset: {}", e))?;
    
    Ok(())
}

// ============================================================================
// Statistics Commands
// ============================================================================

fn get_stats_file_path() -> PathBuf {
    get_app_data_dir().join("stats").join("stat.json")
}

/// Default empty statistics structure
fn get_default_statistics() -> serde_json::Value {
    serde_json::json!({
        "renders": [],
        "totalRenders": 0,
        "totalSuccessful": 0,
        "totalFailed": 0,
        "totalStopped": 0,
        "totalRenderTime": 0,
        "lastUpdated": chrono::Local::now().to_rfc3339()
    })
}

/// Load render statistics from stats/stat.json
#[tauri::command]
fn load_statistics() -> Result<String, String> {
    let stats_path = get_stats_file_path();
    
    // Create default file if doesn't exist
    if !stats_path.exists() {
        let default_stats = get_default_statistics();
        let json_str = serde_json::to_string_pretty(&default_stats)
            .map_err(|e| format!("Failed to serialize default stats: {}", e))?;
        
        // Ensure directory exists
        if let Some(parent) = stats_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create stats dir: {}", e))?;
        }
        
        fs::write(&stats_path, &json_str)
            .map_err(|e| format!("Failed to create stats file: {}", e))?;
        
        return Ok(json_str);
    }
    
    // Read existing file
    fs::read_to_string(&stats_path)
        .map_err(|e| format!("Failed to read statistics: {}", e))
}

/// Save render statistics to stats/stat.json
#[tauri::command]
fn save_statistics(content: String) -> Result<(), String> {
    let stats_path = get_stats_file_path();
    
    // Validate JSON before saving
    serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    
    // Ensure directory exists
    if let Some(parent) = stats_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create stats dir: {}", e))?;
    }
    
    fs::write(&stats_path, &content)
        .map_err(|e| format!("Failed to save statistics: {}", e))?;
    
    Ok(())
}

/// Clear all statistics
#[tauri::command]
fn clear_statistics() -> Result<(), String> {
    let stats_path = get_stats_file_path();
    
    let default_stats = get_default_statistics();
    let json_str = serde_json::to_string_pretty(&default_stats)
        .map_err(|e| format!("Failed to serialize stats: {}", e))?;
    
    fs::write(&stats_path, &json_str)
        .map_err(|e| format!("Failed to clear statistics: {}", e))?;
    
    Ok(())
}

/// Export statistics to a specific file path
#[tauri::command]
fn export_statistics(output_path: String) -> Result<(), String> {
    let stats_path = get_stats_file_path();
    
    if !stats_path.exists() {
        return Err("No statistics to export".to_string());
    }
    
    let content = fs::read_to_string(&stats_path)
        .map_err(|e| format!("Failed to read statistics: {}", e))?;
    
    fs::write(&output_path, &content)
        .map_err(|e| format!("Failed to export statistics: {}", e))?;
    
    Ok(())
}

// ============================================================================
// Context Menu Registry Commands (Windows only)
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct ContextMenuStatus {
    pub enabled: bool,
    pub registry_path: String,
    pub exe_path: String,
    pub exe_valid: bool,
    pub needs_admin: bool,
}

/// Get current executable path
#[cfg(windows)]
fn get_current_exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| format!("Failed to get exe path: {}", e))?
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to convert exe path to string".to_string())
}

#[cfg(not(windows))]
fn get_current_exe_path() -> Result<String, String> {
    Err("Context menu is only supported on Windows".to_string())
}

const CONTEXT_MENU_NAME: &str = "CompressWithSzhimatar";
const VIDEO_EXTENSIONS: &[&str] = &[".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpeg", ".mpg", ".3gp"];

/// Check if context menu is registered and valid
#[tauri::command]
fn check_context_menu_status() -> Result<ContextMenuStatus, String> {
    #[cfg(windows)]
    {
        let exe_path = get_current_exe_path().unwrap_or_default();
        let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
        
        // Check first extension (.mp4) as representative
        let test_ext = VIDEO_EXTENSIONS[0];
        let key_path = format!(r"SystemFileAssociations\{}\shell\{}", test_ext, CONTEXT_MENU_NAME);
        
        match hkcr.open_subkey(&key_path) {
            Ok(key) => {
                // Key exists, check command
                let command_key = match key.open_subkey("command") {
                    Ok(k) => k,
                    Err(_) => return Ok(ContextMenuStatus {
                        enabled: false,
                        registry_path: format!("HKEY_CLASSES_ROOT\\SystemFileAssociations\\<ext>\\shell\\{}", CONTEXT_MENU_NAME),
                        exe_path,
                        exe_valid: false,
                        needs_admin: false,
                    }),
                };
                
                let registered_cmd: String = command_key.get_value("").unwrap_or_default();
                let exe_valid = registered_cmd.contains(&exe_path);
                
                Ok(ContextMenuStatus {
                    enabled: true,
                    registry_path: format!("HKEY_CLASSES_ROOT\\SystemFileAssociations\\<ext>\\shell\\{}", CONTEXT_MENU_NAME),
                    exe_path,
                    exe_valid,
                    needs_admin: false,
                })
            }
            Err(_) => {
                Ok(ContextMenuStatus {
                    enabled: false,
                    registry_path: format!("HKEY_CLASSES_ROOT\\SystemFileAssociations\\<ext>\\shell\\{}", CONTEXT_MENU_NAME),
                    exe_path,
                    exe_valid: false,
                    needs_admin: false,
                })
            }
        }
    }
    
    #[cfg(not(windows))]
    {
        Err("Context menu is only supported on Windows".to_string())
    }
}

/// Add context menu entry to Windows registry for all video extensions
#[tauri::command]
fn add_context_menu() -> Result<(), String> {
    #[cfg(windows)]
    {
        let exe_path = get_current_exe_path()?;
        let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
        
        // Helper to check for admin required error
        fn check_admin_error<T>(result: Result<T, std::io::Error>) -> Result<T, String> {
            result.map_err(|e| {
                let err_str = e.to_string();
                if err_str.contains("Access is denied") || e.raw_os_error() == Some(5) {
                    "ADMIN_REQUIRED".to_string()
                } else {
                    format!("Registry error: {}", err_str)
                }
            })
        }
        
        // Register for each video extension
        for ext in VIDEO_EXTENSIONS {
            let key_path = format!(r"SystemFileAssociations\{}\shell\{}", ext, CONTEXT_MENU_NAME);
            
            // Create main key
            let (key, _) = check_admin_error(hkcr.create_subkey(&key_path))?;
            
            // Set display name
            check_admin_error(key.set_value("", &"Сжать Сжиматором"))?;
            
            // Set icon
            check_admin_error(key.set_value("Icon", &format!("{},0", exe_path)))?;
            
            // Create command subkey
            let (command_key, _) = check_admin_error(key.create_subkey("command"))?;
            
            // Set command
            let command = format!(r#""{}" "%1""#, exe_path);
            check_admin_error(command_key.set_value("", &command))?;
        }
        
        Ok(())
    }
    
    #[cfg(not(windows))]
    {
        Err("Context menu is only supported on Windows".to_string())
    }
}

/// Remove context menu entry from Windows registry for all video extensions
#[tauri::command]
fn remove_context_menu() -> Result<(), String> {
    #[cfg(windows)]
    {
        let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
        
        // Remove for each video extension
        for ext in VIDEO_EXTENSIONS {
            let shell_path = format!(r"SystemFileAssociations\{}\shell", ext);
            
            // Try to open shell key with write access
            if let Ok(shell_key) = hkcr.open_subkey_with_flags(&shell_path, KEY_WRITE) {
                // Try to delete the key tree, ignore if not exists
                let _ = shell_key.delete_subkey_all(CONTEXT_MENU_NAME);
            }
        }
        
        // Verify at least one was removed by checking if any still exist
        let test_ext = VIDEO_EXTENSIONS[0];
        let key_path = format!(r"SystemFileAssociations\{}\shell\{}", test_ext, CONTEXT_MENU_NAME);
        
        if hkcr.open_subkey(&key_path).is_ok() {
            // Key still exists, probably need admin rights
            return Err("ADMIN_REQUIRED".to_string());
        }
        
        Ok(())
    }
    
    #[cfg(not(windows))]
    {
        Err("Context menu is only supported on Windows".to_string())
    }
}

// ============================================================================
// SIMPLE UPDATE SYSTEM (NO SIGNING)
// ============================================================================

use std::io::{Read, Write};
use sha2::{Sha256, Digest};

/// Get updates directory path
fn get_updates_dir() -> PathBuf {
    get_app_data_dir().join("updates")
}

/// Download update file from URL with progress reporting
#[tauri::command]
async fn download_update(
    app_handle: tauri::AppHandle,
    url: String,
    expected_hash: Option<String>,
) -> Result<serde_json::Value, String> {
    use std::io::Write;
    
    // Create updates directory
    let updates_dir = get_updates_dir();
    fs::create_dir_all(&updates_dir).map_err(|e| format!("Failed to create updates dir: {}", e))?;
    
    // Determine filename from URL
    let filename = url.split('/').last().unwrap_or("update.exe");
    let download_path = updates_dir.join(filename);
    
    // Download file using blocking client in spawn_blocking
    let url_clone = url.clone();
    let download_path_clone = download_path.clone();
    let expected_hash_clone = expected_hash.clone();
    let app_handle_clone = app_handle.clone();
    
    let result = tokio::task::spawn_blocking(move || {
        // Create HTTP client
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
        
        // Start download
        let response = client.get(&url_clone)
            .send()
            .map_err(|e| format!("Download request failed: {}", e))?;
        
        if !response.status().is_success() {
            return Err(format!("Download failed with status: {}", response.status()));
        }
        
        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;
        
        // Create file
        let mut file = std::fs::File::create(&download_path_clone)
            .map_err(|e| format!("Failed to create file: {}", e))?;
        
        // Create hasher for integrity check
        let mut hasher = Sha256::new();
        
        // Read and write in chunks with progress
        let mut reader = response;
        let mut buffer = [0u8; 8192];
        
        loop {
            let bytes_read = reader.read(&mut buffer)
                .map_err(|e| format!("Failed to read response: {}", e))?;
            
            if bytes_read == 0 {
                break;
            }
            
            file.write_all(&buffer[..bytes_read])
                .map_err(|e| format!("Failed to write file: {}", e))?;
            
            hasher.update(&buffer[..bytes_read]);
            
            downloaded += bytes_read as u64;
            
            // Emit progress event
            let _ = app_handle_clone.emit_all("update-download-progress", serde_json::json!({
                "downloaded": downloaded,
                "total": total_size
            }));
        }
        
        file.flush().map_err(|e| format!("Failed to flush file: {}", e))?;
        drop(file);
        
        // Verify hash if provided
        if let Some(expected) = expected_hash_clone {
            let hash = hex::encode(hasher.finalize());
            if hash.to_lowercase() != expected.to_lowercase() {
                // Delete file if hash doesn't match
                let _ = std::fs::remove_file(&download_path_clone);
                return Err(format!("Hash mismatch: expected {}, got {}", expected, hash));
            }
        }
        
        Ok(download_path_clone.to_string_lossy().to_string())
    }).await.map_err(|e| format!("Task error: {}", e))?;
    
    match result {
        Ok(path) => {
            // If it's a zip file, extract it
            if filename.ends_with(".zip") {
                extract_update_zip(&PathBuf::from(&path))?;
            }
            
            Ok(serde_json::json!({
                "success": true,
                "path": path
            }))
        }
        Err(e) => Ok(serde_json::json!({
            "success": false,
            "error": e
        }))
    }
}

/// Extract zip file to updates directory
fn extract_update_zip(zip_path: &PathBuf) -> Result<(), String> {
    let file = std::fs::File::open(zip_path)
        .map_err(|e| format!("Failed to open zip: {}", e))?;
    
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Failed to read zip: {}", e))?;
    
    let updates_dir = get_updates_dir();
    
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;
        
        let name = file.name().to_string();
        
        // Only extract .exe files
        if name.ends_with(".exe") {
            let outpath = updates_dir.join(
                std::path::Path::new(&name).file_name().unwrap_or_default()
            );
            
            let mut outfile = std::fs::File::create(&outpath)
                .map_err(|e| format!("Failed to create extracted file: {}", e))?;
            
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }
    
    // Remove zip after extraction
    let _ = std::fs::remove_file(zip_path);
    
    Ok(())
}

/// Apply downloaded update - creates a batch script and restarts
#[tauri::command]
fn apply_update() -> Result<serde_json::Value, String> {
    let updates_dir = get_updates_dir();
    
    // Find the new exe
    let new_exe = std::fs::read_dir(&updates_dir)
        .map_err(|e| format!("Failed to read updates dir: {}", e))?
        .filter_map(|e| e.ok())
        .find(|e| {
            e.path().extension()
                .map(|ext| ext == "exe")
                .unwrap_or(false)
        })
        .ok_or("No update executable found")?;
    
    let new_exe_path = new_exe.path();
    
    // Get current exe path
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Failed to get current exe: {}", e))?;

    // Create and run update script, then exit
    #[cfg(target_os = "windows")]
    {
        let batch_path = updates_dir.join("update.bat");

        // Clean paths to support Cyrillic: remove UNC prefix
        let src = new_exe_path.to_string_lossy().replace("\\\\?\\", "");
        let dst = current_exe.to_string_lossy().replace("\\\\?\\", "");

        // Minimal batch script, CRLF line endings, no leading spaces
        let batch_content = format!(
            "@echo off\r\n\
chcp 65001 > nul\r\n\
timeout /t 3 /nobreak > nul\r\n\
taskkill /F /IM Szhimatar.exe /T > nul 2>&1\r\n\
copy /y \"{}\" \"{}\"\r\n\
start \"\" \"{}\"\r\n\
del \"%~f0\"",
            src, dst, dst
        );

        std::fs::write(&batch_path, batch_content.as_bytes())
            .map_err(|e| format!("Failed to create update script: {}", e))?;

        std::process::Command::new("cmd")
            .args(["/C", &batch_path.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to start update script: {}", e))?;

        std::process::exit(0);
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        let script_path = updates_dir.join("update.sh");
        let script_content = format!(
            r#"#!/bin/bash
sleep 2
cp -f "{}" "{}"
chmod +x "{}"
"{}" &
rm -f "$0"
"#,
            new_exe_path.display(),
            current_exe.display(),
            current_exe.display(),
            current_exe.display()
        );
        
        std::fs::write(&script_path, script_content)
            .map_err(|e| format!("Failed to create update script: {}", e))?;
        
        std::process::Command::new("bash")
            .arg(&script_path)
            .spawn()
            .map_err(|e| format!("Failed to start update script: {}", e))?;
        
        std::process::exit(0);
    }
}

/// Restart the application
#[tauri::command]
fn restart_app(app_handle: tauri::AppHandle) {
    // Exit current process - the update script will start new one
    app_handle.exit(0);
}

/// Get files passed via command line arguments
#[tauri::command]
fn get_cli_files() -> Vec<String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    
    // Filter to only video files that exist
    let video_extensions = ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpeg", "mpg", "3gp"];
    
    args.into_iter()
        .filter(|arg| {
            let path = std::path::Path::new(arg);
            if !path.exists() || !path.is_file() {
                return false;
            }
            if let Some(ext) = path.extension() {
                video_extensions.contains(&ext.to_string_lossy().to_lowercase().as_str())
            } else {
                false
            }
        })
        .collect()
}

fn main() {
    // Ensure app directories exist
    if let Err(e) = ensure_app_dirs() {
        eprintln!("Failed to create app directories: {}", e);
    }
    
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            check_gpu_compatibility,
            detect_hardware_info,
            save_render_mode,
            write_log,
            get_logs_size,
            get_logs_path,
            clear_logs,
            open_logs_folder,
            show_in_explorer,
            // FFmpeg commands
            check_ffmpeg_status,
            search_ffmpeg_fast,
            search_ffmpeg_deep,
            set_ffmpeg_paths,
            search_ffmpeg_single,
            resolve_absolute_path,
            get_binary_version,
            save_ffmpeg_paths,
            load_ffmpeg_paths,
            // Preset commands
            list_presets,
            save_preset,
            load_preset,
            delete_preset,
            // Render commands
            run_ffmpeg_render,
            stop_ffmpeg_render,
            stop_all_renders,
            get_video_duration,
            write_render_log,
            // Statistics commands
            load_statistics,
            save_statistics,
            clear_statistics,
            export_statistics,
            // Context menu commands
            check_context_menu_status,
            add_context_menu,
            remove_context_menu,
            get_cli_files,
            // Update commands
            download_update,
            apply_update,
            restart_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
