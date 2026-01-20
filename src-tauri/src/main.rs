// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use walkdir::WalkDir;

// Global process manager for FFmpeg processes
lazy_static::lazy_static! {
    static ref PROCESS_MANAGER: Arc<Mutex<ProcessManager>> = Arc::new(Mutex::new(ProcessManager::new()));
}

struct ProcessManager {
    processes: HashMap<String, std::process::Child>,
}

impl ProcessManager {
    fn new() -> Self {
        Self {
            processes: HashMap::new(),
        }
    }

    #[allow(dead_code)]
    fn add_process(&mut self, job_id: String, process: std::process::Child) {
        self.processes.insert(job_id, process);
    }

    #[allow(dead_code)]
    fn remove_process(&mut self, job_id: &str) -> Option<std::process::Child> {
        self.processes.remove(job_id)
    }

    fn kill_process(&mut self, job_id: &str) -> bool {
        if let Some(mut process) = self.processes.remove(job_id) {
            let _ = process.kill();
            let _ = process.wait();
            return true;
        }
        false
    }

    fn kill_all(&mut self) {
        for (_, mut process) in self.processes.drain() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
}

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

    // Build command with CREATE_NO_WINDOW flag on Windows
    #[cfg(target_os = "windows")]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new(&config.ffmpeg_path);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = Command::new(&config.ffmpeg_path);

    // Add arguments
    cmd.arg("-y") // Overwrite output
        .arg("-i")
        .arg(&job.input_path)
        .args(&job.ffmpeg_args)
        .arg("-progress")
        .arg("pipe:1")
        .arg("-stats_period")
        .arg("0.5")
        .arg(&job.output_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Start process
    let mut child = cmd.spawn().map_err(|e| format!("Failed to start FFmpeg: {}", e))?;

    // Read stderr in a separate thread for progress
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    
    let job_id_stdout = job.job_id.clone();
    let job_id_stderr = job.job_id.clone();
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

    // Wait for threads
    let _ = stdout_handle.join();
    let errors = stderr_handle.join().unwrap_or_default();

    // Log completion
    let log_message = format!(
        "Render job {} completed with status: {}",
        job.job_id,
        if status.success() { "success" } else { "failed" }
    );
    let _ = write_log(log_message);

    if status.success() {
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

/// Stop a running FFmpeg render job
#[tauri::command]
fn stop_ffmpeg_render(job_id: String) -> Result<bool, String> {
    let mut manager = PROCESS_MANAGER.lock().map_err(|e| e.to_string())?;
    Ok(manager.kill_process(&job_id))
}

/// Stop all running FFmpeg processes
#[tauri::command]
fn stop_all_renders() -> Result<(), String> {
    let mut manager = PROCESS_MANAGER.lock().map_err(|e| e.to_string())?;
    manager.kill_all();
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
