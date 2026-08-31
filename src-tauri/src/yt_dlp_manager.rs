use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

lazy_static! {
    static ref PROGRESS_RE: Regex =
        Regex::new(r"(?P<percent>\d+(?:\.\d+)?)%").expect("valid yt-dlp progress regex");
    static ref ETA_RE: Regex =
        Regex::new(r"ETA\s+(?P<eta>[0-9:]+)").expect("valid yt-dlp ETA regex");
    static ref SPEED_RE: Regex =
        Regex::new(r"at\s+(?P<speed>[^\s]+)").expect("valid yt-dlp speed regex");
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

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct YtDlpFormat {
    ext: Option<String>,
    height: Option<u32>,
    filesize: Option<u64>,
    acodec: Option<String>,
    vcodec: Option<String>,
}

#[derive(Debug, Deserialize)]
struct YtDlpInfo {
    title: Option<String>,
    formats: Vec<YtDlpFormat>,
}

#[derive(Debug, Clone, Serialize)]
struct DownloadProgressPayload {
    job_id: String,
    url: String,
    progress_percent: f64,
    eta: Option<String>,
    speed: Option<String>,
    line: String,
}

#[derive(Debug, Clone, Serialize)]
struct DownloadCompletePayload {
    job_id: String,
    url: String,
    save_path: String,
}

#[derive(Debug, Clone, Serialize)]
struct DownloadErrorPayload {
    job_id: String,
    url: String,
    error: String,
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
                let size = format.filesize.unwrap_or(0);
                let existing_size = entry.filesize.unwrap_or(0);
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
                filesize: format.filesize,
                is_audio_only: false,
            },
        );
    }

    options
}

#[tauri::command]
pub async fn get_video_formats(app_handle: AppHandle, url: String) -> Result<Vec<FormatOption>, String> {
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

    Ok(choose_best_video_formats(&info))
}

fn parse_progress_line(line: &str) -> Option<(f64, Option<String>, Option<String>)> {
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

    Some((percent, eta, speed))
}

#[tauri::command]
pub async fn download_media_link(
    app_handle: AppHandle,
    url: String,
    quality: String,
    format: String,
    save_path: String,
    job_id: Option<String>,
) -> Result<String, String> {
    let yt_dlp_path = ensure_yt_dlp_installed(&app_handle).await?;
    let job_id =
        job_id.unwrap_or_else(|| format!("download-{}", chrono::Utc::now().timestamp_millis()));
    let clean_path_str = save_path.trim().trim_matches('"').trim_matches('\'').trim();
    let resolved_save_path = if clean_path_str.is_empty() {
        dirs::download_dir()
            .or_else(|| Some(crate::get_app_data_dir().join("downloads")))
            .ok_or_else(|| "Failed to resolve save path".to_string())?
    } else {
        PathBuf::from(clean_path_str)
    };

    tokio::fs::create_dir_all(&resolved_save_path).await.map_err(|e| e.to_string())?;

    let normalized_save_path_str = resolved_save_path.to_string_lossy().replace('\\', "/");
    let job_id_clone = job_id.clone();
    let cancel_token = tokio_util::sync::CancellationToken::new();
    let cancel_token_clone = cancel_token.clone();

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
            .arg("--restrict-filenames")
            .arg("--user-agent")
            .arg("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .arg("--no-warnings")
            .arg("--no-playlist")
            .arg("-P")
            .arg(&normalized_save_path_str)
            .arg("-o")
            .arg("%(title).150s.%(ext)s")
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

        let stdout_handle = tokio::spawn(async move {
            let mut last_line = String::new();
            let mut last_emit = Instant::now() - Duration::from_millis(200);

            if let Some(stdout) = stdout {
                use tokio::io::AsyncBufReadExt;
                let reader = tokio::io::BufReader::new(stdout);
                let mut lines = reader.lines();

                while let Ok(Some(line)) = lines.next_line().await {
                    if let Some((progress_percent, eta, speed)) = parse_progress_line(&line) {
                        if last_emit.elapsed() >= Duration::from_millis(100) || progress_percent >= 100.0 {
                            last_emit = Instant::now();
                            let _ = app_handle_progress.emit_all(
                                "download-progress",
                                DownloadProgressPayload {
                                    job_id: job_id_progress.clone(),
                                    url: url_progress.clone(),
                                    progress_percent,
                                    eta,
                                    speed,
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
                    if !line.trim().is_empty() {
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
                    let _ = app_handle.emit_all(
                        "download-complete",
                        DownloadCompletePayload {
                            job_id: job_id_clone.clone(),
                            url,
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
