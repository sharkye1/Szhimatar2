// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize)]
struct Settings {
    theme: String,
    language: String,
    ffmpeg_path: String,
    ffprobe_path: String,
    output_suffix: String,
    default_video_codec: String,
    default_audio_codec: String,
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
        }
    }
}

fn get_app_data_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".szhimatar")
}

fn ensure_app_dirs() -> Result<(), String> {
    let app_dir = get_app_data_dir();
    let logs_dir = app_dir.join("logs");
    let stats_dir = app_dir.join("stats");
    
    fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&stats_dir).map_err(|e| e.to_string())?;
    
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

// ============================================================================
// FFMPEG INTEGRATION
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
struct FfmpegStatus {
    ffmpeg_found: bool,
    ffprobe_found: bool,
    ffmpeg_path: String,
    ffprobe_path: String,
    ffmpeg_version: String,
    ffprobe_version: String,
}

/// Check if a binary is executable and get its version
fn check_binary_version(path: &str) -> Option<String> {
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

/// Search for binary in PATH
fn find_in_path(binary_name: &str) -> Option<String> {
    // Try direct command (it will search PATH automatically)
    if check_binary_version(binary_name).is_some() {
        return Some(binary_name.to_string());
    }
    None
}

/// Search for binary next to the application executable
fn find_next_to_app(binary_name: &str) -> Option<String> {
    let exe_name = if cfg!(windows) {
        format!("{}.exe", binary_name)
    } else {
        binary_name.to_string()
    };

    // Get the directory where the app is located
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidate = exe_dir.join(&exe_name);
            if candidate.exists() {
                let path_str = candidate.to_string_lossy().to_string();
                if check_binary_version(&path_str).is_some() {
                    return Some(path_str);
                }
            }
        }
    }
    None
}

/// Search standard directories (fast search)
fn search_standard_dirs(binary_name: &str) -> Option<String> {
    let exe_name = if cfg!(windows) {
        format!("{}.exe", binary_name)
    } else {
        binary_name.to_string()
    };

    let standard_dirs = if cfg!(windows) {
        vec![
            PathBuf::from("C:\\ffmpeg"),
            PathBuf::from("C:\\ffmpeg\\bin"),
            dirs::download_dir().unwrap_or_default(),
            dirs::desktop_dir().unwrap_or_default(),
            PathBuf::from("C:\\Program Files\\ffmpeg"),
            PathBuf::from("C:\\Program Files\\ffmpeg\\bin"),
            PathBuf::from("C:\\Program Files (x86)\\ffmpeg"),
            PathBuf::from("C:\\Program Files (x86)\\ffmpeg\\bin"),
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
            let path_str = candidate.to_string_lossy().to_string();
            if check_binary_version(&path_str).is_some() {
                return Some(path_str);
            }
        }
    }

    None
}

/// Deep recursive search (slow, last resort)
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
            .max_depth(10) // Limit depth to avoid infinite loops
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                // Skip system directories that definitely won't have ffmpeg
                let path = e.path();
                let path_str = path.to_string_lossy().to_lowercase();
                
                // Skip these directories on Windows
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
                let path_str = path.to_string_lossy().to_string();
                if check_binary_version(&path_str).is_some() {
                    return Some(path_str);
                }
            }

            // Emit progress every 100 files
            checked_count += 1;
            if checked_count % 100 == 0 {
                let _ = window.emit("ffmpeg-search-progress", checked_count);
            }
        }
    }

    None
}

#[tauri::command]
fn check_ffmpeg_status() -> Result<FfmpegStatus, String> {
    let settings = load_settings()?;
    
    let mut status = FfmpegStatus {
        ffmpeg_found: false,
        ffprobe_found: false,
        ffmpeg_path: settings.ffmpeg_path.clone(),
        ffprobe_path: settings.ffprobe_path.clone(),
        ffmpeg_version: String::new(),
        ffprobe_version: String::new(),
    };

    // Check saved paths first
    if let Some(version) = check_binary_version(&settings.ffmpeg_path) {
        status.ffmpeg_found = true;
        status.ffmpeg_version = version;
    } else {
        // Try to find in PATH
        if let Some(path) = find_in_path("ffmpeg") {
            if let Some(version) = check_binary_version(&path) {
                status.ffmpeg_found = true;
                status.ffmpeg_path = path;
                status.ffmpeg_version = version;
            }
        }
    }

    // Same for ffprobe
    if let Some(version) = check_binary_version(&settings.ffprobe_path) {
        status.ffprobe_found = true;
        status.ffprobe_version = version;
    } else {
        if let Some(path) = find_in_path("ffprobe") {
            if let Some(version) = check_binary_version(&path) {
                status.ffprobe_found = true;
                status.ffprobe_path = path;
                status.ffprobe_version = version;
            }
        }
    }

    Ok(status)
}

