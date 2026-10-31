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
    static ref SIZE_RE: Regex =
        Regex::new(r"of\s+(?:~\s*)?(?P<size>[^\s]+)").expect("valid yt-dlp size regex");
    static ref MERGER_RE: Regex =
        Regex::new(r#"\[Merger\]\s+Merging formats into "([^"]+)""#).expect("valid merger regex");
    static ref DEST_RE: Regex =
        Regex::new(r#"\[download\]\s+Destination:\s+(.+)$"#).expect("valid dest regex");
    static ref ALREADY_DOWNLOADED_RE: Regex =
        Regex::new(r#"\[download\]\s+(.+?)\s+has already been downloaded"#).expect("valid already downloaded regex");
    static ref EXTRACT_AUDIO_RE: Regex =
        Regex::new(r#"\[ExtractAudio\]\s+Destination:\s+(.+)$"#).expect("valid extract audio regex");
    static ref FORMATS_RE: Regex =
        Regex::new(r#"Downloading \d+ format\(s\):\s*([^\s]+)"#).expect("valid formats regex");
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TechnicalDetails {
    pub timestamp: String,
    pub url: String,
    pub command: String,
    pub executable: String,
    pub arguments: Vec<String>,
    pub exit_code: Option<i32>,
    pub status: String,
    pub error_classification: Option<String>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub os: String,
    pub arch: String,
    pub is_network_error: bool,
    pub hint: Option<String>,
    pub environment: Option<Vec<String>>,
}

impl std::fmt::Display for TechnicalDetails {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} (exit code: {:?})", self.status, self.exit_code)
    }
}

impl std::error::Error for TechnicalDetails {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadErrorPayload {
    pub job_id: String,
    pub url: String,
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<TechnicalDetails>,
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

    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            #[cfg(windows)]
            let ffmpeg_binary = dir.join("ffmpeg.exe");
            #[cfg(not(windows))]
            let ffmpeg_binary = dir.join("ffmpeg");

            if ffmpeg_binary.is_file() {
                return Some(dir);
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

pub fn is_network_error(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("timedout")
        || lower.contains("getaddrinfo")
        || lower.contains("urlopen error")
        || lower.contains("connection refused")
        || lower.contains("connection reset")
        || lower.contains("network is unreachable")
        || lower.contains("network is down")
        || lower.contains("no route to host")
        || lower.contains("temporary failure in name resolution")
        || lower.contains("nodename nor servname")
        || lower.contains("name or service not known")
        || lower.contains("remote end closed")
        || lower.contains("remotedisconnected")
        || lower.contains("certificate verify failed")
        || lower.contains("ssl error")
        || lower.contains("tls error")
        || lower.contains("http error 403")
        || lower.contains("http error 429")
        || lower.contains("winerror 10060")
        || lower.contains("winerror 10054")
        || lower.contains("winerror 10051")
        || lower.contains("errno 60")
        || lower.contains("errno 8")
        || lower.contains("сбой сети")
        || lower.contains("таймаут")
}

pub fn classify_error_message(err: &str) -> (bool, Option<String>) {
    let lower = err.to_ascii_lowercase();

    // 1. Connection Reset / ECONNRESET
    if lower.contains("errno 54")
        || lower.contains("10054")
        || lower.contains("connection reset")
        || lower.contains("remotedisconnected")
        || lower.contains("remote end closed")
    {
        return (
            true,
            Some("Сброс соединения (ECONNRESET / Errno 54 / WinError 10054). Сетевой поток разорван сервером или промежуточным оборудованием (DPI / блокировка провайдером / РКН).".to_string()),
        );
    }

    // 2. Timeout
    if lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("timedout")
        || lower.contains("errno 60")
        || lower.contains("winerror 10060")
        || lower.contains("таймаут")
    {
        return (
            true,
            Some("Таймаут подключения (ETIMEDOUT / Errno 60 / WinError 10060). Превышено время ожидания ответа от сервера; возможна потеря пакетов или замедление/блокировка фаерволом/DPI.".to_string()),
        );
    }

    // 3. DNS Lookup Failure
    if lower.contains("getaddrinfo")
        || lower.contains("nodename nor servname")
        || lower.contains("name or service not known")
        || lower.contains("temporary failure in name resolution")
        || lower.contains("errno 8")
        || lower.contains("errno 11001")
    {
        return (
            true,
            Some("Сбой DNS (getaddrinfo / Errno 8 / WinError 11001). Не удалось разрешить доменное имя в IP-адрес. Проверьте интернет или настройки DNS.".to_string()),
        );
    }

    // 4. Connection Refused
    if lower.contains("connection refused")
        || lower.contains("winerror 10061")
        || lower.contains("errno 61")
    {
        return (
            true,
            Some("Соединение отклонено (ECONNREFUSED / Errno 61 / WinError 10061). Удаленный сервер или локальный прокси отклонил попытку подключения.".to_string()),
        );
    }

    // 5. Network / Host Unreachable
    if lower.contains("network is unreachable")
        || lower.contains("network is down")
        || lower.contains("no route to host")
        || lower.contains("winerror 10051")
        || lower.contains("errno 65")
    {
        return (
            true,
            Some("Сеть недоступна (ENETUNREACH / EHOSTUNREACH). Отсутствует сетевой маршрут к хосту либо отключен интернет.".to_string()),
        );
    }

    // 6. TLS / SSL Failure
    if lower.contains("certificate verify failed")
        || lower.contains("ssl error")
        || lower.contains("tls error")
        || lower.contains("sslv3")
        || lower.contains("handshake_failure")
    {
        return (
            true,
            Some("Сбой TLS/SSL рукопожатия. Ошибка проверки сертификата или перехват зашифрованного HTTPS-трафика.".to_string()),
        );
    }

    // 7. HTTP 403 Forbidden
    if lower.contains("http error 403") || lower.contains("403 forbidden") {
        return (
            false,
            Some("HTTP 403 Forbidden. Доступ к медиа запрещен сервером (гео-блокировка по стране/IP, приватный доступ или устаревший токен).".to_string()),
        );
    }

    // 8. HTTP 429 Too Many Requests
    if lower.contains("http error 429") || lower.contains("too many requests") {
        return (
            false,
            Some("HTTP 429 Too Many Requests. Превышен лимит запросов к серверу платформы (Rate Limiting).".to_string()),
        );
    }

    // 9. Bot detection / Captcha
    if lower.contains("sign in to confirm")
        || lower.contains("confirm you")
        || lower.contains("bot")
        || lower.contains("captcha")
    {
        return (
            false,
            Some("Защита от ботов / Требуется вход. Сервис заблокировал автоматический запрос и требует авторизацию через браузер.".to_string()),
        );
    }

    // 10. Private / Unavailable video
    if lower.contains("video unavailable")
        || lower.contains("private video")
        || lower.contains("this video has been removed")
    {
        return (
            false,
            Some("Медиафайл недоступен. Видео удалено автором, скрыто приватностью или ограничено для вашего региона.".to_string()),
        );
    }

    // 11. Unsupported URL
    if lower.contains("unsupported url") {
        return (
            false,
            Some("Неподдерживаемый URL. yt-dlp не имеет модуля для скачивания с данного адреса.".to_string()),
        );
    }

    // 12. HTTP 404 Not Found
    if lower.contains("http error 404") || lower.contains("404: not found") || lower.contains("404 not found") {
        return (
            false,
            Some("HTTP 404 Not Found. Запрашиваемая страница или медиафайл не найдены на сервере платформы.".to_string()),
        );
    }

    // 13. HTTP 5xx Server Errors
    if lower.contains("http error 500")
        || lower.contains("http error 502")
        || lower.contains("http error 503")
        || lower.contains("http error 504")
        || lower.contains("502 bad gateway")
        || lower.contains("503 service unavailable")
        || lower.contains("504 gateway time-out")
        || lower.contains("gateway timeout")
    {
        return (
            true,
            Some("Сбой сервера платформы (HTTP 5xx / Bad Gateway / Service Unavailable). Сервер источника перегружен или временно недоступен.".to_string()),
        );
    }

    // 14. FFmpeg / Postprocessor Error
    if lower.contains("ffprobe and ffmpeg not found")
        || lower.contains("ffmpeg not found")
        || lower.contains("ffprobe not found")
        || lower.contains("postprocessing: error opening output")
        || lower.contains("please install or provide the path to a working ffmpeg")
    {
        return (
            false,
            Some("Ошибка постобработки / Отсутствует FFmpeg. yt-dlp не смог объединить видео и аудио или сконвертировать файл.".to_string()),
        );
    }

    // 15. Members-only / Premium / DRM
    if lower.contains("join this channel to get access")
        || lower.contains("members-only")
        || lower.contains("music premium members")
        || lower.contains("drm protected")
        || lower.contains("this video is drm protected")
    {
        return (
            false,
            Some("Платный или защищенный DRM контент. Видео доступно только спонсорам канала, подписчикам Premium или защищено DRM-шифрованием.".to_string()),
        );
    }

    // 16. Extractor / JS Player Failure
    if lower.contains("unable to extract yt initial data")
        || lower.contains("unable to extract video data")
        || lower.contains("unable to extract js player")
        || lower.contains("extractor error")
    {
        return (
            false,
            Some("Сбой экстрактора yt-dlp. Изменились внутренние алгоритмы платформы видеохостинга.".to_string()),
        );
    }

    let is_net = is_network_error(err);
    (
        is_net,
        if is_net {
            Some("Сетевая ошибка при обращении к ресурсу".to_string())
        } else {
            None
        },
    )
}

pub fn build_technical_details(
    url: &str,
    executable: &Path,
    args: &[String],
    exit_code: Option<i32>,
    status: String,
    stdout: Option<String>,
    stderr: Option<String>,
) -> TechnicalDetails {
    let combined = format!(
        "{}\n{}\n{}",
        status,
        stderr.as_deref().unwrap_or_default(),
        stdout.as_deref().unwrap_or_default()
    );
    let (is_net, classification) = classify_error_message(&combined);

    let command_str = format!(
        "\"{}\" {}",
        executable.to_string_lossy(),
        args.iter()
            .map(|a| {
                if a.contains(' ') || a.contains('"') {
                    format!("\"{}\"", a.replace('"', "\\\""))
                } else {
                    a.clone()
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    );

    let hint = if is_net {
        Some("Проверьте интернет-соединение или включите VPN/прокси (возможно, ресурс заблокирован в вашем регионе).".to_string())
    } else if let Some(ref cls) = classification {
        if cls.contains("FFmpeg") {
            Some("Убедитесь, что в системе установлен FFmpeg или укажите путь к нему в настройках приложения.".to_string())
        } else if cls.contains("экстрактора") {
            Some("Возможно, видеохостинг обновил плеер. Обновите yt-dlp в настройках или повторите попытку позже.".to_string())
        } else if cls.contains("404") {
            Some("Проверьте правильность ссылки, возможно видео или страница были удалены.".to_string())
        } else if cls.contains("DRM") || cls.contains("Платный") {
            Some("Этот контент требует платной авторизации или защищен DRM, поэтому его невозможно скачать напрямую.".to_string())
        } else {
            Some(cls.clone())
        }
    } else {
        None
    };

    let mut environment = Vec::new();
    let re_cred = Regex::new(r"://[^@]+@").ok();
    let mut seen_vars = std::collections::HashSet::new();
    for var in &["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"] {
        let upper = var.to_uppercase();
        if seen_vars.contains(&upper) {
            continue;
        }
        if let Ok(val) = std::env::var(var) {
            seen_vars.insert(upper);
            let sanitized = if let Some(ref re) = re_cred {
                re.replace_all(&val, "://***:***@").to_string()
            } else {
                val
            };
            environment.push(format!("{}: {}", var, sanitized));
        }
    }
    if environment.is_empty() {
        environment.push("Proxy: Прямое подключение (прокси не обнаружен в окружении)".to_string());
    }

    TechnicalDetails {
        timestamp: chrono::Utc::now().to_rfc3339(),
        url: url.to_string(),
        command: command_str,
        executable: executable.to_string_lossy().to_string(),
        arguments: args.to_vec(),
        exit_code,
        status,
        error_classification: classification,
        stdout: stdout.filter(|s| !s.trim().is_empty()),
        stderr: stderr.filter(|s| !s.trim().is_empty()),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        is_network_error: is_net,
        hint,
        environment: Some(environment),
    }
}

pub async fn ensure_yt_dlp_installed(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let yt_dlp_path = yt_dlp_path()?;

    if yt_dlp_path.exists() {
        return Ok(yt_dlp_path);
    }

    ensure_parent_dir(&yt_dlp_path)?;

    let url = yt_dlp_download_url()?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(&url).send().await.map_err(|e| {
        format!(
            "Не удалось загрузить модуль yt-dlp с GitHub ({}). Проверьте подключение к интернету или включите VPN/прокси.\n{}",
            url, e
        )
    })?;

    if !response.status().is_success() {
        return Err(format!(
            "Не удалось загрузить yt-dlp с {}: статус {}. Проверьте подключение к интернету или включите VPN/прокси.",
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


fn format_label(height: u32, ext: &str) -> String {
    if ext.eq_ignore_ascii_case("mp4") {
        format!("MP4 {}p", height)
    } else {
        format!("{} {}p", ext.to_uppercase(), height)
    }
}

fn choose_best_video_formats(info: &YtDlpInfo) -> Vec<FormatOption> {
    let mut by_height: BTreeMap<u32, &YtDlpFormat> = BTreeMap::new();
    let mut has_video = false;

    for format in &info.formats {
        let is_video = format
            .vcodec
            .as_deref()
            .map(|value| value != "none")
            .unwrap_or(false);

        if !is_video {
            continue;
        }

        has_video = true;

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

    if !has_video && !info.formats.is_empty() {
        options.push(FormatOption {
            label: "Audio (MP3)".to_string(),
            quality: "bestaudio/best".to_string(),
            format: "mp3".to_string(),
            ext: "mp3".to_string(),
            height: None,
            filesize: None,
            is_audio_only: true,
        });

        options.push(FormatOption {
            label: "Audio (Original)".to_string(),
            quality: "bestaudio/best".to_string(),
            format: "best".to_string(),
            ext: "m4a".to_string(),
            height: None,
            filesize: None,
            is_audio_only: true,
        });
    } else {
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
pub async fn get_video_formats(
    app_handle: AppHandle,
    url: String,
) -> Result<VideoMetadataResponse, TechnicalDetails> {
    let mut args = vec![
        "-J".to_string(),
        "--encoding".to_string(),
        "utf-8".to_string(),
        "--force-ipv4".to_string(),
        "--socket-timeout".to_string(),
        "10".to_string(),
        "--retries".to_string(),
        "2".to_string(),
        "--fragment-retries".to_string(),
        "2".to_string(),
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

    args.push(url.clone());

    let yt_dlp_path = match ensure_yt_dlp_installed(&app_handle).await {
        Ok(path) => path,
        Err(e) => {
            let details = build_technical_details(
                &url,
                &PathBuf::from(yt_dlp_executable_name()),
                &args,
                None,
                format!("yt-dlp executable installation failed: {}", e),
                None,
                Some(e),
            );
            return Err(details);
        }
    };

    let mut command = tokio::process::Command::new(&yt_dlp_path);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .kill_on_drop(true)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .args(&args);

    let output = match tokio::time::timeout(Duration::from_secs(14), command.output()).await {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => {
            let details = build_technical_details(
                &url,
                &yt_dlp_path,
                &args,
                None,
                format!("Failed to execute yt-dlp: {}", e),
                None,
                Some(e.to_string()),
            );
            return Err(details);
        }
        Err(_) => {
            let details = build_technical_details(
                &url,
                &yt_dlp_path,
                &args,
                None,
                "Превышено время ожидания проверки ссылки (таймаут сети 14 сек)".to_string(),
                None,
                Some("Таймаут подключения (14 секунд). Сервер не ответил на запрос или соединение было сброшено/заблокировано сетевым оборудованием или провайдером (DPI / РКН / VPN).".to_string()),
            );
            return Err(details);
        }
    };

    if !output.status.success() {
        let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr_str = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let details = build_technical_details(
            &url,
            &yt_dlp_path,
            &args,
            output.status.code(),
            format!("yt-dlp format discovery failed with status: {}", output.status),
            if !stdout_str.is_empty() { Some(stdout_str) } else { None },
            if !stderr_str.is_empty() { Some(stderr_str) } else { None },
        );
        return Err(details);
    }

    let info: YtDlpInfo = match serde_json::from_slice(&output.stdout) {
        Ok(parsed) => parsed,
        Err(e) => {
            let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr_str = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let details = build_technical_details(
                &url,
                &yt_dlp_path,
                &args,
                output.status.code(),
                format!("Failed to parse metadata JSON from yt-dlp: {}", e),
                if !stdout_str.is_empty() { Some(stdout_str) } else { None },
                if !stderr_str.is_empty() { Some(stderr_str) } else { None },
            );
            return Err(details);
        }
    };
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

fn sanitize_meta_field(s: &str) -> Option<String> {
    let trimmed = s.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("na")
        || trimmed.eq_ignore_ascii_case("n/a")
        || trimmed.eq_ignore_ascii_case("unknown")
        || trimmed.eq_ignore_ascii_case("none")
    {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn parse_progress_line(line: &str) -> Option<(f64, Option<String>, Option<String>, Option<String>)> {
    if let Some(pos) = line.find("SZ_PROGRESS:") {
        let payload = &line[pos + "SZ_PROGRESS:".len()..];
        let parts: Vec<&str> = payload.split('|').collect();
        if !parts.is_empty() {
            let percent_str = parts[0].trim().trim_end_matches('%').trim();
            let percent = percent_str.parse::<f64>().ok()?;
            let eta = parts.get(1).and_then(|s| sanitize_meta_field(s));
            let speed = parts.get(2).and_then(|s| sanitize_meta_field(s));
            let total_size = parts.get(3).and_then(|s| sanitize_meta_field(s));
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
        .and_then(|m| sanitize_meta_field(m.as_str()));

    let speed = SPEED_RE
        .captures(line)
        .and_then(|caps| caps.name("speed"))
        .and_then(|m| sanitize_meta_field(m.as_str()));

    let total_size = SIZE_RE
        .captures(line)
        .and_then(|caps| caps.name("size"))
        .and_then(|m| sanitize_meta_field(m.as_str()));

    Some((percent, eta, speed, total_size))
}

fn parse_progress_meta(line: &str) -> (Option<String>, Option<f64>) {
    if let Some(pos) = line.find("SZ_PROGRESS:") {
        let payload = &line[pos + "SZ_PROGRESS:".len()..];
        let parts: Vec<&str> = payload.split('|').collect();
        let title = parts.get(4).and_then(|s| sanitize_meta_field(s));
        let duration = parts
            .get(5)
            .and_then(|s| sanitize_meta_field(s))
            .and_then(|s| s.parse::<f64>().ok());
        return (title, duration);
    }
    (None, None)
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
        let mut command_args: Vec<String> = vec![
            "--encoding".to_string(),
            "utf-8".to_string(),
            "--newline".to_string(),
            "--no-colors".to_string(),
            "--force-ipv4".to_string(),
            "--socket-timeout".to_string(),
            "15".to_string(),
            "--retries".to_string(),
            "3".to_string(),
            "--fragment-retries".to_string(),
            "3".to_string(),
            "--no-check-certificates".to_string(),
            "--windows-filenames".to_string(),
            "--user-agent".to_string(),
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string(),
            "--no-warnings".to_string(),
            "--no-playlist".to_string(),
            "--compat-options".to_string(),
            "no-youtube-unavailable-videos".to_string(),
            "-P".to_string(),
            normalized_save_path_str.clone(),
            "-o".to_string(),
            "%(title).150s.%(ext)s".to_string(),
            "--progress".to_string(),
            "--progress-template".to_string(),
            "download:SZ_PROGRESS:%(progress._percent_str)s|%(progress._eta_str)s|%(progress._speed_str)s|%(progress._total_bytes_str,progress._total_bytes_estimate_str,progress._downloaded_bytes_str)s|%(info.title)s|%(info.duration)s".to_string(),
            "--progress-template".to_string(),
            "postprocess:SZ_POST:%(progress.status)s|%(info.filepath)s|%(info.title)s|%(info.duration)s".to_string(),
        ];

        if let Some(ffmpeg_loc) = resolve_ffmpeg_location() {
            let normalized_ffmpeg = ffmpeg_loc.to_string_lossy().replace('\\', "/");
            command_args.push("--ffmpeg-location".to_string());
            command_args.push(normalized_ffmpeg);
        }

        if format.eq_ignore_ascii_case("mp3") {
            command_args.push("-x".to_string());
            command_args.push("--audio-format".to_string());
            command_args.push("mp3".to_string());
        } else {
            if !quality.trim().is_empty() {
                command_args.push("-f".to_string());
                command_args.push(quality.clone());
            }

            command_args.push("--merge-output-format".to_string());
            command_args.push("mp4".to_string());
        }

        command_args.push(url.clone());

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
            .args(&command_args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let mut child = match command.spawn() {
            Ok(c) => c,
            Err(e) => {
                let details = build_technical_details(
                    &url,
                    &yt_dlp_path,
                    &command_args,
                    None,
                    format!("Failed to spawn yt-dlp: {}", e),
                    None,
                    Some(e.to_string()),
                );
                let _ = app_handle.emit_all(
                    "download-error",
                    DownloadErrorPayload {
                        job_id: job_id_clone.clone(),
                        url: url.clone(),
                        error: format!("Failed to spawn yt-dlp: {}", e),
                        details: Some(details),
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
            let mut captured_lines: Vec<String> = Vec::new();
            let mut last_emit = Instant::now() - Duration::from_millis(200);
            let mut has_multiple_streams = false;
            let mut current_stream = 0usize;
            let mut highest_reported_percent = 0.0f64;

            if let Some(stdout) = stdout {
                use tokio::io::AsyncBufReadExt;
                let reader = tokio::io::BufReader::new(stdout);
                let mut lines = reader.lines();

                while let Ok(Some(line)) = lines.next_line().await {
                    let trimmed = line.trim();

                    // Detect multi-stream format (e.g. 136+140)
                    if let Some(caps) = FORMATS_RE.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            if m.as_str().contains('+') {
                                has_multiple_streams = true;
                            }
                        }
                    }

                    // Parse postprocess template marker
                    if let Some(pos) = trimmed.find("SZ_POST:") {
                        let payload = &trimmed[pos + "SZ_POST:".len()..];
                        let parts: Vec<&str> = payload.split('|').collect();
                        let status = parts.first().map(|s| s.trim()).unwrap_or("");

                        if let Some(path) = parts.get(1).and_then(|s| sanitize_meta_field(s)) {
                            let clean_path = path.trim_matches('"').to_string();
                            let is_intermediate = clean_path.ends_with(".part")
                                || clean_path.ends_with(".ytdl")
                                || clean_path.contains(".temp.")
                                || clean_path.contains(".f1")
                                || clean_path.contains(".f2")
                                || clean_path.contains(".f3");

                            if let Ok(mut lock) = filepath_for_stdout.lock() {
                                let lock_is_final = lock.as_ref().map(|curr| {
                                    curr.ends_with(".mp3") || curr.ends_with(".mp4")
                                }).unwrap_or(false);

                                let new_is_target = clean_path.ends_with(".mp3") || clean_path.ends_with(".mp4");

                                if (status == "finished" || lock.is_none()) && (!lock_is_final || new_is_target) && !is_intermediate {
                                    *lock = Some(clean_path);
                                }
                            }
                        }
                        if let Some(title) = parts.get(2).and_then(|s| sanitize_meta_field(s)) {
                            if let Ok(mut lock) = title_for_stdout.lock() {
                                if lock.is_none() {
                                    *lock = Some(title);
                                }
                            }
                        }
                        if let Some(dur) = parts.get(3).and_then(|s| sanitize_meta_field(s)).and_then(|s| s.parse::<f64>().ok()) {
                            if let Ok(mut lock) = duration_for_stdout.lock() {
                                if lock.is_none() {
                                    *lock = Some(dur);
                                }
                            }
                        }

                        if status == "started" {
                            highest_reported_percent = highest_reported_percent.max(99.0);
                            let cur_title = title_for_stdout.lock().ok().and_then(|t| t.clone());
                            let _ = app_handle_progress.emit_all(
                                "download-progress",
                                DownloadProgressPayload {
                                    job_id: job_id_progress.clone(),
                                    url: url_progress.clone(),
                                    title: cur_title,
                                    progress_percent: highest_reported_percent,
                                    eta: None,
                                    speed: None,
                                    total_size: None,
                                    line: line.clone(),
                                },
                            );
                        }
                    }

                    // Legacy markers
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
                                    progress_percent: highest_reported_percent,
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
                        let path = trimmed[pos + "SZ_FILEPATH:".len()..].trim().trim_matches('"').to_string();
                        if !path.is_empty() {
                            if let Ok(mut lock) = filepath_for_stdout.lock() {
                                *lock = Some(path);
                            }
                        }
                    }

                    // Path detectors from yt-dlp logs
                    if let Some(caps) = MERGER_RE.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            let clean = m.as_str().trim().trim_matches('"').to_string();
                            if let Ok(mut lock) = filepath_for_stdout.lock() {
                                *lock = Some(clean);
                            }
                        }
                    } else if let Some(caps) = EXTRACT_AUDIO_RE.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            let clean = m.as_str().trim().trim_matches('"').to_string();
                            if let Ok(mut lock) = filepath_for_stdout.lock() {
                                *lock = Some(clean);
                            }
                        }
                    } else if let Some(caps) = ALREADY_DOWNLOADED_RE.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            let clean = m.as_str().trim().trim_matches('"').to_string();
                            if let Ok(mut lock) = filepath_for_stdout.lock() {
                                *lock = Some(clean);
                            }
                        }
                    } else if let Some(caps) = DEST_RE.captures(trimmed) {
                        current_stream += 1;
                        if let Some(m) = caps.get(1) {
                            let clean = m.as_str().trim().trim_matches('"').to_string();
                            if let Ok(mut lock) = filepath_for_stdout.lock() {
                                if lock.is_none() {
                                    *lock = Some(clean);
                                }
                            }
                        }
                    }

                    let (meta_title, meta_dur) = parse_progress_meta(&line);
                    if let Some(t) = meta_title {
                        if let Ok(mut lock) = title_for_stdout.lock() {
                            if lock.is_none() {
                                *lock = Some(t);
                            }
                        }
                    }
                    if let Some(d) = meta_dur {
                        if let Ok(mut lock) = duration_for_stdout.lock() {
                            if lock.is_none() {
                                *lock = Some(d);
                            }
                        }
                    }

                    if let Some((progress_percent, eta, speed, total_size)) = parse_progress_line(&line) {
                        let mapped_percent = if has_multiple_streams {
                            if current_stream <= 1 {
                                (progress_percent * 0.88).min(88.0)
                            } else {
                                (88.0 + progress_percent * 0.10).min(98.0)
                            }
                        } else {
                            progress_percent.min(98.0)
                        };

                        highest_reported_percent = highest_reported_percent.max(mapped_percent);

                        if last_emit.elapsed() >= Duration::from_millis(80) || highest_reported_percent >= 98.0 {
                            last_emit = Instant::now();
                            let cur_title = title_for_stdout.lock().ok().and_then(|t| t.clone());
                            let _ = app_handle_progress.emit_all(
                                "download-progress",
                                DownloadProgressPayload {
                                    job_id: job_id_progress.clone(),
                                    url: url_progress.clone(),
                                    title: cur_title,
                                    progress_percent: highest_reported_percent,
                                    eta,
                                    speed,
                                    total_size,
                                    line: line.clone(),
                                },
                            );
                        }
                    }
                    if !line.trim().is_empty()
                        && !trimmed.starts_with("download:SZ_PROGRESS:")
                        && !trimmed.starts_with("postprocess:SZ_POST:")
                    {
                        if captured_lines.len() < 100 {
                            captured_lines.push(line);
                        }
                    }
                }
            }
            captured_lines.join("\n")
        });

        let stderr_handle = tokio::spawn(async move {
            let mut err_lines = Vec::new();
            if let Some(stderr) = stderr {
                use tokio::io::AsyncBufReadExt;
                let reader = tokio::io::BufReader::new(stderr);
                let mut lines = reader.lines();

                while let Ok(Some(line)) = lines.next_line().await {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        if err_lines.len() < 150 {
                            err_lines.push(line);
                        }
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
                        let details = build_technical_details(
                            &url,
                            &yt_dlp_path,
                            &command_args,
                            None,
                            format!("yt-dlp wait error: {}", e),
                            None,
                            Some(e.to_string()),
                        );
                        let _ = app_handle.emit_all(
                            "download-error",
                            DownloadErrorPayload {
                                job_id: job_id_clone.clone(),
                                url: url.clone(),
                                error: format!("yt-dlp wait error: {}", e),
                                details: Some(details),
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
                    let final_filepath = {
                        let mut resolved: Option<PathBuf> = None;
                        if let Some(p) = explicit_filepath {
                            let path = PathBuf::from(&p);
                            let abs_path = if path.is_absolute() {
                                path
                            } else {
                                resolved_save_path.join(path)
                            };

                            if abs_path.is_file() {
                                resolved = Some(abs_path);
                            } else {
                                let expected_ext = if format.eq_ignore_ascii_case("mp3") { "mp3" } else { "mp4" };
                                let target_ext_path = abs_path.with_extension(expected_ext);
                                if target_ext_path.is_file() {
                                    resolved = Some(target_ext_path);
                                } else if let Some(stem) = abs_path.file_stem() {
                                    if let Ok(entries) = fs::read_dir(&resolved_save_path) {
                                        for entry in entries.flatten() {
                                            let ep = entry.path();
                                            if ep.is_file() && ep.file_stem() == Some(stem) {
                                                resolved = Some(ep);
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Fallback: newest matching file in resolved_save_path
                        resolved.unwrap_or_else(|| {
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
                        })
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
                    let raw_err = if !stderr_output.trim().is_empty() {
                        stderr_output.trim().to_string()
                    } else if !last_stdout.trim().is_empty() {
                        last_stdout.trim().to_string()
                    } else {
                        format!("yt-dlp exited with status: {}", status)
                    };

                    let error_msg = if is_network_error(&raw_err) {
                        format!(
                            "Ошибка соединения (таймаут или блокировка сети). Проверьте интернет или включите VPN.\n{}",
                            raw_err
                        )
                    } else {
                        raw_err
                    };

                    let details = build_technical_details(
                        &url,
                        &yt_dlp_path,
                        &command_args,
                        status.code(),
                        format!("yt-dlp exited with status: {}", status),
                        if !last_stdout.trim().is_empty() { Some(last_stdout) } else { None },
                        if !stderr_output.trim().is_empty() { Some(stderr_output) } else { None },
                    );

                    let _ = app_handle.emit_all(
                        "download-error",
                        DownloadErrorPayload {
                            job_id: job_id_clone.clone(),
                            url,
                            error: error_msg,
                            details: Some(details),
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
        let (percent, eta, speed, total_size) = parsed.unwrap();
        assert!((percent - 23.5).abs() < 1e-6);
        assert_eq!(eta, Some("00:03".to_string()));
        assert_eq!(speed, Some("2.50MiB/s".to_string()));
        assert_eq!(total_size, Some("10.00MiB".to_string()));
    }

    #[test]
    fn test_choose_best_video_formats_audio_only() {
        let info = YtDlpInfo {
            title: Some("SoundCloud Track".to_string()),
            duration: Some(180.0),
            formats: vec![
                YtDlpFormat {
                    ext: Some("m4a".to_string()),
                    height: None,
                    filesize: Some(3_000_000),
                    filesize_approx: None,
                    acodec: Some("mp4a.40.2".to_string()),
                    vcodec: Some("none".to_string()),
                },
            ],
        };

        let options = choose_best_video_formats(&info);
        assert_eq!(options.first().unwrap().label, "Audio (MP3)");
        assert_eq!(options.first().unwrap().format, "mp3");
        assert!(options.first().unwrap().is_audio_only);
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

    #[test]
    fn test_sanitize_meta_field() {
        assert_eq!(sanitize_meta_field(""), None);
        assert_eq!(sanitize_meta_field("   "), None);
        assert_eq!(sanitize_meta_field("NA"), None);
        assert_eq!(sanitize_meta_field("N/A"), None);
        assert_eq!(sanitize_meta_field("Unknown"), None);
        assert_eq!(sanitize_meta_field("none"), None);
        assert_eq!(sanitize_meta_field(" 00:15 "), Some("00:15".to_string()));
        assert_eq!(sanitize_meta_field(" 1.50MiB/s "), Some("1.50MiB/s".to_string()));
    }

    #[test]
    fn test_parse_progress_meta() {
        let line = "SZ_PROGRESS: 25.0%|Unknown|     0.00B/s|   2.97KiB|Wah pedal test|30.087";
        let (title, duration) = parse_progress_meta(line);
        assert_eq!(title, Some("Wah pedal test".to_string()));
        assert_eq!(duration, Some(30.087));
    }

    #[test]
    fn test_parse_progress_hls_spacing_and_na() {
        let line = "SZ_PROGRESS:  0.4%|Unknown|   9.19KiB/s| 396.61KiB|Wah pedal test|30.087";
        let parsed = parse_progress_line(line);
        assert!(parsed.is_some());
        let (percent, eta, speed, total_size) = parsed.unwrap();
        assert!((percent - 0.4).abs() < 1e-6);
        assert_eq!(eta, None); // "Unknown" sanitized to None
        assert_eq!(speed, Some("9.19KiB/s".to_string()));
        assert_eq!(total_size, Some("396.61KiB".to_string()));

        let line_na = "SZ_PROGRESS:100.0%|NA|3.14MiB/s|NA|Big Buck Bunny Trailer|33";
        let parsed_na = parse_progress_line(line_na);
        assert!(parsed_na.is_some());
        let (p_na, eta_na, speed_na, size_na) = parsed_na.unwrap();
        assert!((p_na - 100.0).abs() < 1e-6);
        assert_eq!(eta_na, None);
        assert_eq!(speed_na, Some("3.14MiB/s".to_string()));
        assert_eq!(size_na, None);
    }

    #[test]
    fn test_multi_stream_formats_regex() {
        let line1 = "[info] 5xAgp6i9lUQ: Downloading 1 format(s): 136+140";
        let caps1 = FORMATS_RE.captures(line1);
        assert!(caps1.is_some());
        assert!(caps1.unwrap().get(1).unwrap().as_str().contains('+'));

        let line2 = "[info] 2296666004: Downloading 1 format(s): hls_aac_160k";
        let caps2 = FORMATS_RE.captures(line2);
        assert!(caps2.is_some());
        assert!(!caps2.unwrap().get(1).unwrap().as_str().contains('+'));
    }

    #[test]
    fn test_already_downloaded_regex() {
        let line = r#"[download] c:\Users\Test\Downloads\Wah pedal test.mp3 has already been downloaded"#;
        let caps = ALREADY_DOWNLOADED_RE.captures(line);
        assert!(caps.is_some());
        assert_eq!(caps.unwrap().get(1).unwrap().as_str(), r#"c:\Users\Test\Downloads\Wah pedal test.mp3"#);
    }

    #[test]
    fn test_classify_error_message_categories() {
        let (is_net, class) = classify_error_message("ERROR: <urlopen error [Errno 54] Connection reset by peer>");
        assert!(is_net);
        assert!(class.unwrap().contains("ECONNRESET"));

        let (is_net_timeout, class_timeout) = classify_error_message("WinError 10060: connection timed out");
        assert!(is_net_timeout);
        assert!(class_timeout.unwrap().contains("ETIMEDOUT"));

        let (is_net_dns, class_dns) = classify_error_message("getaddrinfo failed: nodename nor servname provided");
        assert!(is_net_dns);
        assert!(class_dns.unwrap().contains("DNS"));

        let (is_net_403, class_403) = classify_error_message("HTTP Error 403: Forbidden");
        assert!(!is_net_403);
        assert!(class_403.unwrap().contains("403 Forbidden"));

        let (is_net_404, class_404) = classify_error_message("HTTP Error 404: Not Found");
        assert!(!is_net_404);
        assert!(class_404.unwrap().contains("404 Not Found"));

        let (is_net_502, class_502) = classify_error_message("HTTP Error 502: Bad Gateway");
        assert!(is_net_502);
        assert!(class_502.unwrap().contains("HTTP 5xx"));

        let (is_net_ff, class_ff) = classify_error_message("ERROR: Postprocessing: ffprobe and ffmpeg not found");
        assert!(!is_net_ff);
        assert!(class_ff.unwrap().contains("FFmpeg"));

        let (is_net_mem, class_mem) = classify_error_message("Join this channel to get access to members-only content");
        assert!(!is_net_mem);
        assert!(class_mem.unwrap().contains("Платный"));

        let (is_net_ext, class_ext) = classify_error_message("Unable to extract yt initial data");
        assert!(!is_net_ext);
        assert!(class_ext.unwrap().contains("экстрактора"));
    }

    #[test]
    fn test_build_technical_details_fields() {
        let args = vec!["-J".to_string(), "https://youtube.com/watch?v=123".to_string()];
        let details = build_technical_details(
            "https://youtube.com/watch?v=123",
            Path::new("/usr/local/bin/yt-dlp"),
            &args,
            Some(1),
            "Process exited with status 1".to_string(),
            Some("stdout text".to_string()),
            Some("ERROR: <urlopen error [Errno 54] Connection reset by peer>".to_string()),
        );

        assert_eq!(details.url, "https://youtube.com/watch?v=123");
        assert_eq!(details.executable, "/usr/local/bin/yt-dlp");
        assert_eq!(details.exit_code, Some(1));
        assert!(details.is_network_error);
        assert!(details.error_classification.unwrap().contains("ECONNRESET"));
        assert!(details.command.contains("/usr/local/bin/yt-dlp"));
        assert!(details.command.contains("-J"));
        assert_eq!(details.stdout, Some("stdout text".to_string()));
        assert!(details.stderr.unwrap().contains("Errno 54"));
        assert!(details.hint.is_some());
    }
}

