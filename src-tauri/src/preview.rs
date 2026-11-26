use crate::{load_ffmpeg_config, split_ffmpeg_args};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::process::Command;

struct PreviewDirectory {
    path: PathBuf,
    keep_playback: bool,
}

impl PreviewDirectory {
    fn new() -> Result<Self, String> {
        static NEXT_ID: AtomicU64 = AtomicU64::new(0);
        let created = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "{}{}_{}",
            directory_prefix(),
            created.as_millis(),
            id
        ));
        std::fs::create_dir(&path).map_err(|e| format!("Cannot create preview directory: {e}"))?;
        Ok(Self {
            path,
            keep_playback: false,
        })
    }
}

impl Drop for PreviewDirectory {
    fn drop(&mut self) {
        if !self.keep_playback {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

fn directory_prefix() -> String {
    format!("szhimatar_preview_{}_", std::process::id())
}

fn preview_command(ffmpeg: &str) -> Command {
    let mut command = Command::new(ffmpeg);
    command.args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y"]);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    command
}

async fn run_preview_command(mut command: Command) -> Result<Vec<u8>, String> {
    let output = command
        .output()
        .await
        .map_err(|e| format!("Failed to run FFmpeg: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "FFmpeg: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output.stdout)
}

enum PreviewFrame {
    SourceJpeg,
    CompactJpeg,
    ComparisonPng,
}

async fn extract_frame(
    ffmpeg: &str,
    input: &Path,
    time: f64,
    frame: PreviewFrame,
) -> Result<Vec<u8>, String> {
    let mut command = preview_command(ffmpeg);
    command
        .args(["-ss", &format!("{time:.3}"), "-i"])
        .arg(input)
        .args(["-map", "0:V:0", "-frames:v", "1", "-f", "image2pipe"]);
    match frame {
        PreviewFrame::CompactJpeg => {
            command.kill_on_drop(true).args([
                "-vf",
                "scale=320:180:force_original_aspect_ratio=decrease:force_divisible_by=2",
                "-c:v",
                "mjpeg",
                "-q:v",
                "5",
            ]);
        }
        PreviewFrame::SourceJpeg => {
            command.args(["-c:v", "mjpeg", "-q:v", "2"]);
        }
        PreviewFrame::ComparisonPng => {
            // PNG has no display-aspect flag that WebViews consistently honor.
            command.args([
                "-vf",
                "scale=w='max(1,round(iw*sar))':h=ih,setsar=1",
                "-c:v",
                "png",
            ]);
        }
    }
    command.arg("-");
    let frame = run_preview_command(command).await?;
    if frame.is_empty() {
        return Err(format!("No video frame at {time:.3}s"));
    }
    Ok(frame)
}

/// Source thumbnail used by the queue's trim handles.
#[tauri::command]
pub async fn get_preview_frame(input_path: String, time_seconds: f64) -> Result<String, String> {
    let config = load_ffmpeg_config();
    let frame = extract_frame(
        &config.ffmpeg_path,
        Path::new(&input_path),
        time_seconds,
        PreviewFrame::SourceJpeg,
    )
    .await?;
    Ok(STANDARD.encode(frame))
}

#[tauri::command]
pub async fn get_recent_video_thumbnail(path: PathBuf, version: String) -> Result<String, String> {
    if !crate::recent_videos::is_ready_version(&path, &version) {
        return Err("Video is no longer ready".to_string());
    }
    let config = load_ffmpeg_config();
    let frame = tokio::time::timeout(
        std::time::Duration::from_secs(8),
        extract_frame(&config.ffmpeg_path, &path, 0.0, PreviewFrame::CompactJpeg),
    )
    .await
    .map_err(|_| "Video thumbnail timed out".to_string())??;
    Ok(STANDARD.encode(frame))
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PreviewMedia {
    Frame {
        original: String,
        processed: String,
        shared_aspect: Option<f64>,
    },
    Video {
        path: PathBuf,
        directory: String,
    },
}

fn png_aspect(bytes: &[u8]) -> Option<f64> {
    let width = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
    (height > 0).then_some(f64::from(width) / f64::from(height))
}

#[tauri::command]
pub async fn render_preview(
    input_path: String,
    sample_start: f64,
    sample_duration: f64,
    source_time: f64,
    frame_time: Option<f64>,
    output_extension: String,
    ffmpeg_args: Vec<String>,
) -> Result<PreviewMedia, String> {
    let config = load_ffmpeg_config();
    let ffmpeg = config.ffmpeg_path.trim();
    if ffmpeg.is_empty() {
        return Err("FFmpeg not configured".into());
    }
    if output_extension.is_empty() || !output_extension.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err("Invalid preview output extension".into());
    }

    let source = Path::new(&input_path);
    let mut temp = PreviewDirectory::new()?;
    let sample = temp.path.join(format!("encoded.{output_extension}"));
    let start = format!("{sample_start:.3}");
    let source_duration = format!("{:.3}", sample_duration.clamp(0.001, 5.0));
    let (input_args, output_args) = split_ffmpeg_args(&ffmpeg_args);
    let copy_video = output_args
        .windows(2)
        .any(|pair| pair[0] == "-c:v" && pair[1] == "copy");

    if !copy_video {
        let mut encode = preview_command(ffmpeg);
        encode
            .args(["-ss", &start, "-t", &source_duration])
            .args(input_args)
            .arg("-i")
            .arg(source)
            .args(output_args)
            .arg(&sample);
        run_preview_command(encode).await?;
    }

    if let Some(time) = frame_time {
        let original =
            extract_frame(ffmpeg, source, source_time, PreviewFrame::ComparisonPng).await?;
        let original_aspect = png_aspect(&original);
        if copy_video {
            let original = STANDARD.encode(original);
            return Ok(PreviewMedia::Frame {
                processed: original.clone(),
                original,
                shared_aspect: original_aspect,
            });
        }
        let processed = extract_frame(ffmpeg, &sample, time, PreviewFrame::ComparisonPng).await?;
        let shared_aspect = original_aspect
            .zip(png_aspect(&processed))
            .filter(|(before, after)| (before / after - 1.0).abs() < 0.01)
            .map(|(before, _)| before);
        return Ok(PreviewMedia::Frame {
            original: STANDARD.encode(original),
            processed: STANDARD.encode(processed),
            shared_aspect,
        });
    }

    // Decode the actual encoded sample before creating a WebView-compatible clip.
    let path = temp.path.join("playback.mp4");
    let mut playback = preview_command(ffmpeg);
    if copy_video {
        playback.args(["-ss", &start, "-t", &source_duration]);
    } else if output_extension == "gif" {
        playback.args(["-ignore_loop", "1"]);
    }
    playback
        .arg("-i")
        .arg(if copy_video { source } else { &sample })
        .args([
            "-map",
            "0:V:0",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "12",
            "-vf",
            "scale=ceil(iw/2)*2:ceil(ih/2)*2",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
        ])
        .arg(&path);
    run_preview_command(playback).await?;
    if !copy_video {
        std::fs::remove_file(&sample).map_err(|e| format!("Cannot remove encoded sample: {e}"))?;
    }
    let directory = temp
        .path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    temp.keep_playback = true;
    Ok(PreviewMedia::Video { path, directory })
}

#[tauri::command]
pub async fn release_preview(directory: String) {
    if let Some(id) = directory.strip_prefix(&directory_prefix()) {
        if id.split_once('_').is_some_and(|(created, sequence)| {
            created.parse::<u64>().is_ok() && sequence.parse::<u64>().is_ok()
        }) {
            let _ = tokio::fs::remove_dir_all(std::env::temp_dir().join(directory)).await;
        }
    }
}