#[tauri::command]
async fn search_ffmpeg_fast(window: tauri::Window) -> Result<FfmpegStatus, String> {
    let mut ffmpeg_path = String::new();
    let mut ffprobe_path = String::new();

    // 1. Check PATH
    window.emit("ffmpeg-search-stage", "Searching in PATH...").ok();
    if let Some(path) = find_in_path("ffmpeg") {
        ffmpeg_path = path;
    }
    if let Some(path) = find_in_path("ffprobe") {
        ffprobe_path = path;
    }

    // 2. Check next to app
    if ffmpeg_path.is_empty() {
        window.emit("ffmpeg-search-stage", "Checking application directory...").ok();
        if let Some(path) = find_next_to_app("ffmpeg") {
            ffmpeg_path = path;
        }
    }
    if ffprobe_path.is_empty() {
        if let Some(path) = find_next_to_app("ffprobe") {
            ffprobe_path = path;
        }
    }

    // 3. Check standard directories
    if ffmpeg_path.is_empty() {
        window.emit("ffmpeg-search-stage", "Searching standard directories...").ok();
        if let Some(path) = search_standard_dirs("ffmpeg") {
            ffmpeg_path = path;
        }
    }
    if ffprobe_path.is_empty() {
        if let Some(path) = search_standard_dirs("ffprobe") {
            ffprobe_path = path;
        }
    }

    // Save found paths
    if !ffmpeg_path.is_empty() || !ffprobe_path.is_empty() {
        let mut settings = load_settings()?;
        if !ffmpeg_path.is_empty() {
            settings.ffmpeg_path = ffmpeg_path.clone();
        }
        if !ffprobe_path.is_empty() {
            settings.ffprobe_path = ffprobe_path.clone();
        }
        save_settings(settings)?;
    }

    check_ffmpeg_status()
}

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
        window.emit("ffmpeg-search-stage", "Deep searching for ffmpeg (this may take a while)...").ok();
        if let Some(path) = deep_search("ffmpeg", window.clone()) {
            ffmpeg_path = path;
        }
    }

    if !fast_result.ffprobe_found {
        window.emit("ffmpeg-search-stage", "Deep searching for ffprobe (this may take a while)...").ok();
        if let Some(path) = deep_search("ffprobe", window.clone()) {
            ffprobe_path = path;
        }
    }

    // Save found paths
    let mut settings = load_settings()?;
    settings.ffmpeg_path = ffmpeg_path;
    settings.ffprobe_path = ffprobe_path;
    save_settings(settings)?;

    check_ffmpeg_status()
}

#[tauri::command]
fn set_ffmpeg_paths(ffmpeg_path: String, ffprobe_path: String) -> Result<FfmpegStatus, String> {
    // Validate paths
    if !ffmpeg_path.is_empty() && check_binary_version(&ffmpeg_path).is_none() {
        return Err("Invalid ffmpeg path or binary not executable".to_string());
    }
    if !ffprobe_path.is_empty() && check_binary_version(&ffprobe_path).is_none() {
        return Err("Invalid ffprobe path or binary not executable".to_string());
    }

    // Save to settings
    let mut settings = load_settings()?;
    settings.ffmpeg_path = ffmpeg_path;
    settings.ffprobe_path = ffprobe_path;
    save_settings(settings)?;

    check_ffmpeg_status()
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
            write_log,
            check_ffmpeg_status,
            search_ffmpeg_fast,
            search_ffmpeg_deep,
            set_ffmpeg_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
