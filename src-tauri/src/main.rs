// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
