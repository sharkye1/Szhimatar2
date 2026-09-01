use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

lazy_static! {
    static ref PROGRESS_RE: Regex =
        Regex::new(r"(?P<percent>\d+(?:\.\d+)?)%").expect("valid yt-dlp progress regex");
    static ref ETA_RE: Regex =
        Regex::new(r"ETA\s+(?P<eta>[0-9:]+)").expect("valid yt-dlp ETA regex");
    static ref SPEED_RE: Regex =
        Regex::new(r"at\s+(?P<speed>[^\s]+)").expect("valid yt-dlp speed regex");
    static ref MERGER_RE: Regex =
        Regex::new(r#"\[Merger\]\s+Merging formats into "([^"]+)""#).expect("valid merger regex");
    static ref DEST_RE: Regex =
        Regex::new(r#"\[download\]\s+Destination:\s+(.+)$"#).expect("valid dest regex");
    static ref EXTRACT_AUDIO_RE: Regex =
        Regex::new(r#"\[ExtractAudio\]\s+Destination:\s+(.+)$"#).expect("valid extract audio regex");
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatOption {
    pub label: String,
    pub quality: String,
    pub format: String,
    pub ext: String,
    pub height: Option<u32>,
    pub filesize: Option<u64>,
    pub is_audio_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoMetadataResponse {
    pub title: Option<String>,
    pub duration: Option<f64>,
    pub formats: Vec<FormatOption>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct YtDlpFormat {
    ext: Option<String>,
    height: Option<u32>,
    filesize: Option<u64>,
    filesize_approx: Option<u64>,
    acodec: Option<String>,
    vcodec: Option<String>,
}

impl YtDlpFormat {
    fn effective_filesize(&self) -> Option<u64> {
        self.filesize.or(self.filesize_approx)
    }
}

#[derive(Debug, Deserialize)]
struct YtDlpInfo {
    title: Option<String>,
    duration: Option<f64>,
    #[serde(default)]
    formats: Vec<YtDlpFormat>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadStartedPayload {
    pub job_id: String,
    pub url: String,
    pub title: Option<String>,
    pub save_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgressPayload {
    pub job_id: String,
    pub url: String,
    pub title: Option<String>,
    pub progress_percent: f64,
    pub eta: Option<String>,
    pub speed: Option<String>,
    pub total_size: Option<String>,
    pub line: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadCompletePayload {
    pub job_id: String,
    pub url: String,
    pub title: String,
    pub file_path: String,
    pub file_size: String,
    pub file_size_bytes: u64,
    pub duration_seconds: Option<f64>,
    pub duration_formatted: Option<String>,
    pub save_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadErrorPayload {
    pub job_id: String,
    pub url: String,
    pub error: String,
}

fn yt_dlp_executable_name() -> &'static str {
    if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

fn yt_dlp_root_dir() -> Result<PathBuf, String> {
    Ok(crate::get_app_data_dir().join("yt-dlp"))
}

fn yt_dlp_path() -> Result<PathBuf, String> {
    Ok(yt_dlp_root_dir()?.join(yt_dlp_executable_name()))
}

fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;

    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} GB", b / GB)
    } else if b >= MB {
        format!("{:.1} MB", b / MB)
    } else if b >= KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

fn format_duration_compact(seconds: f64) -> String {
    let s = seconds.round().max(0.0) as u64;
    let mins = s / 60;
    let secs = s % 60;
    if mins >= 60 {
        let hrs = mins / 60;
        let mins_rem = mins % 60;
        format!("{:02}:{:02}:{:02}", hrs, mins_rem, secs)
    } else {
        format!("{:02}:{:02}", mins, secs)
    }
}

fn resolve_ffmpeg_location() -> Option<PathBuf> {
    let config_path = crate::get_app_data_dir().join("ffmpeg.json");
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(ffmpeg_path_str) = value.get("ffmpeg_path").and_then(|v| v.as_str()) {
                    let trimmed = ffmpeg_path_str.trim().trim_matches('"').trim_matches('\'');
                    if !trimmed.is_empty() {
                        let path = PathBuf::from(trimmed);
                        if path.exists() {
                            if let Some(parent) = path.parent() {
                                return Some(parent.to_path_buf());
                            } else {
                                return Some(path);
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(windows)]
    {
        for dir in &[
            PathBuf::from("C:\\ffmpeg\\bin"),
            PathBuf::from("C:\\ffmpeg"),
            PathBuf::from("C:\\Program Files\\ffmpeg\\bin"),
            PathBuf::from("C:\\Program Files\\ffmpeg"),
            PathBuf::from("C:\\Program Files (x86)\\ffmpeg\\bin"),
            PathBuf::from("C:\\Program Files (x86)\\ffmpeg"),
        ] {
            if dir.join("ffmpeg.exe").exists() {
                return Some(dir.clone());
            }
        }
    }

    None
}

fn yt_dlp_download_filename() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Ok("yt-dlp.exe"),
        ("macos", "x86_64") | ("macos", "aarch64") => Ok("yt-dlp_macos"),
        ("linux", "x86_64") => Ok("yt-dlp_linux"),
        (os, arch) => Err(format!("Unsupported OS/Arch: {}/{}", os, arch)),
    }
}

fn yt_dlp_download_url() -> Result<String, String> {
    let filename = yt_dlp_download_filename()?;
    Ok(format!(
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/{}",
        filename
    ))
}

fn ensure_parent_dir(path: &PathBuf) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Failed to resolve yt-dlp directory".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())
}

fn install_permissions(_path: &PathBuf) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut perms = fs::metadata(_path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(_path, perms).map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub async fn ensure_yt_dlp_installed(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let yt_dlp_path = yt_dlp_path()?;

    if yt_dlp_path.exists() {
        return Ok(yt_dlp_path);
    }

    ensure_parent_dir(&yt_dlp_path)?;

    let url = yt_dlp_download_url()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download yt-dlp from {}: status {}",
            url,
            response.status()
        ));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(&yt_dlp_path, bytes).await.map_err(|e| e.to_string())?;
    install_permissions(&yt_dlp_path)?;

    let _ = app_handle.emit_all(
        "download-manager-log",
        format!("yt-dlp downloaded to {}", yt_dlp_path.display()),
    );

    Ok(yt_dlp_path)
}

pub fn bootstrap_yt_dlp(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        match ensure_yt_dlp_installed(&app_handle).await {
            Ok(_) => update_yt_dlp_in_background(app_handle),
            Err(error) => eprintln!("Failed to bootstrap yt-dlp: {}", error),
        }
    });
}

pub fn update_yt_dlp_in_background(app_handle: AppHandle) {
    let yt_dlp_path = match yt_dlp_path() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("Failed to resolve yt-dlp path for update: {}", error);
            return;
        }
    };

    if !yt_dlp_path.exists() {
        eprintln!(
            "yt-dlp update skipped because binary does not exist: {}",
            yt_dlp_path.display()
        );
        return;
    }

    tauri::async_runtime::spawn(async move {
        let mut cmd = tokio::process::Command::new(&yt_dlp_path);
        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd.env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .arg("-U");
        let output = cmd.output().await;

        match output {
            Ok(output) => {
                if output.status.success() {
                    let _ = app_handle.emit_all(
                        "download-manager-log",
                        String::from_utf8_lossy(&output.stdout).to_string(),
                    );
                } else {
                    eprintln!(
                        "yt-dlp update failed: {}",
                        String::from_utf8_lossy(&output.stderr)
                    );
                }
            }
            Err(error) => {
                eprintln!("Failed to run yt-dlp update command: {}", error);
            }
        }
    });
}

async fn run_yt_dlp_output(
    app_handle: &AppHandle,
    args: &[String],
) -> Result<std::process::Output, String> {
    let yt_dlp_path = ensure_yt_dlp_installed(app_handle).await?;

    let mut command = tokio::process::Command::new(&yt_dlp_path);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .args(args);

    let output = command.output().await.map_err(|e| e.to_string())?;
    Ok(output)
}

fn format_label(height: u32, ext: &str) -> String {
    if ext.eq_ignore_ascii_case("mp4") {
        format!("MP4 {}p", height)
    } else {
        format!("{} {}p", ext.to_uppercase(), height)
    }
}

fn choose_best_video_formats(info: &YtDlpInfo) -> Vec<FormatOption> {
    let mut by_height: BTreeMap<u32, &YtDlpFormat> = BTreeMap::new();

    for format in &info.formats {
        let is_video = format
            .vcodec
            .as_deref()
            .map(|value| value != "none")
            .unwrap_or(false);

        if !is_video {
            continue;
        }

        if let Some(height) = format.height {
            if height == 0 {
                continue;
            }

            let entry = by_height.entry(height).or_insert(format);
            let ext = format.ext.as_deref().unwrap_or("");
            let existing_ext = entry.ext.as_deref().unwrap_or("");

            if existing_ext != "mp4" && ext == "mp4" {
                *entry = format;
            } else if ext == existing_ext {
                let size = format.effective_filesize().unwrap_or(0);
                let existing_size = entry.effective_filesize().unwrap_or(0);
                if size > existing_size {
                    *entry = format;
                }
            }
        }
    }

    let mut options = Vec::new();

    options.push(FormatOption {
        label: "Best Quality (Auto)".to_string(),
        quality: "bestvideo+bestaudio/best".to_string(),
        format: "mp4".to_string(),
        ext: "mp4".to_string(),
        height: None,
        filesize: None,
        is_audio_only: false,
    });

    options.push(FormatOption {
        label: "Audio Only (MP3)".to_string(),
        quality: "bestaudio/best".to_string(),
        format: "mp3".to_string(),
        ext: "mp3".to_string(),
        height: None,
        filesize: None,
        is_audio_only: true,
    });

    for (height, format) in by_height.iter().rev() {
        let ext = format
            .ext
            .clone()
            .unwrap_or_else(|| "mp4".to_string())
            .to_lowercase();
        let selector = format!("bestvideo[height<={}]+bestaudio/best[height<={}]/best", height, height);

        options.insert(
            options.len().saturating_sub(1),
            FormatOption {
                label: format_label(*height, &ext),
                quality: selector,
                format: ext.clone(),
                ext,
                height: Some(*height),
                filesize: format.effective_filesize(),
                is_audio_only: false,
            },
        );
    }

    options
}

#[tauri::command]
pub fn get_system_download_dir() -> Result<String, String> {
    let dir = dirs::download_dir()
        .or_else(dirs::desktop_dir)
        .unwrap_or_else(|| crate::get_app_data_dir().join("downloads"));
    Ok(dir.display().to_string())
}

#[tauri::command]
pub async fn get_video_formats(app_handle: AppHandle, url: String) -> Result<VideoMetadataResponse, String> {
    let mut args = vec![
        "-J".to_string(),
        "--encoding".to_string(),
        "utf-8".to_string(),
        "--force-ipv4".to_string(),
        "--retries".to_string(),
        "10".to_string(),
        "--fragment-retries".to_string(),
        "10".to_string(),
        "--no-check-certificates".to_string(),
        "--no-colors".to_string(),
        "--user-agent".to_string(),
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string(),
        "--no-warnings".to_string(),
        "--no-playlist".to_string(),
        "--flat-playlist".to_string(),
        "--no-check-formats".to_string(),
        "--skip-download".to_string(),
        "--compat-options".to_string(),
        "no-youtube-unavailable-videos".to_string(),
    ];

    if let Some(ffmpeg_loc) = resolve_ffmpeg_location() {
        let normalized = ffmpeg_loc.to_string_lossy().replace('\\', "/");
        args.push("--ffmpeg-location".to_string());
        args.push(normalized);
    }

    args.push(url);

    let output = run_yt_dlp_output(&app_handle, &args).await?;

    if !output.status.success() {
        let err_text = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if !err_text.is_empty() {
            err_text
        } else {
            format!("yt-dlp format discovery failed with status: {}", output.status)
        });
    }

    let info: YtDlpInfo = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let _ = app_handle.emit_all(
        "download-manager-log",
        format!(
            "Discovered yt-dlp formats for {}{}",
            info.title.as_deref().unwrap_or("media"),
            if info.formats.is_empty() {
                " (no formats found)"
            } else {
                ""
            }
        ),
    );

    let formats = choose_best_video_formats(&info);
    Ok(VideoMetadataResponse {
        title: info.title,
        duration: info.duration,
        formats,
    })
}

fn parse_progress_line(line: &str) -> Option<(f64, Option<String>, Option<String>, Option<String>)> {
    if let Some(pos) = line.find("SZ_PROGRESS:") {
        let payload = &line[pos + "SZ_PROGRESS:".len()..];
        let parts: Vec<&str> = payload.split('|').collect();
        if !parts.is_empty() {
            let percent_str = parts[0].trim().trim_end_matches('%');
            let percent = percent_str.parse::<f64>().ok()?;
            let eta = parts.get(1).map(|s| s.trim()).filter(|s| !s.is_empty() && *s != "NA").map(|s| s.to_string());
            let speed = parts.get(2).map(|s| s.trim()).filter(|s| !s.is_empty() && *s != "NA").map(|s| s.to_string());
            let total_size = parts.get(3).map(|s| s.trim()).filter(|s| !s.is_empty() && *s != "NA").map(|s| s.to_string());
            return Some((percent, eta, speed, total_size));
        }
    }

    let percent = PROGRESS_RE
        .captures(line)
        .and_then(|caps| caps.name("percent"))
        .and_then(|value| value.as_str().parse::<f64>().ok())?;

    let eta = ETA_RE
        .captures(line)
        .and_then(|caps| caps.name("eta"))
        .map(|value| value.as_str().to_string());

    let speed = SPEED_RE
        .captures(line)
        .and_then(|caps| caps.name("speed"))
        .map(|value| value.as_str().to_string());

    Some((percent, eta, speed, None))
}

#[tauri::command]
pub async fn download_media_link(
    app_handle: AppHandle,
    url: String,
    quality: String,
    format: String,
    save_path: String,
    job_id: Option<String>,
    initial_title: Option<String>,
) -> Result<String, String> {
    let yt_dlp_path = ensure_yt_dlp_installed(&app_handle).await?;
    let job_id =
        job_id.unwrap_or_else(|| format!("download-{}", chrono::Utc::now().timestamp_millis()));
    
    let clean_path_str = save_path.trim().trim_matches('"').trim_matches('\'').trim();
    let is_placeholder = clean_path_str.is_empty() 
        || clean_path_str.eq_ignore_ascii_case("downloads") 
        || clean_path_str == "Папка загрузок" 
        || clean_path_str == "Downloads folder";

    let resolved_save_path = if is_placeholder || !Path::new(clean_path_str).is_absolute() {
        dirs::download_dir()
            .or_else(dirs::desktop_dir)
            .unwrap_or_else(|| crate::get_app_data_dir().join("downloads"))
    } else {
        PathBuf::from(clean_path_str)
    };

    tokio::fs::create_dir_all(&resolved_save_path).await.map_err(|e| e.to_string())?;

    let normalized_save_path_str = resolved_save_path.to_string_lossy().replace('\\', "/");
    let job_id_clone = job_id.clone();
    let cancel_token = tokio_util::sync::CancellationToken::new();
    let cancel_token_clone = cancel_token.clone();

    let _ = app_handle.emit_all(
        "download-started",
        DownloadStartedPayload {
            job_id: job_id_clone.clone(),
            url: url.clone(),
            title: initial_title.clone(),
            save_path: resolved_save_path.display().to_string(),
        },
    );

    tauri::async_runtime::spawn(async move {
        let mut command = tokio::process::Command::new(&yt_dlp_path);
        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        command
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .env("PYTHONLEGACYWINDOWSSTDIO", "utf-8")
            .arg("--encoding")
            .arg("utf-8")
            .arg("--newline")
            .arg("--no-colors")
            .arg("--force-ipv4")
            .arg("--retries")
            .arg("10")
            .arg("--fragment-retries")
            .arg("10")
            .arg("--no-check-certificates")
            .arg("--windows-filenames")
            .arg("--user-agent")
            .arg("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .arg("--no-warnings")
            .arg("--no-playlist")
            .arg("--compat-options")
            .arg("no-youtube-unavailable-videos")
            .arg("-P")
            .arg(&normalized_save_path_str)
            .arg("-o")
            .arg("%(title).150s.%(ext)s")
            .arg("--print")
            .arg("SZ_TITLE:%(title)s")
            .arg("--print")
            .arg("SZ_DURATION:%(duration)s")
            .arg("--print")
            .arg("after_move:SZ_FILEPATH:%(filepath)s")
            .arg("--progress-template")
            .arg("download:SZ_PROGRESS:%(progress._percent_str)s|%(progress._eta_str)s|%(progress._speed_str)s|%(progress._total_bytes_estimate_str,progress._downloaded_bytes_str)s")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        if let Some(ffmpeg_loc) = resolve_ffmpeg_location() {
            let normalized_ffmpeg = ffmpeg_loc.to_string_lossy().replace('\\', "/");
            command.arg("--ffmpeg-location").arg(normalized_ffmpeg);
        }

        if format.eq_ignore_ascii_case("mp3") {
            command.arg("-x").arg("--audio-format").arg("mp3");
        } else {
            if !quality.trim().is_empty() {
                command.arg("-f").arg(&quality);
            }

            command.arg("--merge-output-format").arg("mp4");
        }

        command.arg(&url);

        let mut child = match command.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_handle.emit_all(
                    "download-error",
                    DownloadErrorPayload {
                        job_id: job_id_clone.clone(),
                        url,
                        error: format!("Failed to spawn yt-dlp: {}", e),
                    },
                );
                return;
            }
        };

        // Register in ProcessManager
        {
            if let Ok(mut manager) = crate::process_manager::PROCESS_MANAGER.lock() {
                manager.register(
                    job_id_clone.clone(),
                    crate::process_manager::TaskType::Download,
                    child.id(),
                    cancel_token_clone.clone(),
                );
            }
        }

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let app_handle_progress = app_handle.clone();
        let job_id_progress = job_id_clone.clone();
        let url_progress = url.clone();

        let discovered_title: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(initial_title));
        let discovered_duration: Arc<Mutex<Option<f64>>> = Arc::new(Mutex::new(None));
        let discovered_filepath: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

        let title_for_stdout = Arc::clone(&discovered_title);
        let duration_for_stdout = Arc::clone(&discovered_duration);
        let filepath_for_stdout = Arc::clone(&discovered_filepath);

        let stdout_handle = tokio::spawn(async move {
            let mut last_line = String::new();
            let mut last_emit = Instant::now() - Duration::from_millis(200);

            if let Some(stdout) = stdout {
                use tokio::io::AsyncBufReadExt;
                let reader = tokio::io::BufReader::new(stdout);
                let mut lines = reader.lines();

                while let Ok(Some(line)) = lines.next_line().await {
                    let trimmed = line.trim();

                    // Parse custom markers
                    if let Some(pos) = trimmed.find("SZ_TITLE:") {
                        let title = trimmed[pos + "SZ_TITLE:".len()..].trim().to_string();
                        if !title.is_empty() {
                            if let Ok(mut lock) = title_for_stdout.lock() {
                                *lock = Some(title.clone());
                            }
                            let _ = app_handle_progress.emit_all(
                                "download-progress",
                                DownloadProgressPayload {
                                    job_id: job_id_progress.clone(),
                                    url: url_progress.clone(),
                                    title: Some(title),
                                    progress_percent: 0.0,
                                    eta: None,
                                    speed: None,
                                    total_size: None,
                                    line: line.clone(),
                                },
                            );
                        }
                    } else if let Some(pos) = trimmed.find("SZ_DURATION:") {
                        let dur_str = trimmed[pos + "SZ_DURATION:".len()..].trim();
                        if let Ok(dur) = dur_str.parse::<f64>() {
                            if let Ok(mut lock) = duration_for_stdout.lock() {
                                *lock = Some(dur);
                            }
                        }
                    } else if let Some(pos) = trimmed.find("SZ_FILEPATH:") {
                        let path = trimmed[pos + "SZ_FILEPATH:".len()..].trim().to_string();
                        if !path.is_empty() {
                            if let Ok(mut lock) = filepath_for_stdout.lock() {
                                *lock = Some(path);
                            }
                        }
                    }

                    // Fallback path detector from yt-dlp logs
                    if let Some(caps) = MERGER_RE.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            if let Ok(mut lock) = filepath_for_stdout.lock() {
                                if lock.is_none() {
                                    *lock = Some(m.as_str().to_string());
                                }
                            }
                        }
                    } else if let Some(caps) = DEST_RE.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            if let Ok(mut lock) = filepath_for_stdout.lock() {
                                if lock.is_none() {
                                    *lock = Some(m.as_str().to_string());
                                }
                            }
                        }
                    } else if let Some(caps) = EXTRACT_AUDIO_RE.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            if let Ok(mut lock) = filepath_for_stdout.lock() {
                                if lock.is_none() {
                                    *lock = Some(m.as_str().to_string());
                                }
                            }
                        }
                    }

                    if let Some((progress_percent, eta, speed, total_size)) = parse_progress_line(&line) {
                        if last_emit.elapsed() >= Duration::from_millis(80) || progress_percent >= 100.0 {
                            last_emit = Instant::now();
                            let cur_title = title_for_stdout.lock().ok().and_then(|t| t.clone());
                            let _ = app_handle_progress.emit_all(
                                "download-progress",
                                DownloadProgressPayload {
                                    job_id: job_id_progress.clone(),
                                    url: url_progress.clone(),
                                    title: cur_title,
                                    progress_percent,
                                    eta,
                                    speed,
                                    total_size,
                                    line: line.clone(),
                                },
                            );
                        }
                    }
                    if !line.trim().is_empty() {
                        last_line = line;
                    }
                }
            }
            last_line
        });

        let stderr_handle = tokio::spawn(async move {
            let mut err_lines = Vec::new();
            if let Some(stderr) = stderr {
                use tokio::io::AsyncBufReadExt;
                let reader = tokio::io::BufReader::new(stderr);
                let mut lines = reader.lines();

                while let Ok(Some(line)) = lines.next_line().await {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() && !trimmed.starts_with("WARNING:") {
                        err_lines.push(line);
                    }
                }
            }
            err_lines.join("\n")
        });

        tokio::select! {
            res = child.wait() => {
                let last_stdout: String = stdout_handle.await.unwrap_or_default();
                let stderr_output: String = stderr_handle.await.unwrap_or_default();

                let status = match res {
                    Ok(s) => s,
                    Err(e) => {
                        let _ = app_handle.emit_all(
                            "download-error",
                            DownloadErrorPayload {
                                job_id: job_id_clone.clone(),
                                url,
                                error: format!("yt-dlp wait error: {}", e),
                            },
                        );
                        if let Ok(mut manager) = crate::process_manager::PROCESS_MANAGER.lock() {
                            manager.unregister(&job_id_clone);
                        }
                        return;
                    }
                };

                let was_stopped = {
                    if let Ok(mut manager) = crate::process_manager::PROCESS_MANAGER.lock() {
                        manager.take_stopped(&job_id_clone)
                    } else {
                        false
                    }
                };

                if was_stopped {
                    let _ = app_handle.emit_all(
                        "download-stopped",
                        serde_json::json!({
                            "job_id": job_id_clone.clone(),
                            "stopped_by": "user"
                        }),
                    );
                } else if status.success() {
                    let final_title = discovered_title
                        .lock()
                        .ok()
                        .and_then(|t| t.clone())
                        .unwrap_or_else(|| {
                            "Downloaded Media".to_string()
                        });

                    let explicit_filepath = discovered_filepath.lock().ok().and_then(|f| f.clone());
                    let final_filepath = match explicit_filepath {
                        Some(p) => {
                            let path = PathBuf::from(&p);
                            if path.is_absolute() {
                                path
                            } else {
                                resolved_save_path.join(path)
                            }
                        }
                        None => {
                            // Find newest matching file in resolved_save_path
                            let mut newest_file: Option<(PathBuf, std::time::SystemTime)> = None;
                            if let Ok(entries) = fs::read_dir(&resolved_save_path) {
                                for entry in entries.flatten() {
                                    let path = entry.path();
                                    if path.is_file() {
                                        if let Ok(meta) = path.metadata() {
                                            if let Ok(modified) = meta.modified() {
                                                if newest_file.as_ref().map(|(_, t)| modified > *t).unwrap_or(true) {
                                                    newest_file = Some((path, modified));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            newest_file.map(|(p, _)| p).unwrap_or_else(|| resolved_save_path.clone())
                        }
                    };

                    let file_size_bytes = if final_filepath.is_file() {
                        fs::metadata(&final_filepath).map(|m| m.len()).unwrap_or(0)
                    } else {
                        0
                    };

                    let file_size_str = if file_size_bytes > 0 {
                        format_bytes(file_size_bytes)
                    } else {
                        "—".to_string()
                    };

                    let final_duration = discovered_duration.lock().ok().and_then(|d| *d);
                    let final_duration_str = final_duration.map(format_duration_compact);

                    let _ = app_handle.emit_all(
                        "download-complete",
                        DownloadCompletePayload {
                            job_id: job_id_clone.clone(),
                            url,
                            title: final_title,
                            file_path: final_filepath.display().to_string(),
                            file_size: file_size_str,
                            file_size_bytes,
                            duration_seconds: final_duration,
                            duration_formatted: final_duration_str,
                            save_path: resolved_save_path.display().to_string(),
                        },
                    );
                } else {
                    let error_msg = if !stderr_output.trim().is_empty() {
                        stderr_output.trim().to_string()
                    } else if !last_stdout.trim().is_empty() {
                        last_stdout.trim().to_string()
                    } else {
                        format!("yt-dlp exited with status: {}", status)
                    };

                    let _ = app_handle.emit_all(
                        "download-error",
                        DownloadErrorPayload {
                            job_id: job_id_clone.clone(),
                            url,
                            error: error_msg,
                        },
                    );
                }
            }
            _ = cancel_token_clone.cancelled() => {
                eprintln!("🛑 [yt-dlp] Download {} cancelled by user", job_id_clone);
                let _ = child.kill().await;
                let _ = app_handle.emit_all(
                    "download-stopped",
                    serde_json::json!({
                        "job_id": job_id_clone.clone(),
                        "stopped_by": "user"
                    }),
                );
            }
        }

        // Clean up task from manager
        if let Ok(mut manager) = crate::process_manager::PROCESS_MANAGER.lock() {
            manager.unregister(&job_id_clone);
        }
    });

    Ok(job_id)
}

#[tauri::command]
pub fn stop_media_download(job_id: String) -> Result<bool, String> {
    let mut manager = crate::process_manager::PROCESS_MANAGER
        .lock()
        .map_err(|e| e.to_string())?;
    Ok(manager.cancel_task(&job_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_progress_custom_marker() {
        let line = "SZ_PROGRESS:45.5%|00:12|2.50MiB/s|14.2MiB";
        let parsed = parse_progress_line(line);
        assert!(parsed.is_some());
        let (percent, eta, speed, total_size) = parsed.unwrap();
        assert!((percent - 45.5).abs() < 1e-6);
        assert_eq!(eta, Some("00:12".to_string()));
        assert_eq!(speed, Some("2.50MiB/s".to_string()));
        assert_eq!(total_size, Some("14.2MiB".to_string()));
    }

    #[test]
    fn test_parse_progress_fallback_standard() {
        let line = "[download]  23.5% of 10.00MiB at 2.50MiB/s ETA 00:03";
        let parsed = parse_progress_line(line);
        assert!(parsed.is_some());
        let (percent, eta, speed, _) = parsed.unwrap();
        assert!((percent - 23.5).abs() < 1e-6);
        assert_eq!(eta, Some("00:03".to_string()));
        assert_eq!(speed, Some("2.50MiB/s".to_string()));
    }

    #[test]
    fn test_format_bytes() {
        assert_eq!(format_bytes(500), "500 B");
        assert_eq!(format_bytes(1024 * 500), "500.0 KB");
        assert_eq!(format_bytes(1024 * 1024 * 14 + 1024 * 200), "14.2 MB");
    }

    #[test]
    fn test_format_duration_compact() {
        assert_eq!(format_duration_compact(65.0), "01:05");
        assert_eq!(format_duration_compact(213.0), "03:33");
        assert_eq!(format_duration_compact(3665.0), "01:01:05");
    }

    #[test]
    fn test_choose_best_video_formats_with_approx() {
        let info = YtDlpInfo {
            title: Some("Test Video".to_string()),
            duration: Some(120.0),
            formats: vec![
                YtDlpFormat {
                    ext: Some("mp4".to_string()),
                    height: Some(1080),
                    filesize: None,
                    filesize_approx: Some(50_000_000),
                    acodec: Some("mp4a.40.2".to_string()),
                    vcodec: Some("avc1.640028".to_string()),
                },
                YtDlpFormat {
                    ext: Some("mp4".to_string()),
                    height: Some(720),
                    filesize: Some(25_000_000),
                    filesize_approx: None,
                    acodec: Some("mp4a.40.2".to_string()),
                    vcodec: Some("avc1.4d401f".to_string()),
                },
            ],
        };

        let options = choose_best_video_formats(&info);
        assert!(options.iter().any(|o| o.label == "MP4 1080p"));
        assert!(options.iter().any(|o| o.label == "MP4 720p"));
        let opt_1080 = options.iter().find(|o| o.label == "MP4 1080p").unwrap();
        assert_eq!(opt_1080.filesize, Some(50_000_000));
    }
}

